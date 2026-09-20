// SPDX-License-Identifier: Apache-2.0
/** 验证分组配置的环境筛选、配置隔离和失败诊断。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizePageOptions } from '../dist/src/page-options.js'

/** 以明确的构建维度归一化配置，不读取或修改应用产物。 */
function normalize(config, mode = 'development') {
  return normalizePageOptions(config, '/pages/example/config.ts', mode)
}

test('最小页面、Tab 默认标识和参数规则形成稳定路由契约', () => {
  const plain = normalize({ page: { name: 'home' } })
  assert.deepEqual({ name: plain.name, kind: plain.kind, available: plain.available, config: plain.config }, { name: 'home', kind: 'page', available: true, config: {} })
  const tab = normalize({ page: { name: 'mine', tabBar: { text: '我的', order: 1, iconPath: '/mine.png' } } })
  assert.equal(plain.description, 'home')
  assert.equal(normalize({ page: { name: 'home', description: '首页' } }).description, '首页')
  assert.equal(tab.kind, 'tab')
  assert.equal(tab.tab.id, 'mine')
  assert.deepEqual(normalize({ page: { name: 'detail', params: { id: { type: 'string', required: true } } } }).params, { id: { type: 'string', required: true } })
})

test('环境范围控制启用状态，页面不声明目标平台', () => {
  const config = { page: { name: 'demo' }, build: { modes: ['development', 'staging'] } }
  assert.equal(normalize(config).available, true)
  assert.equal(normalize(config, 'staging').available, true)
  assert.equal(normalize(config, 'production').available, false)
  assert.equal(normalize({ page: { name: 'home' } }, 'production').available, true)
})

test('原生配置保持字段和值，路由与构建元数据不会透传', () => {
  const config = {
    page: { name: 'home' }, build: { modes: ['development'] },
    config: { usingComponents: { card: '/card' }, nested: { list: [1, 2] } },
  }
  const before = JSON.stringify(config)
  const result = normalize(config)
  assert.deepEqual(result.config, config.config)
  assert.equal(JSON.stringify(config), before)
  for (const field of ['route', 'build', 'platforms']) assert.equal(field in result.config, false)
})

test('旧字段、分组拼写、互斥配置及不可序列化值给出字段级错误', () => {
  for (const [config, expected] of [
    [{ page: { name: 'home', description: '' } }, /page.description/],
    [{ pagesName: 'home' }, /迁移到 page.name/],
    [{ page: { name: 'home' }, navigationBarTitleText: '首页' }, /原生字段请放入 config/],
    [{ page: { name: 'home', kind: 'tab' } }, /page 不支持字段 kind/],
    [{ page: { name: 'home' }, build: { environments: [] } }, /build 不支持字段 environments/],
    [{ page: { name: 'home' }, build: { modes: [] } }, /build.modes/],
    [{ page: { name: 'home' }, build: { platforms: ['wx'] } }, /build 不支持字段 platforms/],
    [{ page: { name: 'home', params: null } }, /page.params 必须为对象/],
    [{ page: { name: 'home', params: {}, tabBar: {} } }, /Tab 路由不能声明 page.params/],
    [{ page: { name: 'home' }, config: null }, /config 必须为对象/],
    [{ page: { name: 'home' }, config: { route: {} } }, /框架字段/],
    [{ page: { name: 'home' }, config: { component: true } }, /页面不能配置/],
    [{ page: { name: 'home' }, config: { usingComponents: { card: 1 } } }, /usingComponents/],
    [{ page: { name: 'home' }, config: { title: () => '动态' } }, /config.title.*JSON/],
    [{ page: { name: 'home' }, platforms: { alipay: { page: { name: 'other' } } } }, /不支持字段 platforms/],
  ]) assert.throws(() => normalize(config), expected)
})


test('路由名称必须能直接写为无引号枚举成员', () => {
  for (const name of ['home-page', '1home', '首页', 'home page', 'home.name', 'home"'])
    assert.throws(() => normalize({ page: { name } }), /PageEnum 成员/)
  assert.equal(normalize({ page: { name: 'homePage_2' } }).name, 'homePage_2')
})
