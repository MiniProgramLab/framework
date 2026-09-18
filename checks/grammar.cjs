/** 使用本机 VS Code 自带的 TextMate 引擎验证交付语法。 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

/** 显式传入 VS Code app 目录，避免下载另一份语法运行时。 */
async function main() {
  const app = process.argv[2]
  if (!app) throw new Error('请传入 VS Code 的 Contents/Resources/app 目录')
  const textmate = require(path.join(app, 'node_modules/vscode-textmate'))
  const oniguruma = require(path.join(app, 'node_modules/vscode-oniguruma'))
  const binary = fs.readFileSync(path.join(app, 'node_modules/vscode-oniguruma/release/onig.wasm'))
  await oniguruma.loadWASM(binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength))
  const registry = new textmate.Registry({
    onigLib: Promise.resolve({ createOnigScanner: (sources) => new oniguruma.OnigScanner(sources), createOnigString: (text) => new oniguruma.OnigString(text) }),
    /** 优先加载交付语法，表达式沿用编辑器内置 JavaScript 语法。 */
    loadGrammar: async (scope) => {
      const filename = scope === 'text.html.wxml'
        ? path.resolve(__dirname, '../vscode/syntaxes/wxml.tmLanguage.json')
        : scope === 'source.js' ? path.join(app, 'extensions/javascript/syntaxes/JavaScript.tmLanguage.json') : undefined
      return filename && fs.existsSync(filename) ? textmate.parseRawGrammar(fs.readFileSync(filename, 'utf8'), filename) : null
    },
  })
  const grammar = await registry.loadGrammar('text.html.wxml')
  const text = '<view class="panel" wx:if="{{visible > 0}}">{{title}}</view>'
  const tokens = grammar.tokenizeLine(text).tokens
  /** 检查关键位置的 TextMate 范围，覆盖引号内和文本中的插值。 */
  function scope(needle, expected) {
    const offset = text.indexOf(needle)
    const token = tokens.find((item) => offset >= item.startIndex && offset < item.endIndex)
    assert.ok(token?.scopes.some((name) => name === expected || name.startsWith(expected + '.')), needle + ' 缺少 ' + expected)
  }
  scope('view', 'entity.name.tag.wxml')
  scope('class', 'entity.other.attribute-name.wxml')
  scope('panel', 'string.quoted.double.wxml')
  scope('visible', 'meta.embedded.expression.wxml')
  scope('title', 'meta.embedded.expression.wxml')
  console.log('TextMate 语法高亮检查通过')
  registry.dispose()
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
