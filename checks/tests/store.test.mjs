// SPDX-License-Identifier: Apache-2.0
/** 验证两个公开方法、隐藏区域、原子更新、生命周期隔离及实际包装器行为。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { harness, runtime } from './store-test-utils.mjs'

/** 通过唯一读取入口获取快照，验证代码同样不读取任何内部状态。 */
function snapshot(store) {
  let state
  store.on(
    (next) => {
      state = next
    },
    { immediate: true },
  )()
  return state
}

/** 创建按页分隔且共享公开区的完整内部根。 */
function root() {
  return runtime.createStoreRoot(
    () => ({
      theme: 'light',
      nested: { value: 1 },
      values: [1, 2],
    }),
    runtime.storePlugins(),
  )
}

test('两个门面仅有 update/on，反射、快照与序列化不暴露私有页面区域', () => {
  const kernel = root()
  const global = kernel.connectGlobal(() => true).store
  const page = kernel.connectPlugin(
    runtime.pageStorePlugin,
    {},
    {
      options: {},
      ownerOptions: {
        pageStoreDefinition: runtime.definePageStore(() => ({
          secret: '页面数据',
        })),
      },
    },
    () => true,
  ).store
  for (const store of [global, page]) {
    assert.deepEqual(Reflect.ownKeys(store).sort(), ['on', 'update'])
    assert.equal(Object.getPrototypeOf(store), null)
    assert.equal(JSON.stringify(store), '{}')
    assert.equal(Object.isFrozen(store), true)
    assert.equal(store.__pageStore__, undefined)
  }
  assert.equal(JSON.stringify(snapshot(global)).includes('页面数据'), false)
  assert.deepEqual(snapshot(page), { secret: '页面数据' })
  const received = []
  global.on((next, previous) => received.push([next, previous]))
  page.update({ secret: '更新后' })
  assert.equal(received.length, 0)
  for (const invalid of [
    JSON.parse('{"__pageStore__":{}}'),
    JSON.parse('{"__proto__":{}}'),
    { constructor: {} },
    { nested: { __pageStore__: {} } },
  ]) {
    assert.throws(() => global.update(invalid))
  }
  assert.throws(() =>
    global.update((draft) => {
      draft.__pageStore__ = {}
    }),
  )
  assert.equal(received.length, 0)
})

test('补丁和草稿一次提交，只读快照复用未变分支，等值更新不通知', () => {
  const store = root().connectGlobal(() => true).store
  const first = snapshot(store)
  const calls = []
  store.on((next, previous) => calls.push({ next, previous }))
  assert.equal(store.update({ theme: 'dark' }), true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].previous, first)
  assert.equal(calls[0].next.nested, first.nested)
  assert.equal(calls[0].next.values, first.values)
  store.update({ theme: 'dark', nested: { value: 1 } })
  store.update(() => {})
  assert.equal(calls.length, 1)
  let saved
  store.update((draft) => {
    saved = draft.nested
    draft.nested.value += 1
    draft.values.push(3)
    draft.theme = 'light'
  })
  assert.equal(calls.length, 2)
  assert.deepEqual(snapshot(store), {
    theme: 'light',
    nested: { value: 2 },
    values: [1, 2, 3],
  })
  assert.deepEqual(first, { theme: 'light', nested: { value: 1 }, values: [1, 2] })
  assert.throws(() => {
    saved.value = 9
  }, /revoked/)
  assert.throws(() => {
    calls[1].next.nested.value = 99
  }, TypeError)
})

test('非法值、访问器、原型、循环和异步草稿拒绝，失败保留原状态', async () => {
  const store = root().connectGlobal(() => true).store
  const before = snapshot(store)
  const cycle = {}
  cycle.self = cycle
  for (const value of [
    undefined,
    NaN,
    Infinity,
    new Date(),
    () => {},
    cycle,
    [, 1],
    { [Symbol()]: 1 },
  ]) {
    assert.throws(() => store.update({ invalid: value }))
  }
  let accessed = false
  const accessor = {
    get field() {
      accessed = true
      return 1
    },
  }
  assert.throws(() => store.update(accessor))
  assert.equal(accessed, false)
  assert.throws(() =>
    store.update((draft) => {
      draft.nested.value = 2
      throw new Error('回滚')
    }),
  )
  assert.throws(() =>
    store.update(async (draft) => {
      draft.theme = '错误'
    }),
  )
  assert.throws(() => store.update(() => Promise.reject(new Error('异步拒绝'))))
  assert.throws(() =>
    store.update((draft) => {
      Object.setPrototypeOf(draft, {})
    }),
  )
  assert.throws(() =>
    store.update((draft) => {
      draft.self = draft
    }),
  )
  await Promise.resolve()
  assert.equal(snapshot(store), before)
})

test('取消与立即响应规则明确，嵌套更新和更新期间订阅管理使整笔失败', () => {
  const kernel = root()
  const global = kernel.connectGlobal(() => true).store
  const page = kernel.connectPlugin(
    runtime.pageStorePlugin,
    {},
    {
      options: {},
      ownerOptions: {
        pageStoreDefinition: runtime.definePageStore(() => ({ count: 0 })),
      },
    },
    () => true,
  ).store
  const calls = []
  const cancel = global.on(
    (next, previous) => calls.push([next.theme, previous?.theme]),
    { immediate: true },
  )
  assert.deepEqual(calls, [['light', undefined]])
  for (const operation of [
    () => global.update({ theme: 'dark' }),
    () => page.update({ count: 1 }),
    () => global.on(() => {}),
    cancel,
  ]) {
    assert.throws(() =>
      global.update((draft) => {
        draft.theme = '变化'
        try {
          operation()
        } catch {}
      }),
    )
  }
  assert.equal(snapshot(global).theme, 'light')
  assert.equal(snapshot(page).count, 0)
  global.update({ theme: 'dark' })
  cancel()
  cancel()
  global.update({ theme: 'light' })
  assert.deepEqual(calls, [
    ['light', undefined],
    ['dark', 'light'],
  ])
})

test('响应中更新同步提交但通知串行，新增订阅不补发历史，单个异常不阻断其他响应', () => {
  const store = root().connectGlobal(() => true).store
  const events = []
  store.on((next) => {
    events.push('甲:' + next.theme)
    if (next.theme === 'dark') {
      store.update({ theme: 'system' })
      store.on((value) => events.push('后注册:' + value.theme))
    }
  })
  const original = console.error
  console.error = () => {}
  try {
    store.on(() => {
      throw new Error('隔离异常')
    })
    store.on((next) => events.push('乙:' + next.theme))
    store.update({ theme: 'dark' })
  } finally {
    console.error = original
  }
  assert.deepEqual(events, ['甲:dark', '乙:dark', '甲:system', '乙:system'])
  assert.equal(snapshot(store).theme, 'system')
})

test('页面条目和实例连接分别清理，旧句柄不能连接重建条目或其他 App', () => {
  const kernel = root()
  const token = {}
  let initialized = 0
  const factory = () => ({ count: ++initialized })
  const first = kernel.connectPlugin(
    runtime.pageStorePlugin,
    token,
    {
      options: {},
      ownerOptions: { pageStoreDefinition: runtime.definePageStore(factory) },
    },
    () => true,
  )
  const second = kernel.connectPlugin(
    runtime.pageStorePlugin,
    token,
    {
      options: {},
      ownerOptions: { pageStoreDefinition: runtime.definePageStore(factory) },
    },
    () => true,
  )
  const other = kernel.connectPlugin(
    runtime.pageStorePlugin,
    {},
    {
      options: {},
      ownerOptions: { pageStoreDefinition: runtime.definePageStore(factory) },
    },
    () => true,
  )
  const global = kernel.connectGlobal(() => true)
  assert.equal(initialized, 2)
  first.store.update({ count: 9 })
  assert.equal(snapshot(second.store).count, 9)
  assert.equal(snapshot(other.store).count, 2)
  first.dispose()
  assert.equal(
    first.store.update(() => {
      throw new Error('不能执行')
    }),
    false,
  )
  second.dispose()
  assert.equal(
    snapshot(
      kernel.connectPlugin(
        runtime.pageStorePlugin,
        token,
        {
          options: {},
          ownerOptions: {
            pageStoreDefinition: runtime.definePageStore(factory),
          },
        },
        () => true,
      ).store,
    ).count,
    9,
  )
  kernel.releaseOwner(token)
  // 新页面使用新的不透明令牌，即使原生页面 ID 被复用也不会复活旧条目。
  const recreated = kernel.connectPlugin(
    runtime.pageStorePlugin,
    {},
    {
      options: {},
      ownerOptions: { pageStoreDefinition: runtime.definePageStore(factory) },
    },
    () => true,
  ).store
  assert.equal(snapshot(recreated).count, 3)
  assert.equal(second.store.update({ count: 10 }), false)
  assert.equal(snapshot(global.store).theme, 'light')
  kernel.dispose()
  assert.equal(global.store.update({ theme: 'dark' }), false)
  assert.equal(recreated.update({ count: 11 }), false)
  assert.equal(snapshot(root().connectGlobal(() => true).store).theme, 'light')
})

test('数组及对象草稿按数据语义更新，脱离原字段的子草稿不会恢复已删除内容', () => {
  const store = root().connectGlobal(() => true).store
  store.update((draft) => {
    const old = draft.nested
    draft.nested = { value: 7 }
    old.value = 99
    draft.values.splice(0, 1, 3, 4)
    draft.values.reverse()
  })
  assert.deepEqual(snapshot(store), {
    theme: 'light',
    nested: { value: 7 },
    values: [2, 4, 3],
  })
  store.update((draft) => {
    draft.values.length = 1
    delete draft.nested
  })
  assert.deepEqual(snapshot(store), { theme: 'light', values: [2] })
  assert.throws(() =>
    store.update((draft) => {
      draft.values.length = 4
    }),
  )
})

test('四种开关组合独立，关闭页面和父容器仍允许子组件接入同一页面', async () => {
  const env = harness()
  let initialized = 0
  const definition = runtime.definePageStore(() => ({ count: ++initialized }))
  const page = env.mount({ pageStoreDefinition: definition }, 'page-a', {
    isPage: true,
  })
  const container = env.mount({}, 'page-a')
  assert.equal(container.options.behaviors, undefined)
  assert.equal(page.instance.$pageStore, undefined)
  const local = env.mount(
    { pageStore: true, pageStoreDefinition: definition },
    'page-a',
    { owner: container.instance },
  )
  const global = env.mount({ globalStore: true }, 'page-a')
  const both = env.mount({ pageStore: true, globalStore: true }, 'page-a')
  assert.equal(initialized, 1)
  assert.equal(local.instance.$globalStore, undefined)
  assert.equal(global.instance.$pageStore, undefined)
  local.instance.$pageStore.update({ count: 7 })
  assert.equal(snapshot(both.instance.$pageStore).count, 7)
  assert.equal(local.instance.data.$pageStore, undefined)
  assert.equal(local.instance.writes.length, 0)
  both.instance.$globalStore.update({ theme: 'dark' })
  await Promise.resolve()
  assert.equal(global.instance.data.$globalStore.theme, 'dark')
  assert.equal(both.instance.writes.length, 1)
  assert.equal(page.instance.writes.length, 0)
  assert.throws(() =>
    both.instance.setData({ '$globalStore.theme': 'light' }),
  )
  assert.throws(() => local.instance.setData({ '$pageStore.count': 100 }))
})

test('后台回调固定页面，页面卸载先失效两种句柄，复用页面 ID 仍不串页', async () => {
  const env = harness()
  const definition = runtime.definePageStore(() => ({ count: 0 }))
  const pageA = env.mount(
    { pageStore: true, globalStore: true, pageStoreDefinition: definition },
    'same-route-a',
    { isPage: true },
  )
  const pageB = env.mount(
    { pageStore: true, pageStoreDefinition: definition },
    'same-route-b',
    { isPage: true },
  )
  const child = env.mount(
    { globalStore: true, pageStore: true },
    'same-route-a',
  )
  pageA.visible('hide')
  const later = pageA.instance.$pageStore.update
  later({ count: 4 })
  assert.equal(snapshot(pageB.instance.$pageStore).count, 0)
  assert.equal(snapshot(child.instance.$pageStore).count, 4)
  pageA.life('detached')
  assert.equal(child.instance.$globalStore.update({ theme: 'dark' }), false)
  assert.equal(later({ count: 5 }), false)
  const recreated = env.mount(
    { pageStore: true, pageStoreDefinition: definition },
    'same-route-a',
    { isPage: true },
  )
  assert.equal(snapshot(recreated.instance.$pageStore).count, 0)
  assert.equal(later({ count: 8 }), false)
  await Promise.resolve()
  assert.equal(child.instance.writes.length, 0)
})

test('全局视图合并、按变化字段推送，隐藏暂存且显示补齐，业务 on 不漏更新', async () => {
  const env = harness()
  const page = env.mount({ globalStore: true }, 'view', { isPage: true })
  const values = []
  page.instance.$globalStore.on((next) => values.push(next.theme))
  await Promise.resolve()
  page.instance.$globalStore.update({ theme: 'dark' })
  page.instance.$globalStore.update({ theme: 'system' })
  await Promise.resolve()
  assert.deepEqual(page.instance.writes[1], {
    '$globalStore.theme': 'system',
  })
  assert.deepEqual(values, ['dark', 'system'])
  page.visible('hide')
  page.instance.$globalStore.update({ theme: 'light' })
  await Promise.resolve()
  assert.equal(page.instance.writes.length, 2)
  page.visible('show')
  await Promise.resolve()
  assert.equal(page.instance.data.$globalStore.theme, 'light')
  assert.equal(page.instance.writes.length, 3)
})

test('原生底栏及关闭容器下的后代通过明确对象归属，未匹配时不猜栈顶', () => {
  const env = harness()
  const page = env.mount({}, 'page', { isPage: true })
  const bar = env.mount({}, 'native-bar')
  const descendant = env.mount({ pageStore: true }, 'native-bar', {
    owner: bar.instance,
  })
  assert.equal(descendant.instance.$pageStore.update({ count: 1 }), false)
  page.instance.bar = bar.instance
  page.visible('show')
  assert.equal(descendant.instance.$pageStore.update({ count: 1 }), true)
  const ordinary = env.mount({ pageStore: true }, 'page')
  assert.equal(snapshot(ordinary.instance.$pageStore).count, 1)
  assert.equal(bar.instance.$pageStore, undefined)
  page.life('detached')
  assert.equal(descendant.instance.$pageStore.update({ count: 2 }), false)
})

test('定义身份校验和 App 隔离不依赖路由，组件先于页面 attached 仍能接入', () => {
  const env = harness()
  const definition = runtime.definePageStore(() => ({ count: 1 }))
  const page = env.make({ pageStoreDefinition: definition }, 'p', {
    isPage: true,
  })
  page.life('created')
  const child = env.mount(
    { pageStore: true, pageStoreDefinition: definition },
    'p',
  )
  assert.equal(snapshot(child.instance.$pageStore).count, 1)
  page.life('attached')
  const wrong = runtime.definePageStore(() => ({ count: 2 }))
  const original = console.error
  console.error = () => {}
  try {
    const mismatched = env.mount(
      { pageStore: true, pageStoreDefinition: wrong },
      'p',
    )
    assert.equal(mismatched.instance.$pageStore.update({ count: 4 }), false)
  } finally {
    console.error = original
  }
  env.setApp({})
  env.mount({ pageStoreDefinition: definition }, 'p', { isPage: true })
  const other = env.mount({ pageStore: true }, 'p')
  child.instance.$pageStore.update({ count: 8 })
  assert.equal(snapshot(other.instance.$pageStore).count, 1)
})

test('原生 setData 保留对象引用时，展示数据仍与内部只读状态隔离', async () => {
  const env = harness()
  const page = env.make({ globalStore: true }, 'references', { isPage: true })
  page.instance.setData = function (patch) {
    for (const [path, value] of Object.entries(patch)) {
      if (path === '$globalStore') this.data.$globalStore = value
      else this.data.$globalStore[path.slice('$globalStore.'.length)] = value
    }
  }
  page.life('created')
  page.life('attached')
  await Promise.resolve()
  assert.equal(Object.isFrozen(page.instance.data.$globalStore), false)
  page.instance.data.$globalStore.theme = '展示副本'
  assert.equal(snapshot(page.instance.$globalStore).theme, 'light')
  page.instance.$globalStore.update({ theme: 'dark' })
  await Promise.resolve()
  assert.equal(page.instance.data.$globalStore.theme, 'dark')
  assert.equal(Object.isFrozen(snapshot(page.instance.$globalStore)), true)
})

test('跨 JS 上下文的普通对象可更新，类实例和访问器仍被拒绝', () => {
  const store = root().connectGlobal(() => true).store
  const patch = runInNewContext(
    '({ theme: "dark", nested: { value: 2 }, values: [3, 4] })',
  )
  assert.equal(store.update(patch), true)
  patch.nested.value = 99
  assert.deepEqual(snapshot(store), {
    theme: 'dark',
    nested: { value: 2 },
    values: [3, 4],
  })
  assert.throws(() =>
    store.update(
      runInNewContext(
        'new (class Example { constructor() { this.theme = "system"; } })()',
      ),
    ),
  )
  assert.throws(() =>
    store.update(
      runInNewContext('({ get theme() { throw new Error("不能执行"); } })'),
    ),
  )
})

test('业务 Behavior 的页面方法保持原生合并语义，卸载异常不妨碍后续清理', async () => {
  const env = harness()
  const calls = []
  const behavior = {
    methods: {
      /** 模拟原生从行为继承的方法及返回值。 */
      onLoad(query) {
        calls.push(query)
        return this.data.title
      },
      /** 原生平台独立派发 detached，不依赖业务卸载成功。 */
      onUnload() {
        throw new Error('业务卸载异常')
      },
    },
  }
  const page = env.mount(
    { globalStore: true, behaviors: [behavior], data: { title: '页面' } },
    'behavior',
    { isPage: true },
  )
  assert.equal(page.instance.onLoad({ value: '参数' }), '页面')
  assert.deepEqual(calls, [{ value: '参数' }])
  await Promise.resolve()
  page.visible('hide')
  page.instance.$globalStore.update({ theme: 'dark' })
  await Promise.resolve()
  assert.equal(page.instance.data.$globalStore.theme, 'light')
  page.visible('show')
  await Promise.resolve()
  assert.equal(page.instance.data.$globalStore.theme, 'dark')
  assert.throws(() => page.instance.onUnload(), /业务卸载异常/)
  page.life('detached')
  assert.equal(page.instance.$globalStore.update({ theme: 'system' }), false)
})

test('页面工厂重入和初始化期间销毁都不发布未完成条目', () => {
  const kernel = root()
  const token = {}
  assert.throws(
    () =>
      kernel.connectPlugin(
        runtime.pageStorePlugin,
        token,
        {
          options: {},
          ownerOptions: {
            pageStoreDefinition: runtime.definePageStore(() => {
              try {
                kernel.connectPlugin(
                  runtime.pageStorePlugin,
                  token,
                  {
                    options: {},
                    ownerOptions: {
                      pageStoreDefinition: runtime.definePageStore(() => ({
                        count: 9,
                      })),
                    },
                  },
                  () => true,
                )
              } catch {}
              return { count: 1 }
            }),
          },
        },
        () => true,
      ),
    /初始化已失效/,
  )
  const connection = kernel.connectPlugin(
    runtime.pageStorePlugin,
    token,
    {
      options: {},
      ownerOptions: {
        pageStoreDefinition: runtime.definePageStore(() => ({ count: 2 })),
      },
    },
    () => true,
  )
  assert.equal(snapshot(connection.store).count, 2)
  kernel.releaseOwner(token)
  assert.throws(
    () =>
      kernel.connectPlugin(
        runtime.pageStorePlugin,
        token,
        {
          options: {},
          ownerOptions: {
            pageStoreDefinition: runtime.definePageStore(() => ({ count: 3 })),
          },
        },
        () => true,
      ),
    /已销毁/,
  )
  const canceled = {}
  assert.throws(
    () =>
      kernel.connectPlugin(
        runtime.pageStorePlugin,
        canceled,
        {
          options: {},
          ownerOptions: {
            pageStoreDefinition: runtime.definePageStore(() => {
              kernel.releaseOwner(canceled)
              return { count: 4 }
            }),
          },
        },
        () => true,
      ),
    /初始化已失效/,
  )
  const deadApp = root()
  assert.throws(
    () =>
      deadApp.connectPlugin(
        runtime.pageStorePlugin,
        {},
        {
          options: {},
          ownerOptions: {
            pageStoreDefinition: runtime.definePageStore(() => {
              deadApp.dispose()
              return { count: 5 }
            }),
          },
        },
        () => true,
      ),
    /初始化已失效/,
  )
})

test('底栏后代提前订阅在精确归属就绪后激活，提前取消和卸载不会遗留订阅', () => {
  const env = harness()
  const definition = runtime.definePageStore(() => ({ count: 0 }))
  const bar = env.mount({}, 'native')
  const child = env.mount({ pageStore: true }, 'native', {
    owner: bar.instance,
  })
  const values = []
  const stop = child.instance.$pageStore.on(
    (value) => values.push(value.count),
    { immediate: true },
  )
  const canceled = child.instance.$pageStore.on(
    () => {
      throw new Error('已取消不能执行')
    },
    { immediate: true },
  )
  canceled()
  assert.equal(child.instance.$pageStore.update({ count: 9 }), false)
  assert.deepEqual(values, [])
  const detached = env.mount({ pageStore: true }, 'native', {
    owner: bar.instance,
  })
  detached.instance.$pageStore.on(
    () => {
      throw new Error('已卸载不能执行')
    },
    { immediate: true },
  )
  detached.life('detached')
  const page = env.make(
    { pageStore: true, pageStoreDefinition: definition },
    'page',
    { isPage: true },
  )
  page.instance.bar = bar.instance
  page.life('created')
  page.life('attached')
  assert.deepEqual(values, [0])
  page.instance.$pageStore.update({ count: 1 })
  assert.deepEqual(values, [0, 1])
  stop()
  page.instance.$pageStore.update({ count: 2 })
  assert.deepEqual(values, [0, 1])
})

test('多页复用同一原生底栏时撤销页面访问，保留全局能力和正常页面条目', () => {
  const env = harness()
  const definition = runtime.definePageStore(() => ({ count: 0 }))
  const a = env.mount(
    { pageStore: true, pageStoreDefinition: definition },
    'a',
    { isPage: true },
  )
  const bar = env.make({ pageStore: true, globalStore: true }, 'native')
  a.instance.bar = bar.instance
  bar.life('created')
  bar.life('attached')
  const child = env.mount({ pageStore: true, globalStore: true }, 'native', {
    owner: bar.instance,
  })
  const cached = child.instance.$pageStore.update
  assert.equal(cached({ count: 5 }), true)
  const b = env.make(
    { pageStore: true, pageStoreDefinition: definition },
    'b',
    { isPage: true },
  )
  b.instance.bar = bar.instance
  const warn = console.warn
  console.warn = () => {}
  try {
    b.life('created')
    b.life('attached')
  } finally {
    console.warn = warn
  }
  assert.equal(cached({ count: 9 }), false)
  assert.equal(bar.instance.$pageStore.update({ count: 9 }), false)
  let notified = false
  child.instance.$pageStore.on(
    () => {
      notified = true
    },
    { immediate: true },
  )
  assert.equal(notified, false)
  assert.equal(snapshot(a.instance.$pageStore).count, 5)
  assert.equal(snapshot(b.instance.$pageStore).count, 0)
  a.life('detached')
  assert.equal(child.instance.$globalStore.update({ theme: 'dark' }), true)
  child.life('detached')
  assert.equal(child.instance.$globalStore.update({ theme: 'system' }), false)
})
