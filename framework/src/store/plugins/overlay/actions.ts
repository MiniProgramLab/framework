// SPDX-License-Identifier: Apache-2.0
import type { Store } from '../../types.js'
import type { OverlayEntry, OverlayState } from './types.js'

/** 创建或推进指定实例，重开时按实际打开顺序移动到最上层。 */
export function enterOverlay(
  store: Store<OverlayState>,
  entry: OverlayEntry,
): boolean {
  return store.update((draft) => {
    const index = draft.layers.findIndex((layer) => layer.id === entry.id)
    if (index >= 0) draft.layers.splice(index, 1)
    draft.layers.push(entry)
  })
}

/** 只允许当前代次变更；关闭和动画完成均不能覆盖迟到后的新条目。 */
export function changeOverlay(
  store: Store<OverlayState>,
  id: string,
  expected: number,
  patch: Partial<Omit<OverlayEntry, 'id'>>,
): boolean {
  return store.update((draft) => {
    const entry = draft.layers.find(
      (layer) => layer.id === id && layer.generation === expected,
    )
    if (entry) Object.assign(entry, patch)
  })
}

/** 普通关闭核对代次，实例销毁时省略代次清除自身；重复删除无通知。 */
export function removeOverlay(
  store: Store<OverlayState>,
  id: string,
  generation?: number,
): boolean {
  return store.update((draft) => {
    const index = draft.layers.findIndex(
      (layer) =>
        layer.id === id &&
        (generation === undefined || layer.generation === generation),
    )
    if (index >= 0) draft.layers.splice(index, 1)
  })
}
