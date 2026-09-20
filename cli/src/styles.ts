// SPDX-License-Identifier: Apache-2.0
import { logger } from './logger.js'
import { compileAsync, NodePackageImporter } from 'sass'
import less from 'less'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

/** 编译消费项目及组件包的样式，保留 Sass 包解析与 Less 多层导入。 */
export async function compileStyle(filename: string, { root, source, production }: { root: string; source: string; production?: boolean }) {
  if (!/\.(scss|less)$/.test(filename)) return readFile(filename, 'utf8')
  if (filename.endsWith('.less')) {
    const result = await less.render(await readFile(filename, 'utf8'), {
      filename, paths: [path.dirname(filename), source, path.join(root, 'node_modules')],
      compress: production, javascriptEnabled: false,
    })
    return result.css
  }
  const result = await compileAsync(filename, {
    style: production ? 'compressed' : 'expanded',
    logger: {
      /** Sass 诊断沿用 CLI 的日志分级和颜色。 */
      warn(message) { logger.warn('Sass：' + message) },
      /** 显式调试输出使用普通信息颜色。 */
      debug(message) { logger.info('Sass：' + message) },
    },
    loadPaths: [source, path.join(root, 'node_modules')],
    importers: [new NodePackageImporter(root)],
  })
  return result.css
}
