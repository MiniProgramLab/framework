// SPDX-License-Identifier: Apache-2.0
/** UI 的公开独立 API，实例方法仍由所属组件或 Store 提供。 */
export * from './config-api.js'
export { installComponents as installUiComponents } from './configure.js'
export {
  installTabBar, getTabBarSnapshot, subscribeTabBar, configureTabBar,
  updateTabBarItem, resetTabBar, syncTabBarRoute, navigateToTab,
} from './custom-tab-bar/controller.js'
