/** 普通组件通过包路径注册；原生底栏由 CLI 输出到固定根目录。 */
export const libraryComponents = {
  page: '@miniprogramlab/ui/page/index',
  'page-header': '@miniprogramlab/ui/page-header/index',
  overlay: '@miniprogramlab/ui/lib/overlay/index',
  popup: '@miniprogramlab/ui/lib/popup/index',
  'action-sheet': '@miniprogramlab/ui/lib/action-sheet/index',
} as const

export { installComponents } from './configure.js'
export type { ComponentNavigation } from './configure.js'
export type { ActionSheetItem, ActionSheetSelection } from './lib/action-sheet/types.js'
export type { OverlayChangeDetail, OverlayCloseReason } from './lib/overlay/types.js'
export type { ComponentValue } from './lib/shared/types.js'
