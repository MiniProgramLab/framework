// SPDX-License-Identifier: Apache-2.0
/** CLI 自行管理源码工作区的编译缓存，消费项目无需编排 TypeScript 构建。 */
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { BuildProgress, errorCode, errorMessage, logger } from '../src/logger.js'

/** 成功编译时记录输入指纹和完整产物清单。 */
interface BuildCache {
  fingerprint: string
  outputs: string[]
}

/** 稳定列举目录中的文件，用于检测新增、修改、删除和产物缺失。 */
async function files(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map((entry) => {
    const filename = path.join(directory, entry.name)
    return entry.isDirectory() ? files(filename) : [filename]
  }))
  return nested.flat().sort()
}

/** 文件内容而非修改时间决定是否重编译，避免切换分支后使用旧产物。 */
async function fingerprint(root: string) {
  const sources = (await Promise.all(['src', 'bin', 'scripts'].map((directory) => files(path.join(root, directory))))).flat()
  sources.push(path.join(root, 'package.json'), path.join(root, 'tsconfig.json'))
  sources.push(createRequire(path.join(root, 'package.json')).resolve('typescript/package.json'))
  const hash = createHash('sha256')
  hash.update(process.versions.node)
  for (const filename of sources.sort()) {
    hash.update(path.relative(root, filename)).update('\0').update(await readFile(filename)).update('\0')
  }
  return hash.digest('hex')
}

/** 缓存只有在输入一致、每个输出文件仍存在时才可复用。 */
async function current(root: string, input: string) {
  try {
    const cache: BuildCache = JSON.parse(await readFile(path.join(root, 'dist/.build-cache.json'), 'utf8'))
    if (cache.fingerprint !== input || !Array.isArray(cache.outputs) || !cache.outputs.length || cache.outputs.some((filename) => typeof filename !== 'string')) return false
    return (await Promise.all(cache.outputs.map(async (filename) => (await stat(path.join(root, 'dist', filename))).isFile()))).every(Boolean)
  } catch (error) {
    if (errorCode(error) === 'ENOENT' || error instanceof SyntaxError) return false
    throw error
  }
}

/** 串行化并行启动的准备工作；进程退出后遗留的锁可在下一次启动恢复。 */
async function lock(root: string) {
  const filename = path.join(root, '.cache/prepare.lock')
  await mkdir(path.dirname(filename), { recursive: true })
  const deadline = Date.now() + 120_000
  let reported = false
  while (true) {
    try {
      const handle = await open(filename, 'wx')
      await handle.writeFile(String(process.pid))
      await handle.close()
      return async () => { await rm(filename, { force: true }) }
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error
    }
    try {
      const owner = Number(await readFile(filename, 'utf8'))
      if (owner > 0) {
        try { process.kill(owner, 0) }
        catch (error) {
          if (errorCode(error) === 'ESRCH') { await rm(filename, { force: true }); continue }
          if (errorCode(error) !== 'EPERM') throw error
        }
      } else if (Date.now() - (await stat(filename)).mtimeMs > 5000) {
        await rm(filename, { force: true })
        continue
      }
    } catch (error) { if (errorCode(error) !== 'ENOENT') throw error }
    if (Date.now() > deadline) throw new Error('等待 CLI 编译超时，请检查其他正在运行的 framework 编译进程')
    if (!reported) { logger.info('正在等待其他进程完成本地 CLI 准备…'); reported = true }
    await setTimeout(80)
  }
}

/** 调用框架自己的编译器，转发终止信号并保留完整类型诊断。 */
async function compile(root: string) {
  const resolver = createRequire(path.join(root, 'package.json'))
  const compiler = resolver.resolve('typescript/bin/tsc')
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [compiler, '-p', path.join(root, 'tsconfig.json')], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let diagnostics = ''
    child.stdout.on('data', (chunk: Buffer) => { diagnostics += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { diagnostics += chunk.toString() })
    /** 等待编译器终止后才释放锁，避免下一次启动与旧编译并发写入。 */
    const interrupt = () => child.kill('SIGINT')
    const terminate = () => child.kill('SIGTERM')
    process.once('SIGINT', interrupt)
    process.once('SIGTERM', terminate)
    child.once('error', reject)
    child.once('close', (code, signal) => {
      process.removeListener('SIGINT', interrupt)
      process.removeListener('SIGTERM', terminate)
      if (diagnostics.trim()) logger.error(diagnostics.trimEnd())
      if (code === 0) resolve()
      else reject(new Error(signal ? '本地 CLI 编译已终止：' + signal : '本地 CLI 编译失败，请修复上面的 TypeScript 诊断'))
    })
  })
}

/** 仅在需要时编译；失败立即结束，不回退到过期 CLI。 */
export async function prepareCli(root: string): Promise<void> {
  const release = await lock(root)
  let progress: BuildProgress | undefined
  try {
    const input = await fingerprint(root)
    if (await current(root, input)) return
    progress = new BuildProgress('Framework CLI')
    progress.update('准备本地开发入口：首次启动、源码变化或编译产物缺失')
    // 删除成功标记，确保失败后即使恢复旧源码也会重新校验产物。
    await rm(path.join(root, 'dist/.build-cache.json'), { force: true })
    await compile(root)
    if (await fingerprint(root) !== input) throw new Error('编译期间 CLI 源码发生变化，请重新运行命令')
    const outputs = (await files(path.join(root, 'dist'))).map((filename) => path.relative(path.join(root, 'dist'), filename))
    await writeFile(path.join(root, 'dist/.build-cache.json'), JSON.stringify({ fingerprint: input, outputs } satisfies BuildCache))
    progress.complete('本地 CLI 已更新，继续执行应用命令')
  } catch (error) {
    progress?.fail()
    logger.error(errorMessage(error))
    // 预加载入口必须阻止后续应用或测试加载旧产物。
    process.exitCode = 1
    throw new Error('Framework CLI 准备失败', { cause: error })
  } finally {
    progress?.stop()
    await release()
  }
}
