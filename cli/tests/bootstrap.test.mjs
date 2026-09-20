// SPDX-License-Identifier: Apache-2.0
/** 通过隔离源码副本验证 CLI 自举，不改变正在开发的框架或应用产物。 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

/** 复制真实启动器及 TypeScript 实现，只复用已安装的依赖。 */
async function fixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'miniprogram-bootstrap-'))
  const original = fileURLToPath(new URL('../', import.meta.url))
  context.after(() => rm(root, { recursive: true, force: true }))
  for (const name of ['src', 'scripts', 'bin', 'package.json', 'tsconfig.json'])
    await cp(path.join(original, name), path.join(root, name), { recursive: true })
  await symlink(path.join(original, 'node_modules'), path.join(root, 'node_modules'))
  return root
}

/** 模拟从应用目录启动 CLI，记录真实退出状态和日志。 */
function launch(root) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'bin/miniprogram.mjs'), '--version'], {
      cwd: os.tmpdir(), env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code) => resolve({ code, stdout, stderr }))
  })
}

test('首次运行自动编译，缓存命中直接启动，源码变化或产物缺失自动恢复', async (context) => {
  const root = await fixture(context)
  const first = await launch(root)
  assert.equal(first.code, 0, first.stderr)
  assert.match(first.stdout, /本地 CLI 已更新/)
  const output = path.join(root, 'dist/src/cli.js')
  const before = (await stat(output)).mtimeMs
  const cached = await launch(root)
  assert.equal(cached.code, 0, cached.stderr)
  assert.equal(cached.stdout.trim(), '0.1.0')
  assert.equal((await stat(output)).mtimeMs, before)
  const source = path.join(root, 'src/cli.ts')
  await writeFile(source, (await readFile(source, 'utf8')).replace("console.log('0.1.0')", "console.log('0.1.1')"))
  const changed = await launch(root)
  assert.equal(changed.code, 0, changed.stderr)
  assert.match(changed.stdout, /本地 CLI 已更新/)
  assert.match(changed.stdout, /0\.1\.1/)
  await rm(output)
  const recovered = await launch(root)
  assert.equal(recovered.code, 0, recovered.stderr)
  assert.match(recovered.stdout, /本地 CLI 已更新/)
  assert.match(recovered.stdout, /0\.1\.1/)
})

test('并发启动只编译一次，其他进程等待完整产物', async (context) => {
  const root = await fixture(context)
  const runs = await Promise.all([launch(root), launch(root), launch(root)])
  for (const run of runs) {
    assert.equal(run.code, 0, run.stderr)
    assert.match(run.stdout, /0\.1\.0/)
  }
  assert.equal(runs.filter((run) => run.stdout.includes('本地 CLI 已更新')).length, 1)
})

test('编译失败阻止旧 CLI 启动，修复源码后恢复且不保留失效缓存', async (context) => {
  const root = await fixture(context)
  assert.equal((await launch(root)).code, 0)
  const filename = path.join(root, 'src/cli.ts')
  const original = await readFile(filename, 'utf8')
  await writeFile(filename, original + '\nconst invalid: number = "类型错误";\n')
  const failed = await launch(root)
  assert.notEqual(failed.code, 0)
  assert.match(failed.stderr, /TS2322/)
  assert.doesNotMatch(failed.stdout, /0\.1\.0/)
  assert.doesNotMatch(failed.stderr, /data:text\/javascript/)
  await assert.rejects(stat(path.join(root, 'dist/.build-cache.json')), { code: 'ENOENT' })
  await writeFile(filename, original)
  const repaired = await launch(root)
  assert.equal(repaired.code, 0, repaired.stderr)
  assert.match(repaired.stdout, /本地 CLI 已更新/)
})

test('已退出进程遗留的准备锁不会阻塞下次启动', async (context) => {
  const root = await fixture(context)
  const pid = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
    child.once('error', reject)
    child.once('close', () => resolve(child.pid))
  })
  await mkdir(path.join(root, '.cache'))
  await writeFile(path.join(root, '.cache/prepare.lock'), String(pid))
  const run = await launch(root)
  assert.equal(run.code, 0, run.stderr)
  await assert.rejects(stat(path.join(root, '.cache/prepare.lock')), { code: 'ENOENT' })
})
