// SPDX-License-Identifier: Apache-2.0
/** 页头消费 Router 的结果对象，失败后恢复按钮并保留内部错误诊断。 */
import assert from 'node:assert/strict'
import { symlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { compileModules } from '@miniprogramlab/cli/modules'
import { temporaryDirectory, writeFixture, createModuleLoader } from '../helpers/modules.mjs'

test('页头返回入口使用真实结果回执，失败可重试且跳转中不重复提交', async (context) => {
  const root = await temporaryDirectory(context)
  const source = path.join(root, 'src')
  const output = path.join(root, 'dist')
  await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), path.join(root, 'node_modules'))
  await writeFixture(root, {
    'src/probe.ts': `import '@miniprogramlab/ui/page-header/index';
export { installComponents } from '@miniprogramlab/ui/configure';
export { createRouter } from '@miniprogramlab/core/router';`,
  })
  await compileModules({ root, source, output, staging: output, production: false,
    environment: {}, entries: [path.join(source, 'probe.ts')] })
  const app = {}
  let definition
  const loader = createModuleLoader(output, {
    Component: (options) => { definition = options },
    getApp: () => app,
    getCurrentPages: () => [{}],
  })
  const { installComponents, createRouter } = loader.load('probe.js')
  const errors = []
  context.mock.method(console, 'error', (_label, error) => { errors.push(error) })
  const pending = []
  const router = createRouter({
    routes: { home: { name: 'home', path: '/pages/home/index', kind: 'page', available: true, params: {} } },
    entryPageName: 'home',
    adapter: {
      /** 其余动作不参与独立入口返回。 */
      async navigateTo() {},
      /** 其余动作不参与独立入口返回。 */
      async switchTab() {},
      /** 保留真实未完成状态以验证按钮互斥。 */
      reLaunch: () => new Promise((resolve, reject) => { pending.push({ resolve, reject }) }),
    },
  })
  installComponents(app, { getEntryRouteUrl: router.getEntryRouteUrl, navigateToUrl: router.navigateToUrl })
  const events = []
  const header = {
    data: { autoBack: true, homeUrl: '', navigating: false },
    /** 模拟原生数据写入。 */
    setData(patch) { Object.assign(this.data, patch) },
    /** 记录页头向页面派发的结果。 */
    triggerEvent(name, detail) { events.push({ name, detail }) },
  }
  definition.methods.onBack.call(header)
  definition.methods.onBack.call(header)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(header.data.navigating, true)
  assert.equal(pending.length, 1)
  pending[0].reject({ errMsg: '平台拒绝返回' })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(header.data.navigating, false)
  assert.equal(errors.length, 1)
  assert.equal(events.at(-1).name, 'navigationerror')
  assert.equal(events.at(-1).detail.errMsg, '平台拒绝返回')
  definition.methods.onBack.call(header)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(pending.length, 2)
  pending[1].resolve()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(header.data.navigating, true)
  assert.equal(errors.length, 1)
})
