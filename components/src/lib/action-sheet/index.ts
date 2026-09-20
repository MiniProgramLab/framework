// SPDX-License-Identifier: Apache-2.0
import { defineComponent } from '../adapters/component.js'
import { layerBehavior, layerProperties } from '../shared/layer.js'
import type { LayerHost } from '../shared/layer.js'
import type { ActionSheetItem, ActionSheetSelection } from './types.js'

/** 菜单只在共用弹层宿主上增加选项数据和选择状态。 */
type ActionSheetHost = LayerHost & {
  data: {
    actions: ActionSheetItem[]
    selecting: boolean
    closeOnSelect: boolean
  }
}

/** 待退场完成的选择属于本次组件交互，不写入弹层全局状态。 */
const pending = new WeakMap<object, ActionSheetSelection>()

/** ActionSheet 自己承载面板 Portal，选项与取消入口不再放进遮罩插槽。 */
defineComponent({
  overlayStore: true,
  behaviors: [layerBehavior],
  options: { virtualHost: true },
  properties: {
    ...layerProperties,
    /** 操作菜单固定从底部进入。 */
    position: { type: String, value: 'bottom' },
    /** 菜单自动预留一次底部安全距离。 */
    safeArea: { type: Boolean, value: true },
    /** 可选的菜单标题。 */
    title: { type: String, value: '' },
    /** 数据驱动选项，支持禁用和危险操作。 */
    actions: { type: Array, value: [] as ActionSheetItem[] },
    /** 留空时不显示取消操作。 */
    cancelText: { type: String, value: '取消' },
    /** 默认在退场完成后发送选择结果。 */
    closeOnSelect: { type: Boolean, value: true },
  },
  data: { selecting: false },
  observers: {
    /** 重新打开意味着新的交互，不能发送上一次未完成的选择。 */
    show(this: ActionSheetHost, value: boolean) {
      if (value) {
        pending.delete(this)
        this.setData({ selecting: false })
      }
    },
    /** 异步选项或取消文案更新后，由组合组件自动重算内部高度。 */
    'actions, cancelText, title'(this: ActionSheetHost) {
      wx.nextTick(() => this.refreshLayout())
    },
  },
  lifetimes: {
    /** 销毁时放弃待发送结果，共用生命周期负责清理当前弹层记录。 */
    detached() {
      pending.delete(this)
    },
  },
  methods: {
    /** 点击时复制选项，退场期间数据更新不会改变已选中的业务值。 */
    onSelect(
      this: ActionSheetHost,
      event: WechatMiniprogram.TouchEvent,
    ): void {
      if (!this.data.show || this.data.selecting) return
      const index = Number(event.currentTarget.dataset.index)
      const item = this.data.actions[index]
      if (!Number.isInteger(index) || !item || item.disabled) return
      const action = JSON.parse(JSON.stringify(item)) as ActionSheetItem
      const selection: ActionSheetSelection = {
        value: action.value,
        index,
        action,
      }
      if (!this.data.closeOnSelect) {
        this.triggerEvent('select', selection)
        return
      }
      pending.set(this, selection)
      this.setData({ selecting: true })
      this.requestClose('select')
    },
    /** 取消按钮复用当前展示宿主的关闭原因和双向同步。 */
    onCancel(this: ActionSheetHost): void {
      if (!this.data.selecting) this.requestClose('cancel')
    },
    /** 统一转发弹层事件，正常退场后再提交本次选择结果。 */
    dispatchOverlayEvent(
      this: ActionSheetHost,
      name: string,
      detail?: Record<string, unknown>,
    ): void {
      if (name === 'change' && detail?.reason !== 'select')
        pending.delete(this)
      if (name === 'error') {
        pending.delete(this)
        this.setData({ selecting: false })
      }
      if (name !== 'closed') {
        this.triggerEvent(name, detail)
        return
      }
      const selection = pending.get(this)
      pending.delete(this)
      this.setData({ selecting: false })
      this.triggerEvent('closed', detail)
      if (!this.data.show && detail?.reason === 'select' && selection)
        this.triggerEvent('select', selection)
    },
  },
})
