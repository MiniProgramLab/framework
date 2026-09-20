// SPDX-License-Identifier: Apache-2.0
/** 验证真实 Store 与控制器的时序，原生滚动和动画仅提供可控回执。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { harness, runtime } from './store-test-utils.mjs'

/** 读取只读快照，不访问 Store 的内部索引。 */
function snapshot(store) {
  let value
  store.on(
    (next) => {
      value = next
    },
    { immediate: true },
  )()
  return value
}
/** 测试条目使用合法且稳定的身份。 */
function layer(id, generation = 1) {
  return { id, generation, phase: 'opening' }
}

test('弹层范围隔离业务通知，页面销毁使两个私有范围同时失效', () => {
  const root = runtime.createStoreRoot(
    () => ({ value: 0 }),
    runtime.storePlugins(),
  )
  const token = {}
  const global = root.connectGlobal(() => true).store
  const page = root.connectPlugin(
    runtime.pageStorePlugin,
    token,
    {
      options: {},
      ownerOptions: {
        pageStoreDefinition: runtime.definePageStore(() => ({ value: 0 })),
      },
    },
    () => true,
  ).store
  const overlay = root.connectPlugin(
    runtime.overlayStorePlugin,
    token,
    { options: {}, ownerOptions: {} },
    () => true,
  ).store
  const other = root.connectPlugin(
    runtime.overlayStorePlugin,
    {},
    { options: {}, ownerOptions: {} },
    () => true,
  ).store
  let businessNotifications = 0
  global.on(() => businessNotifications++)
  page.on(() => businessNotifications++)
  runtime.enterOverlay(overlay, layer('甲'))
  assert.equal(businessNotifications, 0)
  assert.deepEqual(snapshot(other), { layers: [] })
  assert.deepEqual(Object.keys(overlay).sort(), ['on', 'update'])
  root.releaseOwner(token)
  assert.equal(overlay.update({ layers: [] }), false)
  assert.equal(page.update({ value: 1 }), false)
  assert.throws(
    () =>
      root.connectPlugin(
        runtime.overlayStorePlugin,
        token,
        { options: {}, ownerOptions: {} },
        () => true,
      ),
    /已销毁/,
  )
  assert.equal(global.update({ value: 1 }), true)
})

test('弹层结构校验原子回滚，保留名无法从业务定义或嵌套补丁写入', () => {
  const root = runtime.createStoreRoot(() => ({}), runtime.storePlugins())
  const store = root.connectPlugin(
    runtime.overlayStorePlugin,
    {},
    { options: {}, ownerOptions: {} },
    () => true,
  ).store
  runtime.enterOverlay(store, layer('甲'))
  const before = snapshot(store)
  for (const value of [
    { layers: [], extra: true },
    { layers: [layer('甲'), layer('甲')] },
    { layers: [layer('甲', 0)] },
    { layers: [{ ...layer('甲'), phase: 'closed' }] },
    { layers: [{ ...layer('甲'), modal: false }] },
  ])
    assert.throws(() => store.update(value))
  assert.equal(snapshot(store), before)
  assert.throws(() =>
    root
      .connectGlobal(() => true)
      .store.update({ nested: { __overlayState__: {} } }),
  )
  assert.throws(() =>
    runtime.createStoreRoot(
      () => ({ __overlayState__: {} }),
      runtime.storePlugins(),
    ),
  )
})

test('叠层只限制背景与下层，过期代次移除不影响当前展示', () => {
  const store = runtime
    .createStoreRoot(() => ({}), runtime.storePlugins())
    .connectPlugin(
      runtime.overlayStorePlugin,
      {},
      { options: {}, ownerOptions: {} },
      () => true,
    ).store
  runtime.enterOverlay(store, layer('甲'))
  runtime.enterOverlay(store, layer('乙'))
  assert.equal(runtime.overlayBlocked(snapshot(store)), true)
  assert.equal(runtime.overlayBlocked(snapshot(store), '甲'), true)
  assert.equal(runtime.overlayBlocked(snapshot(store), '乙'), false)
  runtime.changeOverlay(store, '乙', 1, { generation: 2, phase: 'closing' })
  runtime.removeOverlay(store, '乙', 1)
  assert.equal(snapshot(store).layers.length, 2)
  runtime.removeOverlay(store, '乙', 2)
  assert.equal(runtime.overlayBlocked(snapshot(store)), true)
  assert.equal(runtime.overlayBlocked(snapshot(store), '甲'), false)
  runtime.removeOverlay(store, '甲')
  assert.equal(runtime.overlayBlocked(snapshot(store)), false)
})

/** 真实包装器分配页面身份，业务页不声明任何 Store 选项。 */
function scene(t) {
  const env = harness()
  const page = env.mount({}, 'overlay-page', { isPage: true })
  globalThis.wx = { nextTick: (callback) => queueMicrotask(callback) }
  const shell = env.mount({ overlayStore: true }, 'overlay-page')
  const locks = []
  const isolation = runtime.createScrollIsolation(shell.instance, {
    selector: '.scroll',
    background: true,
    enabled: () => false,
    apply: (value) => locks.push(value),
  })
  const popups = []
  t.after(() => {
    for (const popup of popups) popup.component.life('detached')
    isolation.dispose()
    shell.life('detached')
    page.life('detached')
  })
  /** 动画由测试明确结束，避免用定时器假装原生完成。 */
  function popup() {
    const component = env.mount(
      {
        overlayStore: true,
        data: {
          show: false,
          transparent: false,
          mounted: false,
          rendered: false,
          covered: false,
          scrollable: false,
          destroyOnClose: false,
        },
      },
      'overlay-page',
    )
    const host = component.instance
    const events = []
    const animations = []
    Object.assign(host, {
      triggerEvent(name, detail) {
        events.push({ name, detail })
      },
      async animateOverlay(open, generation) {
        animations.push({ open, generation })
      },
      pauseOverlay() {},
      releaseOverlayMotion() {},
      applyOverlayScroll(value) {
        this.data.scrollLocked = value
      },
    })
    const controller = runtime.createOverlayController(host)
    controller.ready()
    const item = {
      component,
      host,
      controller,
      events,
      animations,
      show(value) {
        host.setData({ show: value })
        controller.sync()
      },
      finish() {
        controller.finish(animations.at(-1).generation)
      },
    }
    popups.push(item)
    return item
  }
  return {
    env,
    page,
    shell,
    locks,
    popup,
    snapshot: () => snapshot(shell.instance.$overlayStore),
  }
}

test('业务页面零配置，关闭期间保持锁直到动画结束，重复完成只通知一次', async (t) => {
  const view = scene(t)
  const popup = view.popup()
  assert.equal(view.page.instance.$overlayStore, undefined)
  popup.show(true)
  assert.equal(view.locks.at(-1), true)
  assert.equal(view.snapshot().layers[0].phase, 'opening')
  popup.finish()
  assert.equal(view.snapshot().layers[0].phase, 'open')
  popup.controller.close('mask')
  assert.equal(popup.host.data.show, false)
  assert.equal(view.snapshot().layers[0].phase, 'closing')
  assert.equal(view.locks.at(-1), true)
  popup.finish()
  popup.finish()
  await Promise.resolve()
  assert.equal(view.locks.at(-1), false)
  assert.equal(
    popup.events.filter((event) => event.name === 'closed').length,
    1,
  )
})

test('快速重开使旧退场失效，叠层卸载只释放自己', (t) => {
  const view = scene(t)
  const first = view.popup()
  const second = view.popup()
  first.show(true)
  first.finish()
  first.show(false)
  const stale = first.animations.at(-1).generation
  first.show(true)
  first.controller.finish(stale)
  assert.equal(view.snapshot().layers[0].phase, 'opening')
  assert.equal(
    first.events.some((event) => event.name === 'closed'),
    false,
  )
  second.show(true)
  second.finish()
  assert.equal(first.host.data.covered, true)
  second.component.life('detached')
  assert.equal(view.snapshot().layers.length, 1)
  assert.equal(first.host.data.covered, false)
  assert.equal(view.locks.at(-1), true)
})

test('closed 回调同步打开下一层时，原生背景不会短暂解锁', async (t) => {
  const view = scene(t)
  const first = view.popup()
  const second = view.popup()
  first.show(true)
  first.finish()
  first.host.triggerEvent = (name) => {
    if (name === 'closed') second.show(true)
  }
  view.locks.length = 0
  first.show(false)
  first.finish()
  await Promise.resolve()
  assert.equal(view.locks.includes(false), false)
  assert.equal(view.snapshot().layers.length, 1)
})

test('透明遮罩始终隔离背景，切换透明度不改变代次和展示顺序', async (t) => {
  const view = scene(t)
  const first = view.popup()
  const second = view.popup()
  first.show(true)
  first.finish()
  second.host.setData({ transparent: true })
  second.show(true)
  second.finish()
  const before = view.snapshot()
  second.host.setData({ transparent: false })
  second.controller.sync()
  assert.equal(view.snapshot(), before)
  assert.equal(first.host.data.covered, true)
  assert.equal(view.locks.at(-1), true)
  first.component.life('detached')
  await Promise.resolve()
  assert.equal(view.locks.at(-1), true)
  second.show(false)
  assert.equal(view.locks.at(-1), true)
  second.finish()
  await Promise.resolve()
  assert.equal(view.locks.at(-1), false)
})

test('隐藏时旧完成回调不能推进，页面卸载后旧连接不能复活', (t) => {
  const view = scene(t)
  const popup = view.popup()
  popup.show(true)
  const generation = popup.animations.at(-1).generation
  popup.controller.visibility(false)
  popup.controller.finish(generation)
  assert.equal(view.snapshot().layers[0].phase, 'opening')
  popup.controller.visibility(true)
  popup.controller.finish(generation)
  assert.equal(view.snapshot().layers[0].phase, 'opening')
  popup.finish()
  assert.equal(view.snapshot().layers[0].phase, 'open')
  const stale = popup.host.$overlayStore
  view.page.life('detached')
  assert.equal(stale.update({ layers: [layer('迟到')] }), false)
})
