// SPDX-License-Identifier: Apache-2.0
import type { Theme, globalStoreDefinition } from '../fixtures/store.js'
import type { StoreStateOf } from '@miniprogramlab/core'

/** 测试项目显式声明全局状态，不依赖任何消费应用。 */
declare module '@miniprogramlab/core/store/global' {
  interface GlobalStoreRegistry {
    /** 从测试状态定义推导公开门面。 */
    state: StoreStateOf<typeof globalStoreDefinition>
  }
}
import { defineGlobalStore } from '@miniprogramlab/core/store/definition'
import { definePageStore } from '@miniprogramlab/core/store/plugins/page/index'

/** 页面定义只描述状态，实例归属仍由框架固定绑定。 */
const counter = definePageStore(() => ({
  count: 0,
  nested: { label: '' },
  items: [1],
}))
/** 动态开关必须保留可选门面，不能假定每个实例都启用。 */
declare const dynamic: boolean

/** 页面中的方法、生命周期和 Store 类型同时保留。 */
definePage({
  pageStore: true,
  globalStore: true,
  pageStoreDefinition: counter,
  data: { shown: 0 },
  methods: {
    /** 页面参数和自定义方法仍保留原生推导。 */
    onLoad(query) {
      this.increase(1)
      void query.id
      this.$pageStore.update((draft) => {
        draft.count += 1
        draft.items.push(2)
      })
      this.$globalStore.update({ theme: 'dark' })
      this.$pageStore.on(
        (next, previous) => {
          this.setData({ shown: next.count })
          void previous?.count
          // @ts-expect-error 响应快照递归只读。
          next.nested.label = '错误'
          // @ts-expect-error 数组快照同样不可写。
          next.items.push(3)
        },
        { immediate: true },
      )
      // @ts-expect-error Store 仅保留 update 和 on。
      this.$pageStore.state
      // @ts-expect-error 全局门面没有页面私有字段。
      this.$globalStore.update({ __pageStore__: {} })
      // @ts-expect-error count 不接受字符串。
      this.$pageStore.update({ count: '1' })
      // @ts-expect-error 全局偏好必须使用支持的主题。
      this.$globalStore.update({ theme: 'unknown' })
      // @ts-expect-error 页面数据不自动注入模板快照。
      this.data.$pageStore
      const theme: Theme = this.data.$globalStore.theme
      void theme
    },
    /** 自定义方法参数保持 number。 */
    increase(step: number): number {
      return this.data.shown + step
    },
  },
})

/** 普通组件同样获得强类型页面门面，但没有页面 route。 */
defineComponent({
  pageStore: true,
  globalStore: true,
  pageStoreDefinition: counter,
  properties: { title: String },
  lifetimes: {
    /** attached 中的 this 仍包含自定义方法及两个门面。 */
    attached() {
      this.increment(1)
      this.$globalStore.update({ theme: 'light' })
    },
  },
  methods: {
    /** 只读快照字段从定义自动推导。 */
    increment(step: number): void {
      this.$pageStore.update((draft) => {
        draft.count += step
      })
      this.$globalStore.on((next) => {
        const theme: Theme = next.theme
        void theme
      })
      // @ts-expect-error 组件不混入页面字段。
      this.route
      // @ts-expect-error 不允许传错误的自定义方法参数。
      this.increment('1')
      this.$globalStore.on((next) => {
        // @ts-expect-error 全局响应不能访问内部页面区。
        void next.__pageStore__
      })
    },
  },
})

/** 关闭的范围不提供 API 或全局模板快照。 */
definePage({
  methods: {
    /** 省略开关等同于 false。 */
    onLoad() {
      // @ts-expect-error 未开启页面 Store。
      this.$pageStore
      // @ts-expect-error 未开启全局 Store。
      this.$globalStore
      // @ts-expect-error 未开启全局模板快照。
      this.data.$globalStore
    },
  },
})

/** 组件明确关闭全局时，页面选项也不能隐式开启它。 */
defineComponent({
  pageStore: true,
  globalStore: false,
  methods: {
    /** 两个开关分别控制成员可见性。 */
    check(): void {
      this.$pageStore.update({ loading: true })
      // @ts-expect-error 全局范围未开启。
      this.$globalStore
    },
  },
})

/** 动态布尔值只能按可选成员使用。 */
defineComponent({
  globalStore: dynamic,
  methods: {
    /** 运行时布尔值不保证句柄存在。 */
    check(): void {
      this.$globalStore?.update({ theme: 'light' })
      // @ts-expect-error 动态开关必须处理未启用情况。
      this.$globalStore.update({ theme: 'light' })
    },
  },
})

// @ts-expect-error 参与开关仅接受布尔值。
definePage({ pageStore: {} })
// @ts-expect-error 两种状态定义不能混用。
definePage({ pageStoreDefinition: defineGlobalStore(() => ({ count: 0 })) })
// @ts-expect-error 不允许占用门面名称。
defineComponent({ methods: { $globalStore() {} } })
// @ts-expect-error 不允许占用自动快照名称。
definePage({ data: { $globalStore: {} } })

// @ts-expect-error 公开定义不能包含内部页面容器。
defineGlobalStore(() => ({ __pageStore__: {} }))
