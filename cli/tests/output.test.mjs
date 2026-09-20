// SPDX-License-Identifier: Apache-2.0
/** 验证构建失败隔离、提交回滚和私有配置保护，全部使用临时产物目录。 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildWithStaging } from '@miniprogramlab/cli/output'

/** 创建隔离目录和带私有配置的上一轮产物，测试结束后自动清理。 */
async function fixture(context) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'miniprogramlab-output-'))
  context.after(() => fs.rm(root, { recursive: true, force: true }))
  const output = path.join(root, 'dist')
  await writeFiles(output, {
    'app.js': '旧脚本',
    'app.json': '旧配置',
    'app.wxss': '相同样式',
    'stale.js': '失效脚本',
    'stale.js.map': '失效映射',
    'project.private.config.json': '{\r\n  "个人设置": true\r\n}\r\n',
  })
  return {
    root,
    output,
    initialize: () => fs.mkdir(output, { recursive: true }),
  }
}

/** 写入一组相对路径文件，作为旧产物或本轮生成结果。 */
async function writeFiles(directory, files) {
  for (const [relative, content] of Object.entries(files)) {
    const filename = path.join(directory, relative)
    await fs.mkdir(path.dirname(filename), { recursive: true })
    await fs.writeFile(filename, content)
  }
}

/** 读取目录中的完整文件集合及字节内容，包含私有配置和嵌套文件。 */
async function snapshot(directory) {
  const result = {}
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      for (const [relative, content] of Object.entries(
        await snapshot(filename),
      )) {
        result[path.join(entry.name, relative)] = content
      }
    } else result[entry.name] = await fs.readFile(filename)
  }
  return result
}

test('完整成功后更新产物、清理失效文件，保留私有配置和未变文件', async (context) => {
  const { root, output, initialize } = await fixture(context)
  const privateFile = path.join(output, 'project.private.config.json')
  const original = await snapshot(output)
  const privateInfo = await fs.stat(privateFile)
  const styleInfo = await fs.stat(path.join(output, 'app.wxss'))
  const rename = fs.rename
  // 每次替换前后都检查私有文件仍在原位，避免目录切换造成短暂缺失。
  context.mock.method(fs, 'rename', async (...args) => {
    assert.deepEqual(
      await fs.readFile(privateFile),
      original['project.private.config.json'],
    )
    const result = await rename(...args)
    assert.equal((await fs.stat(privateFile)).ino, privateInfo.ino)
    return result
  })
  const generated = {
    'app.js': '新脚本',
    'app.json': '新配置',
    'app.wxss': '相同样式',
    'pages/new/index.js': '新页面',
  }
  const result = await buildWithStaging(
    output,
    async (staging) => {
      await writeFiles(staging, {
        ...generated,
        'project.private.config.json': '不应覆盖',
      })
      assert.deepEqual(await snapshot(output), original)
      return 5
    },
    initialize,
  )
  assert.equal(result, 5)
  assert.deepEqual(await snapshot(output), {
    ...Object.fromEntries(
      Object.entries(generated).map(([name, content]) => [
        name,
        Buffer.from(content),
      ]),
    ),
    'project.private.config.json': original['project.private.config.json'],
  })
  const styleAfter = await fs.stat(path.join(output, 'app.wxss'))
  assert.equal(styleAfter.ino, styleInfo.ino)
  assert.equal(styleAfter.mtimeMs, styleInfo.mtimeMs)
  assert.deepEqual(await fs.readdir(path.join(root, '.cache')), [])
})

test('后续编译失败时不提交已生成的新配置和样式，也不清理旧产物', async (context) => {
  const { root, output, initialize } = await fixture(context)
  const original = await snapshot(output)
  await assert.rejects(
    buildWithStaging(
      output,
      async (staging) => {
        await writeFiles(staging, {
          'app.json': '已生成的新配置',
          'app.wxss': '已生成的新样式',
        })
        throw new Error('脚本编译失败')
      },
      initialize,
    ),
    /脚本编译失败/,
  )
  assert.deepEqual(await snapshot(output), original)
  assert.deepEqual(await fs.readdir(path.join(root, '.cache')), [])
})

test('清理阶段失败时恢复已替换、已删除的文件，并移除新增文件', async (context) => {
  const { root, output, initialize } = await fixture(context)
  const original = await snapshot(output)
  const rename = fs.rename
  context.mock.method(fs, 'rename', async (source, destination) => {
    if (source === path.join(output, 'stale.js.map'))
      throw new Error('模拟产物目录写入失败')
    return rename(source, destination)
  })
  await assert.rejects(
    buildWithStaging(
      output,
      (staging) =>
        writeFiles(staging, {
          'app.js': '新脚本',
          'app.json': '新配置',
          'app.wxss': '相同样式',
          'pages/new/index.js': '新页面',
        }),
      initialize,
    ),
    /模拟产物目录写入失败/,
  )
  assert.deepEqual(await snapshot(output), original)
  assert.equal(
    await fs.stat(path.join(output, 'pages')).catch((error) => error.code),
    'ENOENT',
  )
  assert.deepEqual(await fs.readdir(path.join(root, '.cache')), [])
})

test('回滚失败时保留可恢复的旧文件备份并给出位置', async (context) => {
  const { root, output, initialize } = await fixture(context)
  const rename = fs.rename
  context.mock.method(fs, 'rename', async (source, destination) => {
    if (source === path.join(output, 'stale.js.map'))
      throw new Error('模拟提交失败')
    if (source.endsWith(path.join('previous', 'app.js')))
      throw new Error('模拟回滚失败')
    return rename(source, destination)
  })
  await assert.rejects(
    buildWithStaging(
      output,
      (staging) =>
        writeFiles(staging, {
          'app.js': '新脚本',
          'app.json': '新配置',
          'app.wxss': '相同样式',
        }),
      initialize,
    ),
    /恢复备份保留在/,
  )
  const remaining = await fs.readdir(path.join(root, '.cache'))
  assert.equal(remaining.length, 1)
  const saved = path.join(root, '.cache', remaining[0], 'previous', 'app.js')
  assert.equal(await fs.readFile(saved, 'utf8'), '旧脚本')
})
