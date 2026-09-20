// SPDX-License-Identifier: Apache-2.0
import type { BuildOptions, NativeConfig } from './types.js'
import type { WatchTarget } from './watch.js'
import { logger, errorMessage, errorCode, BuildProgress } from './logger.js'
import { BuildReporter, type BuildSummary } from './reporter.js'
/** 编译 TS、SCSS、页面配置和 npm 依赖，所有环境共用同一产物目录。 */
import { compileStyle } from './styles.js'
import { createRequire } from 'node:module'
import { constants } from 'node:fs'
import { watchDirectories } from './watch.js'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnvironment } from './env.js'
import { exists, listFiles, writeJson, scriptEntry } from './files.js'
import { createComponentCollector } from './npm-components.js'
import { readConfig } from './config.js'
import { resolvePlatform, isForeignAsset } from './platforms.js'
import { buildWithStaging } from './output.js'
import { compileModules } from './modules.js'
import { discoverRoutes, writeRoutesModule } from './routes.js'
import { spawn } from 'node:child_process'

/** 从消费项目执行完整构建，可由 CLI 或其他 Node 工具调用。 */
export async function buildProject(options: BuildOptions) {
  const { root, source, output, mode } = options
  const adapter = options.adapter ?? resolvePlatform(options.platform)
  const values = options
  const production = mode === 'production'
  const privateName = adapter.privateConfigFile
  const reporter = new BuildReporter({ ...options, adapter })
  let progress: BuildProgress | undefined

  /** 仅首次初始化私有配置，任何模式下均不改写已有文件。 */
  async function ensurePrivateConfig() {
    await mkdir(output, { recursive: true })
    if (!privateName) return
    const destination = path.join(output, privateName)
    if (await exists(destination)) return
    const custom = path.join(root, privateName)
    if (!(await exists(custom)) && !(await exists(path.join(root, privateName.replace(/\.json$/, '.example.json'))))) {
      await writeFile(destination, '{}\n', { flag: 'wx' }).catch((error) => { if (errorCode(error) !== 'EEXIST') throw error })
      return
    }
    try {
      // 首次检查后开发者工具可能已创建私有配置，排他复制避免覆盖新内容。
      await copyFile(
        (await exists(custom))
          ? custom
          : path.join(root, privateName.replace(/\.json$/, '.example.json')),
        destination,
        constants.COPYFILE_EXCL,
      )
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error
    }
  }

  /** 在暂存目录完成环境加载、配置校验、样式编译和全部脚本打包。 */
  async function generateBuild(targetDirectory: string) {
    progress?.update('1/6 解析配置与路由')
    const environment = await loadEnvironment(root, mode, adapter)
    const sourceFiles = await listFiles(source)
    const sourceConfig = await readConfig(
      path.join(source, 'app.config.ts'),
      environment,
      'app',
    )
    adapter.validateApp(sourceConfig, path.join(source, 'app.config.ts'))
    const contract = await discoverRoutes({
      files: sourceFiles,
      source,
      appConfig: sourceConfig,
      environment, adapter,
    })
    const { pages, pageNames, pageConfigs, pageConfigFiles, appConfig, excludedDirectories } =
      contract
    const files = sourceFiles.filter(
      (filename) =>
        !excludedDirectories.some((directory) =>
          filename.startsWith(directory + path.sep),
        ),
    )
    await writeRoutesModule(root, contract, adapter, source)
    progress?.complete(`源码 ${sourceFiles.length} 个文件；启用 ${pages.length} 个页面，排除 ${excludedDirectories.length} 个页面目录`)
    progress?.update('2/6 校验类型与平台能力')
    if (values.typecheck) {
      // 使用异步子进程检查类型，终端仍可刷新当前阶段动画。
      await new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, [fileURLToPath(import.meta.resolve('typescript/bin/tsc')), '--noEmit'], {
          cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
        })
        let diagnostics = ''
        child.stdout.on('data', (chunk: Buffer) => { diagnostics += chunk.toString() })
        child.stderr.on('data', (chunk: Buffer) => { diagnostics += chunk.toString() })
        child.once('error', reject)
        child.once('close', (code) => {
          if (diagnostics.trim()) {
            if (code === 0) logger.info(diagnostics.trimEnd())
            else logger.error(diagnostics.trimEnd())
          }
          if (code === 0) resolve()
          else reject(new Error('TypeScript 类型检查失败'))
        })
      })
    }
    await adapter.validateTabs(appConfig, {
      source,
      pages,
      pageConfigs,
      environment,
      packageEntry: options.customTabBar,
    })
    const projectFile = path.resolve(root, options.projectConfig || adapter.projectFile)
    const project = JSON.parse(await readFile(projectFile, 'utf8'))
    if (!project || typeof project !== 'object' || Array.isArray(project)) throw new Error('工程配置必须是对象：' + projectFile)
    adapter.validateProject?.(project, projectFile)
    progress?.complete(`平台与工程配置校验通过；${values.typecheck ? 'TypeScript 类型检查通过' : '未执行 TypeScript 类型检查'}`)
    progress?.update('3/6 编译模板、样式与资源')
    const keep = new Set([adapter.projectFile, 'pages.json', 'app.json'])
    const collector = createComponentCollector(root, targetDirectory, keep, { source, production, environment, adapter })
    for (const entry of adapter.nativeEntries?.(appConfig, options) ?? []) {
      await collector.addNative(entry.reference, entry.destination)
    }
    await writeJson(path.join(targetDirectory, 'pages.json'), pageNames)
    await writeJson(
      path.join(targetDirectory, 'app.json'),
      await collector.rewrite({ ...appConfig, pages }),
    )
    await writeJson(path.join(targetDirectory, adapter.projectFile), adapter.projectConfig(project, environment))
    // 配置文件可任意命名或与页面共存，JSON 输出只取决于原生页面入口。
    for (const route of pages) {
      const target = route + '.json'
      keep.add(target)
      await writeJson(path.join(targetDirectory, target), await collector.rewrite(pageConfigs.get(path.join(source, route))!))
    }

    const entries = [
      await scriptEntry(path.join(source, 'app')),
      ...await Promise.all(pages.map((route) => scriptEntry(path.join(source, route)))),
    ]
    /** 按实际处理结果统计应用资源，npm 组件在下一阶段单独统计。 */
    const resources = { templates: 0, styles: 0, assets: 0, components: 0 }
    /** 本地源码组件与原生 JSON 组件都作为真正入口进入共享模块图。 */
    async function collectLocalComponent(config: NativeConfig, base: string, filename: string) {
      adapter.validateConfig(config, filename)
      if (config.component !== true) return
      const entry = await scriptEntry(base)
      if (!(await exists(base + adapter.templateExtension))) throw new Error('组件入口缺少平台模板：' + filename)
      entries.push(entry)
      resources.components++
    }
    for (const filename of files) {
      const relative = path.relative(source, filename)
      if (isForeignAsset(filename, adapter)) continue
      if (filename.endsWith('.json') && pageConfigs.has(filename.slice(0, -5)))
        throw new Error('手写 JSON 与自动生成配置冲突：' + relative)
      if (filename.endsWith('.json') && await exists(filename.replace(/\.json$/, '.config.ts')))
        throw new Error('手写 JSON 与自动生成配置冲突：' + relative)
      if (
        filename.endsWith('.d.ts') ||
        filename === path.join(source, 'app.config.ts') ||
        pageConfigFiles.has(filename)
      )
        continue
      if (filename.endsWith('.config.ts')) {
        const target = relative.replace(/\.config\.ts$/, '.json')
        keep.add(target)
        const config =
          pageConfigs.get(filename) ?? (await readConfig(filename, environment))
        await collectLocalComponent(config, filename.replace(/\.config\.ts$/, ''), filename)
        await writeJson(
          path.join(targetDirectory, target),
          await collector.rewrite(config),
        )
      } else if (/\.[cm]?[jt]s$/.test(filename)) {
        // 普通 TS 只由实际依赖遍历收集，未被使用的模块不会进入产物。
        continue
      } else if (/\.(scss|less)$/.test(filename)) {
        // 下划线文件为 SCSS 局部模块，供 @use 引用，不单独输出。
        if (path.basename(filename).startsWith('_')) continue
        const target = relative.replace(/\.(scss|less)$/, adapter.styleExtension)
        if (keep.has(target) || files.includes(path.join(source, target)))
          throw new Error('样式输出重名：' + target)
        const compiled = await compileStyle(filename, { root, source, production })
        keep.add(target)
        await mkdir(path.dirname(path.join(targetDirectory, target)), {
          recursive: true,
        })
        await writeFile(path.join(targetDirectory, target), compiled)
        resources.styles++
      } else {
        if (
          relative === 'app.json' ||
          relative === 'pages.json' ||
          (filename.endsWith('.json') &&
            (await exists(filename.replace(/\.json$/, '.config.ts'))))
        ) {
          throw new Error('手写 JSON 与自动生成配置冲突：' + relative)
        }
        if (keep.has(relative)) throw new Error('资源与生成产物重名：' + relative)
        if (filename.endsWith('.json')) {
          const config = JSON.parse(await readFile(filename, 'utf8'))
          if (config?.component === true) {
            await collectLocalComponent(config, filename.slice(0, -5), filename)
            keep.add(relative)
            await writeJson(path.join(targetDirectory, relative), await collector.rewrite(config))
            continue
          }
        }
        keep.add(relative)
        await mkdir(path.dirname(path.join(targetDirectory, relative)), {
          recursive: true,
        })
        await copyFile(filename, path.join(targetDirectory, relative))
        if (filename.endsWith(adapter.templateExtension)) resources.templates++
        else if (filename.endsWith(adapter.styleExtension)) resources.styles++
        else resources.assets++
      }
    }
    progress?.complete(`模板 ${resources.templates} 个；样式 ${resources.styles} 个；其他资源 ${resources.assets} 个`)
    progress?.update('4/6 收集原生组件')
    const components = await collector.emit()
    progress?.complete(`依赖包 ${components.roots.length} 个；npm 组件 ${components.entries.length} 个；本地组件 ${resources.components} 个`)
    progress?.update('5/6 编译脚本依赖图')
    const scripts = await compileModules({
      entries: [...entries, ...components.entries],
      // 原生底栏由平台管理；自定义底栏页面才接入 Core 的同步和留白行为。
      tabPages: appConfig.tabBar?.custom === true
        ? await Promise.all(contract.routes.filter((route) => route.available && route.kind === 'tab')
            .map((route) => scriptEntry(path.join(source, route.path))))
        : [],
      componentRoots: components.roots,
      entryAliases: components.aliases,
      excludedDirectories,
      root,
      source,
      output,
      staging: targetDirectory,
      production,
      environment: environment.public, adapter,
    })
    for (const filename of scripts) keep.add(filename)
    // 模块编译结果同时包含映射文件，分别统计，避免把 Source Map 误算为脚本。
    const scriptCount = scripts.filter((filename) => filename.endsWith('.js')).length
    const sourceMapCount = scripts.filter((filename) => filename.endsWith('.map')).length
    progress?.complete(`编译入口 ${new Set([...entries, ...components.entries]).size} 个；JavaScript ${scriptCount} 个；Source Map ${sourceMapCount} 个`)
    progress?.update('6/6 校验并写入产物')
    // 预期产物齐全才允许提交，额外生成的许可证等文件也随实际清单一同保留。
    for (const relative of keep) {
      if (!(await exists(path.join(targetDirectory, relative))))
        throw new Error('构建缺少预期产物：' + relative)
    }
    const generatedFiles = await listFiles(targetDirectory)
    const sizes = await Promise.all(generatedFiles.map(async (filename) => (await stat(filename)).size))
    return {
      pages: pages.length, localComponents: resources.components, npmComponents: components.entries.length,
      scripts: scriptCount, sourceMaps: sourceMapCount,
      files: generatedFiles.length, bytes: sizes.reduce((total, size) => total + size, 0),
    } satisfies BuildSummary
  }

  /** 编译失败保留旧产物，提交失败回滚已修改的文件；成功后才报告完成。 */
  async function buildOnce(changes: string[] = []) {
    progress = reporter.begin(changes)
    try {
      const hadPrivateConfig = privateName ? await exists(path.join(output, privateName)) : false
      const summary = await buildWithStaging(output, generateBuild, ensurePrivateConfig)
      progress.complete(`已校验 ${summary.files} 个文件，产物目录同步完成`)
      reporter.success(summary, hadPrivateConfig)
    } catch (error) {
      progress.fail()
      reporter.failure()
      throw error
    } finally {
      progress.stop()
      progress = undefined
    }
  }

  /** 监听源码、环境文件和共用包输出，串行防抖避免重复构建互相覆盖。 */
  async function main() {
    reporter.session(await exists(options.configFile))
    try { await buildOnce() }
    catch (error) {
      if (!values.watch) throw error
      logger.error(errorMessage(error))
    }
    if (!values.watch) return
    let pending = Promise.resolve()
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    /** 防抖窗口内记录全部变更路径，同一路径只报告一次。 */
    const changes = new Set<string>()
    /** 将文件变更合并为一次完整构建，失败时继续监听后续修正。 */
    function schedule(filenames: string[]) {
      if (stopped) return
      for (const filename of filenames) changes.add(filename)
      clearTimeout(timer)
      timer = setTimeout(() => {
        const batch = [...changes].sort()
        changes.clear()
        pending = pending
          .then(() => { if (!stopped) return buildOnce(batch) })
          .catch((error) => logger.error(errorMessage(error)))
          .finally(() => { if (!stopped) reporter.waiting() })
      }, 80)
    }
    const targets: WatchTarget[] = [
      { directory: source, recursive: true },
      { directory: root, recursive: false, filter: (filename) => filename.startsWith('.env') || [options.projectConfig || adapter.projectFile, 'package.json', 'tsconfig.json'].includes(filename) },
    ]
    // 依赖包的源码变更也触发重编译，发布 tarball 与 workspace 链接采用相同逻辑。
    const dependencyDirectories = new Set((options.watchDirectories ?? []).map((directory) => path.resolve(root, directory)))
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
    const resolver = createRequire(path.join(root, 'package.json'))
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      try { dependencyDirectories.add(path.dirname(resolver.resolve(name + '/package.json'))) }
      catch { /* 未导出清单的第三方包可通过 watchDirectories 显式添加。 */ }
    }
    for (const directory of dependencyDirectories) {
      if (await exists(directory)) targets.push({ directory, recursive: true })
    }
    const watcher = await watchDirectories(targets, schedule, { poll: options.poll })
    /** 退出前完成正在执行的构建并关闭全部监听器。 */
    async function stop() {
      if (stopped) return
      stopped = true
      clearTimeout(timer)
      watcher.close()
      await pending
      logger.info('开发监听已停止。')
      process.exit(0)
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    reporter.watching(targets, watcher.mode)
  }

  await main()
}
