import { getWindowLayout } from '../lib/shared/window.js'
import { headerProperties } from '../page-header/properties.js'
import { createScrollIsolation } from '@skyline-kit/framework/store/plugins/overlay/adapters/index'
import type { ScrollIsolation } from '@skyline-kit/framework/store/plugins/overlay/adapters/index'
import { createScrollGate } from '@skyline-kit/framework/store/plugins/overlay/adapters/index.worklet'
import type { ScrollGateHost } from '@skyline-kit/framework/store/plugins/overlay/adapters/index.worklet'

/** 滚动适配器只由组件生命周期持有，不进入渲染数据。 */
const scrolls = new WeakMap<object, ScrollIsolation>()

/** 为 Skyline 页面统一导航、独立滚动、固定底栏和设备安全区。 */
defineComponent({
  overlayStore: true,
  options: { multipleSlots: true, virtualHost: true },
  properties: {
    ...headerProperties,
    /** default 使用内置页头；custom 使用完整 header 插槽；none 隐藏页头。 */
    headerMode: { type: String, value: 'default' },
    /** 无页头时仍避开状态栏与胶囊；仅沉浸式页面主动关闭。 */
    safeTop: { type: Boolean, value: true },
    safeBottom: { type: Boolean, value: true },
    /** 悬浮 Tabbar 等覆盖层所需的额外空间，单位为逻辑像素，不含安全区。 */
    bottomSpace: { type: Number, value: 0 },
    /** 正文默认独立滚动并提供设计稿的左右间距。 */
    scrollable: { type: Boolean, value: true },
    padded: { type: Boolean, value: true },
    /** 显式启用 footer 插槽，安全区会从正文末尾转移到底栏。 */
    footer: { type: Boolean, value: false },
    footerPadded: { type: Boolean, value: true },
    footerBackground: { type: String, value: '#FFFFFF' },
    /** 透传 Skyline 滚动定位与刷新控制属性。 */
    scrollTop: { type: Number, value: 0 },
    scrollIntoView: { type: String, value: '' },
    scrollWithAnimation: { type: Boolean, value: false },
    upperThreshold: { type: Number, value: 50 },
    lowerThreshold: { type: Number, value: 50 },
    refresherEnabled: { type: Boolean, value: false },
    refresherTriggered: { type: Boolean, value: false },
    refresherThreshold: { type: Number, value: 45 },
    refresherBackground: { type: String, value: '#F7F8F2' },
  },
  data: {
    windowHeight: 0,
    topInset: 0,
    bottomInset: 0,
    safeLeft: 0,
    safeRight: 0,
    scrollLocked: false,
  },
  observers: {
    /** 业务切换静态布局时自动重新登记原生能力，不暴露锁属性。 */
    scrollable() {
      scrolls.get(this)?.refresh()
    },
  },
  lifetimes: {
    /** 在模板绑定前提供稳定的 UI 线程手势共享值。 */
    created() {
      ;(this as unknown as ScrollGateHost)._scrollGate = createScrollGate()
    },
    /** 组件挂载时建立滚动容器的明确高度。 */
    attached() {
      this.updateLayout()
      const gate = (this as unknown as ScrollGateHost)._scrollGate
      scrolls.set(
        this,
        createScrollIsolation(this, {
          selector: '.page-shell__scroll',
          background: true,
          /** 静态布局直接报告无背景滚动能力。 */
          enabled: () => this.data.scrollable,
          /** 滚动锁同步控制刷新入口与 UI 线程的原生手势。 */
          apply: (locked) => {
            gate.value = !locked
            this.setData({ scrollLocked: locked })
          },
        }),
      )
    },
    /** 渲染完成后取得当前滚动节点。 */
    ready() {
      scrolls.get(this)?.refresh()
    },
    /** 解除自身订阅及原生引用，不删除任何弹层条目。 */
    detached() {
      scrolls.get(this)?.dispose()
      scrolls.delete(this)
    },
  },
  pageLifetimes: {
    /** 返回页面时重新读取窗口尺寸。 */
    show() {
      this.updateLayout()
    },
    /** 窗口变化后让正文和固定底栏重新分配空间。 */
    resize() {
      this.updateLayout()
    },
  },
  methods: {
    /** Skyline 原生手势通过 UI 线程共享值及时拒绝背景滚动。 */
    shouldScrollRespond(): boolean {
      'worklet'
      return (this as unknown as ScrollGateHost)._scrollGate.value
    },
    /** 安全区在当前布局中只消费一次，页面无需自行监听设备变化。 */
    updateLayout(): void {
      const {
        windowHeight,
        statusBarHeight,
        navigationBarHeight,
        safeBottom,
        safeLeft,
        safeRight,
      } = getWindowLayout()
      const layout = {
        windowHeight,
        topInset: statusBarHeight + navigationBarHeight,
        bottomInset: safeBottom,
        safeLeft,
        safeRight,
      }
      if (
        (Object.keys(layout) as (keyof typeof layout)[]).some(
          (key) => this.data[key] !== layout[key],
        )
      )
        this.setData(layout)
    },
    /** 保留原生事件名称和 detail；业务通过 page 标签直接监听。 */
    onScrollEvent(event: WechatMiniprogram.CustomEvent): void {
      this.triggerEvent(event.type, event.detail)
    },
    /** 转发页头返回意图；自动导航仅由内部页头执行一次。 */
    onBack(event: WechatMiniprogram.CustomEvent): void {
      this.triggerEvent('back', event.detail)
    },
    /** 转发页头的文字操作。 */
    onAction(): void {
      this.triggerEvent('action')
    },
    /** 将返回失败通知页面，由业务决定提示方式。 */
    onNavigationError(event: WechatMiniprogram.CustomEvent): void {
      this.triggerEvent('navigationerror', event.detail)
    },
  },
})
