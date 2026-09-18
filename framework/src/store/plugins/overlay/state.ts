import type { OverlayEntry, OverlaySnapshot, OverlayState } from './types.js'

/** 为新页面创建独立的初始弹层状态。 */
export function initialOverlayState(): OverlayState {
  return { layers: [] }
}

/** 弹层作用域除可序列化校验外，还保持固定结构和标识唯一。 */
export function validateOverlayState(state: OverlaySnapshot): void {
  if (Object.keys(state).length !== 1 || !Array.isArray(state.layers))
    throw new TypeError('弹层状态必须仅包含 layers 数组')
  const ids = new Set<string>()
  for (const value of state.layers) {
    const entry = value as OverlayEntry | null
    if (
      !entry ||
      typeof entry !== 'object' ||
      Object.keys(entry).length !== 3 ||
      typeof entry.id !== 'string' ||
      !entry.id ||
      ids.has(entry.id) ||
      !Number.isSafeInteger(entry.generation) ||
      entry.generation < 1 ||
      !['opening', 'open', 'closing'].includes(entry.phase)
    ) {
      throw new TypeError('弹层条目的标识、代次或阶段无效')
    }
    ids.add(entry.id)
  }
}
