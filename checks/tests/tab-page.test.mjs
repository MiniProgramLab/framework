// SPDX-License-Identifier: Apache-2.0
/** 编译并执行真实 Core/UI 模块，验证 页面元数据注入与原生生命周期的组合。 */
import assert from 'node:assert/strict'
import { readFile, symlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { compileModules } from '@miniprogramlab/cli/modules'
import { createModuleLoader, temporaryDirectory, writeFixture } from '../helpers/modules.mjs'

/** 每个用例单独安装 App 和加载模块，页面按原生方法合并顺序创建。 */
async function fixture(context) {
  const root = await temporaryDirectory(context)
  const source = path.join(root, 'src')
  const output = path.join(root, 'dist')
  await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), path.join(root, 'node_modules'))
  await writeFixture(root, {
    'src/probe.ts': 'import { definePage } from "@miniprogramlab/core"; export { definePage, defineComponent } from "@miniprogramlab/core"; /** 由 CLI 为这个入口注入底栏行为。 */ export function registerTab(options) { return definePage(options) } export * as controller from "@miniprogramlab/ui/custom-tab-bar/controller"; export { registeredTabs } from "./tabs.js";',
    'src/tabs.ts': await readFile(new URL('../fixtures/tab-bar.ts', import.meta.url), 'utf8'),
  })
  await compileModules({ root, source, output, staging: output, production: false,
    environment: {}, entries: [path.join(source, 'probe.ts')], tabPages: [path.join(source, 'probe.ts')] })
  let app = {}
  const window = { windowWidth: 375 }
  const loader = createModuleLoader(output, {
    Behavior: (options) => options,
    Component: (options) => options,
    getApp: () => app,
    wx: { getWindowInfo: () => window },
  })
  const { definePage, defineComponent, registerTab, controller, registeredTabs } = loader.load('probe.js')
  controller.installTabBar(app, { tabs: registeredTabs })
  let sequence = 0

  /** 保留 Behavior 方法继承、页面覆盖和框架行为先执行的语义。 */
  function create(options, route = 'pages/home/index', tab = true) {
    const definition = (tab ? registerTab : definePage)(options)
    const behaviors = definition.behaviors ?? []
    const id = ++sequence
    const methods = Object.assign({}, ...behaviors.map((behavior) => behavior.methods), definition.methods)
    const writes = []
    const instance = Object.assign(Object.create(methods), {
      route,
      data: Object.assign({}, ...behaviors.map((behavior) => structuredClone(behavior.data ?? {})), structuredClone(definition.data ?? {})),
      getPageId: () => id,
      /** 记录同步结果，同时保留业务字段。 */
      setData(patch) {
        writes.push({ ...patch })
        Object.assign(this.data, patch)
      },
    })
    /** 原生生命周期独立派发，业务异常不跳过框架清理。 */
    function life(name) {
      for (const behavior of behaviors) behavior.lifetimes?.[name]?.call(instance)
      ;(definition.lifetimes?.[name] ?? definition[name])?.call(instance)
    }
    return { instance, definition, life, writes }
  }
  return { create, definePage, defineComponent, registerTab, controller, window,
    /** 模拟不同 App，检查能力安装隔离。 */
    switchApp() { app = {} },
  }
}

test('编译后的页面自动同步选中项和留白，业务 onShow/resize 保留参数、this 与返回值', async (context) => {
  const state = await fixture(context)
  const events = []
  const options = {
    data: { title: '业务数据' },
    methods: {
      /** 业务方法执行时框架已经同步所属路由。 */
      onShow(value) {
        events.push([this.route, value, state.controller.getTabBarSnapshot().activeId])
        return this.data.title
      },
      /** 业务窗口回调保持原参数。 */
      onResize(value) { events.push(value); return 42 },
    },
  }
  const page = state.create(options, 'pages/profile/index')
  assert.equal(page.definition.tabPage, undefined)
  assert.equal(options.data.tabBarSpace, undefined)
  page.life('created')
  assert.equal(page.writes.length, 0)
  page.life('attached')
  assert.ok(page.instance.data.tabBarSpace > 0)
  assert.equal(page.instance.onShow('显示参数'), '业务数据')
  assert.deepEqual(events[0], ['pages/profile/index', '显示参数', 'profile'])
  const height = page.instance.data.tabBarSpace
  state.window.windowWidth = 750
  const size = { size: { windowWidth: 750 } }
  assert.equal(page.instance.onResize(size), 42)
  assert.equal(events[1], size)
  assert.equal(page.instance.data.tabBarSpace, height * 2)
  page.life('attached')
  const count = page.writes.length
  state.controller.configureTabBar({ layout: { height: 140 } })
  assert.equal(page.writes.length, count + 1)
  state.controller.configureTabBar({ hidden: true })
  assert.equal(page.instance.data.tabBarSpace, 0)
  page.life('detached')
  page.life('detached')
  const detachedCount = page.writes.length
  state.controller.configureTabBar({ hidden: false })
  assert.equal(page.writes.length, detachedCount)
})

test('继承的 Behavior 方法不丢失，原生底栏实例优先同步，业务异常后仍能清理', async (context) => {
  const state = await fixture(context)
  const calls = []
  const failure = new Error('业务显示异常')
  const behavior = { methods: {
    /** 模拟业务 Behavior 中的同名生命周期。 */
    onShow(value) { calls.push(value); return this.route },
  } }
  const page = state.create({ behaviors: [behavior] }, 'pages/activity/index')
  page.instance.getTabBar = () => ({ syncRoute: (route) => calls.push(route) })
  page.life('created')
  page.life('attached')
  assert.equal(page.instance.onShow('业务'), 'pages/activity/index')
  assert.deepEqual(calls, ['pages/activity/index', '业务'])
  const throwing = state.create({ methods: { onShow() { throw failure } } })
  throwing.life('created')
  throwing.life('attached')
  assert.throws(() => throwing.instance.onShow(), (error) => error === failure)
  throwing.life('detached')
  const count = throwing.writes.length
  state.controller.configureTabBar({ hidden: true })
  assert.equal(throwing.writes.length, count)
  assert.equal(page.instance.data.tabBarSpace, 0)
  page.life('detached')
})

test('未声明生命周期的 Tab 页自动接入，普通页面不绑定且拒绝旧开关', async (context) => {
  const state = await fixture(context)
  const plain = state.create({ }, 'pages/stats/index')
  plain.life('created')
  plain.life('attached')
  plain.instance.onShow()
  assert.equal(state.controller.getTabBarSnapshot().activeId, 'stats')
  plain.life('detached')
  const page = state.create({}, undefined, false)
  page.life('created')
  page.life('attached')
  assert.equal(page.instance.data.tabBarSpace, undefined)
  assert.equal(page.instance.onShow, undefined)
  page.life('detached')
  for (const tabPage of [true, false, 'true'])
    assert.throws(() => state.definePage({ tabPage }), /tabPage 已移除/)
  assert.throws(() => state.defineComponent({ tabPage: true }), /tabPage 已移除/)
  assert.throws(() => state.registerTab({ data: { tabBarSpace: 0 } }), /请勿重复声明/)
  assert.throws(() => state.registerTab({ properties: { tabBarSpace: Number } }), /请勿重复声明/)
  state.switchApp()
  const uninstalled = state.create({ })
  uninstalled.life('created')
  assert.throws(() => uninstalled.life('attached'), /installTabBar/)
  uninstalled.life('detached')
})
