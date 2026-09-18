/** 浮层插件的公共入口；初始化与结构校验不向调用方导出。 */
export { overlayStorePlugin } from './plugin.js'
export { enterOverlay, changeOverlay, removeOverlay } from './actions.js'
export { overlayBlocked, overlayCovered } from './selectors.js'
export type { OverlayEntry, OverlaySnapshot, OverlayState } from './types.js'
