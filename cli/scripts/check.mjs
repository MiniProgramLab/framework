/** 逐个检查发布脚本的语法，不生成与仓库相关的构建路径。 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { listFiles } from '../src/files.mjs'

/** 开发检查覆盖 CLI 的源码及可执行入口。 */
const root = fileURLToPath(new URL('../', import.meta.url))
for (const filename of await listFiles(root)) {
  if (!filename.endsWith('.mjs')) continue
  const result = spawnSync(process.execPath, ['--check', filename], { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status || 1)
}
console.log('CLI 开发语法检查通过')
