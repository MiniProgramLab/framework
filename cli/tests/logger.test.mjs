// SPDX-License-Identifier: Apache-2.0
/** 验证彩色分级、动画清理和非交互日志，不依赖真实用户终端。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { BuildProgress, formatLog, supportsColor } from '../dist/src/logger.js'

/** 每个用例结束后还原终端环境变量。 */
function environment(context, values) {
  for (const [key, value] of Object.entries(values)) {
    const before = process.env[key]
    context.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before })
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

test('信息、成功、警告和错误使用不同颜色，关闭颜色时保留标签', () => {
  for (const [level, color, label] of [['info', 36, 'INFO'], ['success', 32, 'SUCCESS'], ['warn', 33, 'WARN'], ['error', 31, 'ERROR']]) {
    assert.ok(formatLog(level, '构建消息', true).includes(`\u001b[${color}m`))
    assert.ok(!formatLog(level, '构建消息', false).includes('\u001b'))
    assert.ok(formatLog(level, '构建消息', false).includes('构建消息'))
    assert.equal(formatLog(level, '构建消息', false), `[${label}] 构建消息`)
  }
  assert.equal(formatLog('error', '类型错误\n具体位置', false), '[ERROR] 类型错误\n[ERROR] 具体位置')
})

test('颜色遵守终端能力、NO_COLOR 和 FORCE_COLOR', (context) => {
  environment(context, { NO_COLOR: undefined, FORCE_COLOR: undefined, TERM: 'xterm-256color' })
  assert.equal(supportsColor({ isTTY: false }), false)
  assert.equal(supportsColor({ isTTY: true }), true)
  process.env.FORCE_COLOR = '1'
  assert.equal(supportsColor({ isTTY: false }), true)
  process.env.NO_COLOR = ''
  assert.equal(supportsColor({ isTTY: true }), false)
})

test('交互终端旋转动画持续刷新，结束后不再写入', async (context) => {
  environment(context, { CI: undefined, TERM: 'xterm-256color', NO_COLOR: undefined, FORCE_COLOR: '1' })
  const chunks = []
  const progress = new BuildProgress('微信 · development', { isTTY: true, columns: 80, write: (text) => chunks.push(text) })
  context.after(() => progress.stop())
  progress.update('1/6 解析配置与路由')
  await setTimeout(190)
  progress.update('2/6 校验类型与平台能力')
  assert.ok(new Set(chunks.join('').match(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/g)).size > 1)
  assert.ok(chunks.join('').includes('\u001b[36m'))
  progress.stop()
  const stopped = chunks.length
  await setTimeout(100)
  assert.equal(chunks.length, stopped)
  assert.equal(chunks.at(-1), '\r\u001b[2K')
})

test('非交互环境完整保留阶段开始与结果，不产生光标控制字符', (context) => {
  environment(context, { FORCE_COLOR: undefined, NO_COLOR: '1' })
  const chunks = []
  const progress = new BuildProgress('支付宝 · development', { isTTY: false, write: (text) => chunks.push(text) })
  progress.update('1/6 解析配置与路由')
  progress.update('1/6 解析配置与路由')
  progress.update('2/6 校验类型与平台能力')
  progress.complete('类型检查未启用')
  progress.stop()
  assert.equal(chunks.length, 4)
  assert.match(chunks[3], /类型检查未启用/)
  assert.ok(chunks.every((line) => line.endsWith('\n') && !line.includes('\r') && !line.includes('\u001b[2K')))
})

test('交互终端、管道和 CI 保留相同信息，只有临时动画不同', (context) => {
  environment(context, { CI: undefined, TERM: 'xterm-256color', NO_COLOR: undefined, FORCE_COLOR: '1' })
  /** 仅收集永久行，模拟终端清除临时动画后的可见记录。 */
  function transcript(isTTY, ci) {
    if (ci) process.env.CI = 'true'
    else delete process.env.CI
    const chunks = []
    const progress = new BuildProgress('微信 #1', { isTTY, columns: 40, write: (text) => chunks.push(text) })
    progress.update('1/6 解析配置与路由')
    progress.complete('启用 6 个页面')
    progress.update('2/6 校验类型与平台能力')
    progress.complete('未执行 TypeScript 类型检查')
    progress.stop()
    return {
      retained: chunks.filter((line) => line.endsWith('\n')).join('').replace(/\u001b\[\d+m/g, '').replace(/\d+ ms/g, '<耗时>'),
      animated: chunks.some((line) => line.includes('\r')),
    }
  }
  const interactive = transcript(true, false)
  const piped = transcript(false, false)
  const ci = transcript(true, true)
  assert.equal(interactive.retained, piped.retained)
  assert.equal(interactive.retained, ci.retained)
  assert.equal(interactive.animated, true)
  assert.equal(piped.animated, false)
  assert.equal(ci.animated, false)
  assert.match(interactive.retained, /未执行 TypeScript 类型检查/)
})

test('失败阶段被明确标记，停止动画不会误报成功', (context) => {
  environment(context, { CI: undefined, TERM: 'xterm-256color', NO_COLOR: '1' })
  const chunks = []
  const progress = new BuildProgress('微信 #2', { isTTY: true, columns: 100, write: (text) => chunks.push(text) })
  progress.update('3/6 编译模板、样式与资源')
  progress.fail()
  progress.stop()
  const retained = chunks.filter((line) => line.endsWith('\n')).join('')
  assert.match(retained, /\[ERROR\].*3\/6.*本阶段未完成/)
  assert.doesNotMatch(retained, /\[SUCCESS\]/)
})
