/** 普通组件通过包路径注册；原生底栏由 CLI 输出到固定根目录。 */
export const libraryComponents = {
  page: '@skyline-kit/components/page/index',
  'page-header': '@skyline-kit/components/page-header/index',
  overlay: '@skyline-kit/components/lib/overlay/index',
  popup: '@skyline-kit/components/lib/popup/index',
  'action-sheet': '@skyline-kit/components/lib/action-sheet/index',
} as const

export { installComponents } from './configure.js'
export type { ComponentNavigation } from './configure.js'
export type { ActionSheetItem, ActionSheetSelection } from './lib/action-sheet/types.js'
export type { OverlayChangeDetail, OverlayCloseReason } from './lib/overlay/types.js'
export type { ComponentValue } from './lib/shared/types.js'
