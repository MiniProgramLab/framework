// SPDX-License-Identifier: Apache-2.0
import { errorCode } from './logger.js'
/** 构建文件操作共用工具，所有输出限定在调用方给定目录。 */
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** 文件不存在返回 false，权限及其他错误继续抛出。 */
export async function exists(filename: string) {
  try {
    await access(filename)
    return true
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false
    throw error
  }
}

/** 递归列举文件，排除依赖目录与平台私有配置。 */
export async function listFiles(directory: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      entry.name === 'node_modules' ||
      entry.name === 'project.private.config.json'
    )
      continue
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await listFiles(filename)))
    else if (entry.isFile()) files.push(filename)
  }
  return files
}

/** 保持 JSON 稳定缩进，已有内容相同时不触发额外文件变更。 */
export async function writeJson(filename: string, value: unknown) {
  const content = JSON.stringify(value, null, 2) + '\n'
  if (
    (await exists(filename)) &&
    (await readFile(filename, 'utf8')) === content
  )
    return
  await mkdir(path.dirname(filename), { recursive: true })
  await writeFile(filename, content)
}

/** 将平台路径转换为微信配置使用的正斜杠相对路径。 */
export function posixPath(filename: string) {
  return filename.split(path.sep).join('/')
}

/** 原生入口支持 TS 或 JS，同名双入口会造成覆盖，因此直接报错。 */
export async function scriptEntry(base: string) {
  const matches: string[] = []
  for (const suffix of ['.ts', '.js']) if (await exists(base + suffix)) matches.push(base + suffix)
  if (matches.length !== 1) throw new Error('原生入口必须且只能包含一个 TS 或 JS 脚本：' + base)
  return matches[0]
}
