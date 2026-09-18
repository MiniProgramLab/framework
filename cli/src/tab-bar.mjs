/** 校验微信自定义 Tabbar 的静态注册，构建失败时不写入半成品配置。 */
import path from 'node:path'
import { exists } from './files.mjs'
import { readConfig } from './config.mjs'

/** 配置中的 usingComponents 必须是对象，空对象也能开启自定义组件支持。 */
function hasComponents(config) {
  return (
    !!config?.usingComponents &&
    typeof config.usingComponents === 'object' &&
    !Array.isArray(config.usingComponents)
  )
}

/** 校验主包路由、列表数量、页面组件支持和根目录入口，并缓存入口配置。 */
export async function validateCustomTabBar(
  appConfig,
  { source, pages, pageConfigs, environment, packageEntry },
) {
  const tabBar = appConfig.tabBar
  if (tabBar?.custom !== true) return
  if (
    !Array.isArray(tabBar.list) ||
    tabBar.list.length < 2 ||
    tabBar.list.length > 5
  ) {
    throw new Error('自定义 Tabbar 的 app.json.tabBar.list 必须静态注册 2–5 项')
  }
  for (const key of ['color', 'selectedColor', 'backgroundColor']) {
    if (
      typeof tabBar[key] !== 'string' ||
      !/^#[\da-f]{6}$/i.test(tabBar[key])
    ) {
      throw new Error('自定义 Tabbar 仍须完整声明原生配色：tabBar.' + key)
    }
  }
  /** 原生列表决定哪些页面可以被 switchTab 打开，不能仅配置视觉组件的 items。 */
  const routes = new Set()
  for (const item of tabBar.list) {
    if (
      !item ||
      typeof item.pagePath !== 'string' ||
      !pages.includes(item.pagePath)
    ) {
      throw new Error(
        'Tabbar 页面必须在主包 pages 中注册，路径不带前导斜杠或参数：' +
          item?.pagePath,
      )
    }
    if (routes.has(item.pagePath))
      throw new Error('Tabbar 页面重复注册：' + item.pagePath)
    if (typeof item.text !== 'string' || !item.text.trim())
      throw new Error('Tabbar 导航项缺少 text：' + item.pagePath)
    routes.add(item.pagePath)
    if (
      !hasComponents(appConfig) &&
      !hasComponents(
        pageConfigs.get(path.join(source, item.pagePath + '.config.ts')),
      )
    ) {
      throw new Error(
        'Tab 页或 app.config.ts 必须声明 usingComponents：' + item.pagePath,
      )
    }
  }
  /** 入口名称由微信约定，本项目的四类源码分别输出为 JS、JSON、WXML 和 WXSS。 */
  // npm 底栏由收集器校验四件套并重定位，页面注册约束仍在上面完整执行。
  if (packageEntry) return
  const entry = path.join(source, 'custom-tab-bar/index')
  for (const extension of ['.ts', '.config.ts', '.wxml', '.scss']) {
    if (!(await exists(entry + extension)))
      throw new Error('自定义 Tabbar 缺少固定入口：' + entry + extension)
  }
  const filename = entry + '.config.ts'
  const config = await readConfig(filename, environment)
  if (config.component !== true)
    throw new Error('custom-tab-bar/index.config.ts 必须声明 component: true')
  pageConfigs.set(filename, config)
}
