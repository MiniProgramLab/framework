// SPDX-License-Identifier: Apache-2.0
/** 从页面配置生成唯一的注册列表、Tab 列表与类型化运行时路由表。 */
import type { DiscoveredRoute, NativeConfig, BuildEnvironment, PlatformAdapter, BuildOptions } from './types.js'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { exists, listFiles, posixPath, scriptEntry } from './files.js'
import { inspectPageSource, isPageScript } from './page-config.js'
import { readConfig } from './config.js'
import { normalizePageOptions } from './page-options.js'
import { loadEnvironment } from './env.js'
import { resolvePlatform } from './platforms.js'
import { writeRoutesModule } from './route-module.js'

/** 供独立构建工具复用同一套路由和类型生成逻辑。 */
export { writeRoutesModule } from './route-module.js'

/** 页面目录是环境过滤边界，禁止关闭某页时连带排除仍启用的同目录页面。 */
function excludedPageDirectories(routes: DiscoveredRoute[], source: string) {
  const excluded = routes
    .filter((route) => !route.available)
    .map((route) => path.dirname(path.join(source, route.path)))
  for (const route of routes.filter((item) => item.available)) {
    const filename = path.join(source, route.path)
    if (
      excluded.some((directory) => filename.startsWith(directory + path.sep))
    ) {
      throw new Error(
        '环境专用页面必须放在独立目录，不能包含仍启用的页面：' + route.name,
      )
    }
  }
  return [...new Set(excluded)]
}

/** 自动发现页面及元数据，不执行或依赖生成后的运行时路由模块。 */
export async function discoverRoutes({
  files,
  source,
  appConfig,
  environment,
  adapter = resolvePlatform(),
}: { files: string[]; source: string; appConfig: NativeConfig; environment: BuildEnvironment; adapter?: PlatformAdapter }) {
  /** 同目录只有一个页面入口和一处配置声明，避免按文件名猜测配置归属。 */
  const directories = new Map<string, { entries: string[]; configs: string[] }>()
  for (const filename of files.filter((item) => item.startsWith(path.join(source, 'pages') + path.sep) && isPageScript(item)).sort()) {
    const directory = path.dirname(filename)
    const record = directories.get(directory) ?? { entries: [], configs: [] }
    directories.set(directory, record)
    const declaration = inspectPageSource(filename, await readFile(filename, 'utf8'))
    for (const _ of declaration.configs) record.configs.push(filename)
    // 原生 Page 工程与现有模板入口沿用同一发现规则，组件不作为页面注册。
    if (/\.[jt]s$/.test(filename) && (declaration.page || (!declaration.component && await exists(filename.slice(0, -3) + adapter.templateExtension)))) {
      record.entries.push(filename)
    }
  }
  const definitions: { filename: string; base: string }[] = []
  for (const [directory, { entries, configs }] of directories) {
    if (!entries.length && !configs.length) continue
    if (entries.length !== 1) throw new Error('页面目录必须且只能包含一个页面入口：' + directory + (entries.length ? '\n' + entries.join('\n') : '（配置缺少对应页面）'))
    if (!configs.length) throw new Error('页面缺少配置，请在同目录文件中直接调用 definePageConfig()：' + entries[0])
    if (configs.length !== 1) throw new Error('页面配置重复，同目录必须且只能直接调用一次 definePageConfig()：\n' + configs.join('\n'))
    definitions.push({ filename: configs[0]!, base: entries[0]!.slice(0, -3) })
  }
  if (
    ['pages', 'subPackages', 'subpackages', 'entryPagePath'].some((key) =>
      Object.hasOwn(appConfig, key),
    )
  ) {
    throw new Error(
      '页面路径由路由契约生成，请使用 entryPageName；分包需先扩展页面发现规则',
    )
  }
  if (appConfig.tabBar && ['list', 'items'].some((key) => Object.hasOwn(appConfig.tabBar, key)))
    throw new Error('Tab 列表由页面 page.tabBar 生成，不能手写 tabBar.list 或 tabBar.items')
  const routes: DiscoveredRoute[] = []
  const names = new Set()
  const tabIds = new Set()
  const tabOrders = new Set()
  const pageConfigs = new Map<string, NativeConfig>()
  /** 配置源码用于跳过组件配置读取；产物始终按页面入口命名。 */
  const pageConfigFiles = new Set(definitions.map((item) => item.filename))
  for (const { filename, base } of definitions) {
    await scriptEntry(base)
    const options = normalizePageOptions(await readConfig(filename, environment, 'page'), filename, environment.public.mode)
    const { name, description, kind, params, tab, available, config } = options
    if (names.has(name)) throw new Error('page.name 重复：' + name + '（' + filename + '）')
    names.add(name)
    // 仅启用页面需要模板和样式；未启用的环境专属目录完整排除。
    if (available) {
      if (!(await exists(base + adapter.templateExtension))) throw new Error('页面缺少源码：' + base + adapter.templateExtension)
      if (!(await Promise.all(['.scss', '.less', adapter.styleExtension].map((suffix) => exists(base + suffix)))).some(Boolean))
        throw new Error('页面缺少 SCSS、Less 或平台原生样式：' + base)
    }
    if (tab) {
      if (tabIds.has(tab.id) || tabOrders.has(tab.order)) throw new Error('Tab 的 id、order 重复：' + filename)
      tabIds.add(tab.id)
      tabOrders.add(tab.order)
    }
    const route: DiscoveredRoute = {
      name, description, path: posixPath(path.relative(source, base)), kind, available, params,
      ...(tab ? { tab } : {}),
    }
    routes.push(route)
    if (route.available)
      pageConfigs.set(
        base,
        adapter.pageConfig(
          { ...config, usingComponents: config.usingComponents ?? {} },
          filename,
        ),
      )
  }
  const entry = routes.find(
    (route) => route.name === appConfig.entryPageName && route.available,
  )
  if (!entry) throw new Error('entryPageName 必须对应当前环境已启用的页面')
  if (Object.values(entry.params).some((rule) => rule.required))
    throw new Error('应用入口不能要求必填查询参数')
  const tabs = routes
    .filter((route): route is (typeof routes)[number] & { tab: NonNullable<DiscoveredRoute['tab']> } => route.available && route.kind === 'tab')
    .sort((a, b) => a.tab.order - b.tab.order)
  if (tabs.length && !appConfig.tabBar)
    throw new Error('声明 Tab 页面时必须同时配置应用 tabBar 外观')
  const pages = routes
    .filter((route) => route.available)
    .map((route) => route.path)
    .sort((a, b) =>
      a === entry.path ? -1 : b === entry.path ? 1 : a.localeCompare(b),
    )
  const pageNames = Object.fromEntries(
    routes
      .filter((route) => route.available)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((route) => [route.name, route.path]),
  )
  const { entryPageName, ...nativeConfig } = appConfig
  return {
    pages,
    pageNames,
    pageConfigs,
    pageConfigFiles,
    routes,
    entryPageName,
    excludedDirectories: excludedPageDirectories(routes, source),
    appConfig: adapter.appConfig(nativeConfig, { entry, tabs, pages }),
  }
}

/** 类型检查前准备路由常量、应用类型和解析配置，不修改原生产物。 */
export async function prepareRoutes({ root, source, mode, adapter = resolvePlatform() }: Pick<BuildOptions, 'root' | 'source' | 'mode'> & { adapter?: PlatformAdapter }) {
  const environment = await loadEnvironment(root, mode, adapter)
  const appConfig = await readConfig(path.join(source, 'app.config.ts'), environment, 'app')
  const contract = await discoverRoutes({ files: await listFiles(source), source, appConfig, environment, adapter })
  await writeRoutesModule(root, contract, adapter, source)
}
