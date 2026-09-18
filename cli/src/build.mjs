/** 编译 TS、SCSS、页面配置和 npm 依赖，所有环境共用同一产物目录。 */
import { compileStyle } from './styles.mjs'
import { createRequire } from 'node:module'
import { constants } from 'node:fs'
import { watchDirectories } from './watch.mjs'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnvironment } from './env.mjs'
import { exists, listFiles, writeJson } from './files.mjs'
import { createComponentCollector } from './npm-components.mjs'
import { readConfig } from './config.mjs'
import {
  validateSkylineApp,
  validateSkylineProject,
  validateSkylineRenderer,
} from './skyline.mjs'
import { validateCustomTabBar } from './tab-bar.mjs'
import { buildWithStaging } from './output.mjs'
import { compileModules } from './modules.mjs'
import { discoverRoutes, writeRouteTypes } from './routes.mjs'
import { spawnSync } from 'node:child_process'

/** 从消费项目执行完整构建，可由 CLI 或其他 Node 工具调用。 */
export async function buildProject(options) {
  const { root, source, output, mode } = options
  const values = options
  const production = mode === 'production'
  const privateName = 'project.private.config.json'

  /** 仅首次初始化私有配置，任何模式下均不改写已有文件。 */
  async function ensurePrivateConfig() {
    await mkdir(output, { recursive: true })
    const destination = path.join(output, privateName)
    if (await exists(destination)) return
    const custom = path.join(root, privateName)
    if (!(await exists(custom)) && !(await exists(path.join(root, 'project.private.config.example.json')))) {
      await writeFile(destination, '{}\n', { flag: 'wx' }).catch((error) => { if (error.code !== 'EEXIST') throw error })
      return
    }
    try {
      // 首次检查后开发者工具可能已创建私有配置，排他复制避免覆盖新内容。
      await copyFile(
        (await exists(custom))
          ? custom
          : path.join(root, 'project.private.config.example.json'),
        destination,
        constants.COPYFILE_EXCL,
      )
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
  }

  /** 在暂存目录完成环境加载、配置校验、样式编译和全部脚本打包。 */
  async function generateBuild(targetDirectory) {
    const environment = await loadEnvironment(root, mode)
    const sourceFiles = await listFiles(source)
    const sourceConfig = await readConfig(
      path.join(source, 'app.config.ts'),
      environment,
      'app',
    )
    validateSkylineApp(sourceConfig, path.join(source, 'app.config.ts'))
    const contract = await discoverRoutes({
      files: sourceFiles,
      source,
      appConfig: sourceConfig,
      environment,
    })
    const { pages, pageNames, pageConfigs, appConfig, excludedDirectories } =
      contract
    const files = sourceFiles.filter(
      (filename) =>
        !excludedDirectories.some((directory) =>
          filename.startsWith(directory + path.sep),
        ),
    )
    await writeRouteTypes(root, contract)
    if (values.typecheck) {
      // 路由类型准备完成后再检查，首次检出及不同环境均不依赖旧缓存。
      const result = spawnSync(
        process.execPath,
        [fileURLToPath(import.meta.resolve('typescript/bin/tsc')), '--noEmit'],
        { cwd: root, stdio: 'inherit' },
      )
      if (result.error) throw result.error
      if (result.status !== 0) throw new Error('TypeScript 类型检查失败')
    }
    await validateCustomTabBar(appConfig, {
      source,
      pages,
      pageConfigs,
      environment,
      packageEntry: options.customTabBar,
    })
    const project = JSON.parse(
      await readFile(path.join(root, 'project.config.json'), 'utf8'),
    )
    validateSkylineProject(project, path.join(root, 'project.config.json'))
    const keep = new Set(['project.config.json', 'pages.json', 'app.json'])
    const collector = createComponentCollector(root, targetDirectory, keep, { source, production, environment })
    if (appConfig.tabBar?.custom && options.customTabBar) {
      await collector.addNative(options.customTabBar, 'custom-tab-bar/index')
    }
    await writeJson(path.join(targetDirectory, 'pages.json'), pageNames)
    await writeJson(
      path.join(targetDirectory, 'app.json'),
      await collector.rewrite({ ...appConfig, pages }),
    )
    await writeJson(path.join(targetDirectory, 'project.config.json'), {
      ...project,
      appid: environment.appid,
    })

    const entries = [
      path.join(source, 'app.ts'),
      ...pages.map((route) => path.join(source, route + '.ts')),
    ]
    for (const filename of files) {
      const relative = path.relative(source, filename)
      if (
        filename.endsWith('.d.ts') ||
        filename === path.join(source, 'app.config.ts')
      )
        continue
      if (filename.endsWith('.config.ts')) {
        const target = relative.replace(/\.config\.ts$/, '.json')
        keep.add(target)
        const config =
          pageConfigs.get(filename) ?? (await readConfig(filename, environment))
        validateSkylineRenderer(config, filename)
        if (config.component === true) {
          const entry = filename.replace(/\.config\.ts$/, '.ts')
          if (
            !(await exists(entry)) ||
            !(await exists(entry.replace(/\.ts$/, '.wxml')))
          ) {
            throw new Error('组件入口缺少脚本或模板：' + filename)
          }
          entries.push(entry)
        }
        await writeJson(
          path.join(targetDirectory, target),
          await collector.rewrite(config),
        )
      } else if (filename.endsWith('.ts')) {
        // 普通 TS 只由实际依赖遍历收集，未被使用的模块不会进入产物。
        continue
      } else if (/\.(scss|less)$/.test(filename)) {
        // 下划线文件为 SCSS 局部模块，供 @use 引用，不单独输出。
        if (path.basename(filename).startsWith('_')) continue
        const target = relative.replace(/\.(scss|less)$/, '.wxss')
        if (files.includes(path.join(source, target)))
          throw new Error('SCSS 与 WXSS 输出重名：' + target)
        const compiled = await compileStyle(filename, { root, source, production })
        keep.add(target)
        await mkdir(path.dirname(path.join(targetDirectory, target)), {
          recursive: true,
        })
        await writeFile(path.join(targetDirectory, target), compiled)
      } else {
        if (
          relative === 'app.json' ||
          relative === 'pages.json' ||
          (filename.endsWith('.json') &&
            (await exists(filename.replace(/\.json$/, '.config.ts'))))
        ) {
          throw new Error('手写 JSON 与自动生成配置冲突：' + relative)
        }
        keep.add(relative)
        await mkdir(path.dirname(path.join(targetDirectory, relative)), {
          recursive: true,
        })
        await copyFile(filename, path.join(targetDirectory, relative))
      }
    }
    const components = await collector.emit()
    const scripts = await compileModules({
      entries: [...entries, ...components.entries],
      componentRoots: components.roots,
      entryAliases: components.aliases,
      excludedDirectories,
      root,
      source,
      output,
      staging: targetDirectory,
      production,
      environment: environment.public,
    })
    for (const filename of scripts) keep.add(filename)
    // 预期产物齐全才允许提交，额外生成的许可证等文件也随实际清单一同保留。
    for (const relative of keep) {
      if (!(await exists(path.join(targetDirectory, relative))))
        throw new Error('构建缺少预期产物：' + relative)
    }
    return pages.length
  }

  /** 编译失败保留旧产物，提交失败回滚已修改的文件；成功后才报告完成。 */
  async function buildOnce() {
    const pageCount = await buildWithStaging(
      output,
      generateBuild,
      ensurePrivateConfig,
    )
    console.log(
      '微信编译完成：环境=' + mode + '，页面=' + pageCount + '，目录=' + output,
    )
  }

  /** 监听源码、环境文件和共用包输出，串行防抖避免重复构建互相覆盖。 */
  async function main() {
    await buildOnce()
    if (!values.watch) return
    let pending = Promise.resolve()
    let timer
    let stopped = false
    /** 将文件变更合并为一次完整构建，失败时继续监听后续修正。 */
    function schedule() {
      if (stopped) return
      clearTimeout(timer)
      timer = setTimeout(() => {
        pending = pending
          .then(buildOnce)
          .catch((error) => console.error('微信编译失败：', error.message))
      }, 80)
    }
    const targets = [
      { directory: source, recursive: true },
      { directory: root, recursive: false, filter: (filename) => filename.startsWith('.env') || ['project.config.json', 'package.json', 'tsconfig.json'].includes(filename) },
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
      stopped = true
      clearTimeout(timer)
      watcher.close()
      await pending
      process.exit(0)
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    console.log(
      '正在监听 TS、SCSS、页面配置、.env 文件和共用包；切换环境请重启命令并指定 --mode。',
    )
  }

  await main()
}
