/** 从页面配置生成唯一的注册列表、Tab 列表与类型化运行时路由表。 */
import path from 'node:path'
import { exists, listFiles, posixPath } from './files.mjs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { readConfig } from './config.mjs'
import { loadEnvironment } from './env.mjs'
import { withSkylinePage } from './skyline.mjs'

/** 校验参数规则，Tab 路由保持无查询参数，普通页支持明确的标量参数。 */
function querySchema(route, filename) {
  const params = route.params ?? {}
  if (!params || typeof params !== 'object' || Array.isArray(params))
    throw new Error('路由 params 必须为对象：' + filename)
  if (route.kind === 'tab' && Object.keys(params).length)
    throw new Error('Tab 路由不能声明查询参数：' + filename)
  for (const [name, rule] of Object.entries(params)) {
    if (
      !/^[A-Za-z][A-Za-z0-9_]*$/.test(name) ||
      !rule ||
      !['string', 'number', 'boolean'].includes(rule.type) ||
      (rule.required !== undefined && typeof rule.required !== 'boolean')
    ) {
      throw new Error('路由参数规则无效：' + name + '（' + filename + '）')
    }
  }
  return params
}

/** 页面目录是环境过滤边界，禁止关闭某页时连带排除仍启用的同目录页面。 */
function excludedPageDirectories(routes, source) {
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
}) {
  for (const filename of files) {
    if (
      filename.startsWith(path.join(source, 'pages') + path.sep) &&
      filename.endsWith('.ts') &&
      !filename.endsWith('.config.ts') &&
      !filename.endsWith('.d.ts') &&
      (await exists(filename.slice(0, -3) + '.wxml')) &&
      !(await exists(filename.slice(0, -3) + '.config.ts'))
    ) {
      throw new Error('页面缺少配置：' + filename)
    }
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
  if (appConfig.tabBar && Object.hasOwn(appConfig.tabBar, 'list'))
    throw new Error('Tab 列表由页面 route.tab 生成，不能手写 tabBar.list')
  const routes = []
  const names = new Set()
  const tabIds = new Set()
  const tabOrders = new Set()
  const pageConfigs = new Map()
  for (const filename of files) {
    if (
      !filename.startsWith(path.join(source, 'pages') + path.sep) ||
      !filename.endsWith('.config.ts')
    )
      continue
    const base = filename.slice(0, -10)
    for (const suffix of ['.ts', '.wxml']) {
      if (!(await exists(base + suffix)))
        throw new Error('页面缺少源码：' + base + suffix)
    }
    if (!(await Promise.all(['.scss', '.less', '.wxss'].map((suffix) => exists(base + suffix)))).some(Boolean))
      throw new Error('页面缺少 SCSS、Less 或 WXSS 样式：' + base)
    const {
      pagesName: name,
      route: metadata = {},
      ...config
    } = await readConfig(filename, environment, 'page')
    if (
      typeof name !== 'string' ||
      !/^[A-Za-z][A-Za-z0-9_]*$/.test(name) ||
      names.has(name)
    ) {
      throw new Error('pagesName 无效或重复：' + name + '（' + filename + '）')
    }
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
      throw new Error('route 必须为对象：' + filename)
    names.add(name)
    const kind = metadata.kind ?? 'page'
    if (!['page', 'tab'].includes(kind))
      throw new Error('路由 kind 只能为 page 或 tab：' + filename)
    const environments = metadata.environments
    if (
      environments !== undefined &&
      (!Array.isArray(environments) ||
        !environments.length ||
        environments.some(
          (mode) => typeof mode !== 'string' || !/^[a-z][a-z0-9-]*$/.test(mode),
        ))
    ) {
      throw new Error('路由 environments 必须为非空环境名称数组：' + filename)
    }
    const route = {
      name,
      path: posixPath(path.relative(source, base)),
      kind,
      available:
        !environments || environments.includes(environment.public.mode),
      params: querySchema({ ...metadata, kind }, filename),
    }
    if (kind === 'tab') {
      const tab = metadata.tab
      if (
        !tab ||
        !Number.isInteger(tab.order) ||
        tab.order < 0 ||
        tabOrders.has(tab.order) ||
        typeof tab.id !== 'string' ||
        !tab.id.trim() ||
        tabIds.has(tab.id) ||
        typeof tab.text !== 'string' ||
        !tab.text.trim() ||
        typeof tab.iconPath !== 'string' ||
        !tab.iconPath.trim() ||
        (tab.selectedIconPath !== undefined &&
          (typeof tab.selectedIconPath !== 'string' ||
            !tab.selectedIconPath.trim()))
      ) {
        throw new Error('Tab 配置缺失或 id、order 重复：' + filename)
      }
      tabIds.add(tab.id)
      tabOrders.add(tab.order)
      route.tab = {
        id: tab.id,
        text: tab.text,
        iconPath: tab.iconPath,
        order: tab.order,
        ...(tab.selectedIconPath
          ? { selectedIconPath: tab.selectedIconPath }
          : {}),
      }
    } else if (metadata.tab !== undefined)
      throw new Error('普通页面不能声明 route.tab：' + filename)
    if (config.component === true)
      throw new Error('页面不能配置 component: true：' + filename)
    routes.push(route)
    if (route.available)
      pageConfigs.set(
        filename,
        withSkylinePage(
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
    .filter((route) => route.available && route.kind === 'tab')
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
    routes,
    entryPageName,
    excludedDirectories: excludedPageDirectories(routes, source),
    appConfig: {
      ...nativeConfig,
      entryPagePath: entry.path,
      ...(nativeConfig.tabBar
        ? {
            tabBar: {
              ...nativeConfig.tabBar,
              list: tabs.map((route) => ({
                pagePath: route.path,
                text: route.tab.text,
              })),
            },
          }
        : {}),
    },
  }
}

/** 生成可由 TS 与构建器共同读取的路由常量；未启用页面不暴露实际路径。 */
export async function writeRouteTypes(root, contract) {
  const routes = Object.fromEntries(
    contract.routes.map((route) => [
      route.name,
      {
        ...route,
        path: route.available ? '/' + route.path : '',
      },
    ]),
  )
  const content =
    '/** 由页面配置自动生成，请勿手动编辑。 */\nexport const routes = ' +
    JSON.stringify(routes, null, 2) +
    ' as const;\n\n/** 应用默认入口的页面名称。 */\nexport const entryPageName = ' +
    JSON.stringify(contract.entryPageName) +
    ' as const;\n'
  const filename = path.join(root, '.cache/routes.generated.ts')
  await mkdir(path.dirname(filename), { recursive: true })
  if (
    !(await exists(filename)) ||
    (await readFile(filename, 'utf8')) !== content
  )
    await writeFile(filename, content)
}

/** 类型检查前只准备路由常量，不修改正式构建产物。 */
export async function prepareRoutes({ root, source, mode }) {
  const environment = await loadEnvironment(root, mode)
  const appConfig = await readConfig(path.join(source, 'app.config.ts'), environment, 'app')
  const contract = await discoverRoutes({ files: await listFiles(source), source, appConfig, environment })
  await writeRouteTypes(root, contract)
}
