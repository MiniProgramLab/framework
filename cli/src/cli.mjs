import { parseArgs } from 'node:util'
import { loadOptions } from './options.mjs'
import { buildProject } from './build.mjs'
import { prepareRoutes } from './routes.mjs'

/** 解析命令并统一报告错误，允许业务脚本复用 CLI。 */
export async function run(args = process.argv.slice(2)) {
  try {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
      root: { type: 'string' }, config: { type: 'string' }, src: { type: 'string' },
      'out-dir': { type: 'string' }, mode: { type: 'string' },
      watch: { type: 'boolean' }, typecheck: { type: 'boolean' },
      poll: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
    } })
    if (values.help) {
      console.log('skyline <dev|build|routes> [--root 路径] [--mode 环境] [--typecheck]\n' +
        '  dev     以开发环境构建并监听源码与依赖\n' +
        '  build   单次构建；使用 --mode=development 进行开发验证\n' +
        '  routes  仅生成路由类型\n' +
        '  --config 配置路径  --src 源码目录  --out-dir 产物目录  --watch 开启监听  --poll 使用轮询')
      return
    }
    if (values.version) { console.log('0.1.0'); return }
    const command = positionals[0] || 'build'
    if (positionals.length > 1 || !['dev', 'build', 'routes'].includes(command))
      throw new Error('未知命令，请使用 skyline --help 查看用法')
    if (command === 'dev') values.watch = true
    if (command === 'routes') values.mode ??= 'development'
    const options = await loadOptions(values)
    if (command === 'routes') await prepareRoutes(options)
    else await buildProject(options)
  } catch (error) {
    console.error('Skyline 构建失败：', error.stack || error.message)
    process.exitCode = 1
  }
}
