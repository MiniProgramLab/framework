// SPDX-License-Identifier: Apache-2.0
import { createRouter } from '../src/router/index.js'
import type { NavigationAdapter, RouteParams, TabPageName } from '../src/router/index.js'

/** 字面量契约同时覆盖 Tab、无参数、可选参数及必填参数页面。 */
const routes = {
  home: { name: 'home', path: '/pages/home/index', kind: 'tab', available: true, params: {} },
  detail: { name: 'detail', path: '/pages/detail/index', kind: 'page', available: true, params: {
    id: { type: 'string', required: true }, count: { type: 'number' }, enabled: { type: 'boolean' },
  } },
  search: { name: 'search', path: '/pages/search/index', kind: 'page', available: true, params: { query: { type: 'string' } } },
} as const
/** 编译期仅关心协议，不执行任何平台导航。 */
declare const adapter: NavigationAdapter
/** 泛型必须从路由数据推导，不能由错误的调用参数反向扩大。 */
const router = createRouter({ routes, entryPageName: 'home', adapter })
/** CLI 消费项目省略适配器后仍保留相同的路由类型约束。 */
const compiledRouter = createRouter({ routes, entryPageName: 'home' })
compiledRouter.navigateTo('/pages/detail/index').params({ id: '1' }).go()
// @ts-expect-error 平台自动注入不会放宽必填参数约束。
compiledRouter.navigateTo('/pages/detail/index').go()
router.navigateTo('/pages/home/index').go()
router.navigateTo('/pages/detail/index').params({ id: '1', count: 0, enabled: false }).go()
router.navigateTo('/pages/search/index').go()
router.getRouteUrl('/pages/search/index', { query: '中文' })
// @ts-expect-error 未声明的页面不能导航。
router.navigateTo('missing').go()
// @ts-expect-error 必填参数不能省略。
router.navigateTo('/pages/detail/index').go()
// @ts-expect-error 参数对象必须包含 id。
router.navigateTo('/pages/detail/index').params({ count: 1 }).go()
// @ts-expect-error 数字字段不能传字符串。
router.getRouteUrl('/pages/detail/index', { id: '1', count: '1' })
// @ts-expect-error Tab 页面不能传入参数对象。
router.navigateTo('/pages/home/index').params({}).go()
// @ts-expect-error 未声明的参数必须拒绝。
router.navigateTo('/pages/search/index').params({ extra: 1 }).go()
// @ts-expect-error 入口名称不能使路由表类型被扩宽。
createRouter({ routes, entryPageName: 'missing', adapter })
/** 外部组件可复用从契约推导出的名称与参数。 */
const tab: TabPageName<typeof routes> = 'home'
const params: RouteParams<typeof routes, '/pages/detail/index'> = { id: '1' }
// @ts-expect-error 普通页面不是 Tab 页面。
const invalidTab: TabPageName<typeof routes> = 'detail'
void [tab, params, invalidTab]

/** 方法解构后依然保留字面量名称与参数约束。 */
const { navigateTo, getRouteUrl } = router
navigateTo('/pages/detail/index').params({ id: '1' }).go()
// @ts-expect-error 解构不能丢失必填参数。
getRouteUrl('/pages/detail/index')

/** 同一执行入口可直接忽略结果，也可等待 Promise。 */
const immediate: Promise<import('../src/router/types.js').NavigationResult> = router.navigateTo('/pages/home/index').go()
const pending = router.navigateTo('/pages/detail/index').params({ id: '1' }).go()
pending.then((result) => { if (!result.ok) { const reason: unknown = result.error.cause; void reason } })
// @ts-expect-error 跳转参数必须是路径，不能继续传页面名称。
router.navigateTo('home').go()
void immediate

/** 页面优先的导航链保留参数类型，回调可以注册在参数前后。 */
const detailNavigation = router.navigateTo('/pages/detail/index')
  .success((result) => { const url: string = result.url; void url })
  .fail((error) => { const cause: unknown = error.cause; void cause })
// @ts-expect-error 必填参数未设置前不能发起导航。
detailNavigation.go()
// @ts-expect-error 必填参数未设置前不能替换页面。
detailNavigation.replace()
// @ts-expect-error 必填参数未设置前不能重建页面栈。
detailNavigation.reLaunch()
// @ts-expect-error 缺少目标页的必填字段。
detailNavigation.params({ count: 1 })
// @ts-expect-error 数字参数不能传字符串。
detailNavigation.params({ id: '42', count: '1' })
// @ts-expect-error 不接受未声明字段。
detailNavigation.params({ id: '42', extra: true })
detailNavigation.params({ id: '42', count: 0, enabled: false }).success(() => {}).fail(() => {}).go()
detailNavigation.params({ id: '42' }).replace()
detailNavigation.params({ id: '42' }).reLaunch()
// @ts-expect-error success 接收成功回执，不包含失败字段。
detailNavigation.success((result) => { void result.error })
// @ts-expect-error fail 接收 NavigationError，不是结果包装对象。
detailNavigation.fail((error) => { void error.ok })

/** Tab 页从入口到回调派生链均不提供参数配置。 */
const homeNavigation = router.navigateTo('/pages/home/index')
homeNavigation.go()
homeNavigation.success(() => {}).fail(() => {}).replace()
// @ts-expect-error Tab 页不提供 params 方法。
homeNavigation.params({})
// @ts-expect-error 注册回调不能使 Tab 页重新获得 params。
homeNavigation.success(() => {}).fail(() => {}).params({ id: '42' })

/** 可选参数页允许直接执行，设置参数后继续保留约束。 */
router.navigateTo('/pages/search/index').go()
router.navigateTo('/pages/search/index').params({ query: '中文' }).replace()
// @ts-expect-error 可选参数的值类型仍然严格。
router.navigateTo('/pages/search/index').params({ query: 42 })
// @ts-expect-error 只能选择契约中已声明的路径。
router.navigateTo('/pages/missing/index')

/** 解构新入口和终结方法后，类型与返回值保持一致。 */
const { go } = navigateTo('/pages/detail/index').params({ id: '42' })
const chainResult: Promise<import('../src/router/types.js').NavigationResult> = go()
void chainResult

/** 动态页面包含 Tab 时，必须先收窄路径才能配置页面参数。 */
declare const dynamicPage: '/pages/home/index' | '/pages/detail/index'
// @ts-expect-error 混合目标不能绕过 Tab 参数限制。
router.navigateTo(dynamicPage).params({ id: '42' })
// @ts-expect-error 混合目标不能绕过普通页面必填参数。
router.navigateTo(dynamicPage).go()

/** 独立返回入口不需要目标页，回调只暴露原生返回的回执。 */
router.navigateBack().success((result) => {
  const delta: number = result.delta
  const method: 'navigateBack' = result.method
  void [delta, method]
}).fail((error) => { void error.cause }).go()
router.navigateBack(2).go()
// @ts-expect-error 返回入口不接受页面路径。
router.navigateBack('/pages/home/index')
// @ts-expect-error 返回已有页面不能重新设置查询参数。
router.navigateBack().params({ id: '42' })
// @ts-expect-error 返回链不能替换目标页面。
router.navigateBack().replace()
// @ts-expect-error 返回已有页面不能重建页面栈。
router.navigateBack().reLaunch()
// @ts-expect-error 目标页导航链不包含返回操作。
router.navigateTo('/pages/home/index').back()
// @ts-expect-error 原生返回回执不伪造目标 URL。
router.navigateBack().success((result) => { void result.url })

/** 等待结果与回调模式互斥，参数配置和解构都不能丢失模式约束。 */
async function checkExclusiveNavigationModes(): Promise<void> {
  const base = router.navigateTo('/pages/detail/index').params({ id: '42' })
  const callbackBranch = base.success(() => {})
  const result = await base.go()
  if (result.ok) { const url: string = result.url; void url }
  await base.replace()
  await base.reLaunch()
  await router.navigateToUrl('/pages/detail/index?id=42').go()
  await router.navigateToUrl('/pages/detail/index?id=42').replace()
  await router.navigateToUrl('/pages/detail/index?id=42').reLaunch()
  // @ts-expect-error URL 链不提供参数配置。
  router.navigateToUrl('/pages/detail/index?id=42').params({ id: '42' })
  // @ts-expect-error URL 链仅接收字符串。
  router.navigateToUrl(42)
  // @ts-expect-error URL 链注册回调后不能等待。
  await router.navigateToUrl('/pages/detail/index?id=42').success(() => {}).reLaunch()
  // @ts-expect-error 路径链的重建方法同样禁止混用回调与等待。
  await callbackBranch.reLaunch()
  await router.navigateTo('/pages/home/index').go()
  await router.navigateBack(2).go()
  // @ts-expect-error 注册成功回调后不能 await go。
  await callbackBranch.go()
  // @ts-expect-error 仅注册失败回调也不能 await replace。
  await base.fail(() => {}).replace()
  // @ts-expect-error 先注册回调再传参数不能恢复等待模式。
  await router.navigateTo('/pages/detail/index').success(() => {}).params({ id: '42' }).go()
  // @ts-expect-error 重设参数仍保留回调模式。
  await callbackBranch.params({ id: '新值' }).replace()
  // @ts-expect-error Tab 切换同样禁止混用回调与等待。
  await router.navigateTo('/pages/home/index').fail(() => {}).go()
  // @ts-expect-error 返回成功回调不能与等待混用。
  await router.navigateBack().success(() => {}).go()
  // @ts-expect-error 返回失败回调不能与等待混用。
  await router.navigateBack().fail(() => {}).go()
  const execution = callbackBranch.go()
  // @ts-expect-error 保存执行结果后也不能等待。
  await execution
  // @ts-expect-error 回调执行标记不能当作 Promise 使用。
  const pendingResult: Promise<unknown> = execution
  // @ts-expect-error 不提供可用的 then 以便绕过模式约束。
  execution.then(() => {})
  const { replace } = callbackBranch
  // @ts-expect-error 解构终结方法不能恢复等待模式。
  await replace()
  // @ts-expect-error 未注册回调的执行结果是 Promise，不再提供注册方法。
  base.go().success(() => {})
  // @ts-expect-error Promise 结果不能补注册失败回调。
  router.navigateBack().go().fail(() => {})
  void pendingResult
}
void checkExclusiveNavigationModes
