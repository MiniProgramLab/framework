// SPDX-License-Identifier: Apache-2.0
import type { StoreSnapshot, StoreState } from '../../types.js'

/** 活动条目只保存展示事实，完全关闭后从列表删除。 */
export type OverlayEntry = {
  /** 同一组件实例的稳定标识。 */
  id: string
  /** 单调递增的转换代次，阻止旧动画影响新展示。 */
  generation: number
  /** 退场完成之前仍参与背景隔离。 */
  phase: 'opening' | 'open' | 'closing'
}
/** 每个页面实例单独拥有弹层顺序，不保存业务内容或原生句柄。 */
export type OverlayState = { layers: OverlayEntry[] }
/** 订阅与选择器使用同一份不可变快照。 */
export type OverlaySnapshot = StoreSnapshot<OverlayState>

/** 插件自行扩展通用状态注册表，包装器无需识别浮层类型。 */
declare module '../../plugin.js' {
  interface StorePluginStates<S extends StoreState = StoreState> {
    overlayStore: OverlayState
  }
}
