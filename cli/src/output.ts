// SPDX-License-Identifier: Apache-2.0
import { logger, errorMessage, errorCode } from './logger.js'
/** 将完整构建结果提交到固定产物目录，更新失败时恢复上一轮文件。 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { listFiles } from './files.js'

/** 回滚未完成时保留工作目录，便于使用备份恢复产物。 */
class OutputRollbackError extends AggregateError {
  /** 同时保留更新错误、回滚错误及备份位置。 */
  constructor(errors: unknown[], backup: string) {
    super(errors, '产物更新及回滚失败，恢复备份保留在：' + backup)
  }
}

/** 单个产物的提交和回滚记录。 */
interface OutputChange {
  /** 相对产物目录的路径。 */
  relative: string
  /** 是否存在旧版本。 */
  existed: boolean
  /** 暂存文件路径，删除操作为 null。 */
  staged: string | null
}

/** 比较实际产物清单，并在任何替换前备份全部待修改的旧文件。 */
async function prepareChanges(staging: string, output: string, backup: string) {
  const previous = new Set(
    (await listFiles(output)).map((filename) =>
      path.relative(output, filename),
    ),
  )
  const changes: OutputChange[] = []
  for (const filename of await listFiles(staging)) {
    const relative = path.relative(staging, filename)
    const destination = path.join(output, relative)
    const existed = previous.delete(relative)
    if (
      existed &&
      (await fs.readFile(filename)).equals(await fs.readFile(destination))
    )
      continue
    changes.push({ relative, existed, staged: filename })
  }
  for (const relative of previous)
    changes.push({ relative, existed: true, staged: null })
  for (const change of changes) {
    if (!change.existed) continue
    const destination = path.join(output, change.relative)
    const saved = path.join(backup, change.relative)
    const metadata = await fs.stat(destination)
    await fs.mkdir(path.dirname(saved), { recursive: true })
    await fs.copyFile(destination, saved)
    await fs.utimes(saved, metadata.atime, metadata.mtime)
  }
  return changes
}

/** 逐文件替换完整内容；私有配置被清单扫描排除，始终留在原位置。 */
async function publishOutput(staging: string, output: string, backup: string) {
  const changes = await prepareChanges(staging, output, backup)
  const applied: OutputChange[] = []
  const createdDirectories = new Set<string>()
  try {
    for (const change of changes) {
      const destination = path.join(output, change.relative)
      if (change.staged) {
        const parent = path.dirname(destination)
        const firstCreated = await fs.mkdir(parent, { recursive: true })
        // 只记录本轮新建的目录，回滚时不会删除原有目录或外部写入的文件。
        if (firstCreated) {
          for (let directory = parent; ; directory = path.dirname(directory)) {
            createdDirectories.add(directory)
            if (directory === firstCreated) break
          }
        }
        await fs.rename(change.staged, destination)
      } else {
        // 旧产物也先移动到备份，后续失败时可以恢复原文件。
        await fs.rename(destination, path.join(backup, change.relative))
      }
      applied.push(change)
    }
  } catch (error) {
    const failures: unknown[] = []
    for (const change of applied.reverse()) {
      const destination = path.join(output, change.relative)
      try {
        if (change.existed)
          await fs.rename(path.join(backup, change.relative), destination)
        else await fs.unlink(destination)
      } catch (failure) {
        failures.push(failure)
      }
    }
    for (const directory of [...createdDirectories].sort(
      (a, b) => b.length - a.length,
    )) {
      try {
        await fs.rmdir(directory)
      } catch (failure) {
        if (!['ENOENT', 'ENOTEMPTY'].includes(errorCode(failure) || ''))
          failures.push(failure)
      }
    }
    if (failures.length)
      throw new OutputRollbackError([error, ...failures], backup)
    throw error
  }
}

/** 所有编译步骤先写入独立缓存目录，完整成功后才初始化并更新正式产物。 */
export async function buildWithStaging<T>(output: string, generate: (staging: string) => Promise<T>, initialize: () => Promise<void>): Promise<T> {
  const cache = path.join(path.dirname(output), '.cache')
  await fs.mkdir(cache, { recursive: true })
  const workspace = await fs.mkdtemp(path.join(cache, 'miniprogram-build-'))
  const staging = path.join(workspace, 'next')
  let preserveWorkspace = false
  try {
    await fs.mkdir(staging)
    const result = await generate(staging)
    await initialize()
    await publishOutput(staging, output, path.join(workspace, 'previous'))
    return result
  } catch (error) {
    preserveWorkspace = error instanceof OutputRollbackError
    throw error
  } finally {
    if (!preserveWorkspace) {
      await fs
        .rm(workspace, { recursive: true, force: true })
        .catch((error) => {
          logger.warn('构建缓存清理失败：' + workspace + '，' + errorMessage(error))
        })
    }
  }
}
