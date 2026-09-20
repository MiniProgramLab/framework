// SPDX-License-Identifier: Apache-2.0
/** 编译期回归检查：这些声明不输出到 dist，也不会在小程序中执行。 */
definePage({
  data: { count: 0 },
  methods: {
    /** 以下错误必须由 TypeScript 检出。 */
    onLoad(query) {
      this.increment(2)
      // @ts-expect-error 自定义方法保留参数类型。
      this.increment('2')
      // @ts-expect-error 页面参数值不能当成 number。
      const wrong: number = query.title
      // @ts-expect-error count 保持 number 类型。
      this.setData({ count: 'wrong' })
      // @ts-expect-error 未声明的 data 字段不能访问。
      this.data.missing
      // @ts-expect-error 未声明的方法不能调用。
      this.notDeclared
      void wrong
    },
    /** 混合声明页面生命周期与自定义方法时，仍可推导方法和返回值。 */
    increment(step: number): number {
      return this.data.count + step
    },
    /** 分享方法可引用页面数据和路由字段。 */
    onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
      return { title: String(this.data.count), path: this.route }
    },
  },
  lifetimes: {
    /** Component 生命周期内同样可以访问页面方法。 */
    attached() {
      this.increment(1)
    },
  },
})
defineComponent({
  properties: { label: String },
  methods: {
    /** 组件不能被误当成页面实例。 */
    check() {
      // @ts-expect-error label 保持 string 类型。
      const wrong: number = this.properties.label
      // @ts-expect-error 组件没有页面 route 字段。
      this.route
      void wrong
    },
  },
})
// @ts-expect-error page 必填。
definePageConfig({ config: { navigationBarTitleText: '缺少名称' } })
// @ts-expect-error page.name 必须为字符串。
definePageConfig({ page: { name: 1 } })
// @ts-expect-error 页面不能被声明为组件。
definePageConfig({ page: { name: 'home' }, config: { component: true } })
// @ts-expect-error 应用页面注册必须交给构建器。
defineAppConfig({ pages: ['pages/index/index'] })
// @ts-expect-error Page 风格的顶层生命周期不能直接用于 Component 页面。
definePage({ onLoad() {} })

// @ts-expect-error methods 只能声明函数。
definePage({ methods: { invalid: 1 } })
// @ts-expect-error 组件 methods 只能声明函数。
defineComponent({ methods: { invalid: 1 } })

definePage({
  methods: {
    // @ts-expect-error 页面生命周期参数不能改为数字。
    onLoad(query: number) {
      void query
    },
  },
})

// @ts-expect-error 应用不能切回 WebView 渲染器。
defineAppConfig({ renderer: 'webview' })
// @ts-expect-error 页面不能覆盖纯 Skyline 策略。
definePageConfig({ page: { name: 'invalidRenderer' }, config: { renderer: 'webview' } })
// @ts-expect-error 页面不能启用旧组件框架。
definePageConfig({ page: { name: 'invalidFramework' }, config: { componentFramework: 'exparser' } })
// @ts-expect-error Skyline 使用自定义导航。
definePageConfig({ page: { name: 'invalidNavigation' }, config: { navigationStyle: 'default' } })
// @ts-expect-error Skyline 页面滚动交给 scroll-view。
definePageConfig({ page: { name: 'invalidScroll' }, config: { disableScroll: false } })
// @ts-expect-error 页面不能覆盖全局 Skyline 灰度或版本区间。
definePageConfig({ page: { name: 'invalidOptions' }, config: { rendererOptions: {} } })

/** 底栏是否存在由页面配置决定，页面类型保留可选留白与具体业务推导。 */
definePage({
  globalStore: true,
  data: { count: 0 },
  methods: {
    /** 页面显示生命周期保留框架字段与自定义方法类型。 */
    onShow() {
      const space: number | undefined = this.data.tabBarSpace
      this.increment(space ?? 0)
      this.$globalStore.on(() => {})
      // @ts-expect-error 底栏留白是可选数值。
      const wrong: string = this.data.tabBarSpace
      // @ts-expect-error 业务方法参数仍为数值。
      this.increment('1')
      void wrong
    },
    /** 业务数据保持具体类型。 */
    increment(step: number): number { return this.data.count + step },
  },
})

defineComponent({
  methods: {
    /** 普通组件没有页面底栏字段。 */
    check() {
      // @ts-expect-error 底栏留白只属于页面。
      this.data.tabBarSpace
    },
  },
})
// @ts-expect-error 底栏开关不能用于普通组件。
defineComponent({ tabPage: true })
// @ts-expect-error 页面通过 definePageConfig.page.tabBar 声明底栏，不再接受开关。
definePage({ tabPage: true })
// @ts-expect-error 编译器注入的参数不属于公开 API。
definePage({}, true)
// @ts-expect-error 不允许业务覆盖框架留白。
definePage({ data: { tabBarSpace: 5 } })
