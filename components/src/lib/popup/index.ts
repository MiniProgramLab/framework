import { defineComponent } from '../adapters/component.js'
import { layerBehavior, layerProperties } from '../shared/layer.js'
import type { LayerHost } from '../shared/layer.js'

/** Popup 自己承载面板 Portal，遮罩组件与面板共用唯一弹层记录。 */
defineComponent({
  overlayStore: true,
  options: { multipleSlots: true, virtualHost: true },
  behaviors: [layerBehavior],
  properties: {
    ...layerProperties,
    /** Popup 自动避开胶囊区和底部安全区。 */
    safeArea: { type: Boolean, value: true },
    /** 可选的标题文字。 */
    title: { type: String, value: '' },
    /** 按需展示独立关闭按钮。 */
    closable: { type: Boolean, value: false },
  },
  observers: {
    /** 异步标题变化后重新测量面板自己的内容。 */
    'title, closable'(this: LayerHost) {
      wx.nextTick(() => this.refreshLayout())
    },
  },
  methods: {
    /** 关闭按钮复用当前面板的统一关闭协议。 */
    onCloseTap(this: LayerHost): void {
      this.requestClose('close')
    },
    /** 保留既有布局刷新入口，调用方无须知道面板与遮罩的分离结构。 */
    refreshPopupLayout(this: LayerHost): void {
      this.refreshLayout()
    },
  },
})
