// SPDX-License-Identifier: Apache-2.0
/** 构建与组件回归共用的隔离文件和微信 CommonJS 加载工具。 */
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createContext, Script } from 'node:vm'

/** 创建自动清理的临时目录，避免回归用例修改真实源码及产物。 */
export async function temporaryDirectory(context) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'miniprogramlab-check-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

/** 写入相对目录下的文件集合。 */
export async function writeFixture(directory, files) {
  for (const [relative, content] of Object.entries(files)) {
    const filename = path.join(directory, relative)
    await mkdir(path.dirname(filename), { recursive: true })
    await writeFile(filename, content)
  }
}

/** 按微信的相对 require 与模块缓存执行真实产物，不借用 Node 的包解析。 */
export function createModuleLoader(directory, globals = {}) {
  const cache = new Map()
  const context = createContext({
    console,
    setTimeout,
    clearTimeout,
    ...globals,
  })
  /** 同一路径只执行一次，循环依赖读取已建立的 exports。 */
  function load(relative) {
    const filename = path.resolve(directory, relative)
    if (!filename.startsWith(directory + path.sep))
      throw new Error('模块引用超出产物目录：' + relative)
    if (cache.has(filename)) return cache.get(filename).exports
    const module = { exports: {} }
    cache.set(filename, module)
    /** 禁止产物依赖裸包名，所有依赖必须已经输出到小程序目录。 */
    const require = (reference) => {
      if (!reference.startsWith('.'))
        throw new Error('产物包含未处理的依赖：' + reference)
      return load(
        path.relative(
          directory,
          path.resolve(path.dirname(filename), reference),
        ),
      )
    }
    const code = readFileSync(filename, 'utf8')
    new Script('(function(require, module, exports) {\n' + code + '\n})', {
      filename,
    }).runInContext(context)(require, module, module.exports)
    return module.exports
  }
  return { load, context, cache }
}
