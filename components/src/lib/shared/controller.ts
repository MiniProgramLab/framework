// SPDX-License-Identifier: Apache-2.0
import {
  onStoreDispose,
  storeOwner,
  changeOverlay,
  enterOverlay,
  overlayCovered,
  removeOverlay,
  observeBackground,
  createScrollIsolation,
} from '../adapters/store.js'
import type {
  OverlayEntry,
  OverlaySnapshot,
  OverlayHost as StoreOverlayHost,
  ScrollIsolation,
} from '../adapters/store.js'
import type { OverlayCloseReason } from '../overlay/types.js'

/** 控制器只通过窄接口驱动视图与原生动画。 */
export type OverlayHost = StoreOverlayHost & {
  data: {
    show: boolean
    scrollable: boolean
    destroyOnClose: boolean
    mounted: boolean
    rendered: boolean
    covered: boolean
  }
  /** 对应当前代次播放原生动画。 */
  animateOverlay(open: boolean, generation: number): Promise<void>
  /** 页面隐藏或卸载时停止动画推进。 */
  pauseOverlay(): void
  /** 原生节点销毁时清理样式绑定。 */
  releaseOverlayMotion(): void
  /** 根据层级关系更新内容滚动能力。 */
  applyOverlayScroll(blocked: boolean): void
}
/** 控制器的方法仅供组件内部使用，不成为页面服务。 */
export interface OverlayController {
  /** 同步当前显示意图。 */
  sync(): void
  /** 标记原生布局已经就绪。 */
  ready(): void
  /** 请求关闭并同步父级显示字段。 */
  close(reason: OverlayCloseReason): void
  /** 核对真实动画完成的代次。 */
  finish(generation: number): void
  /** 响应所属页面的可见性变化。 */
  visibility(visible: boolean): void
  /** 内容节点变化后重新绑定滚动能力。 */
  refreshScroll(): void
  /** 幂等释放当前实例的条目和资源。 */
  dispose(): void
}
/** 身份只用于关联本实例，实际顺序和阶段全部由 Store 保存。 */
let nextId = 0

/** 组合 Store、原生动画和资源清理，事件适配允许菜单在退场后提交选择。 */
export function createOverlayController(
  host: OverlayHost,
  emit: (name: string, detail?: Record<string, unknown>) => void = (
    name,
    detail,
  ) => host.triggerEvent(name, detail),
): OverlayController {
  const id = 'overlay-' + ++nextId
  let alive = true
  let ready = false
  let visible = true
  let bound = false
  let backgroundReady = false
  let generation = 0
  let animatedGeneration = 0
  let snapshot: OverlaySnapshot = { layers: [] }
  let reason: OverlayCloseReason = 'programmatic'
  let watchdog: ReturnType<typeof setTimeout> | undefined
  let scroll: ScrollIsolation | undefined
  let cancelBackground = (): void => {}
  let cancelStore = (): void => {}
  let unregister = (): void => {}

  /** 当前条目始终从最后一次 Store 快照读取，不复制可写阶段。 */
  function current(): OverlaySnapshot['layers'][number] | undefined {
    return snapshot.layers.find((layer) => layer.id === id)
  }
  /** 任意状态转换或暂停都废弃原来的超时观察。 */
  function stopWatchdog(): void {
    if (watchdog !== undefined) clearTimeout(watchdog)
    watchdog = undefined
  }
  /** 故障回收保证页面最终恢复，错误不冒充正常取消或选择。 */
  function fail(message: string): void {
    if (!alive) return
    stopWatchdog()
    reason = 'error'
    host.pauseOverlay()
    host.setData({ show: false, rendered: false })
    removeOverlay(host.$overlayStore, id)
    emit('change', { show: false, reason })
    emit('error', { message })
    console.error('Overlay：' + message)
  }
  /** 超时只处理缺失能力和异常动画回调，正常路径使用真实完成信号。 */
  function watch(message: string): void {
    stopWatchdog()
    if (visible) watchdog = setTimeout(() => fail(message), 3000)
  }
  /** 原生节点就绪后开始本代动画；任何迟到的异步结果都须重新核对。 */
  function animate(entry: OverlaySnapshot['layers'][number]): void {
    if (
      !ready ||
      !visible ||
      animatedGeneration === entry.generation ||
      entry.phase === 'open'
    )
      return
    animatedGeneration = entry.generation
    watch('弹层动画未完成，已回收本轮展示')
    host.setData({ mounted: true, rendered: true }, () => {
      if (!alive || !visible || current()?.generation !== entry.generation)
        return
      scroll?.refresh()
      host
        .animateOverlay(entry.phase === 'opening', entry.generation)
        .catch((error) => {
          if (alive && current()?.generation === entry.generation)
            fail(
              error instanceof Error ? error.message : '弹层动画绑定失败',
            )
        })
    })
  }
  /** 订阅只投影当前实例，其他弹层变更不重启动画。 */
  function respond(next: OverlaySnapshot): void {
    if (!alive) return
    snapshot = next
    if (!bound) {
      const owner = storeOwner(host)
      if (owner) {
        bound = true
        cancelBackground = observeBackground(owner, (value) => {
          backgroundReady = value
          controller.sync()
        })
      }
    }
    const entry = current()
    const covered = overlayCovered(next, id)
    if (host.data.covered !== covered) host.setData({ covered })
    if (entry) animate(entry)
  }
  const controller: OverlayController = {
    /** 显示意图统一在 Store 内完成转换，遮罩透明度不参与状态转换。 */
    sync(): void {
      if (!alive) return
      if (!bound) {
        if (ready && visible && host.data.show && watchdog === undefined)
          watch('弹层所属页面尚未确认')
        return
      }
      const entry = current()
      if (host.data.show) {
        if (!ready || !visible) return
        if (!backgroundReady && (!entry || entry.phase === 'closing')) {
          if (watchdog === undefined)
            watch('所属 page 的背景滚动能力未就绪')
          return
        }
        if (!entry || entry.phase === 'closing') {
          stopWatchdog()
          reason = 'programmatic'
          const next: OverlayEntry = {
            id,
            generation: ++generation,
            phase: 'opening',
          }
          enterOverlay(host.$overlayStore, next)
        } else animate(entry)
      } else if (entry && entry.phase !== 'closing') {
        changeOverlay(host.$overlayStore, id, entry.generation, {
          generation: ++generation,
          phase: 'closing',
        })
      } else if (!entry) stopWatchdog()
    },
    /** 原生节点及页面布局完成后才允许真正入场。 */
    ready(): void {
      ready = true
      if (!bound && host.data.show) watch('弹层所属页面尚未确认')
      controller.sync()
    },
    /** 用户关闭同步回父级字段，监听者不必手动处理 setData(false)。 */
    close(nextReason): void {
      if (
        !alive ||
        !host.data.show ||
        current()?.phase === 'closing' ||
        host.data.covered
      )
        return
      reason = nextReason
      host.setData({ show: false })
      emit('change', { show: false, reason })
      controller.sync()
    },
    /** 真实动画结束后核对代次，先提交状态再通知业务。 */
    finish(epoch): void {
      const entry = current()
      if (!alive || !visible || !entry || entry.generation !== epoch) return
      stopWatchdog()
      if (entry.phase === 'opening') {
        changeOverlay(host.$overlayStore, id, epoch, { phase: 'open' })
        emit('opened')
      } else if (entry.phase === 'closing') {
        const closeReason = reason
        host.setData({ rendered: false }, () => {
          if (
            !alive ||
            current()?.generation !== epoch ||
            current()?.phase !== 'closing'
          )
            return
          removeOverlay(host.$overlayStore, id, epoch)
          if (host.data.destroyOnClose) {
            host.releaseOverlayMotion()
            host.setData({ mounted: false })
          }
          emit('closed', { reason: closeReason })
        })
      }
    },
    /** 隐藏只暂停原生效果，Store 条目和表单内容继续保留。 */
    visibility(shown): void {
      const resumed = shown && !visible
      visible = shown
      if (!shown) {
        stopWatchdog()
        animatedGeneration = 0
        host.pauseOverlay()
      } else {
        const entry = current()
        // 恢复时更换回执代次，后台排队的旧完成回调不能提前结束新动画。
        if (resumed && entry && entry.phase !== 'open')
          changeOverlay(host.$overlayStore, id, entry.generation, {
            generation: ++generation,
          })
        controller.sync()
        const latest = current()
        if (latest) animate(latest)
      }
    },
    /** 内容滚动区切换时自动清理旧原生节点。 */
    refreshScroll(): void {
      scroll?.refresh()
    },
    /** 在 Store 连接失效前删除本实例，不触碰其他弹层。 */
    dispose(): void {
      if (!alive) return
      alive = false
      stopWatchdog()
      cancelBackground()
      cancelStore()
      unregister()
      scroll?.dispose()
      host.pauseOverlay()
      host.releaseOverlayMotion()
      removeOverlay(host.$overlayStore, id)
    },
  }
  unregister = onStoreDispose(host, controller.dispose)
  scroll = createScrollIsolation(host, {
    selector: '.layer__scroll',
    layerId: id,
    /** 未挂载内容不进行无效原生查询。 */
    enabled: () => host.data.mounted && host.data.scrollable,
    /** 弹层自己的内容只接受更高弹层带来的限制。 */
    apply: (blocked) => host.applyOverlayScroll(blocked),
  })
  cancelStore = host.$overlayStore.on(respond, { immediate: true })
  return controller
}
