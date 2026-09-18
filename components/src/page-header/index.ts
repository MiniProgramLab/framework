import { getWindowLayout } from '../lib/shared/window.js'
import { headerProperties } from './properties.js'
import { componentNavigation } from '../configure.js'

/** 根据设计稿统一紧凑导航、大标题、胶囊避让与返回交互。 */
defineComponent({
  options: { multipleSlots: true, virtualHost: true },
  properties: headerProperties,
  data: {
    statusBarHeight: 0,
    navigationBarHeight: 44,
    contentRight: 96,
    safeLeft: 0,
    safeRight: 0,
    navigating: false,
  },
  lifetimes: {
    /** 首次挂载时按真实设备布局。 */
    attached() {
      this.updateLayout()
    },
  },
  pageLifetimes: {
    /** 重新显示后同步窗口，并释放上一次导航状态。 */
    show() {
      this.setData({ navigating: false })
      this.updateLayout()
    },
    /** 横竖屏和窗口变化时同步胶囊与安全区。 */
    resize() {
      this.updateLayout()
    },
  },
  methods: {
    /** 仅更新页头需要的布局数据。 */
    updateLayout(): void {
      const {
        statusBarHeight,
        navigationBarHeight,
        contentRight,
        safeLeft,
        safeRight,
      } = getWindowLayout()
      this.setData({
        statusBarHeight,
        navigationBarHeight,
        contentRight,
        safeLeft,
        safeRight,
      })
    },
    /** 普通入口回上一页；独立入口回首页；业务拦截时仅通知页面。 */
    onBack(): void {
      if (this.data.navigating) return
      const canGoBack = getCurrentPages().length > 1
      this.triggerEvent('back', { canGoBack })
      if (!this.data.autoBack) return
      this.setData({ navigating: true })
      /** 导航失败时恢复按钮并交由页面展示合适的提示。 */
      const fail = (error: WechatMiniprogram.GeneralCallbackResult): void => {
        this.setData({ navigating: false })
        this.triggerEvent('navigationerror', error)
      }
      if (canGoBack) wx.navigateBack({ delta: 1, fail })
      else
        void Promise.resolve().then(() => {
          const navigation = componentNavigation()
          return navigation.returnTo(this.data.homeUrl || navigation.homeUrl())
        }).catch((error) => {
          fail({
            errMsg:
              error instanceof Error
                ? error.message
                : String(error?.errMsg ?? error),
          })
        })
    },
    /** 禁用时不派发操作，避免重复触发业务请求。 */
    onAction(): void {
      if (!this.data.actionDisabled) this.triggerEvent('action')
    },
  },
})
