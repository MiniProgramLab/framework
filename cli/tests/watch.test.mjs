// SPDX-License-Identifier: Apache-2.0
/** 验证两种监听机制均提供真实变更路径，供开发日志说明重编译原因。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { watchDirectories } from '../dist/src/watch.js'

for (const poll of [false, true]) {
  test((poll ? '轮询' : '系统监听') + '报告新增、修改和删除的文件路径', async (context) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'miniprogram-watch-'))
    context.after(() => rm(root, { recursive: true, force: true }))
    const events = []
    const watcher = await watchDirectories([{ directory: root, recursive: false }], (filenames) => events.push(...filenames), { poll })
    context.after(() => watcher.close())
    const filename = path.join(root, 'source.ts')
    /** 每次修改前清空事件，确认收到本次操作产生的完整路径。 */
    async function changed(action) {
      events.length = 0
      await action()
      const deadline = Date.now() + 5000
      while (!events.includes(filename)) {
        assert.ok(Date.now() < deadline, '未收到文件变更：' + filename)
        await new Promise((resolve) => setTimeout(resolve, 30))
      }
    }
    await changed(() => writeFile(filename, 'export const count = 1'))
    await changed(() => writeFile(filename, 'export const count = 200'))
    await changed(() => rm(filename))
    watcher.close()
    events.length = 0
    await writeFile(filename, '监听已停止')
    await new Promise((resolve) => setTimeout(resolve, 350))
    assert.deepEqual(events, [])
  })
}
