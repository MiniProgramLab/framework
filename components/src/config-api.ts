// SPDX-License-Identifier: Apache-2.0
/** 配置阶段可用的纯函数与常量，不依赖小程序宿主。 */
export { libraryComponents } from './registration.js'
export {
  lightTabTheme as lightTabBarTheme, darkTabTheme as darkTabBarTheme,
  createDefaultConfig as createTabBarConfig, mergeTabBarConfig,
  visibleTabItems as getVisibleTabBarItems, resolveTabValue as resolveTabBarValue,
  formatTabBadge as formatTabBarBadge,
} from './custom-tab-bar/config.js'
export { normalizeTabColor as normalizeTabBarColor, deriveTabPalette as deriveTabBarPalette } from './custom-tab-bar/theme.js'
