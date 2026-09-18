import {
  createDefaultConfig,
  mergeTabBarConfig,
  resolveTabValue,
  visibleTabItems,
} from './config.js'
import { deriveTabPalette } from './theme.js'
import {
  cancelFluid,
  configureFluid,
  createFluid,
  dragFluid,
  endFluid,
  fallbackTapFluid,
  longPressFluid,
  pressFluid,
  respondsFluid,
  resumeFluid,
  selectFluid,
  tapFluid,
  touchPressFluid,
} from './motion.worklet.js'
import type {
  FluidEvent,
  FluidGesture,
  FluidSettings,
  FluidState,
} from './motion.worklet.js'
import type {
  CustomTabAnimation,
  CustomTabBarConfig,
  CustomTabBarPatch,
  CustomTabChange,
  CustomTabItem,
} from './types.js'
import { configureTabBar, getTabBarSnapshot } from './controller.js'
import { runtimeFor, findRuntime, deleteRuntime } from './runtime.js'
import {
  bindBaseMotion,
  bindItemMotion,
  clearMotionBindings,
} from './bindings.worklet.js'
import { createViewKeys, createTabView, measureTabLayout } from './view.js'
import {
  connectNavigation,
  pauseNavigation,
  resetNavigation,
  resumeTabNavigation,
  syncNavigationRoute,
  navigateTabSelection,
} from './navigation.js'
import { overlayBlocked } from '@skyline-kit/framework/store/plugins/overlay/index'

/** 原生 worklet 方法只读取固定的共享图，不捕获普通运行时对象。 */
type FluidHost = WechatMiniprogram.Component.TrivialInstance & {
  _fluid: FluidState
}

/** 微信自动加载此组件入口，生命周期协调视图计算、动画绑定与导航模块。 */
defineComponent({
  /** 底栏内部接入所属页面的弹层隔离，业务配置保持原状。 */
  overlayStore: true,
  properties: {
    /** 独立预览复用同一实现并只派发事件；默认启用原生 Tab 页导航。 */
    standalone: { type: Boolean, value: false },
    /** 独立模式的属性配置整体替换；原生底栏通过 configure 更新共享配置。 */
    config: { type: Object, value: {} as CustomTabBarPatch },
    /** 由业务路由或父容器同步的稳定 id；省略时使用内部选中状态。 */
    value: { type: String, value: '' },
    /** 外部导航进行中时暂时阻止重复提交，不影响视觉回弹。 */
    disabled: { type: Boolean, value: false },
  },
  data: {
    items: [] as (CustomTabItem & {
      badgeText: string
      maskStyle: string
      selectedMaskStyle: string
    })[],
    activeId: '',
    showLabel: true,
    hidden: false,
    fixed: true,
    measured: false,
    hasSelection: false,
    navigating: false,
    /** 仅投影模态约束，不覆盖业务 hidden 或 disabled。 */
    modalSuspended: false,
    hostStyle: '',
    barStyle: '',
    positionStyle: '',
    indicatorStyle: '',
    itemStyle: '',
    iconStyle: '',
    labelStyle: '',
    badgeStyle: '',
    color: '',
    selectedColor: '',
    disabledColor: '',
  },
  observers: {
    /** 属性更新先校验；出现错误时保留上一个可用版本并通知调用方。 */
    config(patch: CustomTabBarPatch) {
      if (!this.data.standalone) return
      try {
        this.replaceConfig(
          mergeTabBarConfig(createDefaultConfig(), patch ?? {}),
        )
      } catch (error) {
        this.triggerEvent('configerror', {
          message: error instanceof Error ? error.message : String(error),
        })
      }
    },
    /** 外部同步不触发 change，避免路由和父子组件形成更新循环。 */
    value(id: string) {
      if (!this.data.standalone) return
      const runtime = runtimeFor(this)
      if (runtime.activeId !== id) this.setValue(id, false, runtime.ready)
    },
    /** 导航锁生效时取消未完成的触摸，避免旧手势在跳转后提交。 */
    disabled() {
      this.syncMotion()
    },
    /** 模式改变时释放旧订阅，重新读取对应配置源。 */
    standalone() {
      if (runtimeFor(this).attached) this.initializeMode()
    },
  },
  lifetimes: {
    /** 在模板绑定 worklet 前准备共享引用，避免手势闭包捕获尚未初始化的值。 */
    created() {
      const runtime = runtimeFor(this)
      const palette = deriveTabPalette(runtime.config.theme)
      const state = createFluid(
        {
          epoch: 0,
          alive: false,
          locked: false,
          visible: false,
          enableDrag: true,
          barLeft: 0,
          barWidth: 0,
          left: 0,
          top: 0,
          height: 0,
          slot: 0,
          width: 1,
          enabled: [],
          color: palette.color,
          selectedColor: palette.selectedColor,
          disabledColor: palette.disabledColor,
          motion: runtime.config.motion,
        },
        -1,
        this.onFluidEvent.bind(this),
      )
      runtime.motion = state
      ;(this as unknown as FluidHost)._fluid = state
    },
    /** 挂载时连接应用导航或独立配置，并建立首帧布局。 */
    attached() {
      const runtime = runtimeFor(this)
      runtime.attached = true
      runtime.bindings.alive = true
      this.initializeMode()
      this.$overlayStore.on(
        (snapshot) => {
          const modalSuspended = overlayBlocked(snapshot)
          if (modalSuspended === this.data.modalSuspended) return
          this.setData({ modalSuspended }, () => {
            // 隔离期间业务可能改变尺寸，表面恢复后重新测量最新布局。
            if (!this.data.modalSuspended && findRuntime(this)?.attached)
              this.measure()
          })
          this.syncMotion()
        },
        { immediate: true },
      )
    },
    /** 节点创建完成后绑定原生弹簧，仅对位移和缩放做动画。 */
    ready() {
      runtimeFor(this).ready = true
      this.initializeMotion()
      this.measure()
    },
    /** 停止共享动画并移除绑定，防止页面销毁后继续工作。 */
    detached() {
      const runtime = runtimeFor(this)
      pauseNavigation(runtime)
      runtime.attached = false
      runtime.revision += 1
      this.syncMotion(true)
      clearMotionBindings(this, runtime.bindings)
      deleteRuntime(this)
    },
  },
  pageLifetimes: {
    /** 相同窗口和配置复用布局，避免回到页面时打断现有动画。 */
    show() {
      runtimeFor(this).shown = true
      this.subscribe()
      this.syncMotion()
      this.renderConfig()
      this.resumeNavigation()
    },
    /** 切后台或切页时释放按压，恢复到已提交的选中项。 */
    hide() {
      const runtime = runtimeFor(this)
      runtime.shown = false
      pauseNavigation(runtime)
      this.syncMotion()
    },
    /** 横竖屏与桌面窗口变化后重新计算 rpx 比例及安全区。 */
    resize() {
      this.cancelGesture()
      this.renderConfig()
    },
  },
  methods: {
    /** 同一入口按使用方式读取配置，独立实例不更改应用导航状态。 */
    initializeMode(): void {
      const runtime = runtimeFor(this)
      resetNavigation(runtime)
      if (!this.data.standalone) {
        this.subscribe()
        return
      }
      this.updateView({ navigating: false })
      try {
        this.replaceConfig(
          mergeTabBarConfig(createDefaultConfig(), this.data.config),
        )
        const activeId = resolveTabValue(runtime.items, this.data.value)
        if (runtime.activeId !== activeId) this.setValue(activeId, false, false)
      } catch (error) {
        this.renderConfig()
        this.triggerEvent('configerror', {
          message: error instanceof Error ? error.message : String(error),
        })
      }
      this.syncMotion()
    },
    /** 页面提供所属路由，应用导航协调模块同步对应实例。 */
    syncRoute(route: string): void {
      syncNavigationRoute(this, runtimeFor(this), route)
    },
    /** 原生模式连接共享状态，独立预览保持自己的配置。 */
    subscribe(): void {
      connectNavigation(this, runtimeFor(this))
    },
    /** 布局就绪或重新显示时接续剩余回弹。 */
    resumeNavigation(): void {
      resumeTabNavigation(this, runtimeFor(this))
    },
    /** 选中意图统一交给导航协调模块，失败后恢复原选择。 */
    navigateSelection(
      id: string,
      animation?: CustomTabAnimation,
    ): Promise<void> {
      return navigateTabSelection(this, runtimeFor(this), id, animation)
    },
    /** 仅提交变化字段，将一次选中状态合并为一次跨线程更新。 */
    updateView(patch: Record<string, unknown>, done?: () => void): void {
      const data = this.data as Record<string, unknown>
      const changed: Record<string, unknown> = {}
      for (const key of Object.keys(patch)) {
        const value = patch[key]
        if (value === data[key]) continue
        if (
          Array.isArray(value) &&
          JSON.stringify(value) === JSON.stringify(data[key])
        )
          continue
        changed[key] = value
      }
      if (Object.keys(changed).length) this.setData(changed, done)
      else done?.()
    },
    /** 内部替换已校验的配置，并处理选中项被隐藏或删除的情况。 */
    replaceConfig(config: CustomTabBarConfig): void {
      const runtime = runtimeFor(this)
      if (JSON.stringify(runtime.config) === JSON.stringify(config)) {
        this.renderConfig()
        return
      }
      const previousIds = runtime.items.map((item) => item.id).join('\0')
      const previousId = runtime.activeId
      const motionChanged =
        JSON.stringify(runtime.config.motion) !== JSON.stringify(config.motion)
      runtime.config = config
      runtime.items = visibleTabItems(config)
      runtime.activeId = resolveTabValue(
        runtime.items,
        runtime.activeId || this.data.value,
      )
      this.renderConfig()
      if (
        motionChanged ||
        previousId !== runtime.activeId ||
        previousIds !== runtime.items.map((item) => item.id).join('\0')
      )
        this.settle(false)
    },
    /** 原生模式更新全部 Tab 页，独立模式只更新当前实例；参数均经过同一校验。 */
    configure(patch: CustomTabBarPatch): void {
      if (this.data.standalone)
        this.replaceConfig(mergeTabBarConfig(runtimeFor(this).config, patch))
      else configureTabBar(patch)
    },
    /** 替换列表时保留稳定 id 对应的选中状态。 */
    setItems(items: CustomTabItem[]): void {
      this.configure({ items })
    },
    /** 单项更新也经过完整校验，避免同名 id 或异常数量进入视图。 */
    updateItem(id: string, patch: Partial<Omit<CustomTabItem, 'id'>>): void {
      const items = this.getConfig().items
      if (!items.some((item) => item.id === id))
        throw new Error(`Tabbar 导航项不存在：${id}`)
      this.configure({
        items: items.map((item) =>
          item.id === id ? { ...item, ...patch, id } : item,
        ),
      })
    },
    /** 返回深度足够的配置副本，各导航项和配置组均独立。 */
    getConfig(): CustomTabBarConfig {
      return this.data.standalone
        ? mergeTabBarConfig(runtimeFor(this).config, {})
        : getTabBarSnapshot().config
    },
    /** 纯计算生成视图；组件只维护缓存并决定是否需要重新测量。 */
    renderConfig(): void {
      const runtime = runtimeFor(this)
      if (!runtime.attached) return
      const window = wx.getWindowInfo()
      const { windowKey, geometryKey } = createViewKeys(
        runtime.config,
        runtime.items.length,
        window,
      )
      if (
        runtime.renderedConfig === runtime.config &&
        runtime.windowKey === windowKey &&
        this.data.measured
      )
        return
      const measureNeeded =
        geometryKey !== runtime.geometryKey || !this.data.measured
      runtime.renderedConfig = runtime.config
      runtime.windowKey = windowKey
      runtime.geometryKey = geometryKey
      if (measureNeeded) runtime.revision += 1
      const view = createTabView(
        runtime.config,
        runtime.items,
        runtime.activeId,
        window,
        !measureNeeded && this.data.measured,
      )
      runtime.padding = view.padding
      this.updateView(view.data, () => {
        if (!runtime.attached || !runtime.ready) return
        this.bindMotionItems()
        this.syncMotion(measureNeeded)
        if (measureNeeded) this.measure()
      })
    },
    /** 以实际渲染宽度计算等分区域，支持 1 至 5 项及父容器内嵌。 */
    measure(): void {
      const runtime = runtimeFor(this)
      if (!runtime.attached || !runtime.ready || this.data.hidden) return
      if (runtime.pendingMeasure && runtime.pendingMeasure === runtime.revision)
        return
      const revision = ++runtime.revision
      runtime.pendingMeasure = revision
      this.createSelectorQuery()
        .select('.custom-tab__bar')
        .boundingClientRect((rect) => {
          if (runtime.pendingMeasure === revision) runtime.pendingMeasure = 0
          if (
            !runtime.attached ||
            revision !== runtime.revision ||
            !rect ||
            Array.isArray(rect) ||
            rect.width <= 0
          )
            return
          runtime.rect = {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          }
          const layout = measureTabLayout(
            rect,
            runtime.config,
            runtime.items.length,
            runtime.padding,
            wx.getWindowInfo().windowWidth,
          )
          runtime.slot = layout.slot
          this.updateView({
            measured: true,
            positionStyle: layout.positionStyle,
          })
          this.syncMotion(true)
          this.settle(false)
          this.resumeNavigation()
          this.triggerEvent('layout', {
            height: layout.height,
            width: layout.width,
          })
        })
        .exec()
    },
    /** 绑定模块管理共享图句柄，基座绑定在 ready 后只建立一次。 */
    initializeMotion(): void {
      const runtime = runtimeFor(this)
      if (!runtime.motion) return
      bindBaseMotion(this, runtime.bindings, runtime.motion)
      this.bindMotionItems()
    },
    /** 仅条目身份变化时重绑内容，主题和角标更新复用句柄。 */
    bindMotionItems(): void {
      const runtime = runtimeFor(this)
      if (runtime.motion)
        bindItemMotion(this, runtime.bindings, runtime.motion, runtime.items)
    },
    /** 将布局视口坐标转换为屏幕坐标，供原生手势统一判断实际底栏边界。 */
    motionSettings(): FluidSettings {
      const runtime = runtimeFor(this)
      const palette = deriveTabPalette(runtime.config.theme)
      const screenTop = wx.getWindowInfo().screenTop ?? 0
      return {
        epoch: runtime.epoch,
        alive: runtime.attached,
        locked:
          this.data.disabled ||
          this.data.navigating ||
          this.data.modalSuspended,
        visible:
          runtime.shown &&
          !this.data.hidden &&
          !this.data.modalSuspended &&
          this.data.measured,
        enableDrag: runtime.config.enableDrag,
        barLeft: runtime.rect.left,
        barWidth: runtime.rect.width,
        left: runtime.rect.left + runtime.padding + 1,
        top: runtime.rect.top + screenTop,
        height: runtime.rect.height,
        slot: runtime.slot,
        width: Math.max(1, runtime.slot - Math.min(4, runtime.padding)),
        enabled: runtime.items.map((item) => !item.disabled),
        color: palette.color,
        selectedColor: palette.selectedColor,
        disabledColor: palette.disabledColor,
        motion: runtime.config.motion,
      }
    },
    /** 配置、布局和生命周期统一用一条 UI 命令，废弃旧语义回调。 */
    syncMotion(reset = false): void {
      const runtime = runtimeFor(this)
      if (!runtime.motion) return
      runtime.epoch += 1
      wx.worklet.runOnUI(configureFluid)(
        runtime.motion,
        this.motionSettings(),
        runtime.items.findIndex((item) => item.id === runtime.activeId),
        reset,
      )
    },
    /** 恢复已提交状态；选中相同时 UI 侧保留未结束的回弹。 */
    settle(animate = true): void {
      const runtime = runtimeFor(this)
      const index = runtime.items.findIndex(
        (item) => item.id === runtime.activeId,
      )
      if (runtime.motion)
        wx.worklet.runOnUI(selectFluid)(
          runtime.motion,
          Math.max(0, index),
          animate,
          ++runtime.epoch,
        )
      if (runtime.attached)
        this.updateView({
          activeId: runtime.activeId,
          hasSelection: !!runtime.activeId,
        })
    },
    /** 更新选择；非法、隐藏或禁用 id 保留当前值，返回 false。 */
    setValue(id: string, emit = false, animate = true): boolean {
      const runtime = runtimeFor(this)
      if (!runtime.items.some((item) => item.id === id && !item.disabled))
        return false
      const previousId = runtime.activeId
      runtime.activeId = id
      this.settle(animate)
      if (emit && previousId !== id) this.emitSelection(id, previousId, 'api')
      return true
    },
    /** 接续真实手势状态；外部程序导航仍可按起止项生成兼容动画。 */
    resumeTransition(
      fromId: string,
      toId: string,
      startedAt: number,
      animation?: CustomTabAnimation,
    ): boolean {
      const runtime = runtimeFor(this)
      if (
        !runtime.ready ||
        !runtime.slot ||
        !this.data.measured ||
        runtime.activeId !== toId ||
        !runtime.motion
      )
        return false
      const from = runtime.items.findIndex((item) => item.id === fromId)
      const to = runtime.items.findIndex((item) => item.id === toId)
      if (from < 0 || to < 0 || !Number.isFinite(startedAt)) return false
      wx.worklet.runOnUI(resumeFluid)(
        runtime.motion,
        animation ?? {
          startedAt,
          head: from,
          tail: from,
          headVelocity: 0,
          tailVelocity: 0,
          target: to,
          press: 0,
          kick: 0.65,
          motion: runtime.config.motion,
        },
      )
      return true
    },
    /** JS 只处理语义事件，视觉反馈已在 UI 线程完成。 */
    onFluidEvent(event: FluidEvent): void {
      const runtime = findRuntime(this)
      if (
        !runtime ||
        !runtime.attached ||
        !runtime.shown ||
        event.epoch !== runtime.epoch ||
        event.sequence <= runtime.committedSequence ||
        this.data.disabled ||
        this.data.navigating ||
        this.data.hidden ||
        this.data.modalSuspended
      )
        return
      const item = runtime.items[event.index]
      if (!item || item.disabled) return
      if (event.kind === 'preview') {
        this.playHaptic()
        this.triggerEvent('preview', {
          id: item.id,
          index: event.index,
          item: { ...item },
        })
        return
      }
      runtime.committedSequence = event.sequence
      const previousId = runtime.activeId
      runtime.activeId = item.id
      this.updateView({ activeId: item.id, hasSelection: true })
      if (previousId !== item.id) {
        this.playHaptic()
        this.emitSelection(item.id, previousId, event.source, event.animation)
      } else if (event.source === 'tap')
        this.triggerEvent('reselect', {
          id: item.id,
          index: event.index,
          item: { ...item },
        })
    },
    /** 原生模式由当前组件提交导航；独立模式仅派发事件供页面处理。 */
    emitSelection(
      id: string,
      previousId: string,
      source: CustomTabChange['source'],
      animation?: CustomTabAnimation,
    ): void {
      const runtime = runtimeFor(this)
      const index = runtime.items.findIndex((item) => item.id === id)
      const item = runtime.items[index]
      if (!item) return
      if (!this.data.standalone) void this.navigateSelection(id, animation)
      this.triggerEvent('change', {
        id,
        previousId,
        index,
        item: { ...item },
        source,
        ...(animation ? { animation } : {}),
      } satisfies CustomTabChange)
    },
    /** 轻震动仅在明确启用时执行，连续跨项设置短节流。 */
    playHaptic(): void {
      const runtime = runtimeFor(this)
      const now = Date.now()
      if (!runtime.config.haptics || now - runtime.lastHapticAt < 65) return
      runtime.lastHapticAt = now
      wx.vibrateShort({
        type: 'light',
        fail: () => {
          /* 无震动能力时不影响选择。 */
        },
      })
    },
    /** 触屏时在 UI 线程立即扩散，无需等待点击或长按识别成功。 */
    shouldAcceptTap(this: FluidHost, event?: FluidGesture): boolean {
      'worklet'
      return !!this._fluid && pressFluid(this._fluid, event)
    },
    /** 拖动与点击共享按压起点，重复协商不会重启动画。 */
    shouldAcceptDrag(this: FluidHost, event?: FluidGesture): boolean {
      'worklet'
      return !!this._fluid && pressFluid(this._fluid, event, true)
    },
    /** 高频协商仍在 UI 线程完成，应用拖动阈值并避让纵向滚动。 */
    shouldRespondDrag(this: FluidHost, event: FluidGesture): boolean {
      'worklet'
      return !!this._fluid && respondsFluid(this._fluid, event)
    },
    /** 点击识别器在 UI 线程提供按下和松手反馈。 */
    onTapGesture(this: FluidHost, event: FluidGesture): void {
      'worklet'
      if (this._fluid) tapFluid(this._fluid, event)
    },
    /** 长按后由同一识别器持续跟踪移动，松手才提交目标。 */
    onLongPressGesture(this: FluidHost, event: FluidGesture): void {
      'worklet'
      if (this._fluid) longPressFluid(this._fluid, event)
    },
    /** 高频手势不经过逻辑线程，也不调用 setData。 */
    onDragGesture(this: FluidHost, event: FluidGesture): void {
      'worklet'
      if (this._fluid) dragFluid(this._fluid, event)
    },
    /** 触屏补齐即时按压反馈；只传项目索引，不向 UI 逐帧传输坐标。 */
    onTouchStart(event: WechatMiniprogram.TouchEvent): void {
      if (this.data.modalSuspended) return
      if (event.touches.length > 1) {
        this.cancelGesture()
        return
      }
      const runtime = runtimeFor(this)
      if (runtime.motion)
        wx.worklet.runOnUI(touchPressFluid)(
          runtime.motion,
          Number(event.currentTarget.dataset.index),
          runtime.epoch,
        )
    },
    /** 拖动松手统一提交最终屏幕坐标，原生结束事件不能用零值或起点抢先收尾。 */
    onTouchEnd(event?: WechatMiniprogram.TouchEvent): void {
      const runtime = runtimeFor(this)
      const touch = event?.changedTouches?.[0]
      const point: FluidGesture = touch
        ? {
            state: 3,
            absoluteX: touch.clientX,
            absoluteY: touch.clientY + (wx.getWindowInfo().screenTop ?? 0),
          }
        : { state: 3 }
      if (runtime.motion)
        wx.worklet.runOnUI(endFluid)(
          runtime.motion,
          runtime.epoch,
          runtime.motion.session.value.sequence,
          point,
        )
    },
    /** 系统中断触摸时取消预览，不将中断当成松手提交。 */
    onTouchCancel(): void {
      this.cancelGesture()
    },
    /** 页面失焦、系统打断或多指输入时取消未提交预览。 */
    cancelGesture(): void {
      const runtime = runtimeFor(this)
      if (runtime.motion)
        wx.worklet.runOnUI(cancelFluid)(runtime.motion, ++runtime.epoch)
    },
    /** 普通单击与无障碍点击均提交到 UI，由同一手势状态去重并排除拖动。 */
    onTap(event: WechatMiniprogram.TouchEvent): void {
      if (this.data.modalSuspended) return
      const runtime = runtimeFor(this)
      if (runtime.motion)
        wx.worklet.runOnUI(fallbackTapFluid)(
          runtime.motion,
          Number(event.currentTarget.dataset.index),
        )
    },
  },
})
