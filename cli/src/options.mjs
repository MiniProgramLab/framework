import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { exists } from './files.mjs'

/** 保留配置类型提示，不在导入配置时启动构建。 */
export function defineConfig(config) { return config }

/** 读取消费项目配置并限定源码和产物目录，避免覆盖源码或项目根。 */
export async function loadOptions(values = {}) {
  const root = path.resolve(values.root || process.cwd())
  const filename = path.resolve(root, values.config || 'skyline.config.mjs')
  if (values.config && !(await exists(filename))) throw new Error('构建配置不存在：' + filename)
  const config = (await exists(filename)) ? (await import(pathToFileURL(filename).href)).default : {}
  if (!config || typeof config !== 'object') throw new Error('构建配置必须默认导出对象')
  const source = path.resolve(root, values.src || config.source || 'src')
  const output = path.resolve(root, values['out-dir'] || config.outDir || 'dist')
  if (output === root || !output.startsWith(root + path.sep) ||
      output === source || output.startsWith(source + path.sep) || source.startsWith(output + path.sep))
    throw new Error('产物必须位于项目内独立目录，不能覆盖或包含源码')
  return {
    ...config, root, source, output,
    mode: values.mode || process.env.WX_MODE || (values.watch ? 'development' : 'production'),
    watch: values.watch ?? false,
    typecheck: values.typecheck ?? false,
    poll: values.poll ?? config.poll ?? false,
    configFile: filename,
  }
}
