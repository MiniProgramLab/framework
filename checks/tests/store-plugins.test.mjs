// SPDX-License-Identifier: Apache-2.0
/** 验证第三方插件通过同一注册、绑定和释放路径接入真实 Store。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { harness, runtime } from './store-test-utils.mjs'

/** 仅用于观察惰性初始化，不保存或代替任何状态。 */
let created = 0
/** 自定义区域没有核心专用分支，与页面和弹层使用完全相同的协议。 */
const selection = runtime.defineStorePlugin({
  key: '__selectionState__',
  option: 'selectionStore',
  /** 接入约束每次检查，不能因复用已有状态而跳过。 */
  validateContext({ options }) {
    if (options.rejectSelection) throw new Error('拒绝当前参与者')
  },
  /** 工厂只在同一页面的首个参与者接入时执行。 */
  create() {
    created += 1
    return { count: 0 }
  },
  /** 非法提交保持原状态且不发送通知。 */
  validateState(state) {
    if (!Number.isSafeInteger(state.count) || state.count < 0)
      throw new TypeError('计数必须为非负整数')
  },
})
runtime.registerStorePlugin(selection)

/** 验证配置可完全归属插件，页面配置不依赖业务页面 Store 是否开启。 */
const configured = runtime.defineStorePlugin({
  key: '__configuredState__',
  option: 'configuredStore',
  extraOptions: ['configuredStoreValue'],
  /** 共享状态始终读取所属页面配置，不使用首个参与组件的配置。 */
  create({ ownerOptions }) {
    return { count: ownerOptions.configuredStoreValue ?? 0 }
  },
})
runtime.registerStorePlugin(configured)

/** 独立核心验证不依赖微信实例或全局装配。 */
const context = { options: {}, ownerOptions: {} }
/** 只通过公开订阅读取当前快照。 */
function snapshot(store) {
  let result
  store.on(
    (value) => {
      result = value
    },
    { immediate: true },
  )()
  return result
}

test('注册幂等、名称冲突与封存均有明确边界，注册本身不创建状态', () => {
  const registry = runtime.createStorePluginRegistry()
  const before = created
  registry.register(selection)
  registry.register(selection)
  assert.throws(
    () => registry.register({ ...selection, option: 'otherStore' }),
    /重复/,
  )
  assert.throws(
    () => registry.register({ ...selection, key: '__other__' }),
    /重复/,
  )
  assert.throws(
    () => registry.register({ ...selection, option: 'globalStore' }),
    /无效/,
  )
  assert.throws(
    () => registry.register({ ...selection, key: 'public' }),
    /无效/,
  )
  assert.throws(
    () => registry.register({ ...selection, create: undefined }),
    /无效/,
  )
  assert.throws(
    () => registry.register({ ...selection, validateState: async () => {} }),
    /无效/,
  )
  assert.throws(
    () => registry.register({ ...selection, extraOptions: ['data'] }),
    /自身开关前缀/,
  )
  assert.throws(
    () =>
      registry.register({
        ...selection,
        extraOptions: ['selectionStoreValue', 'selectionStoreValue'],
      }),
    /唯一/,
  )
  assert.deepEqual(registry.seal(), [selection])
  assert.equal(Object.isFrozen(registry.seal()), true)
  registry.register(selection)
  assert.throws(
    () =>
      registry.register({
        ...selection,
        key: '__later__',
        option: 'laterStore',
      }),
    /封存/,
  )
  assert.equal(created, before)
})

test('插件附加配置归属所属页面，原生构造器不接收配置且注册检查跨插件冲突', () => {
  const env = harness()
  const page = env.mount({ configuredStoreValue: 7 }, 'configured', {
    isPage: true,
  })
  const child = env.mount(
    { configuredStore: true, configuredStoreValue: 99 },
    'configured',
  )
  assert.equal(snapshot(child.instance.$configuredStore).count, 7)
  assert.equal(page.options.configuredStoreValue, undefined)
  assert.equal(child.options.configuredStoreValue, undefined)
  assert.equal(page.instance.$configuredStore, undefined)
  page.life('detached')
  assert.equal(child.instance.$configuredStore.update({ count: 8 }), false)

  const registry = runtime.createStorePluginRegistry()
  const names = ['selectionStoreChildStore']
  const declaration = runtime.defineStorePlugin({
    ...selection,
    extraOptions: names,
  })
  registry.register(declaration)
  names.push('selectionStoreLater')
  assert.deepEqual(declaration.extraOptions, ['selectionStoreChildStore'])
  assert.equal(Object.isFrozen(declaration.extraOptions), true)
  assert.throws(
    () =>
      registry.register({
        ...selection,
        key: '__child__',
        option: 'selectionStoreChildStore',
      }),
    /重复/,
  )
})

test('核心按声明身份授权，插件按页面与 App 隔离，工厂惰性且仅初始化一次', () => {
  const bare = runtime.createStoreRoot(() => ({}))
  assert.throws(
    () => bare.connectPlugin(selection, {}, context, () => true),
    /未注册/,
  )
  const root = runtime.createStoreRoot(() => ({}), [selection])
  const token = {}
  const before = created
  const first = root.connectPlugin(selection, token, context, () => true)
  first.store.update({ count: 3 })
  first.dispose()
  const second = root.connectPlugin(selection, token, context, () => true)
  assert.equal(snapshot(second.store).count, 3)
  assert.equal(created, before + 1)
  assert.throws(
    () => root.connectPlugin({ ...selection }, token, context, () => true),
    /未注册/,
  )
  assert.equal(
    snapshot(root.connectPlugin(selection, {}, context, () => true).store)
      .count,
    0,
  )
  const other = runtime.createStoreRoot(() => ({}), [selection])
  assert.equal(
    snapshot(other.connectPlugin(selection, token, context, () => true).store)
      .count,
    0,
  )
  root.releaseOwner(token)
  assert.equal(second.store.update({ count: 4 }), false)
  assert.throws(
    () => root.connectPlugin(selection, token, context, () => true),
    /已销毁/,
  )
  const active = root.connectPlugin(selection, {}, context, () => true)
  root.dispose()
  assert.equal(active.store.update({ count: 4 }), false)
})

test('自定义插件初始化与更新都校验，失败可重试且不发布无效快照', () => {
  let valid = false
  const plugin = runtime.defineStorePlugin({
    ...selection,
    /** 模拟首次工厂失败，之后显式重试。 */
    create() {
      return { count: valid ? 0 : -1 }
    },
  })
  const root = runtime.createStoreRoot(() => ({}), [plugin])
  const token = {}
  assert.throws(
    () => root.connectPlugin(plugin, token, context, () => true),
    /非负整数/,
  )
  valid = true
  const store = root.connectPlugin(plugin, token, context, () => true).store
  const before = snapshot(store)
  let notifications = 0
  store.on(() => {
    notifications += 1
  })
  assert.throws(() => store.update({ count: -1 }), /非负整数/)
  assert.throws(
    () =>
      store.update((draft) => {
        draft.count = -2
      }),
    /非负整数/,
  )
  assert.equal(snapshot(store), before)
  assert.equal(notifications, 0)
  assert.throws(
    () =>
      root.connectPlugin(
        plugin,
        token,
        { ...context, options: { rejectSelection: true } },
        () => true,
      ),
    /拒绝/,
  )
  assert.equal(store.update({ count: 1 }), true)
})

test('自定义工厂捕获递归异常仍不能发布，销毁期间的初始化不能复活', () => {
  let root
  let reenter = true
  let destroy = false
  const token = {}
  const plugin = runtime.defineStorePlugin({
    ...selection,
    /** 故意吞掉内部错误，外层提交仍必须识别初始化失效。 */
    create() {
      if (reenter) {
        try {
          root.connectPlugin(plugin, token, context, () => true)
        } catch {}
      }
      if (destroy) root.releaseOwner(token)
      return { count: 0 }
    },
  })
  root = runtime.createStoreRoot(() => ({}), [plugin])
  assert.throws(
    () => root.connectPlugin(plugin, token, context, () => true),
    /初始化已失效/,
  )
  reenter = false
  destroy = true
  assert.throws(
    () => root.connectPlugin(plugin, token, context, () => true),
    /初始化已失效/,
  )
  assert.throws(
    () => root.connectPlugin(plugin, token, context, () => true),
    /已销毁/,
  )
})

test('普通函数返回异步校验也不能绕过提交边界，拒绝不会成为未处理异常', async () => {
  let asynchronous = false
  const plugin = runtime.defineStorePlugin({
    ...selection,
    /** 模拟未标记 async 却返回 Promise 的错误校验器。 */
    validateState() {
      if (asynchronous) return Promise.reject(new Error('异步校验失败'))
    },
  })
  const root = runtime.createStoreRoot(() => ({}), [plugin])
  const store = root.connectPlugin(plugin, {}, context, () => true).store
  asynchronous = true
  assert.throws(() => store.update({ count: 1 }), /同步执行/)
  assert.equal(snapshot(store).count, 0)
  await Promise.resolve()
})

test('第三个插件自动获得门面、保留名与等待订阅，并随整页卸载失效', () => {
  const env = harness()
  assert.throws(() => env.make({ missingStore: true }, 'unknown'), /未注册/)
  assert.throws(() => env.make({ selectionStore: 1 }, 'invalid'), /布尔值/)
  assert.throws(
    () => env.make({ data: { $selectionStore: {} } }, 'invalid'),
    /冲突/,
  )
  const before = created
  const child = env.make({ selectionStore: true }, 'plugins')
  child.life('created')
  child.life('attached')
  const values = []
  child.instance.$selectionStore.on((state) => values.push(state.count), {
    immediate: true,
  })
  assert.deepEqual(values, [])
  assert.equal(created, before)
  const page = env.mount(
    {
      pageStore: true,
      overlayStore: true,
      selectionStore: true,
      globalStore: true,
    },
    'plugins',
    { isPage: true },
  )
  assert.deepEqual(values, [0])
  assert.equal(created, before + 1)
  assert.equal(page.options.selectionStore, undefined)
  assert.equal(page.instance.data.$selectionStore, undefined)
  let businessNotifications = 0
  page.instance.$pageStore.on(() => {
    businessNotifications += 1
  })
  page.instance.$globalStore.on(() => {
    businessNotifications += 1
  })
  page.instance.$overlayStore.on(() => {
    businessNotifications += 1
  })
  page.instance.$selectionStore.update({ count: 2 })
  assert.deepEqual(values, [0, 2])
  assert.equal(businessNotifications, 0)
  assert.throws(
    () => child.instance.setData({ '$selectionStore.count': 3 }),
    /保留字段/,
  )
  assert.throws(
    () =>
      page.instance.$globalStore.update({ nested: { __selectionState__: {} } }),
    /保留字段/,
  )
  assert.throws(
    () =>
      page.instance.$pageStore.update((draft) => {
        draft.__futurePlugin__ = {}
      }),
    /非法字段/,
  )
  page.life('detached')
  assert.equal(child.instance.$selectionStore.update({ count: 3 }), false)
  assert.throws(
    () =>
      runtime.registerStorePlugin({
        ...selection,
        key: '__late__',
        option: 'lateStore',
      }),
    /封存/,
  )
})

test('某个插件接入失败撤销本实例的插件连接，页面卸载仍清理全局连接', (t) => {
  const env = harness()
  const error = console.error
  console.error = () => {}
  t.after(() => {
    console.error = error
  })
  const page = env.mount({}, 'reject', { isPage: true })
  const child = env.mount(
    {
      pageStore: true,
      overlayStore: true,
      selectionStore: true,
      globalStore: true,
      rejectSelection: true,
    },
    'reject',
  )
  assert.equal(child.instance.$pageStore.update({ value: 1 }), false)
  assert.equal(child.instance.$overlayStore.update({ layers: [] }), false)
  assert.equal(child.instance.$selectionStore.update({ count: 1 }), false)
  assert.equal(child.instance.$globalStore.update({ theme: 'dark' }), true)
  page.life('detached')
  assert.equal(child.instance.$globalStore.update({ theme: 'light' }), false)
})
