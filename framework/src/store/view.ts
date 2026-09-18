import type { StoreState, StoreValue } from './types.js'

/** 原生 setData 可能保留对象引用，展示副本不能与内部不可变状态共享可写对象。 */
function copyValue(value: StoreValue): StoreValue {
  if (Array.isArray(value)) return value.map(copyValue)
  if (value && typeof value === 'object') {
    const result: StoreState = {}
    for (const key of Object.keys(value)) result[key] = copyValue(value[key]!)
    return result
  }
  return value
}

/** 初帧与删除使用完整副本，其余仅复制变化分支，减少序列化和跨线程传输。 */
export function viewPatch(
  next: StoreState,
  previous?: StoreState,
): Record<string, StoreValue> {
  const keys = Object.keys(next)
  if (
    !previous ||
    Object.keys(previous).some((key) => !(key in next)) ||
    keys.some((key) => !/^[A-Za-z_$][\w$]*$/.test(key))
  )
    return { $globalStore: copyValue(next) }
  const patch: Record<string, StoreValue> = {}
  for (const key of keys)
    if (next[key] !== previous[key])
      patch['$globalStore.' + key] = copyValue(next[key]!)
  return patch
}
