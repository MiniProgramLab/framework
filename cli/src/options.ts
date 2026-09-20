// SPDX-License-Identifier: Apache-2.0
import { errorCode } from './logger.js'
import type { MiniProgramConfig, CliArguments, BuildOptions } from './types.js'
export type * from './types.js'
import path from 'node:path'
import { realpath } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { exists } from './files.js'
import { createPlatformRegistry } from './platforms.js'
export { definePlatformAdapter, createPlatformRegistry, builtinPlatforms } from './platforms.js'

/** 保留配置类型提示，不在导入配置时启动构建。 */
export function defineConfig(config: MiniProgramConfig): MiniProgramConfig { return config }

/** 读取消费项目配置并限定源码和产物目录，避免覆盖源码或项目根。 */
export async function loadOptions(values: CliArguments = {}): Promise<BuildOptions> {
  const root = path.resolve(values.root || process.cwd())
  const filename = path.resolve(root, values.config || 'miniprogram.config.mjs')
  if (values.config && !(await exists(filename))) throw new Error('构建配置不存在：' + filename)
  const baseConfig = (await exists(filename)) ? (await import(pathToFileURL(filename).href)).default : {}
  if (!baseConfig || typeof baseConfig !== 'object' || Array.isArray(baseConfig)) throw new Error('构建配置必须默认导出对象')
  const adapter = createPlatformRegistry(baseConfig.platformAdapters).resolve(values.platform || process.env.MINIPROGRAM_PLATFORM || baseConfig.platform || 'wechat')
  const overrides = baseConfig.platforms?.[adapter.id] ?? {}
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw new Error('平台配置必须是对象：' + adapter.id)
  const config = { ...baseConfig, ...overrides }
  const source = path.resolve(root, values.src || config.source || 'src')
  const output = path.resolve(root, values['out-dir'] || config.outDir || (adapter.id === 'wechat' ? 'dist' : 'dist-' + adapter.id))
  if (output === root || !output.startsWith(root + path.sep) ||
      output === source || output.startsWith(source + path.sep) || source.startsWith(output + path.sep))
    throw new Error('产物必须位于项目内独立目录，不能覆盖或包含源码')
  if (path.relative(root, output).split(path.sep).some((part) => ['.git', '.cache', 'node_modules', '.codex', '.agents'].includes(part)))
    throw new Error('产物不能使用依赖、版本管理或工具缓存目录')
  const [actualRoot, actualSource, actualOutput] = await Promise.all([physicalPath(root), physicalPath(source), physicalPath(output)])
  if (actualOutput === actualRoot || !actualOutput.startsWith(actualRoot + path.sep) ||
      actualOutput === actualSource || actualOutput.startsWith(actualSource + path.sep) || actualSource.startsWith(actualOutput + path.sep))
    throw new Error('产物符号链接不能越过项目边界或指向源码')
  return {
    ...config, root, source, output, platform: adapter.id, adapter,
    mode: values.mode || process.env.MINIPROGRAM_MODE || process.env[adapter.envPrefix + '_MODE'] || (values.watch ? 'development' : 'production'),
    watch: values.watch ?? false,
    typecheck: values.typecheck ?? false,
    poll: values.poll ?? config.poll ?? false,
    configFile: filename,
  }
}

/** 对尚未创建的路径解析最近已有父目录，避免符号链接绕过输出隔离。 */
async function physicalPath(filename: string): Promise<string> {
  try { return await realpath(filename) }
  catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error
    const parent = path.dirname(filename)
    if (parent === filename) throw error
    return path.join(await physicalPath(parent), path.basename(filename))
  }
}
