// SPDX-License-Identifier: Apache-2.0
/** 用隔离构建的真实组件验证模块拆分后的生命周期、绑定与导航边界。 */
import assert from 'node:assert/strict'
import { readFile, symlink } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { compileModules } from '@miniprogramlab/cli/modules'
import {
  createModuleLoader,
  temporaryDirectory,
  writeFixture,
} from '../helpers/modules.mjs'

/** 每个用例独立加载 CommonJS 缓存，平台替身允许控制异步返回的先后顺序。 */
async function fixture(context) {
  const root = await temporaryDirectory(context)
  const source = path.join(root, 'src')
  const output = path.join(root, 'dist')
  await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), path.join(root, 'node_modules'))
  await writeFixture(root, {
    'src/probe.ts': 'export * as runtimeModule from "@miniprogramlab/ui/custom-tab-bar/runtime"; export * as controller from "@miniprogramlab/ui/custom-tab-bar/controller"; export * as navigation from "@miniprogramlab/ui/custom-tab-bar/navigation"; export { storeOptions } from "@miniprogramlab/core/store/binding"; export { appTabBarConfig, registeredTabs } from "./tab-bar.js";',
    'src/tab-bar.ts': await readFile(new URL('../fixtures/tab-bar.ts', import.meta.url), 'utf8'),
  })
  await compileModules({
    root,
    source,
    output,
    staging: output,
    production: false,
    environment: {},
    entries: [fileURLToPath(import.meta.resolve('@miniprogramlab/ui/custom-tab-bar/index')), path.join(source, 'probe.ts')],
    entryAliases: [{ filename: fileURLToPath(import.meta.resolve('@miniprogramlab/ui/custom-tab-bar/index')), relative: 'custom-tab-bar/index.js' }],
  })
  const app = { globalData: {} }
  const switches = []
  const toasts = []
  const window = {
    windowWidth: 375,
    windowHeight: 812,
    screenWidth: 375,
    screenHeight: 812,
    screenTop: 0,
    safeArea: { left: 0, right: 375, bottom: 778 },
  }
  let definition
  const loader = createModuleLoader(output, {
    Behavior: (value) => value,
    Component(value) {
      definition = value
    },
    getApp: () => app,
    getCurrentPages: () => [{ route: 'pages/home/index' }],
    wx: {
      getWindowInfo: () => window,
      switchTab: (options) => switches.push(options),
      showToast: (options) => toasts.push(options),
      worklet: {
        shared: (value) => ({ value }),
        derived: (compute) => ({
          get value() {
            return compute()
          },
        }),
        runOnUI: (callback) => callback,
        runOnJS: (callback) => callback,
        spring: (target) => target,
        timing: (target) => target,
        cancelAnimation() {},
      },
    },
  })
  const { runtimeModule, controller, navigation, appTabBarConfig, registeredTabs, storeOptions } = loader.load('probe.js')
  controller.installTabBar(app, { config: appTabBarConfig, tabs: registeredTabs })
  loader.load('custom-tab-bar/index.js')
  let pageSequence = 0

  /** 按原生顺序触发生命周期，并记录真正的视图更新、测量和绑定回调。 */
  function mount({
    standalone = true,
    delayBindings = false,
    delayMeasurements = false,
  } = {}) {
    const id = 'tabbar-test-' + ++pageSequence
    const page = {
      data: {},
      getPageId: () => id,
      setData(patch) {
        Object.assign(this.data, patch)
      },
    }
    const pageOptions = storeOptions({}, true)
    for (const behavior of pageOptions.behaviors) {
      behavior.lifetimes.created.call(page)
      behavior.lifetimes.attached.call(page)
    }
    const events = [],
      patches = [],
      bindings = [],
      cleared = [],
      measurements = []
    const instance = {
      getPageId: () => id,
      data: {
        ...structuredClone(definition.data),
        standalone,
        disabled: false,
        value: '',
        config: structuredClone(appTabBarConfig),
      },
      setData(patch, done) {
        patches.push(patch)
        Object.assign(this.data, patch)
        done?.()
      },
      triggerEvent(name, detail) {
        events.push({ name, detail })
      },
      applyAnimatedStyle(selector, updater, _options, done) {
        const id = bindings.length + 1
        const binding = {
          selector,
          updater,
          finish: () => done({ styleId: id }),
          id,
        }
        bindings.push(binding)
        if (!delayBindings) binding.finish()
      },
      clearAnimatedStyle(selector, ids) {
        cleared.push(...ids.map((id) => ({ selector, id })))
      },
      createSelectorQuery() {
        const query = {
          select() {
            return query
          },
          boundingClientRect(done) {
            const finish = () =>
              done({ left: 16, top: 690, width: 343, height: 60 })
            measurements.push(finish)
            if (!delayMeasurements) finish()
            return query
          },
          exec() {},
        }
        return query
      },
    }
    for (const [name, method] of Object.entries(definition.methods))
      instance[name] = method.bind(instance)
    /** 真实 Behavior 先于组件执行，让内置弹层订阅接受正常归属与清理。 */
    function life(phase) {
      for (const behavior of definition.behaviors)
        behavior.lifetimes?.[phase]?.call(instance)
      definition.lifetimes[phase]?.call(instance)
    }
    for (const phase of ['created', 'attached', 'ready']) life(phase)
    return {
      instance,
      events,
      patches,
      bindings,
      cleared,
      measurements,
      runtime: runtimeModule.findRuntime(instance),
      show: () => definition.pageLifetimes.show.call(instance),
      hide: () => definition.pageLifetimes.hide.call(instance),
      detach: () => {
        life('detached')
        for (const behavior of pageOptions.behaviors)
          behavior.lifetimes.detached.call(page)
      },
    }
  }
  return { mount, controller, navigation, runtimeModule, switches, toasts, app }
}

test('主题与角标更新复用布局和动画绑定，列表重排后释放旧绑定', async (context) => {
  const fixtureState = await fixture(context)
  const bar = fixtureState.mount()
  assert.equal(bar.instance.data.measured, true)
  assert.equal(bar.bindings.length, 18)
  assert.match(bar.instance.data.hostStyle, /position:fixed/)
  const measured = bar.measurements.length
  bar.instance.configure({ theme: { color: '#245BFF' } })
  bar.instance.updateItem('activity', { badge: 120 })
  assert.equal(bar.instance.data.items[1].badgeText, '99+')
  assert.equal(bar.measurements.length, measured)
  assert.equal(bar.bindings.length, 18)
  const updates = bar.patches.length
  bar.show()
  assert.equal(bar.patches.length, updates)
  assert.equal(bar.measurements.length, measured)
  bar.instance.setItems(bar.instance.getConfig().items.reverse())
  assert.equal(bar.bindings.length, 34)
  assert.equal(bar.cleared.length, 16)
  assert.equal(bar.instance.data.activeId, 'home')
  bar.detach()
  assert.equal(bar.cleared.length, 34)
})

test('过期测量、异步绑定和语义事件在隐藏或销毁后失效', async (context) => {
  const state = await fixture(context)
  const bar = state.mount({ delayBindings: true, delayMeasurements: true })
  bar.instance.configure({ layout: { height: 140 } })
  bar.measurements[0]()
  assert.equal(bar.instance.data.measured, false)
  bar.measurements.at(-1)()
  assert.equal(bar.instance.data.measured, true)
  bar.instance.setItems(bar.instance.getConfig().items.reverse())
  bar.bindings.slice(0, 18).forEach((binding) => binding.finish())
  assert.equal(bar.cleared.length, 16)
  const commit = {
    kind: 'commit',
    source: 'tap',
    index: 1,
    sequence: 1,
    epoch: bar.runtime.epoch,
  }
  bar.hide()
  bar.instance.onFluidEvent(commit)
  assert.equal(bar.instance.data.activeId, 'home')
  bar.show()
  bar.instance.onFluidEvent(commit)
  assert.equal(bar.instance.data.activeId, 'home')
  bar.instance.onFluidEvent({ ...commit, epoch: bar.runtime.epoch })
  assert.equal(bar.instance.data.activeId, 'stats')
  bar.instance.onFluidEvent({ ...commit, epoch: bar.runtime.epoch })
  assert.equal(bar.events.filter((event) => event.name === 'change').length, 1)
  assert.equal(state.switches.length, 0)
  bar.detach()
  bar.bindings.slice(18).forEach((binding) => binding.finish())
  assert.equal(bar.cleared.length, bar.bindings.length)
  const updates = bar.patches.length
  bar.measurements.forEach((finish) => finish())
  bar.instance.onFluidEvent({
    ...commit,
    sequence: 2,
    epoch: bar.runtime.epoch,
  })
  assert.equal(bar.patches.length, updates)
  assert.equal(state.runtimeModule.findRuntime(bar.instance), undefined)
})

test('原生导航跨实例同步，隐藏取消订阅，失败恢复选择，接续动画只播放一次', async (context) => {
  const state = await fixture(context)
  const source = state.mount({ standalone: false })
  const destination = state.mount({ standalone: false })
  assert.equal(typeof source.runtime.navigation.unsubscribe, 'function')
  assert.equal(typeof destination.runtime.navigation.unsubscribe, 'function')
  const navigation = source.instance.navigateSelection('activity')
  assert.equal(state.switches[0].url, '/pages/activity/index')
  assert.equal(destination.instance.data.activeId, 'activity')
  assert.equal(destination.instance.data.navigating, true)
  state.switches[0].success({})
  await navigation
  assert.equal(destination.instance.data.navigating, false)
  source.hide()
  assert.equal(source.runtime.navigation.unsubscribe, null)
  const hiddenUpdates = source.patches.length
  state.controller.configureTabBar({ haptics: true })
  assert.equal(source.patches.length, hiddenUpdates)
  const failed = destination.instance.navigateSelection('stats')
  state.switches[1].fail({ errMsg: '模拟切页失败' })
  await failed
  assert.equal(destination.instance.data.activeId, 'activity')
  assert.equal(destination.instance.data.navigating, false)
  assert.equal(
    destination.events.filter((event) => event.name === 'navigationerror')
      .length,
    1,
  )
  assert.equal(state.toasts.length, 1)
  source.show()
  assert.equal(source.instance.data.activeId, 'activity')
  assert.equal(typeof source.runtime.navigation.unsubscribe, 'function')
  let resumed = 0
  const transition = {
    token: 100,
    startedAt: Date.now(),
    from: 'home',
    to: 'activity',
  }
  destination.runtime.navigation.transition = transition
  destination.runtime.navigation.played = null
  const host = {
    resumeTransition() {
      resumed += 1
      return true
    },
  }
  state.navigation.resumeTabNavigation(host, destination.runtime)
  state.navigation.resumeTabNavigation(host, destination.runtime)
  assert.equal(resumed, 1)
  source.detach()
  destination.detach()
  assert.equal(source.runtime.navigation.unsubscribe, null)
  assert.equal(destination.runtime.navigation.unsubscribe, null)
})

test('模态期间暂停底栏输入，恢复时重新测量业务更新后的布局', async (context) => {
  const state = await fixture(context)
  const bar = state.mount()
  bar.instance.$overlayStore.update({
    layers: [{ id: 'popup', generation: 1, phase: 'open' }],
  })
  assert.equal(bar.instance.data.modalSuspended, true)
  assert.equal(bar.runtime.motion.settings.value.locked, true)
  bar.instance.onTap({ currentTarget: { dataset: { index: 1 } } })
  assert.equal(
    bar.events.some((event) => event.name === 'change'),
    false,
  )
  bar.instance.configure({ layout: { height: 144 } })
  const measurements = bar.measurements.length
  bar.instance.$overlayStore.update({ layers: [] })
  assert.equal(bar.instance.data.modalSuspended, false)
  assert.equal(bar.measurements.length, measurements + 1)
  assert.equal(bar.runtime.motion.settings.value.locked, false)
  assert.equal(bar.instance.getConfig().layout.height, 144)
  bar.detach()
})
