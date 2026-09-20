// SPDX-License-Identifier: Apache-2.0
/** 按实际依赖生成小程序 CommonJS 模块，普通依赖共享，Worklet 依赖随调用方内联。 */
import type { PlatformAdapter, PublicEnvironment } from './types.js'
import { build } from 'esbuild'
import ts from 'typescript'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { posixPath, exists } from './files.js'
import { resolvePlatform } from './platforms.js'
import { environmentDefines } from './env.js'
import { generatedRoutesPath, routesModuleName } from './route-module.js'
import { stripPageConfig, injectTabPage, inspectPageSource } from './page-config.js'
import { hasPackage, runtimeApiCompilation } from './api.js'

/** 将产物间引用转换为明确的相对路径，交由宿主模块缓存复用实例。 */
function moduleReference(importer: string, target: string) {
  const relative = posixPath(path.relative(path.dirname(importer), target))
  return relative.startsWith('.') ? relative : './' + relative
}

/** 模块编译需要的项目边界、入口和平台信息。 */
interface ModuleOptions {
  /** 真正执行原生注册的入口。 */
  entries: string[]
  /** 从页面元数据选出的自定义底栏入口。 */
  tabPages?: string[]
  /** 项目及源码根目录。 */
  root: string
  source: string
  /** 最终产物与暂存目录。 */
  output: string
  staging: string
  /** 是否生成压缩产物。 */
  production: boolean
  /** 明确公开的环境字段。 */
  environment: PublicEnvironment
  /** 平台钩子。 */
  adapter?: PlatformAdapter
  /** 原生组件包目录与产物前缀。 */
  componentRoots?: { directory: string; prefix: string }[]
  /** 重定位的原生组件入口。 */
  entryAliases?: { filename: string; relative: string }[]
  /** 当前环境不能访问的页面目录。 */
  excludedDirectories?: string[]
}

/** 从原生入口遍历依赖，只生成可达模块，不把普通工具文件视作启动入口。 */
export async function compileModules({
  entries,
  tabPages = [],
  root,
  source,
  output,
  staging,
  production,
  environment,
  adapter = resolvePlatform(),
  componentRoots = [],
  entryAliases = [],
  excludedDirectories = [],
}: ModuleOptions) {
  // pnpm 和 macOS 临时目录含符号链接，统一真实路径后判断模块身份及目录归属。
  root = await realpath(root)
  source = await realpath(source)
  entries = await Promise.all(entries.map((filename) => realpath(filename)))
  componentRoots = await Promise.all(
    componentRoots.map(async (item) => ({
      ...item,
      directory: await realpath(item.directory),
    })),
  )
  excludedDirectories = await Promise.all(
    excludedDirectories.map((directory) => realpath(directory)),
  )
  const modules = new Map<string, string>()
  const destinations = new Map()
  const nativeEntries = new Set(entries)
  const tabEntries = new Set(await Promise.all(tabPages.map((filename) => realpath(filename))))
  const files: string[] = []
  const aliases = new Map(await Promise.all(entryAliases.map(async (item) => [await realpath(item.filename), item.relative] as const)))
  // 平台适配器按需注入运行时；原生抖音和支付宝工程不依赖微信 Core。
  const frameworkRuntime = await adapter.runtime?.({ root, source })
  /** 从包的公开清单读取实际声明名，注入文件必须显式列出名称。 */
  const definitionsFile = frameworkRuntime && hasPackage(root, '@miniprogramlab/core')
    ? createRequire(path.join(root, 'package.json')).resolve('@miniprogramlab/core/definitions') : undefined
  const definitionNames = definitionsFile ? runtimeApiCompilation(definitionsFile).names : []
  /** 页面包装器和状态声明独立注入。 */
  const definitionSource = frameworkRuntime
    ? 'export { definePage, defineComponent } from ' + JSON.stringify(frameworkRuntime) + ';' +
      (definitionsFile ? 'export { ' + definitionNames.join(', ') + ' } from ' + JSON.stringify(definitionsFile) + ';' : '')
    : ''

  const apiFile = path.join(root, '.cache/api.generated.ts')
  const hasApi = await exists(apiFile)
  const api = hasApi ? runtimeApiCompilation(apiFile) : undefined
  /** Worklet 只能使用自身或显式 Worklet 模块提供的函数。 */
  const injectedNames = new Set([...(api?.names ?? []), ...(frameworkRuntime ? ['definePage', 'defineComponent', ...definitionNames] : [])])
  /** 纯导出清单可安全展开；带状态或执行语句的实现仍通过模块缓存共享。 */
  const apiBarrels = new Set([apiFile])
  const barrelCache = new Map<string, boolean>()
  /** 仅展开声明式清单，不复制模块中的实例或初始化过程。 */
  async function isApiBarrel(filename: string) {
    if (barrelCache.has(filename)) return barrelCache.get(filename)!
    const syntax = ts.createSourceFile(filename, await readFile(filename, 'utf8'), ts.ScriptTarget.Latest, true)
    const pure = syntax.statements.every((statement) => ts.isExportDeclaration(statement) || ts.isEmptyStatement(statement))
    barrelCache.set(filename, pure)
    return pure
  }

  /** 本地模块保留源码目录，外部依赖按相对工作区的稳定身份分配唯一产物。 */
  function register(filename: string) {
    if (modules.has(filename)) return modules.get(filename)!
    const owner = [{ directory: source, prefix: '' }, ...componentRoots].find(
      (item) => filename.startsWith(item.directory + path.sep),
    )
    const relative = aliases.get(filename) ?? (owner
      ? path.join(
          owner.prefix,
          path
            .relative(owner.directory, filename)
            .replace(/\.(?:[cm]?js|tsx?|json)$/, '.js'),
        )
      : path.join(
          'common/vendor',
          createHash('sha256')
            .update(posixPath(path.relative(root, filename)))
            .digest('hex')
            .slice(0, 16) + '.js',
        ))
    if (destinations.has(relative))
      throw new Error('模块产物路径冲突：' + relative)
    modules.set(filename, relative)
    destinations.set(relative, filename)
    return relative
  }

  for (const entry of entries) register(entry)
  const pending = new Set(entries)
  // 只追踪最终产物保留的导入，类型导入及被消除的注入依赖不会额外输出。
  for (const filename of pending) {
    const relative = modules.get(filename)!
    const dependencies = new Map()
    const result = await build({
      absWorkingDir: root,
      entryPoints: [filename],
      outfile: path.join(output, relative),
      write: false,
      bundle: true,
      platform: 'neutral',
      format: 'cjs',
      target: 'es2018',
      metafile: true,
      mainFields: ['module', 'main'],
      sourcemap: !production,
      minify: production,
      define: environmentDefines(environment, adapter),
      logLevel: 'silent',
      inject: frameworkRuntime || hasApi ? ['miniprogram:framework'] : [],
      plugins: [
        {
          name: 'miniprogram-common-modules',
          /** 普通依赖留作 require，显式标记的 Worklet 模块保持同一编译闭包。 */
          setup(context) {
            context.onLoad({ filter: /\.[cm]?[jt]s$/ }, async (args) => {
              if (args.path === apiFile && api) return { contents: api.contents, loader: 'ts' }
              if (!args.path.startsWith(source + path.sep)) return
              const content = await readFile(args.path, 'utf8')
              // 识别实际未绑定引用，局部同名函数与对象属性不受影响。
              if (/\.worklet\.[jt]s$/.test(args.path)) {
                const analysis = inspectPageSource(args.path, content, injectedNames)
                if (analysis.usedApis.size) throw new Error('Worklet 不能调用框架 API，请在逻辑线程中调用：' + [...analysis.usedApis].join(', ') + '，' + args.path)
              } else if (/\bmini\b/.test(content)) inspectPageSource(args.path, content)
              const runtime = stripPageConfig(args.path, content)
              return { contents: tabEntries.has(args.path) ? injectTabPage(args.path, runtime) : runtime, loader: /\.[cm]?ts$/.test(args.path) ? 'ts' : 'js' }
            })
            context.onResolve({ filter: /^miniprogram:framework$/ }, () => ({
              path: 'runtime',
              namespace: 'miniprogram-inject',
              sideEffects: false,
            }))
            context.onLoad({ filter: /.*/, namespace: 'miniprogram-inject' }, () => ({
              contents:
                definitionSource +
                (api ? 'export { ' + api.names.join(', ') + ' } from ' + JSON.stringify(apiFile) + ';' : ''),
              resolveDir: root,
              loader: 'js',
            }))
            context.onResolve({ filter: /.*/ }, async (args) => {
              if (args.kind === 'entry-point' || args.pluginData?.nativeResolve)
                return
              const navigation = args.path === '@miniprogramlab/core/router/platform'
              if (navigation && !adapter.navigationAdapter)
                return { errors: [{ text: '平台未声明路由 navigationAdapter：' + adapter.id }] }
              // 导航实现由构建平台注册表决定，普通 Router 无需导入全部平台。
              const navigationReference = navigation ? adapter.navigationAdapter! : args.path
              const referencePath = navigation && navigationReference.startsWith('.')
                ? path.resolve(root, navigationReference) : navigationReference
              adapter.validateDependency?.(referencePath)
              // 路由始终使用当前消费项目的生成结果，包内导入也无需维护别名。
              const resolved = await context.resolve(referencePath === routesModuleName ? generatedRoutesPath(root) : referencePath, {
                importer: args.importer,
                resolveDir: navigation ? root : args.resolveDir,
                kind: args.kind,
                pluginData: { nativeResolve: true },
              })
              if (resolved.errors.length) return { errors: resolved.errors }
              // API 的聚合入口在编译时展开，未使用的成员不会引入运行时依赖。
              if (resolved.path === apiFile) return { path: resolved.path, sideEffects: false }
              if (resolved.external || !resolved.path)
                return {
                  errors: [
                    { text: '小程序模块无法解析运行时依赖：' + args.path },
                  ],
                }
              if (
                excludedDirectories.some((directory) =>
                  resolved.path.startsWith(directory + path.sep),
                )
              ) {
                return {
                  errors: [
                    { text: '当前环境不能导入已排除页面的实现：' + args.path },
                  ],
                }
              }
              if (/\.worklet\.[jt]s$/.test(resolved.path)) {
                if (!adapter.worklets) return { errors: [{ text: adapter.label + '适配器不支持微信 Worklet：' + args.path }] }
                return { path: resolved.path }
              }
              if (/\.worklet\.[jt]s$/.test(args.importer)) {
                return {
                  errors: [
                    {
                      text:
                        'Worklet 的运行时依赖也必须使用 .worklet.ts，类型依赖请使用 import type：' +
                        args.path,
                    },
                  ],
                }
              }
              if (nativeEntries.has(resolved.path)) {
                return {
                  errors: [
                    {
                      text:
                        '普通模块不能导入原生注册入口，请将复用逻辑提取为独立模块：' +
                        args.path,
                    },
                  ],
                }
              }
              // 独立声明的清单也需展开，避免未知星号导出让每个模块保留整套注入依赖。
              if ((apiBarrels.has(args.importer) || args.namespace === 'miniprogram-inject') && await isApiBarrel(resolved.path)) {
                apiBarrels.add(resolved.path)
                return { path: resolved.path, sideEffects: false }
              }
              const target = register(resolved.path)
              const reference = moduleReference(relative, target)
              dependencies.set(reference, resolved.path)
              return {
                path: reference,
                external: true,
                sideEffects: apiBarrels.has(args.importer) || args.namespace === 'miniprogram-inject' ? false : resolved.sideEffects,
              }
            })
          },
        },
      ],
    })
    for (const emitted of Object.values(result.metafile!.outputs)) {
      for (const imported of emitted.imports) {
        if (dependencies.has(imported.path))
          pending.add(dependencies.get(imported.path))
      }
    }
    for (const file of result.outputFiles!) {
      const target = path.relative(output, file.path)
      await mkdir(path.dirname(path.join(staging, target)), { recursive: true })
      await writeFile(path.join(staging, target), file.contents)
      files.push(target)
    }
  }
  return files
}
