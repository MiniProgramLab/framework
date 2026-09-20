// SPDX-License-Identifier: Apache-2.0
/** 普通组件通过包路径注册；原生底栏由 CLI 输出到固定根目录。 */
export { libraryComponents } from './registration.js'

export { installComponents } from './configure.js'
export type { ComponentNavigation } from './configure.js'
export type { ActionSheetItem, ActionSheetSelection } from './lib/action-sheet/types.js'
export type { OverlayChangeDetail, OverlayCloseReason } from './lib/overlay/types.js'
export type { ComponentValue } from './lib/shared/types.js'
