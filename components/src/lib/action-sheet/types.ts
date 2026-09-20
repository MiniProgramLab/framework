// SPDX-License-Identifier: Apache-2.0
import type { ComponentValue } from '../shared/types.js'

/** 每个选项携带业务值，调用方不依赖展示下标。 */
export type ActionSheetItem = {
  /** 用户看到的选项文字。 */
  label: string
  /** 原样返回的可序列化业务值。 */
  value: ComponentValue
  /** 禁用项不响应选择，也不会关闭菜单。 */
  disabled?: boolean
  /** 危险操作使用强调色。 */
  tone?: 'default' | 'danger'
}
/** 选择事件提供点击时的独立选项副本。 */
export type ActionSheetSelection = {
  value: ComponentValue
  index: number
  action: ActionSheetItem
}
