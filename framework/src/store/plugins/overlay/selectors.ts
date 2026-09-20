// SPDX-License-Identifier: Apache-2.0
import type { OverlaySnapshot } from './types.js'

/** 所有弹层均隔离背景，自身内容仅被更高弹层限制。 */
export function overlayBlocked(state: OverlaySnapshot, id?: string): boolean {
  const index = id ? state.layers.findIndex((layer) => layer.id === id) : -1
  return state.layers.length > index + 1
}

/** 原生 Portal 不依赖跨 Portal 的层级排序，仅最高活动表面响应触摸。 */
export function overlayCovered(state: OverlaySnapshot, id: string): boolean {
  const index = state.layers.findIndex((layer) => layer.id === id)
  return index >= 0 && index < state.layers.length - 1
}
