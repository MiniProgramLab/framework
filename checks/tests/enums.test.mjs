// SPDX-License-Identifier: Apache-2.0
/** 仓库枚举统一使用 Enum 后缀，成员名称必须直接使用标识符。 */
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import ts from 'typescript'

/** 仅检查维护的源码，依赖、缓存、交付包和编译产物不参与约束。 */
async function sourceFiles(directory) {
  const files = []
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', '.cache', 'artifacts', 'coverage'].includes(item.name)) continue
    const filename = path.join(directory, item.name)
    if (item.isDirectory()) files.push(...await sourceFiles(filename))
    else if (item.isFile() && /\.[cm]?[jt]sx?$/.test(filename)) files.push(filename)
  }
  return files
}

test('framework 所有源码枚举遵循 Enum 命名和无引号成员规则', async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const errors = []
  for (const filename of await sourceFiles(root)) {
    const source = ts.createSourceFile(filename, await readFile(filename, 'utf8'), ts.ScriptTarget.Latest, true)
    /** AST 区分真实枚举与注释、字符串及模板示例。 */
    function visit(node) {
      if (ts.isEnumDeclaration(node)) {
        if (!node.name.text.endsWith('Enum')) errors.push(filename + '：枚举名称必须以 Enum 结尾')
        for (const member of node.members) if (!ts.isIdentifier(member.name))
          errors.push(filename + '：枚举成员名称必须是无引号标识符')
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  assert.deepEqual(errors, [])
})
