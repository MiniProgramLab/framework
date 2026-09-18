/** 构建文件操作共用工具，所有输出限定在调用方给定目录。 */
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** 文件不存在返回 false，权限及其他错误继续抛出。 */
export async function exists(filename) {
  try {
    await access(filename)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

/** 递归列举文件，排除依赖目录与平台私有配置。 */
export async function listFiles(directory) {
  const files = []
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
export async function writeJson(filename, value) {
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
export function posixPath(filename) {
  return filename.split(path.sep).join('/')
}
