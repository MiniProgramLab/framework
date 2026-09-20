// SPDX-License-Identifier: Apache-2.0
import type { PageOwner } from '../../../owner.js'

/** 这里只存原生能力就绪信息，弹层事实仍全部保存在 Store 中。 */
interface BackgroundResources {
  participants: Map<object, boolean>
  listeners: Set<(ready: boolean) => void>
}
/** 原生能力按与 Store 相同的页面令牌隔离。 */
const resources = new WeakMap<object, BackgroundResources>()

/** 为当前页面惰性建立原生能力索引。 */
function resourceFor(owner: PageOwner): BackgroundResources {
  let value = resources.get(owner.token)
  if (!value) {
    value = { participants: new Map(), listeners: new Set() }
    resources.set(owner.token, value)
    owner.cleanups.add(() => {
      value!.listeners.clear()
      value!.participants.clear()
      resources.delete(owner.token)
    })
  }
  return value
}

/** 所有已登记的页面背景容器都完成绑定后才允许弹层入场。 */
function isReady(value: BackgroundResources): boolean {
  return (
    value.participants.size > 0 &&
    [...value.participants.values()].every(Boolean)
  )
}

/** 页面自动报告自身原生滚动容器状态，静态布局直接就绪。 */
export function registerBackground(owner: PageOwner): {
  ready(value: boolean): void
  dispose(): void
} {
  const value = resourceFor(owner)
  const token = {}
  let alive = true
  value.participants.set(token, false)
  /** 能力变化只通知存活页面，不向 Store 写入原生对象。 */
  const notify = (): void => {
    if (owner.alive)
      for (const listener of [...value.listeners]) listener(isReady(value))
  }
  notify()
  return {
    /** 原生查询完成后更新能力，失效查询不能重新登记。 */
    ready(ready): void {
      if (alive) {
        value.participants.set(token, ready)
        notify()
      }
    },
    /** 容器销毁后撤销能力并通知等待中的弹层。 */
    dispose(): void {
      if (alive) {
        alive = false
        value.participants.delete(token)
        notify()
      }
    },
  }
}

/** Overlay 无论先后挂载均收到最新状态，取消函数幂等。 */
export function observeBackground(
  owner: PageOwner,
  listener: (ready: boolean) => void,
): () => void {
  const value = resourceFor(owner)
  value.listeners.add(listener)
  listener(owner.alive && isReady(value))
  return () => {
    value.listeners.delete(listener)
  }
}
