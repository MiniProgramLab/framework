import { onStoreDispose, storeOwner } from '../../../binding.js'
import { overlayBlocked } from '../selectors.js'
import type { OverlaySnapshot, OverlayState } from '../types.js'
import type { Store } from '../../../types.js'
import { registerBackground } from './background.js'

/** 原生滚动适配仅依赖实例能力，不查找页面栈或修改业务方法。 */
export type OverlayHost = WechatMiniprogram.Component.TrivialInstance & {
  $overlayStore: Store<OverlayState>
}
/** 页面和 Overlay 共用的受管容器配置。 */
export interface ScrollIsolationOptions {
  /** 组件内部固定选择器。 */
  selector: string
  /** Overlay 内容所属条目；省略表示页面背景。 */
  layerId?: string
  /** 页面负责报告背景能力，弹层自身不会冒充背景就绪。 */
  background?: boolean
  /** 业务是否仍启用这个滚动节点。 */
  enabled(): boolean
  /** 同步刷新入口和手势共享值，只投影派生状态。 */
  apply(blocked: boolean): void
}
/** 容器生命周期只持有原生资源与最新不可变快照。 */
export interface ScrollIsolation {
  refresh(): void
  dispose(): void
}

/** 自动订阅本页状态，立即加锁、合并解锁，节点重建后应用最新状态。 */
export function createScrollIsolation(
  host: OverlayHost,
  options: ScrollIsolationOptions,
): ScrollIsolation {
  let alive = true
  let revision = 0
  let context: WechatMiniprogram.ScrollViewContext | undefined
  let snapshot: OverlaySnapshot = { layers: [] }
  let blocked: boolean | undefined
  let scheduled = false
  let background: ReturnType<typeof registerBackground> | undefined
  let cancel = (): void => {}
  let unregister = (): void => {}
  /** 只在进入锁定时终止当前位置的惯性，回调核对节点与当前状态。 */
  function stopMomentum(current: WechatMiniprogram.ScrollViewContext): void {
    const epoch = revision
    host
      .createSelectorQuery()
      .select(options.selector)
      .scrollOffset((result) => {
        if (
          !alive ||
          epoch !== revision ||
          context !== current ||
          !overlayBlocked(snapshot, options.layerId) ||
          !result
        )
          return
        current.scrollTo({
          top: result.scrollTop,
          left: result.scrollLeft,
          animated: false,
        })
      })
      .exec()
  }
  /** 原生能力与最小视图投影一起更新，恢复时不改写原滚动位置。 */
  function apply(): void {
    if (!alive) return
    const next = overlayBlocked(snapshot, options.layerId)
    const changed = blocked !== next
    blocked = next
    // 先更新 UI 手势门控，再写原生能力，避免异步惯性查询留下输入窗口。
    if (changed) options.apply(next)
    if (context) {
      context.scrollEnabled = options.enabled() && !next
      if (changed && next) stopMomentum(context)
    }
  }
  /** 解除限制延迟到微任务末尾，连续打开新弹层时不会短暂解锁。 */
  function respond(next: OverlaySnapshot): void {
    snapshot = next
    if (!background && options.background) {
      const owner = storeOwner(host)
      if (owner) {
        background = registerBackground(owner)
        controller.refresh()
      }
    }
    if (overlayBlocked(next, options.layerId)) apply()
    else if (!scheduled) {
      scheduled = true
      Promise.resolve().then(() => {
        scheduled = false
        apply()
      })
    }
  }
  const controller: ScrollIsolation = {
    /** 每次节点可能重建时使旧查询失效，再绑定最新节点。 */
    refresh(): void {
      if (!alive) return
      const epoch = ++revision
      context = undefined
      if (!options.enabled()) {
        background?.ready(true)
        apply()
        return
      }
      background?.ready(false)
      wx.nextTick(() => {
        if (!alive || epoch !== revision) return
        host
          .createSelectorQuery()
          .select(options.selector)
          .node((result) => {
            if (!alive || epoch !== revision) return
            const node = result?.node as
              | WechatMiniprogram.ScrollViewContext
              | undefined
            if (!node || typeof node.scrollTo !== 'function') return
            context = node
            blocked = undefined
            apply()
            background?.ready(true)
          })
          .exec()
      })
    },
    /** Store 先行清理也能使在途查询和待解锁任务全部失效。 */
    dispose(): void {
      if (!alive) return
      alive = false
      revision += 1
      cancel()
      unregister()
      background?.dispose()
      context = undefined
    },
  }
  unregister = onStoreDispose(host, controller.dispose)
  cancel = host.$overlayStore.on(respond, { immediate: true })
  return controller
}
