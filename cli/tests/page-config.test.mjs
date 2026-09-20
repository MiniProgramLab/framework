// SPDX-License-Identifier: Apache-2.0
/** 验证配置依赖裁剪不会执行业务代码，也不破坏共享声明与映射位置。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { transform } from 'esbuild'
import { Script } from 'node:vm'
import { extractPageConfig, stripPageConfig, injectTabPage, inspectPageSource } from '../dist/src/page-config.js'

test('同文件配置保留传递依赖，运行时保留共享值和原始行列', async () => {
  const source = `
const first = '配置', shared = '共享', unusedRuntime = business();
const { name: routeName } = { name: 'home' };
/** 通过函数和对象简写读取外层声明。 */
function metadata() { const first = '局部'; return { page: { name: routeName }, config: { shared, navigationBarTitleText: first } } }
definePageConfig({ ...metadata(), config: { ...metadata().config, title: first } });
definePage({ data: { shared, unusedRuntime } });
`
  const compiled = extractPageConfig('/fixture/page.ts', source)
  const runtime = stripPageConfig('/fixture/page.ts', source)
  let config
  new Script(compiled).runInNewContext({ definePageConfig(value) { config = value } })
  assert.equal(config.page.name, 'home')
  assert.equal(config.config.navigationBarTitleText, '局部')
  assert.equal(config.config.title, '配置')
  let page
  new Script(runtime).runInNewContext({ business() { return 42 }, definePage(value) { page = value } })
  assert.equal(page.data.shared, '共享')
  assert.equal(page.data.unusedRuntime, 42)
  assert.equal(runtime.indexOf('definePage('), source.indexOf('definePage('))
  assert.equal(runtime.split('\n').length, source.split('\n').length)
  await transform(runtime, { loader: 'ts' })
})

test('混合导入和多变量声明按绑定裁剪，业务导入不进入配置求值', async () => {
  for (const [imports, configExpression, runtimeExpression] of [
    ['import config, { live } from "pkg"', 'config', 'live'],
    ['import live, { config } from "pkg"', 'config', 'live'],
    ['import { before, config, live, after } from "pkg"', 'config + before + after', 'live'],
    ['import { config, middle, live } from "pkg"', 'config + middle', 'live'],
    ['import * as config from "pkg"', 'config.title', '"业务"'],
  ]) {
    const source = `${imports};\ndefinePageConfig({ page: { name: "home" }, config: { title: ${configExpression} } });\ndefinePage({ value: ${runtimeExpression} });`
    const config = extractPageConfig('/fixture/page.ts', source)
    const runtime = stripPageConfig('/fixture/page.ts', source)
    await transform(config, { loader: 'ts' })
    await transform(runtime, { loader: 'ts' })
    assert.doesNotMatch(runtime, /\bconfig\b/)
    assert.doesNotMatch(config, /\blive\b|definePage\(/)
  }
})

test('移除配置声明仍保留无分号源码的语句边界', () => {
  const source = `
const value = business()
definePageConfig({ page: { name: 'home' } });
(() => definePage({ value }))()
`
  let page
  new Script(stripPageConfig('/fixture/page.ts', source)).runInNewContext({
    business() { return 7 }, definePage(value) { page = value },
  })
  assert.equal(page.value, 7)
})


test('底栏注入支持全局、导入别名和命名空间，忽略业务同名函数', async () => {
  for (const [source, expected] of [
    ['definePage({})', 'definePage({}, true)'],
    ['definePage({}, /* 尾随注释 */)', 'definePage({}, true, /* 尾随注释 */)'],
    ['import { definePage as page } from "@miniprogramlab/core"; page({})', 'page({}, true)'],
    ['import * as core from "@miniprogramlab/core/runtime"; core.definePage({})', 'core.definePage({}, true)'],
  ]) {
    const compiled = injectTabPage('/fixture/page.ts', source)
    assert.ok(compiled.includes(expected), compiled)
    assert.equal(inspectPageSource('/fixture/page.ts', source).page, true)
    await transform(compiled, { loader: 'ts' })
  }
  for (const source of [
    'function definePage(value) {}; definePage({})',
    'function run(definePage) { definePage({}) }',
    'import { definePage } from "business"; definePage({})',
    'const object = { definePage() {} }; object.definePage({})',
    'const mini = { definePage() {} }; mini.definePage({})',
    'function run(mini) { mini.definePage({}) }',
    'Page({})',
  ]) assert.equal(injectTabPage('/fixture/page.ts', source), source)
  assert.throws(() => injectTabPage('/fixture/page.ts', 'definePage({}, true)'), /只接受一个页面选项/)
  assert.throws(() => injectTabPage('/fixture/page.ts', 'mini.definePage({})'), /直接调用 definePage/)
  assert.throws(() => inspectPageSource('/fixture/card.ts', 'mini.defineComponent({})'), /直接调用 defineComponent/)
})


test('独立配置宏保留配置依赖，与 mini 运行时调用分别裁剪', () => {
  const source = `const title = '首页'; definePageConfig({ page: { name: 'home' }, config: { navigationBarTitleText: title } }); definePage({ methods: { go() { navigateTo('/pages/home/index').go() } } });`
  let config
  new Script(extractPageConfig('/fixture/page.ts', source)).runInNewContext({ definePageConfig(value) { config = value } })
  assert.equal(config.config.navigationBarTitleText, '首页')
  assert.doesNotMatch(stripPageConfig('/fixture/page.ts', source), /definePageConfig|const title/)
  assert.equal(inspectPageSource('/fixture/page.ts', 'const mini = { definePageConfig() {} }; mini.definePageConfig({})').configs.length, 0)
  assert.equal(inspectPageSource('/fixture/page.ts', 'function use(mini) { mini.definePageConfig({}) }').configs.length, 0)
  assert.throws(() => inspectPageSource('/fixture/page.ts', 'mini.definePageConfig({})'), /直接调用 definePageConfig/)
  assert.throws(() => inspectPageSource('/fixture/app.config.ts', 'mini.defineAppConfig({})'), /直接调用 defineAppConfig/)
})
