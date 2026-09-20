// SPDX-License-Identifier: Apache-2.0
import { createOverlayController } from './controller.js'
import type { OverlayController } from './controller.js'
import type { OverlayCloseReason } from '../overlay/types.js'
import { resolveOverlayLayout } from './layout.js'
import {
  bindOverlayMotion,
  clearOverlayMotion,
  createOverlayMotion,
  pauseOverlayMotion,
  playOverlayMotion,
  resetOverlayMotion,
} from './motion.worklet.js'
import type { OverlayBindings, OverlayMotion } from './motion.worklet.js'
import { createScrollGate } from './gate.worklet.js'
import type { ScrollGateHost } from './gate.worklet.js'
import type { OverlayHost } from './controller.js'
import type { MaskPresentation } from './types.js'
import { getWindowLayout } from './window.js'

/** 动画及控制器属于实例运行时资源，不写入组件 data 或 Store。 */
interface OverlayRuntime {
  motion: OverlayMotion
  bindings: OverlayBindings
  controller: OverlayController | undefined
  bound: boolean
  binding: Promise<void> | undefined
  alive: boolean
  /** 在途测量或绑定不能在快速反向后启动旧动画。 */
  request: number
}
/** 实例资源通过弱索引隔离，卸载时显式断开引用。 */
const runtimes = new WeakMap<object, OverlayRuntime>()

/** 三个弹层保持一致的显示、关闭和内容配置。 */
export const layerProperties = {
  /** 使用 model:show 时内部取消自动同步回调用方。 */
  show: { type: Boolean, value: false },
  /** center、bottom、top、left、right 对应五种入场方位。 */
  position: { type: String, value: 'center' },
  /** 只改变遮罩颜色，透明遮罩仍完整拦截交互并锁定背景。 */
  transparent: { type: Boolean, value: false },
  /** 点击遮罩时自动请求关闭。 */
  closeOnMask: { type: Boolean, value: true },
  /** 长内容默认由内部列表滚动。 */
  scrollable: { type: Boolean, value: true },
  /** 默认保留表单实例；开启后在退场完成时销毁。 */
  destroyOnClose: { type: Boolean, value: false },
  /** Popup、ActionSheet 内部启用内容避让，独立遮罩默认不限制内容区域。 */
  safeArea: { type: Boolean, value: false },
}

/** 所有字段均是 Store 展示投影或设备布局，不另存活动弹层状态。 */
const layerData = {
  maskInSelf: false,
  mounted: false,
  rendered: false,
  covered: false,
  scrollLocked: false,
  windowHeight: 0,
  safeBottom: 0,
  safeTop: 0,
  viewportTop: 0,
  viewportBottom: 0,
  surfaceTop: 0,
  surfaceBottom: 0,
  surfaceMaxHeight: 0,
  bodyHeight: 240,
  hasContent: false,
  surfaceWidth: 320,
  resolvedPosition: 'center',
}

/** 共用行为只依赖弹层所需的原生实例能力和内部方法。 */
export type LayerHost = OverlayHost &
  ScrollGateHost & {
    data: typeof layerData & {
      show: boolean
      position: string
      transparent: boolean
      closeOnMask: boolean
      scrollable: boolean
      destroyOnClose: boolean
      safeArea: boolean
      presentation?: MaskPresentation | null
    }
    /** 更新窗口及内容布局。 */
    refreshLayout(): void
    /** 等待真实内容测量完成。 */
    measureOverlay(): Promise<void>
    /** 核对原生动画完成代次。 */
    onMotionDone(generation: number): void
    /** 将关闭意图提交给唯一状态机。 */
    requestClose(reason?: OverlayCloseReason): void
    /** 派发完成事件并允许组合组件追加交互语义。 */
    dispatchOverlayEvent(
      name: string,
      detail?: Record<string, unknown>,
    ): void
  }

/** Popup、ActionSheet 的独立面板与 Overlay 共用状态机和原生资源管理。 */
export const layerBehavior = Behavior({
  data: layerData,
  observers: {
    /** 所有显示意图经过同一个 Store 状态机。 */
    show(this: LayerHost) {
      runtimes.get(this)?.controller?.sync()
    },
    /** 节点重建后重新绑定内容滚动能力。 */
    scrollable(this: LayerHost) {
      runtimes.get(this)?.controller?.refreshScroll()
      this.refreshLayout()
    },
    /** 外观变化只更新布局，不重建显示状态。 */
    'position, safeArea'(this: LayerHost) {
      this.refreshLayout()
    },
  },
  lifetimes: {
    /** 共享值必须先于模板中的手势回调创建。 */
    created(this: LayerHost) {
      ;(this as unknown as ScrollGateHost)._scrollGate = createScrollGate()
      runtimes.set(this, {
        motion: createOverlayMotion((generation) =>
          this.onMotionDone(generation),
        ),
        bindings: { epoch: 0, handles: [] },
        controller: undefined,
        bound: false,
        binding: undefined,
        alive: true,
        request: 0,
      })
    },
    /** 组件自动接入页面弹层区域，业务无需引入额外能力。 */
    attached(this: LayerHost) {
      this.refreshLayout()
      if (!this.data.presentation)
        runtimes.get(this)!.controller = createOverlayController(
          this,
          (name, detail) => this.dispatchOverlayEvent(name, detail),
        )
    },
    /** 布局与原生能力就绪后启动初始 show 意图。 */
    ready(this: LayerHost) {
      runtimes.get(this)?.controller?.ready()
    },
    /** 先释放 Store 条目和原生资源，再丢弃弱索引。 */
    detached(this: LayerHost) {
      const runtime = runtimes.get(this)
      if (runtime) {
        runtime.controller?.dispose()
        runtime.alive = false
      }
      runtimes.delete(this)
    },
  },
  pageLifetimes: {
    /** 恢复未完成的本代动画，重新读取键盘影响后的窗口尺寸。 */
    show(this: LayerHost) {
      this.refreshLayout()
      runtimes.get(this)?.controller?.visibility(true)
    },
    /** 切后台保留表单和 Store 条目，只停止原生动画。 */
    hide(this: LayerHost) {
      runtimes.get(this)?.controller?.visibility(false)
    },
    /** 窗口已经包含键盘变化，不重复扣减键盘高度。 */
    resize(this: LayerHost) {
      this.refreshLayout()
    },
  },
  methods: {
    /** 默认直接派发事件，操作菜单可追加退场后的选择语义。 */
    dispatchOverlayEvent(
      this: LayerHost,
      name: string,
      detail?: Record<string, unknown>,
    ): void {
      this.triggerEvent(name, detail)
    },
    /** 分离 Portal 中的遮罩请求由当前弹层状态机统一关闭。 */
    onMaskClose(
      this: LayerHost,
      event: WechatMiniprogram.CustomEvent<{ reason: OverlayCloseReason }>,
    ): void {
      this.requestClose(event.detail.reason)
    },
    /** 原生手势只读取共享门控，组件锁与页面锁彼此独立。 */
    shouldScrollRespond(this: LayerHost): boolean {
      'worklet'
      return (this as unknown as ScrollGateHost)._scrollGate.value
    },
    /** Store 投影同步内容滚动和手势输入。 */
    applyOverlayScroll(this: LayerHost, blocked: boolean): void {
      ;(this as unknown as ScrollGateHost)._scrollGate.value = !blocked
      this.setData({ scrollLocked: blocked })
    },
    /** 遮罩和静态区域消费触摸，列表仍由自己的原生手势处理。 */
    consumeTouch(this: LayerHost): void {},
    /** 只有明确开启遮罩关闭时才同步 show。 */
    onMaskTap(this: LayerHost): void {
      if (!this.data.closeOnMask) return
      if (this.data.presentation) {
        if (
          this.data.presentation.rendered &&
          !this.data.presentation.covered
        )
          this.triggerEvent('close', { reason: 'mask' })
      } else this.requestClose('mask')
    },
    /** 当前展示宿主统一处理取消与选择关闭，不重复持有锁。 */
    requestClose(
      this: LayerHost,
      reason: OverlayCloseReason = 'programmatic',
    ): void {
      runtimes.get(this)?.controller?.close(reason)
    },
    /** 原生完成回调只传代次，业务事件由状态机核对后派发。 */
    onMotionDone(this: LayerHost, generation: number): void {
      runtimes.get(this)?.controller?.finish(generation)
    },
    /** 按窗口和胶囊实际位置计算布局，安全距离只在对应边缘保留一次。 */
    refreshLayout(this: LayerHost): void {
      if (!runtimes.get(this)?.alive) return
      this.setData(
        resolveOverlayLayout(
          this.data.position,
          wx.getWindowInfo(),
          getWindowLayout(),
          this.data.safeArea,
        ),
      )
      if (this.data.mounted) this.measureOverlay()
    },
    /** 内容、标题与固定操作区共同决定可滚动区域的实际高度。 */
    measureOverlay(this: LayerHost): Promise<void> {
      return new Promise((resolve) => {
        wx.nextTick(() => {
          if (!runtimes.get(this)?.alive || !this.data.mounted) {
            resolve()
            return
          }
          const query = this.createSelectorQuery()
          query.select('.layer__content').boundingClientRect()
          query.select('.layer__header').boundingClientRect()
          query.select('.layer__footer').boundingClientRect()
          query.exec((results) => {
            if (!runtimes.get(this)?.alive) {
              resolve()
              return
            }
            // 高度预算包含固定区域和实际内边距，不能把安全区重复扣减。
            const limit =
              this.data.surfaceMaxHeight -
              this.data.surfaceTop -
              this.data.surfaceBottom
            const content = results[0]?.height ?? 0
            const chrome =
              (results[1]?.height ?? 0) + (results[2]?.height ?? 0)
            const bodyHeight = Math.max(
              0,
              Math.min(content, limit - chrome),
            )
            this.setData(
              { bodyHeight, hasContent: content + chrome > 0 },
              resolve,
            )
          })
        })
      })
    },
    /** 节点首次挂载时绑定样式，后续反向动画继续复用同一共享值。 */
    async animateOverlay(
      this: LayerHost,
      open: boolean,
      generation: number,
    ): Promise<void> {
      const runtime = runtimes.get(this)
      if (!runtime?.alive) return
      const epoch = runtime.bindings.epoch
      const request = ++runtime.request
      await this.measureOverlay()
      if (
        !runtime.alive ||
        request !== runtime.request ||
        epoch !== runtime.bindings.epoch
      )
        return
      await new Promise<void>((resolve) => {
        this.createSelectorQuery()
          .select('.layer__surface')
          .boundingClientRect((rect) => {
            if (rect && !Array.isArray(rect))
              runtime.motion.geometry.value = {
                position: this.data.resolvedPosition,
                width: rect.width,
                height: rect.height,
              }
            resolve()
          })
          .exec()
      })
      if (!runtime.bound) {
        const mask = this.data.maskInSelf
          ? this
          : this.selectComponent('#overlay')
        if (!mask) throw new Error('弹层遮罩尚未挂载')
        runtime.binding ??= bindOverlayMotion(
          this,
          mask,
          runtime.motion,
          runtime.bindings,
        )
        await runtime.binding
        if (
          !runtime.alive ||
          request !== runtime.request ||
          epoch !== runtime.bindings.epoch
        )
          return
        runtime.bound = true
      }
      // 只播放仍对应当前意图的动画，过期完成回调仍由控制器再次核对。
      if (
        !runtime.alive ||
        request !== runtime.request ||
        epoch !== runtime.bindings.epoch ||
        open !== this.data.show
      )
        return
      playOverlayMotion(runtime.motion, open, generation)
    },
    /** 隐藏时取消原生推进，保持当前动画位置以便恢复。 */
    pauseOverlay(this: LayerHost): void {
      const runtime = runtimes.get(this)
      if (runtime) {
        runtime.request += 1
        pauseOverlayMotion(runtime.motion)
      }
    },
    /** 内容销毁时释放绑定，下一次打开重新创建节点订阅。 */
    releaseOverlayMotion(this: LayerHost): void {
      const runtime = runtimes.get(this)
      if (!runtime) return
      clearOverlayMotion(runtime.bindings)
      runtime.bound = false
      runtime.binding = undefined
      resetOverlayMotion(runtime.motion)
    },
  },
})
