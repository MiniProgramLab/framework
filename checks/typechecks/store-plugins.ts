// SPDX-License-Identifier: Apache-2.0
import { createStoreRoot } from '@miniprogramlab/core/store/core'
import { defineStorePlugin } from '@miniprogramlab/core/store/plugin'

/** 第三个插件只扩展注册表，无须改写页面或组件包装器类型。 */
type SelectionState = { selected: string[] }
declare module '@miniprogramlab/core/store/plugin' {
  interface StorePluginStates {
    selectionStore: SelectionState
  }
  interface StorePluginOptions {
    selectionStoreLimit?: number
  }
}

/** 独立插件的状态也由核心连接正确推导。 */
const selection = defineStorePlugin<SelectionState>({
  key: '__selectionState__',
  option: 'selectionStore',
  extraOptions: ['selectionStoreLimit'],
  /** 每次初始化创建新的数组。 */
  create: () => ({ selected: [] }),
  /** 校验器只允许读取即将提交的快照。 */
  validateState(state) {
    // @ts-expect-error 插件校验器不能修改状态。
    state.selected.push('错误')
  },
})
/** 核心连接的泛型不丢失自定义插件字段。 */
const connection = createStoreRoot(() => ({}), [selection]).connectPlugin(
  selection,
  {},
  { options: {}, ownerOptions: {} },
  () => true,
)
connection.store.update({ selected: ['甲'] })
// @ts-expect-error 插件字段必须遵守其声明类型。
connection.store.update({ selected: [1] })

defineComponent({
  selectionStore: true,
  selectionStoreLimit: 3,
  data: { count: 0 },
  methods: {
    /** 插件成员、普通 data 和自定义方法仍同时保持类型。 */
    select(value: string) {
      this.setData({ count: 1 })
      this.$selectionStore.update({ selected: [value] })
      // @ts-expect-error 插件字段保持元素类型。
      this.$selectionStore.update({ selected: [1] })
      // @ts-expect-error 插件不自动注入模板快照。
      this.data.$selectionStore
      // @ts-expect-error 新增插件不隐式开启页面状态。
      this.$pageStore
    },
  },
})

/** 动态开关在未知运行时值下保持可选。 */
declare const dynamicPlugin: boolean
definePage({
  selectionStore: dynamicPlugin,
  methods: {
    /** 访问前必须处理未开启情形。 */
    onLoad() {
      this.$selectionStore?.update({ selected: [] })
      // @ts-expect-error 动态开关不能保证门面存在。
      this.$selectionStore.update({ selected: [] })
    },
  },
})
defineComponent({
  selectionStore: false,
  methods: {
    /** 明确关闭的插件不提供门面。 */
    check() {
      // @ts-expect-error 关闭插件不可使用。
      this.$selectionStore
    },
  },
})
// @ts-expect-error 第三个插件同样只接受布尔开关。
defineComponent({ selectionStore: 'true' })
// @ts-expect-error 第三个插件自动加入门面保留名。
defineComponent({ data: { $selectionStore: {} } })
// @ts-expect-error 附加配置的类型也由插件声明合并提供。
defineComponent({ selectionStoreLimit: '错误' })
