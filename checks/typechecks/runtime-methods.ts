// SPDX-License-Identifier: Apache-2.0
/** 混合同步生命周期与异步业务方法时，页面推导不能退化为 never。 */
definePage({
  data: { title: '首页', todayLabel: '', visible: true },
  methods: {
    /** 复现首页通过生命周期更新数据的使用方式。 */
    onShow(): void {
      const today = new Date()
      this.setData({ todayLabel: `${today.getMonth() + 1}月${today.getDate()}日` })
      const space: number | undefined = this.data.tabBarSpace
      void space
    },
    /** 异步方法不依赖 this 时也必须完整参与方法推导。 */
    async openDemo(): Promise<void> {
      try { await Promise.resolve() }
      catch { wx.showToast({ title: '暂时无法打开', icon: 'none' }) }
    },
  },
  lifetimes: {
    /** 同时保留数据、方法返回值和错误参数检查。 */
    attached() {
      const title: string = this.data.title
      const pending: Promise<void> = this.openDemo()
      // @ts-expect-error 异步方法不接受额外参数。
      this.openDemo('wrong')
      // @ts-expect-error 字符串数据不能写入数值。
      this.setData({ todayLabel: 123 })
      // @ts-expect-error 不能读取未声明的方法。
      this.missingMethod()
      void title
      void pending
    },
  },
})

/** 组件也保留异步方法和事件参数的具体类型。 */
defineComponent({
  data: { count: 0 },
  methods: {
    /** 显式参数和 Promise 返回类型不能被宽泛 Function 索引吞掉。 */
    async increment(step: number): Promise<number> { return this.data.count + step },
    /** 同步方法可以正确调用异步业务方法。 */
    check(): void {
      const pending: Promise<number> = this.increment(1)
      // @ts-expect-error 自定义参数仍需为数值。
      this.increment('1')
      // @ts-expect-error 异步返回值不能当作同步数值。
      const value: number = this.increment(1)
      void pending
      void value
    },
  },
})
