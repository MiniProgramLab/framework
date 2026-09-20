// SPDX-License-Identifier: Apache-2.0
import type { NativeConfig, PlatformAdapter } from '../types.js'
/** 原生平台共用配置处理，不注入微信运行时或改写平台模板。 */

/** 拒绝只能在微信 Skyline 中生效的配置，避免输出无法运行的其他平台工程。 */
export function validateNativeConfig(config: NativeConfig, filename: string) {
  for (const key of ['renderer', 'rendererOptions', 'componentFramework', 'lazyCodeLoading']) {
    if (config[key] !== undefined) throw new Error('当前平台不支持微信专用配置 ' + key + '：' + filename)
  }
}

/** 校验由路由元数据生成的原生底栏，当前仅微信适配器支持自定义底栏。 */
export function validateNativeTabs(config: NativeConfig, { packageEntry }: { packageEntry?: string }) {
  const items = config.tabBar?.list ?? config.tabBar?.items
  if (config.tabBar && (!Array.isArray(items) || items.length < 2 || items.length > 5))
    throw new Error('原生 Tabbar 必须静态注册 2–5 项')
  if (config.tabBar?.custom || packageEntry)
    throw new Error('当前平台适配器仅支持原生 Tabbar，不能使用微信 customTabBar 组件')
}

/** 原生底栏保留完整图标信息，不丢弃元数据中的选中态图标。 */
export function nativeTabItems(tabs: Parameters<PlatformAdapter['appConfig']>[1]['tabs']) {
  return tabs.map((route) => ({
    pagePath: route.path,
    text: route.tab.text,
    iconPath: route.tab.iconPath,
    ...(route.tab.selectedIconPath ? { selectedIconPath: route.tab.selectedIconPath } : {}),
  }))
}

/** 抖音沿用原生 list 字段，默认入口由 pages 的首项确定。 */
export function createDouyinApp(config: NativeConfig, { tabs }: Parameters<PlatformAdapter['appConfig']>[1]) {
  return {
    ...config,
    ...(config.tabBar ? { tabBar: { ...config.tabBar, list: nativeTabItems(tabs) } } : {}),
  }
}

/** 支付宝使用 items、name、icon 和 activeIcon 表达底栏。 */
export function createAlipayApp(config: NativeConfig, { tabs }: Parameters<PlatformAdapter['appConfig']>[1]) {
  return {
    ...config,
    ...(config.tabBar ? { tabBar: { ...config.tabBar, items: tabs.map((route) => ({
      pagePath: route.path, name: route.tab.text, icon: route.tab.iconPath,
      ...(route.tab.selectedIconPath ? { activeIcon: route.tab.selectedIconPath } : {}),
    })) } } : {}),
  }
}

/** 保持已声明的原生页面配置，不补入其他平台的渲染选项。 */
export function nativePage(config: NativeConfig, filename: string) {
  validateNativeConfig(config, filename)
  return config
}

/** Core 路由子入口跨平台，其余页面包装与 UI 能力仍仅适用于微信。 */
export function validateNativeDependency(reference: string) {
  if (/^@miniprogramlab\/core\/router(?:\/|$)/.test(reference)) return
  if (/^@miniprogramlab\/(core|ui)(?:\/|$)/.test(reference))
    throw new Error('当前原生适配器不能使用仅支持微信 Skyline 的 Core/UI 包：' + reference)
}
