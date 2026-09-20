// SPDX-License-Identifier: Apache-2.0
/** 将三个 npm 包和编辑器 VSIX 写入统一交付目录，不执行远程发布。 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** 发布包使用消费端可解析的版本，不依赖 workspace 链接。 */
const artifacts = fileURLToPath(new URL('./artifacts/', import.meta.url))
const pnpm = process.env.npm_execpath
if (!pnpm) throw new Error('请通过 pnpm pack:framework 执行')
mkdirSync(artifacts, { recursive: true })
for (const name of ['@miniprogramlab/core', '@miniprogramlab/ui', '@miniprogramlab/cli']) {
  const result = spawnSync(process.execPath, [pnpm, '--filter', name, 'pack', '--pack-destination', artifacts], { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}
/** VSIX 文件名和筛选条件直接使用扩展元数据，避免包名再次分歧。 */
const extension = JSON.parse(readFileSync(new URL('./vscode/package.json', import.meta.url), 'utf8'))
const result = spawnSync(process.execPath, [pnpm, '--filter', extension.name, 'package', '--out', artifacts + '/' + extension.name + '-' + extension.version + '.vsix'], { stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status || 0
