// SPDX-License-Identifier: Apache-2.0
/** 无编译依赖的预加载入口，将本地准备工作交给 TypeScript 实现。 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** 发布包不携带开发准备源码，直接使用随包分发的产物。 */
const source = new URL('../scripts/prepare.ts', import.meta.url)
if (existsSync(source)) {
  try {
    const { build } = await import('esbuild')
    const result = await build({
      entryPoints: [fileURLToPath(source)], bundle: true, write: false,
      platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent',
    })
    const { prepareCli } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].contents).toString('base64'))
    await prepareCli(fileURLToPath(new URL('../', import.meta.url)))
  } catch (error) {
    // 自举模块尚未加载时也保留诊断，不打印包含整段源码的数据 URL 堆栈。
    if (!process.exitCode) console.error('[ERROR] Framework CLI 准备失败：' + (error instanceof Error ? error.message : String(error)))
    process.exit(1)
  }
}
