import { compileAsync, NodePackageImporter } from 'sass'
import less from 'less'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

/** 编译消费项目及组件包的样式，保留 Sass 包解析与 Less 多层导入。 */
export async function compileStyle(filename, { root, source, production }) {
  if (filename.endsWith('.wxss')) return readFile(filename, 'utf8')
  if (filename.endsWith('.less')) {
    const result = await less.render(await readFile(filename, 'utf8'), {
      filename, paths: [path.dirname(filename), source, path.join(root, 'node_modules')],
      compress: production, javascriptEnabled: false,
    })
    return result.css
  }
  const result = await compileAsync(filename, {
    style: production ? 'compressed' : 'expanded',
    loadPaths: [source, path.join(root, 'node_modules')],
    importers: [new NodePackageImporter(root)],
  })
  return result.css
}
