// SPDX-License-Identifier: Apache-2.0
/** 使用本机 VS Code 自带的 TextMate 引擎验证交付语法。 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

/** 显式传入 VS Code app 目录，避免下载另一份语法运行时。 */
async function main() {
  const app = process.argv[2]
  if (!app) throw new Error('请传入 VS Code 的 Contents/Resources/app 目录')
  // 新版编辑器将语法引擎放在归档中，使用编辑器的 Node 模式可直接读取。
  const modules = path.join(app, fs.existsSync(path.join(app, 'node_modules/vscode-textmate')) ? 'node_modules' : 'node_modules.asar')
  const textmate = require(path.join(modules, 'vscode-textmate'))
  const oniguruma = require(path.join(modules, 'vscode-oniguruma'))
  const binary = fs.readFileSync(path.join(modules, 'vscode-oniguruma/release/onig.wasm'))
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
  /** 使用实际扩展声明分配语言编号，验证括号配色依赖的令牌元数据。 */
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../vscode/package.json'), 'utf8'))
  const contribution = manifest.contributes.grammars.find((item) => item.language === 'wxml')
  const languages = { wxml: 1, javascript: 2 }
  const grammar = await registry.loadGrammarWithConfiguration('text.html.wxml', languages.wxml, {
    embeddedLanguages: Object.fromEntries(Object.entries(contribution.embeddedLanguages).map(([scope, language]) => [scope, languages[language]])),
    balancedBracketSelectors: ['*'],
  })
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
  /** 多行属性、连续插值与嵌套对象都必须保留完整的 WXML 双括号边界。 */
  const cases = [
    { text: '<view style="{{\n fixed\n ? \'position: fixed; left: 0;\'\n : \'position: static;\'\n}} z-index: {{ zIndex }}; top: {{ navbarHeight }}px;"/>', pairs: 3 },
    { text: "<view title='{{ label }}'>{{title}}</view>", pairs: 2 },
    { text: '<view>{{({ nested: { value: [1, 2] } }).nested.value[0]}}</view>', pairs: 1 },
    { text: '<view>{{{ value: 1 }}}</view>', pairs: 1 },
    { text: '<view>{{ flag ? "}}" : "{{" }}</view>', pairs: 1 },
  ]
  for (const example of cases) {
    let state = textmate.INITIAL
    let opened = 0
    let closed = 0
    for (const line of example.text.split('\n')) {
      const result = grammar.tokenizeLine(line, state)
      const binary = grammar.tokenizeLine2(line, state).tokens
      /** 按字符位置读取实际语言、字符串类型和配对标志。 */
      function metadataAt(offset) {
        let metadata = 0
        for (let index = 0; index < binary.length && binary[index] <= offset; index += 2) metadata = binary[index + 1]
        return metadata
      }
      for (const token of result.tokens) {
        const boundary = token.scopes.find((name) => /^punctuation\.section\.embedded\.(begin|end)\.wxml$/.test(name))
        const metadata = metadataAt(token.startIndex)
        if (boundary) {
          const opening = boundary.includes('.begin.')
          assert.equal(line.slice(token.startIndex, token.endIndex), opening ? '{{' : '}}')
          // 边界必须采用 WXML 的双括号配置，不能拆成两层 JavaScript 单括号。
          assert.equal(metadata & 0xff, languages.wxml, boundary + ' 错误地归入嵌入语言')
          assert.equal((metadata >>> 8) & 3, 0, boundary + ' 不应继承外层属性的字符串类型')
          assert.ok(metadata & 0x400, boundary + ' 必须参与括号配对')
          opening ? opened++ : closed++
        } else if (token.scopes.includes('source.js.embedded.wxml')) {
          assert.equal(metadata & 0xff, languages.javascript, '内部表达式必须保留 JavaScript 高亮与括号行为')
        }
      }
      state = result.ruleStack
    }
    assert.equal(opened, example.pairs, '插值开始边界数量不符')
    assert.equal(closed, example.pairs, '插值结束边界数量不符')
  }
  console.log('TextMate 语法高亮检查通过：标签、属性、5 组双括号配对及嵌入语言边界')
  registry.dispose()
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
