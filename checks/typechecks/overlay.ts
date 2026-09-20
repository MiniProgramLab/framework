// SPDX-License-Identifier: Apache-2.0
/** 内置组件单独启用弹层范围时仍不获得业务范围或模板快照。 */
defineComponent({
  overlayStore: true,
  lifetimes: {
    /** 固定状态结构与不可变快照由门面自动推导。 */
    attached() {
      this.$overlayStore.on((next) => {
        const phase: 'opening' | 'open' | 'closing' | undefined =
          next.layers[0]?.phase
        void phase
        // @ts-expect-error 快照不能直接修改。
        next.layers.push({
          id: '甲',
          generation: 1,
          phase: 'open',
        })
      })
      // @ts-expect-error 弹层没有业务 count 字段。
      this.$overlayStore.update({ count: 1 })
      // @ts-expect-error 未启用业务页面范围。
      this.$pageStore
      // @ts-expect-error 不自动向模板注入弹层快照。
      this.data.$overlayStore
    },
  },
})

/** 业务页面省略开关时不会获得内部弹层门面。 */
definePage({
  methods: {
    /** 禁止将页面的自动隔离误用为业务 Store 授权。 */
    check(): void {
      // @ts-expect-error 普通页面没有弹层门面。
      this.$overlayStore
    },
  },
})
