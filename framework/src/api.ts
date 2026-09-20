// SPDX-License-Identifier: Apache-2.0
/** 独立运行时 API 清单；函数使用小驼峰动词和业务对象命名。 */
export { installGlobalStore } from './store/global.js'
export { registerStorePlugin } from './store/setup.js'
export { enterOverlay, changeOverlay, removeOverlay } from './store/plugins/overlay/actions.js'
export { overlayBlocked as isOverlayBlocked, overlayCovered as isOverlayCovered } from './store/plugins/overlay/selectors.js'
export { pageStorePlugin } from './store/plugins/page/plugin.js'
export { overlayStorePlugin } from './store/plugins/overlay/plugin.js'
