/** 打包扩展和 TypeScript 解析器，VSIX 安装后不依赖项目 node_modules。 */
import { build, context } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

/** 随运行时捆绑的 TypeScript 一并交付原始许可证及第三方声明。 */
const dependency = path.dirname(fileURLToPath(import.meta.resolve('typescript/package.json')))
const licenses = fileURLToPath(new URL('../licenses/', import.meta.url))
await mkdir(licenses, { recursive: true })
for (const name of ['LICENSE.txt', 'ThirdPartyNoticeText.txt'])
  await copyFile(path.join(dependency, name), path.join(licenses, 'typescript-' + name))

/** VS Code API 由扩展宿主提供，其余运行依赖全部内联。 */
const options = {
  absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
  entryPoints: ['src/extension.ts'], outfile: 'dist/extension.cjs',
  bundle: true, platform: 'node', format: 'cjs', target: 'node20',
  external: ['vscode'], sourcemap: false, minify: true, logLevel: 'info',
}
if (process.argv.includes('--watch')) {
  const compiler = await context(options)
  await compiler.watch()
} else await build(options)
