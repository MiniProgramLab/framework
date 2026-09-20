// SPDX-License-Identifier: Apache-2.0
/** 使用真实 TypeScript 实现验证平台无关协议与微信回调适配。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

/** 只在内存编译，测试不需要微信全局或消费应用。 */
const compiled = await build({
  stdin: { contents: 'export * from "../src/router/index.ts"; export * from "../src/router/adapters/wechat.ts";',
    resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', write: false,
})
const { createRouter, createWechatAdapter } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'))

/** 每个用例得到独立契约，允许验证调用方修改输入的边界。 */
function contract() {
  return {
    home: { name: 'home', path: '/pages/home/index', kind: 'tab', available: true, params: {} },
    detail: { name: 'detail', path: '/pages/detail/index', kind: 'page', available: true,
      params: { id: { type: 'string', required: true }, count: { type: 'number' }, enabled: { type: 'boolean' } } },
    settings: { name: 'settings', path: '/pages/settings/index', kind: 'page', available: true, params: {} },
    demo: { name: 'demo', path: '/pages/demo/index', kind: 'page', available: false, params: {} },
  }
}

/** 自定义适配器完全不访问 wx，用于检验开放的执行边界。 */
function fixture(routes = contract()) {
  const calls = []
  const adapter = Object.fromEntries(['navigateTo', 'switchTab', 'reLaunch'].map((method) => [method, async (url) => { calls.push({ method, url }) }]))
  const router = createRouter({ routes, entryPageName: 'home', adapter })
  return { router, adapter, calls }
}

/** 等待本轮已触发的模拟导航及异步回调完成，不等待回调模式的执行标记。 */
function settleNavigation() {
  return new Promise((resolve) => setImmediate(resolve))
}

test('路由仅公开统一的链式入口与查询方法，URL 链按终结动作执行', async () => {
  const { router, adapter, calls } = fixture()
  adapter.redirectTo = async (url) => { calls.push({ method: 'redirectTo', url }) }
  assert.deepEqual(Object.keys(router).sort(), [
    'getEntryRouteUrl', 'getRouteUrl', 'isRouteAvailable', 'navigateBack', 'navigateTo', 'navigateToUrl',
  ])
  const chain = router.navigateToUrl('/pages/detail/index?count=2&id=%E4%B8%AD%E6%96%87')
  assert.equal(chain.params, undefined)
  assert.equal(Object.isFrozen(chain), true)
  assert.deepEqual(calls, [])
  await chain.go()
  await chain.replace()
  await chain.reLaunch()
  await router.navigateTo('/pages/detail/index').params({ id: '42' }).reLaunch()
  await router.navigateTo('/pages/home/index').reLaunch()
  await router.navigateToUrl('/pages/home/index').reLaunch()
  assert.deepEqual(calls, [
    ...['navigateTo', 'redirectTo', 'reLaunch'].map((method) => ({ method, url: '/pages/detail/index?id=%E4%B8%AD%E6%96%87&count=2' })),
    { method: 'reLaunch', url: '/pages/detail/index?id=42' },
    { method: 'switchTab', url: '/pages/home/index' },
    { method: 'switchTab', url: '/pages/home/index' },
  ])
})

test('URL 链复用回调隔离与 await 互斥规则，失败只在执行阶段报告', async (context) => {
  const { router, calls } = fixture()
  const errors = []
  context.mock.method(console, 'error', (_label, error) => { errors.push(error) })
  const base = router.navigateToUrl('/pages/settings/index')
  const callbacks = []
  const branch = base.success((result) => { callbacks.push(result.method) })
  const execution = branch.reLaunch()
  await assert.rejects(async () => await execution, TypeError)
  await settleNavigation()
  assert.deepEqual(callbacks, ['reLaunch'])
  assert.equal((await base.go()).ok, true)
  assert.deepEqual(callbacks, ['reLaunch'])
  const invalid = router.navigateToUrl('/pages/detail/index?id=x&id=y').fail((error) => { callbacks.push(error.phase) })
  assert.deepEqual(errors, [])
  invalid.reLaunch()
  await settleNavigation()
  assert.equal(errors.length, 1)
  assert.deepEqual(callbacks, ['reLaunch', 'resolve'])
  assert.equal(calls.length, 2)
})

test('名称、参数编码和普通页/Tab 导航由同一契约决定', async () => {
  const { router, calls } = fixture()
  assert.equal(router.getEntryRouteUrl(), '/pages/home/index')
  assert.equal(router.isRouteAvailable('/pages/demo/index'), false)
  assert.equal(router.isRouteAvailable('missing'), false)
  await router.navigateTo('/pages/home/index').go()
  const url = router.getRouteUrl('/pages/detail/index', { id: '中文/空 格', count: 0, enabled: false })
  await router.navigateTo('/pages/detail/index').params({ id: '中文/空 格', count: 0, enabled: false }).go()
  await router.navigateToUrl('/pages/detail/index?id=abc&count=2&enabled=false').reLaunch()
  await router.navigateToUrl('/pages/home/index').reLaunch()
  assert.equal(url, '/pages/detail/index?id=' + encodeURIComponent('中文/空 格') + '&count=0&enabled=false')
  assert.deepEqual(calls, [
    { method: 'switchTab', url: '/pages/home/index' },
    { method: 'navigateTo', url },
    { method: 'reLaunch', url: '/pages/detail/index?id=abc&count=2&enabled=false' },
    { method: 'switchTab', url: '/pages/home/index' },
  ])
})

test('未知页面、禁用页面和非法参数不会进入适配器', async () => {
  const { router, calls } = fixture()
  await assertRouteFailure(router.navigateTo('missing').go(), /页面不存在/)
  await assertRouteFailure(router.navigateTo('/pages/demo/index').go(), /未启用/)
  await assertRouteFailure(router.navigateToUrl('/pages/home/index?id=1').go(), /未知/)
  await assertRouteFailure(router.navigateTo('/pages/detail/index').params({}).go(), /必填参数/)
  for (const count of [NaN, Infinity, '1'])
    await assertRouteFailure(router.navigateTo('/pages/detail/index').params({ id: '1', count }).go(), /参数类型/)
  for (const value of [null, [], 1])
    await assertRouteFailure(router.navigateTo('/pages/detail/index').params(value).go(), /参数必须为对象/)
  assert.deepEqual(calls, [])
})

test('外部 URL 严格还原参数，拒绝重复字段、非法编码和未启用入口', async () => {
  const { router, calls } = fixture()
  for (const suffix of ['id=a&id=b', 'id=a&extra=x', 'id=a&enabled=1', 'id=a&count=', 'id=a&count=Infinity', 'id=%ZZ'])
    await assertRouteFailure(router.navigateToUrl('/pages/detail/index?' + suffix).reLaunch())
  for (const url of ['/pages/demo/index', '/pages/home/index#x', '/pages/detail/index?id=x?y', 'https://example.com'])
    await assertRouteFailure(router.navigateToUrl(url).reLaunch())
  await assertRouteFailure(router.navigateToUrl('/pages/detail/index').reLaunch(), /必填参数/)
  await router.navigateToUrl('/pages/detail/index?enabled=true&id=a%2Bb&count=2').reLaunch()
  assert.deepEqual(calls, [{ method: 'reLaunch', url: '/pages/detail/index?id=a%2Bb&count=2&enabled=true' }])
})

test('路由实例与输入对象隔离，解构方法可以直接注入 UI', async () => {
  const routes = contract()
  const first = fixture(routes)
  const second = fixture()
  routes.detail.params.id.required = false
  routes.home.path = '/changed'
  const { getEntryRouteUrl, navigateTo, navigateToUrl } = first.router
  assert.equal(getEntryRouteUrl(), '/pages/home/index')
  assert.equal(navigateTo('/pages/detail/index').go, undefined)
  await assertRouteFailure(navigateTo('/pages/detail/index').params({}).go(), /必填参数/)
  await navigateToUrl('/pages/settings/index').reLaunch()
  assert.equal(first.calls.length, 1)
  assert.equal(second.calls.length, 0)
})

test('手写契约也校验入口、重复路径、Tab 参数和适配器完整性', () => {
  for (const change of [
    (routes) => { routes.home.available = false },
    (routes) => { routes.home.params.id = { type: 'string' } },
    (routes) => { routes.settings.path = routes.home.path },
    (routes) => { routes.home.name = 'other' },
    (routes) => { routes.detail.params.id.type = 'object' },
  ]) {
    const routes = contract()
    change(routes)
    assert.throws(() => fixture(routes))
  }
  const { adapter } = fixture()
  assert.throws(() => createRouter({ routes: contract(), entryPageName: 'detail', adapter }), /入口不能要求必填/)
  assert.throws(() => createRouter({ routes: contract(), entryPageName: 'home', adapter: {} }), /适配器缺少方法/)
  assert.throws(() => createRouter({ routes: contract(), entryPageName: 'home' }), /未注入路由平台/)
})

test('微信适配器延迟获取 API，保持接收者和回调失败原因', async () => {
  let reads = 0
  const calls = []
  const reason = { errMsg: '平台拒绝导航' }
  const api = Object.fromEntries(['navigateTo', 'switchTab', 'reLaunch'].map((method) => [method, function (options) {
    assert.equal(this, api)
    calls.push({ method, url: options.url })
    if (method === 'reLaunch') options.fail(reason)
    else options.success()
  }]))
  const adapter = createWechatAdapter(() => { reads++; return api })
  assert.equal(reads, 0)
  await adapter.navigateTo('/pages/detail/index')
  await adapter.switchTab('/pages/home/index')
  await assert.rejects(adapter.reLaunch('/pages/settings/index'), (error) => error === reason)
  assert.equal(reads, 3)
  assert.equal(calls.length, 3)
  // 默认适配器的创建也不要求 Node 进程提供 wx 全局。
  assert.doesNotThrow(() => createWechatAdapter())
})

test('自定义适配器和微信 API 的同步异常都成为导航 Promise 拒绝', async () => {
  const reason = new Error('同步失败')
  const { adapter } = fixture()
  adapter.navigateTo = () => { throw reason }
  const router = createRouter({ routes: contract(), entryPageName: 'home', adapter })
  await assertRouteFailure(router.navigateTo('/pages/settings/index').go(), (error) => error === reason)
  const wechat = createWechatAdapter(() => { throw reason })
  await assert.rejects(wechat.navigateTo('/pages/settings/index'), (error) => error === reason)
})

/** 为三个平台分别编译入口，确认只有目标宿主可用时仍能完成导航。 */
for (const [platform, title, host] of [['wechat', 'Wechat', 'wx'], ['douyin', 'Douyin', 'tt'], ['alipay', 'Alipay', 'my']]) {
  test(`${platform} 适配器只使用自身宿主并原样返回失败`, async (context) => {
    const result = await build({
      entryPoints: [fileURLToPath(new URL(`../src/router/adapters/${platform}.ts`, import.meta.url))],
      bundle: true, format: 'esm', platform: 'node', write: false, metafile: true,
    })
    const module = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'))
    const factory = module[`create${title}Adapter`]
    const adapter = factory()
    assert.equal(adapter.id, platform)
    const calls = []
    const reason = { error: 123, errMsg: '平台失败' }
    const previous = Object.getOwnPropertyDescriptor(globalThis, host)
    context.after(() => {
      if (previous) Object.defineProperty(globalThis, host, previous)
      else delete globalThis[host]
    })
    globalThis[host] = Object.fromEntries(['navigateTo', 'switchTab', 'reLaunch'].map((method) => [method, (options) => {
      calls.push({ method, url: options.url })
      if (options.url.includes('fail')) options.fail(reason)
      else options.success()
    }]))
    const router = createRouter({ routes: contract(), entryPageName: 'home', adapter })
    await router.navigateTo('/pages/home/index').go()
    await router.navigateTo('/pages/settings/index').go()
    await router.navigateToUrl('/pages/settings/index').reLaunch()
    await assert.rejects(adapter.navigateTo('/fail'), (error) => error === reason)
    assert.deepEqual(calls.map((call) => call.method), ['switchTab', 'navigateTo', 'reLaunch', 'navigateTo'])
    const platformInputs = Object.keys(result.metafile.inputs).filter((name) => /adapters\/(wechat|douyin|alipay)\.ts$/.test(name))
    assert.equal(platformInputs.length, 1)
    assert.ok(platformInputs[0].endsWith(`/adapters/${platform}.ts`))
  })
}

test('平台注册支持默认微信、别名和扩展，冲突注册原子失败且互不污染', async () => {
  const result = await build({ entryPoints: [fileURLToPath(new URL('../src/router/index.ts', import.meta.url))],
    bundle: true, format: 'esm', platform: 'node', write: false, metafile: true })
  const { createNavigationRegistry } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'))
  assert.equal(Object.keys(result.metafile.inputs).some((name) => /adapters\//.test(name)), false)
  const registry = createNavigationRegistry([createWechatAdapter()])
  assert.equal(registry.resolve(), registry.resolve('wx'))
  const custom = { id: 'custom', aliases: ['own'], count: 0,
    async navigateTo() { this.count++ }, async switchTab() {}, async reLaunch() {} }
  registry.register(custom)
  await registry.resolve('own').navigateTo('/page')
  assert.equal(custom.count, 1)
  assert.throws(() => registry.register({ ...custom, id: 'conflict', aliases: ['new', 'wx'] }), /重复/)
  assert.throws(() => registry.resolve('new'), /未注册/)
  assert.throws(() => registry.resolve('conflict'), /未注册/)
  assert.throws(() => registry.register({ ...custom, id: 'other', aliases: ['same', 'same'] }), /重复/)
  assert.throws(() => createNavigationRegistry().resolve('own'), /未注册/)
})


/** 断言路由统一结果失败，并核对诊断或平台原始原因。 */
async function assertRouteFailure(pending, expected) {
  const result = await pending
  assert.equal(result.ok, false)
  if (expected instanceof RegExp) assert.match(result.error.message, expected)
  else if (expected) assert.ok(expected(result.error.cause))
  return result.error
}

test('导航可忽略 Promise，异步失败记录诊断且不会产生未处理拒绝', async (context) => {
  const { router, adapter, calls } = fixture()
  const errors = []
  context.mock.method(console, 'error', (_label, error) => { errors.push(error) })
  const reason = { errMsg: '原生导航失败' }
  adapter.navigateTo = () => Promise.reject(reason)
  void router.navigateTo('/pages/settings/index').go()
  void router.navigateToUrl('/pages/home/index').reLaunch()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(errors.length, 1)
  assert.equal(errors[0].cause, reason)
  assert.equal(errors[0].phase, 'navigate')
  assert.equal(errors[0].target, '/pages/settings/index')
  assert.deepEqual(calls, [{ method: 'switchTab', url: '/pages/home/index' }])
  void router.navigateTo('missing').go()
  assert.equal(router.getRouteUrl('/pages/detail/index', {}), undefined)
  assert.equal(errors.length, 3)
  assert.equal(errors[1].phase, 'resolve')
  assert.match(errors[2].message, /必填参数/)
})

test('显式等待返回完整结果，同步宿主错误也作为失败结果返回', async (context) => {
  const { router, adapter } = fixture()
  const warnings = []
  context.mock.method(console, 'error', (_label, error) => { warnings.push(error) })
  const success = await router.navigateTo('/pages/detail/index').params({ id: '42' }).go()
  assert.deepEqual(success, { ok: true, url: '/pages/detail/index?id=42', method: 'navigateTo' })
  const reason = new Error('平台执行失败')
  adapter.reLaunch = () => { throw reason }
  const failure = await router.navigateToUrl('/pages/settings/index').reLaunch()
  assert.equal(failure.ok, false)
  assert.equal(failure.error.cause, reason)
  assert.equal(warnings.length, 1)
  assert.equal(warnings[0], failure.error)
  assert.equal(router.onError, undefined)
})

test('无需注册错误处理即可记录诊断，不会静默吞掉导航失败', async (context) => {
  const { adapter } = fixture()
  const logged = []
  context.mock.method(console, 'error', (...args) => { logged.push(args) })
  const router = createRouter({ routes: contract(), entryPageName: 'home', adapter })
  void router.navigateTo('missing').go()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(logged.length, 1)
  assert.equal(logged[0][1].phase, 'resolve')
})

test('导航链延迟执行，Tab 不提供参数且普通页必须先补齐必填参数', async () => {
  const { router, adapter, calls } = fixture()
  adapter.redirectTo = async (url) => { calls.push({ method: 'redirectTo', url }) }
  const detail = router.navigateTo('/pages/detail/index')
  const home = router.navigateTo('/pages/home/index')
  assert.equal(detail.go, undefined)
  assert.equal(detail.replace, undefined)
  assert.equal(home.params, undefined)
  assert.equal(home.success(() => {}).fail(() => {}).params, undefined)
  assert.equal(router.navigateTo('/pages/settings/index').params, undefined)
  const configured = detail.params({ id: '中文', count: 0, enabled: false })
  assert.deepEqual(calls, [])
  assert.equal(Object.isFrozen(configured), true)
  assert.equal((await configured.go()).method, 'navigateTo')
  assert.equal((await configured.replace()).method, 'redirectTo')
  assert.equal((await home.replace()).method, 'switchTab')
  assert.deepEqual(calls.map((call) => call.method), ['navigateTo', 'redirectTo', 'switchTab'])
})

test('参数快照和回调分支互相隔离，重复设置整体替换且支持解构执行', async () => {
  const { router, calls } = fixture()
  const events = []
  const input = { id: '原值', count: 2 }
  const base = router.navigateTo('/pages/detail/index').params(input)
  input.id = '修改后'
  const first = base.success((result) => { events.push(['first', result.url]) })
  const second = base.params({ id: '分支' }).success(() => { events.push(['second']) })
  const { go } = first
  go()
  second.go()
  await base.go()
  await settleNavigation()
  assert.deepEqual(calls.map((call) => call.url), [
    '/pages/detail/index?id=%E5%8E%9F%E5%80%BC&count=2',
    '/pages/detail/index?id=%E5%88%86%E6%94%AF',
    '/pages/detail/index?id=%E5%8E%9F%E5%80%BC&count=2',
  ])
  assert.equal(events.filter(([name]) => name === 'first').length, 1)
  assert.equal(events.filter(([name]) => name === 'second').length, 1)
  base.success(() => { events.push(['旧回调']) }).success(() => { events.push(['新回调']) }).go()
  await settleNavigation()
  assert.equal(events.some(([name]) => name === '旧回调'), false)
  assert.equal(events.at(-1)[0], '新回调')
})

test('成功与失败回调等待真实导航结果，回调异常独立记录', async (context) => {
  const { router, adapter } = fixture()
  const logs = [], events = []
  context.mock.method(console, 'error', (_label, error) => { logs.push(error) })
  let finish
  adapter.navigateTo = () => new Promise((resolve) => { finish = resolve })
  router.navigateTo('/pages/settings/index')
    .success(async (result) => { events.push(result); throw new Error('成功回调异常') })
    .fail(() => { events.push('不应触发失败回调') }).go()
  assert.deepEqual(events, [])
  finish()
  await settleNavigation()
  assert.deepEqual(events, [{ ok: true, method: 'navigateTo', url: '/pages/settings/index' }])
  assert.match(logs[0].message, /成功回调异常/)
  const reason = new Error('平台拒绝')
  adapter.navigateTo = () => Promise.reject(reason)
  router.navigateTo('/pages/settings/index')
    .success(() => { events.push('不应触发成功回调') })
    .fail((error) => { events.push(error); throw new Error('失败回调异常') }).go()
  await settleNavigation()
  assert.equal(events.length, 2)
  assert.equal(events[1].cause, reason)
  assert.match(logs.at(-1).message, /失败回调异常/)
})

test('参数校验和缺失适配器能力经由 fail 返回，错误输入不会调用平台', async (context) => {
  const { router, calls } = fixture()
  const failures = []
  context.mock.method(console, 'error', () => {})
  for (const params of [{}, { id: '42', extra: 1 }, { id: '42', count: Infinity }, null, []]) {
    router.navigateTo('/pages/detail/index').params(params)
      .fail((error) => { failures.push(error) }).go()
    await settleNavigation()
    assert.equal(failures.at(-1).phase, 'resolve')
  }
  assert.equal(failures.length, 5)
  assert.deepEqual(calls, [])
  const missing = await router.navigateTo('/pages/settings/index').replace()
  assert.equal(missing.ok, false)
  assert.match(missing.error.message, /redirectTo/)
  await assertRouteFailure(router.navigateTo('missing').go(), /页面不存在/)
  await assertRouteFailure(router.navigateTo('/pages/demo/index').go(), /未启用/)
})

test('原生 replace 保持宿主接收者，注册表保留新增能力', async () => {
  const api = {
    /** 用断言确保替换不会误用其他导航动作。 */
    navigateTo() { assert.fail('不应执行 navigateTo') },
    /** 用断言确保替换不会误切换底栏。 */
    switchTab() { assert.fail('不应执行 switchTab') },
    /** 用断言确保替换不会清空页面栈。 */
    reLaunch() { assert.fail('不应执行 reLaunch') },
    /** 原生调用必须保留 API 对象作为接收者。 */
    redirectTo(options) { assert.equal(this, api); options.success() },
  }
  const adapter = createWechatAdapter(api)
  const { createNavigationRegistry } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'))
  const registry = createNavigationRegistry([adapter])
  const router = createRouter({ routes: contract(), entryPageName: 'home', adapter: registry.resolve() })
  assert.equal((await router.navigateTo('/pages/settings/index').replace()).method, 'redirectTo')
})

test('独立返回链延迟执行并保持回调隔离，默认上一页也支持指定层数', async () => {
  const { router, adapter } = fixture()
  const calls = [], events = []
  adapter.navigateBack = async (delta) => { calls.push(delta) }
  const base = router.navigateBack()
  const branch = base.success((result) => { events.push(result) })
  assert.deepEqual(calls, [])
  assert.equal(base.params, undefined)
  assert.equal(base.replace, undefined)
  assert.equal(router.navigateTo('/pages/home/index').back, undefined)
  const { go } = branch
  go()
  await settleNavigation()
  await base.go()
  await router.navigateBack(2).go()
  assert.deepEqual(calls, [1, 1, 2])
  assert.deepEqual(events, [{ ok: true, method: 'navigateBack', delta: 1 }])
})

test('返回层数和平台错误通过 fail 返回，失败回调异常独立记录', async (context) => {
  const { router, adapter } = fixture()
  const logs = [], failures = [], calls = []
  context.mock.method(console, 'error', (_label, error) => { logs.push(error) })
  adapter.navigateBack = async (delta) => { calls.push(delta) }
  for (const delta of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '2', null]) {
    router.navigateBack(delta).fail((error) => { failures.push(error) }).go()
    await settleNavigation()
    assert.equal(failures.at(-1).phase, 'resolve')
  }
  assert.deepEqual(calls, [])
  assert.equal(failures.length, 8)
  const reason = new Error('当前页面不能返回')
  adapter.navigateBack = () => { throw reason }
  router.navigateBack().success(() => { failures.push('不应触发成功回调') })
    .fail(async (error) => { failures.push(error); throw new Error('返回回调异常') }).go()
  await settleNavigation()
  assert.equal(failures.length, 9)
  assert.equal(failures.at(-1).cause, reason)
  assert.equal(failures.at(-1).phase, 'navigate')
  assert.equal(failures.at(-1).target, 'navigateBack')
  assert.match(logs.at(-1).message, /返回回调异常/)
  delete adapter.navigateBack
  const missing = await router.navigateBack().go()
  assert.equal(missing.ok, false)
  assert.match(missing.error.message, /缺少方法.*navigateBack/)
})

test('原生返回只接收 delta，注册表保留接收者且回调等待平台结果', async () => {
  let finish
  const api = {
    /** 打开操作不参与本次返回。 */
    navigateTo() {},
    /** 底栏切换不参与本次返回。 */
    switchTab() {},
    /** 重建页面栈不参与本次返回。 */
    reLaunch() {},
    /** 延迟成功以验证公开链没有提前调用回调。 */
    navigateBack(options) {
      assert.equal(this, api)
      assert.equal(options.delta, 2)
      assert.equal('url' in options, false)
      finish = options.success
    },
  }
  const { createNavigationRegistry } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'))
  const adapter = createNavigationRegistry([createWechatAdapter(api)]).resolve()
  const router = createRouter({ routes: contract(), entryPageName: 'home', adapter })
  const events = []
  router.navigateBack(2).success((result) => { events.push(result) }).go()
  assert.deepEqual(events, [])
  finish()
  await settleNavigation()
  assert.deepEqual(events, [{ ok: true, method: 'navigateBack', delta: 2 }])
})

test('回调模式拒绝等待及 Promise 同化，原始无回调分支仍可等待', async () => {
  const { router, adapter, calls } = fixture()
  const events = []
  adapter.redirectTo = async (url) => { calls.push({ method: 'redirectTo', url }) }
  adapter.navigateBack = async (delta) => { calls.push({ method: 'navigateBack', delta }) }
  const base = router.navigateTo('/pages/detail/index').params({ id: '42' })
  const executions = [
    base.success((result) => { events.push(result.method) }).go(),
    base.fail(() => {}).replace(),
    router.navigateTo('/pages/detail/index').success((result) => { events.push(result.method) }).params({ id: '新值' }).go(),
    router.navigateTo('/pages/home/index').success((result) => { events.push(result.method) }).replace(),
    router.navigateBack().success((result) => { events.push(result.method) }).go(),
    router.navigateBack(2).fail(() => {}).go(),
  ]
  for (const execution of executions) {
    assert.equal(Object.isFrozen(execution), true)
    assert.equal(execution instanceof Promise, false)
    await assert.rejects(async () => { await execution }, /已注册 success 或 fail 的导航不能使用 await/)
    await assert.rejects(Promise.resolve(execution), TypeError)
  }
  await settleNavigation()
  // 错误地等待只会被拒绝，不应再次执行已经发起的导航或回调。
  assert.equal(calls.length, 6)
  assert.deepEqual(events, ['navigateTo', 'navigateTo', 'switchTab', 'navigateBack'])
  assert.equal((await base.go()).ok, true)
  assert.equal((await base.replace()).method, 'redirectTo')
  assert.equal((await router.navigateBack().go()).ok, true)
})
