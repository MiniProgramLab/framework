// SPDX-License-Identifier: Apache-2.0
/** 验证真正入口、公共模块单例、原生 npm 组件依赖及 Worklet 编译边界。 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { compileModules } from '@miniprogramlab/cli/modules'
import { createComponentCollector } from '@miniprogramlab/cli/npm-components'
import {
  createModuleLoader,
  temporaryDirectory,
  writeFixture,
} from '../../checks/helpers/modules.mjs'

/** 为模块回归创建最小框架注入源和统一构建参数。 */
async function setup(context, files) {
  const root = await temporaryDirectory(context)
  await writeFixture(root, {
    'src/framework/runtime.ts':
      'export function definePage(value) { return Component(value); } export function defineComponent(value) { return Component(value); }',
    ...files,
  })
  return {
    root,
    source: path.join(root, 'src'),
    output: path.join(root, 'dist'),
    staging: path.join(root, 'dist'),
    production: false,
    environment: {},
  }
}

test('多个入口共享同一可变模块及框架，未引用文件不进入产物', async (context) => {
  const options = await setup(context, {
    'src/shared.ts': 'export const state = { count: 0 };',
    'src/unused.ts': 'throw new Error("不应编译或加载");',
    'src/first.ts':
      'import { state } from "./shared.js"; state.count++; export { state }; definePage({ name: "first" });',
    'src/nested/second.ts':
      'export { state } from "../shared.js"; definePage({ name: "second" });',
  })
  const files = await compileModules({
    ...options,
    entries: ['first.ts', 'nested/second.ts'].map((name) =>
      path.join(options.source, name),
    ),
  })
  assert.equal(files.filter((name) => name === 'shared.js').length, 1)
  assert.equal(files.includes('unused.js'), false)
  const registered = []
  const loader = createModuleLoader(options.output, {
    Component: (value) => registered.push(value.name),
  })
  const first = loader.load('first.js')
  const second = loader.load('nested/second.js')
  assert.equal(first.state, second.state)
  assert.equal(second.state.count, 1)
  assert.deepEqual(registered, ['first', 'second'])
})

test('Worklet 辅助函数随入口内联，保留指令和依赖声明顺序', async (context) => {
  const options = await setup(context, {
    'src/math.worklet.ts':
      'export function double(value) { "worklet"; return value * 2; }',
    'src/motion.worklet.ts':
      'import { double } from "./math.worklet.js"; export function animate(value) { "worklet"; return double(value) + 1; }',
    'src/app.ts':
      'import { animate } from "./motion.worklet.js"; export const value = animate(3);',
  })
  const files = await compileModules({
    ...options,
    entries: [path.join(options.source, 'app.ts')],
  })
  assert.equal(
    files.some((name) => name.includes('.worklet.')),
    false,
  )
  assert.equal(files.includes('framework/runtime.js'), false)
  const code = await readFile(path.join(options.output, 'app.js'), 'utf8')
  assert.ok(code.indexOf('function double') < code.indexOf('function animate'))
  assert.equal((code.match(/"worklet"/g) ?? []).length, 2)
  assert.equal(createModuleLoader(options.output).load('app.js').value, 7)
})

test('Worklet 不能捕获普通模块的 require 命名空间', async (context) => {
  const options = await setup(context, {
    'src/helper.ts': 'export function calculate(value) { return value; }',
    'src/motion.worklet.ts':
      'import { calculate } from "./helper.js"; export function animate(value) { "worklet"; return calculate(value); }',
    'src/app.ts': 'export { animate } from "./motion.worklet.js";',
  })
  await assert.rejects(
    compileModules({
      ...options,
      entries: [path.join(options.source, 'app.ts')],
    }),
    /运行时依赖也必须使用/,
  )
})

test('原生 npm 组件和应用复用同一依赖，组件工具文件不作为额外入口', async (context) => {
  const options = await setup(context, {
    'src/app.ts': 'export { state } from "fixture-ui";',
    'node_modules/fixture-ui/package.json': JSON.stringify({
      name: 'fixture-ui',
      main: 'mini/shared.js',
      miniprogram: 'mini',
    }),
    'node_modules/fixture-ui/mini/shared.js':
      'export const state = { count: 0 };',
    'node_modules/fixture-ui/mini/unused.js': 'throw new Error("未引用工具");',
    'node_modules/fixture-ui/mini/button/index.js':
      'import { state } from "../shared.js"; state.count++; Component({ state });',
    'node_modules/fixture-ui/mini/button/index.json': '{"component":true}',
    'node_modules/fixture-ui/mini/button/index.wxml': '<view />',
  })
  const collector = createComponentCollector(
    options.root,
    options.output,
    new Set(),
  )
  const config = await collector.rewrite({
    usingComponents: { button: 'fixture-ui/button/index' },
  })
  assert.equal(
    config.usingComponents.button,
    '/miniprogram_npm/fixture-ui/button/index',
  )
  const components = await collector.emit()
  const files = await compileModules({
    ...options,
    componentRoots: components.roots,
    entries: [path.join(options.source, 'app.ts'), ...components.entries],
  })
  assert.equal(
    files.some((name) => name.endsWith('/unused.js')),
    false,
  )
  let component
  const loader = createModuleLoader(options.output, {
    Component: (value) => {
      component = value
    },
  })
  const app = loader.load('app.js')
  loader.load('miniprogram_npm/fixture-ui/button/index.js')
  assert.equal(app.state, component.state)
  assert.equal(app.state.count, 1)
})
