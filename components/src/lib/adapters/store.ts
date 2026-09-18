/** 组件库只通过此处接入宿主 Store；独立发包时可替换适配实现。 */
export {
  onStoreDispose,
  storeOwner,
} from '@skyline-kit/framework/store/binding'
export {
  changeOverlay,
  enterOverlay,
  overlayCovered,
  removeOverlay,
} from '@skyline-kit/framework/store/plugins/overlay/index'
export type {
  OverlayEntry,
  OverlaySnapshot,
} from '@skyline-kit/framework/store/plugins/overlay/index'
export {
  observeBackground,
  createScrollIsolation,
} from '@skyline-kit/framework/store/plugins/overlay/adapters/index'
export type {
  OverlayHost,
  ScrollIsolation,
} from '@skyline-kit/framework/store/plugins/overlay/adapters/index'
