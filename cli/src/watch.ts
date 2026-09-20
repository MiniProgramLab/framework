// SPDX-License-Identifier: Apache-2.0
import { logger, errorMessage, errorCode } from './logger.js'
/** 优先使用系统文件监听，资源不足时回退为有界轮询，保持开发进程可恢复。 */
import { watch, type FSWatcher } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'

/** 一个监听根目录及其文件过滤规则。 */
export interface WatchTarget {
  /** 已存在的绝对目录。 */
  directory: string
  /** 是否递归进入子目录。 */
  recursive: boolean
  /** 按根目录相对路径过滤变更。 */
  filter?: (filename: string) => boolean
}

/** 忽略工具缓存与依赖内部目录，防止工作区输出造成自触发循环。 */
function ignored(filename: string) {
  return filename.split(path.sep).some((part) => ['node_modules', '.cache', '.git', '.pnpm-store'].includes(part))
}

/** 扫描指定范围的文件状态，目录暂时移除后仍允许下一轮恢复。 */
async function snapshot(targets: WatchTarget[]) {
  const files = new Map<string, string>()
  /** 只按目标递归级别读取，根目录配置监听不会扫描整个项目。 */
  async function collect(target: WatchTarget, directory = target.directory) {
    let entries
    try { entries = await readdir(directory, { withFileTypes: true }) }
    catch (error) { if (errorCode(error) === 'ENOENT') return; throw error }
    for (const entry of entries) {
      const filename = path.join(directory, entry.name)
      const relative = path.relative(target.directory, filename)
      if (ignored(relative)) continue
      if (entry.isDirectory()) {
        if (target.recursive) await collect(target, filename)
      } else if (entry.isFile() && (!target.filter || target.filter(relative))) {
        try {
          const info = await stat(filename)
          files.set(filename, info.mtimeMs + ':' + info.size)
        } catch (error) { if (errorCode(error) !== 'ENOENT') throw error }
      }
    }
  }
  for (const target of targets) await collect(target)
  return files
}

/** 返回统一关闭句柄，轮询不会并发扫描，也不会因监听错误丢失后续修改。 */
export async function watchDirectories(targets: WatchTarget[], onChange: (filenames: string[]) => void, { poll = false } = {}) {
  let previous = await snapshot(targets)
  const watchers: FSWatcher[] = []
  let timer: ReturnType<typeof setInterval> | undefined
  let stopped = false
  let scanning = false
  /** 系统监听异常后关闭所有原生句柄，统一切换到低频目录比较。 */
  function polling(error?: unknown) {
    if (stopped || timer) return
    for (const watcher of watchers) watcher.close()
    if (error) logger.warn('系统文件监听不可用，已切换轮询：' + errorMessage(error))
    timer = setInterval(async () => {
      if (stopped || scanning) return
      scanning = true
      try {
        const current = await snapshot(targets)
        const changed = [...new Set([...previous.keys(), ...current.keys()])]
          .filter((filename) => current.get(filename) !== previous.get(filename)).sort()
        previous = current
        if (!stopped && changed.length) onChange(changed)
      } catch (failure) {
        logger.error('文件扫描失败，等待下次重试：' + errorMessage(failure))
      } finally { scanning = false }
    }, 300)
  }
  if (poll) polling()
  else for (const target of targets) {
    try {
      const watcher = watch(target.directory, { recursive: target.recursive }, (_, filename) => {
        if (!stopped && (!filename || (!ignored(filename) && (!target.filter || target.filter(filename))))) {
          onChange([filename ? path.join(target.directory, filename) : target.directory])
        }
      })
      watchers.push(watcher)
      watcher.on('error', polling)
    } catch (error) { polling(error); break }
  }
  return {
    /** 发生系统监听回退后也返回实际生效的监听机制。 */
    get mode(): 'native' | 'poll' { return timer ? 'poll' : 'native' },
    /** 关闭轮询和系统句柄；已开始的扫描会自行结束且不再触发回调。 */
    close() {
      stopped = true
      clearInterval(timer)
      for (const watcher of watchers) watcher.close()
    },
  }
}
