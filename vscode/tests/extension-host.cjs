// SPDX-License-Identifier: Apache-2.0
/** 在真实 VS Code 扩展宿主中执行已注册的定义与补全提供器。 */
const vscode = require('vscode')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')

/** 扩展测试入口由 VS Code 调用，返回前完成全部公开命令验证。 */
async function run() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'skyline-host-')))
  /** 长文件提供足够滚动空间，避免文件边界掩盖居中逻辑。 */
  const padding = '/** 滚动验证占位行。 */\n'.repeat(120)
  /** 同时覆盖原生组件配置、npm 转发入口和按需下载的跨分包组件。 */
  const files = {
    'package.json': '{"name":"host-fixture"}',
    'build.config.js': 'const path = require("node:path"); const locate = value => path.resolve(__dirname, value); module.exports = { output: { path: locate("output") }, copy: { patterns: [{ from: locate("vendor"), to: "widgets" }] } };',
    'app.json': '{"pages":["index"],"subPackages":[{"root":"async","pages":["index"]}]}',
    'base.ts': padding + 'export default Behavior({ data: { title: "名字" }, methods: { submit() {} } })\n' + padding,
    'middle.ts': 'import base from "./base"; export default Behavior({ behaviors: [base] })',
    'index.ts': 'import middle from "./middle"; Component({ behaviors: [middle] })',
    '_tokens.scss': padding + '$tone: red; @mixin panel { color: $tone; } .shared { color: red; }\n' + padding,
    '_theme.scss': '@forward "tokens";',
    'index.scss': '@use "theme" as theme; .host { color: theme.$tone; @include theme.panel; }',
    'palette.less': '@brand: blue; .paint() { color: @brand; }',
    'bridge.less': '@import "palette";',
    'other.less': '@import "bridge"; .x { color: @brand; .paint(); }',
    'index.json': JSON.stringify({ usingComponents: {
      'local-card': './components/card/index.ts', 'npm-card': '@sample/ui/card', 'async-card': '/async/components/card', 'loading-card': './components/loading',
      'build-card': '/widgets/popup',
    }, componentPlaceholder: { 'async-card': 'loading-card' } }),
    'components/card/index.ts': '/** 本地卡片声明。 */\nComponent({ properties: {\n/** 局部卡片的标题。 */\nheadingText: { type: String, value: "默认标题" }\n} })',
    'components/loading.ts': 'Component({})',
    'node_modules/@sample/ui/package.json': '{"name":"@sample/ui","miniprogram":"src"}',
    'node_modules/@sample/ui/src/card/index.js': 'module.exports = require("./middle");',
    'node_modules/@sample/ui/src/card/middle.js': 'require("./implementation");',
    'node_modules/@sample/ui/src/card/implementation.js': '/** npm 卡片声明。 */\nComponent({ properties: {\n/** npm 卡片的数量。 */\ncount: Number\n} })',
    'async/components/card.ts': '/** 分包卡片声明。 */\nComponent({ properties: {\n/** 异步订单名称。 */\norderName: String\n} })',
    'vendor/component.js': 'exports.VantComponent = void 0; function VantComponent(options) { Component(options) } exports.VantComponent = VantComponent;',
    'vendor/transition.d.ts': 'export declare function transition(show: boolean): any;',
    'vendor/transition.js': 'exports.transition = void 0; function transition(value) { return Behavior({ properties: { /** 弹层是否显示。 */ visible: Boolean } }) } exports.transition = transition;',
    'vendor/popup.js': 'var kit = require("./component"); var mixin = require("./transition");\n' + padding + '(0, kit.VantComponent)({ mixins: [(0, mixin.transition)(false)], props: { /** 构建组件的标题。 */ popupHeading: String } });\n' + padding,
    'index.wxml': '<view class="shared" bindtap="submit">{{title}}</view><local-card heading-text="{{title}}"></local-card><npm-card count="2"/><async-card order-name="订单" ></async-card><build-card popup-heading="标题" visible="{{true}}"/>',
    'loop.ts': 'Page({ data: { items: [] } })',
    'loop.wxml': '<!-- 滚动空间 -->\n'.repeat(120) + '<view wx:for="{{items}}" wx:for-item="entry">\n'
      + '<!-- 滚动空间 -->\n'.repeat(120) + '{{entry}}\n</view>\n' + '<!-- 滚动空间 -->\n'.repeat(120),
  }
  try {
    for (const [name, text] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true })
      await fs.writeFile(path.join(root, name), text)
    }
    const extension = vscode.extensions.getExtension('miniprogramlab.devtool')
    assert.ok(extension, '扩展必须被 VS Code 发现')
    await extension.activate()
    /** 通过编辑器实际执行定义提供器，接受宿主内其他合法提供器的补充结果。 */
    async function definition(file, needle, target, declaration) {
      const document = await vscode.workspace.openTextDocument(path.join(root, file))
      const position = document.positionAt(document.getText().lastIndexOf(needle) + 1)
      const definitions = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', document.uri, position)
      const found = definitions.find((item) => (item.uri || item.targetUri).fsPath === path.join(root, target))
      assert.ok(found, file + ':' + needle + ' 跳转失败')
      if (declaration) {
        const targetDocument = await vscode.workspace.openTextDocument(path.join(root, target))
        const range = found.targetSelectionRange || found.range
        assert.equal(targetDocument.getText(range), declaration)
        assert.equal(targetDocument.offsetAt(range.start), files[target].indexOf(declaration))
      }
      return found
    }
    await definition('index.wxml', 'submit', 'base.ts')
    await definition('index.wxml', 'title', 'base.ts')
    await definition('index.wxml', 'shared', '_tokens.scss')
    await definition('index.scss', '$tone', '_tokens.scss')
    await definition('index.scss', 'panel', '_tokens.scss')
    await definition('other.less', '@brand', 'palette.less')
    await definition('other.less', 'paint', 'palette.less')
    await definition('index.wxml', 'local-card', 'components/card/index.ts', 'Component')
    await definition('index.wxml', 'npm-card', 'node_modules/@sample/ui/src/card/implementation.js', 'Component')
    await definition('index.wxml', 'async-card', 'async/components/card.ts', 'Component')
    await definition('index.wxml', 'build-card', 'vendor/popup.js', 'kit.VantComponent')
    const document = await vscode.workspace.openTextDocument(path.join(root, 'index.wxml'))
    assert.equal(document.languageId, 'wxml')
    const completion = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', document.uri,
      document.positionAt(document.getText().indexOf('title') + 2))
    assert.ok(completion.items.some((item) => item.label === 'title'))
    const properties = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', document.uri,
      document.positionAt(document.getText().indexOf('<local-card ') + '<local-card '.length))
    assert.ok(properties.items.some((item) => item.label === 'heading-text'))
    /** 通过宿主实际悬浮命令检查类型、注释和安全的 Markdown 内容。 */
    for (const [attribute, type, description] of [
      ['heading-text', 'headingText: string', '局部卡片的标题。'],
      ['count', 'count: number', 'npm 卡片的数量。'],
      ['order-name', 'orderName: string', '异步订单名称。'],
      ['popup-heading', 'popupHeading: string', '构建组件的标题。'],
      ['visible', 'visible: boolean', '弹层是否显示。'],
    ]) {
      const position = document.positionAt(document.getText().indexOf(attribute) + 1)
      const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', document.uri, position)
      const hover = hovers.find((item) => item.contents.some((content) => content.value?.includes(type)))
      assert.ok(hover, attribute + ' 缺少类型说明')
      assert.ok(hover.contents.some((content) => description.split(/\s+/).every((word) => content.value?.includes(word))),
        attribute + ': ' + JSON.stringify(hover.contents.map((content) => content.value)))
      assert.equal(document.getText(hover.range), attribute)
      assert.ok(hover.contents.every((content) => !content.isTrusted))
    }

    /** 等待实际编辑器状态稳定，超时提供具体失败信息。 */
    async function waitFor(check, message) {
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        if (check()) return
        await new Promise((resolve) => setTimeout(resolve, 40))
      }
      assert.fail(typeof message === 'function' ? message() : message)
    }

    /** 执行原生定义跳转，验证新编辑器和已打开编辑器均把声明置于中部。 */
    async function centered(file, needle, target, seedVisible = false) {
      const source = await vscode.workspace.openTextDocument(path.join(root, file))
      const expected = await definition(file, needle, target)
      const line = expected.range.start.line
      if (seedVisible) {
        const targetDocument = await vscode.workspace.openTextDocument(path.join(root, target))
        const seeded = await vscode.window.showTextDocument(targetDocument)
        seeded.selection = new vscode.Selection(line - 3, 0, line - 3, 0)
        await new Promise((resolve) => setTimeout(resolve, 100))
        seeded.revealRange(new vscode.Range(line - 3, 0, line - 3, 0), vscode.TextEditorRevealType.AtTop)
        await waitFor(() => {
          const visible = seeded.visibleRanges[0]
          return visible && visible.start.line <= line && visible.end.line >= line
            && Math.abs((visible.start.line + visible.end.line) / 2 - line) > 6
        },
          () => '预置目标视口失败：' + JSON.stringify({ line, ranges: seeded.visibleRanges, selection: seeded.selection }))
      }
      const editor = await vscode.window.showTextDocument(source)
      const position = source.positionAt(source.getText().lastIndexOf(needle) + 1)
      editor.selection = new vscode.Selection(position, position)
      editor.revealRange(editor.selection, vscode.TextEditorRevealType.InCenter)
      await vscode.commands.executeCommand('editor.action.revealDefinition')
      await waitFor(() => {
        const active = vscode.window.activeTextEditor
        if (active?.document.uri.toString() !== expected.uri.toString() || active.selection.active.line !== line) return false
        const visible = active.visibleRanges[0]
        return visible && Math.abs((visible.start.line + visible.end.line) / 2 - line) <= 3
      }, () => needle + ' 未居中：' + JSON.stringify({ line, ranges: vscode.window.activeTextEditor?.visibleRanges, selection: vscode.window.activeTextEditor?.selection }))
    }

    // 普通定义查询（例如 Cmd 悬浮预览）不得自行滚动或打开目标文件。
    const origin = await vscode.window.showTextDocument(document)
    origin.selection = new vscode.Selection(0, 0, 0, 0)
    await definition('index.wxml', 'submit', 'base.ts')
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(vscode.window.activeTextEditor.document.uri.toString(), document.uri.toString())
    assert.equal(origin.selection.active.character, 0)
    await centered('index.wxml', 'title', 'base.ts')
    await centered('index.wxml', 'submit', 'base.ts', true)
    await centered('index.wxml', 'shared', '_tokens.scss', true)
    await centered('loop.wxml', 'entry', 'loop.wxml')
    await centered('index.wxml', 'build-card', 'vendor/popup.js')
    /** 可选只读工程验证由启动参数指定，不在外部工程创建或修改文件。 */
    for (const check of JSON.parse(process.env.SKYLINE_COMPONENT_CHECKS || '[]')) {
      const source = await vscode.workspace.openTextDocument(check.file)
      const offset = source.getText().indexOf(check.needle)
      assert.ok(offset >= 0, '工程验证的标签必须存在')
      const found = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', source.uri, source.positionAt(offset + 2))
      const target = found.find((item) => (item.uri || item.targetUri).fsPath === check.target)
      assert.ok(target, check.needle + ' 工程组件跳转失败')
      const declaration = await vscode.workspace.openTextDocument(check.target)
      assert.equal(declaration.getText(target.targetSelectionRange || target.range), check.declaration)
      console.log('只读工程组件验证通过：' + check.needle)
    }
    console.log('真实扩展宿主检查通过：组件/Behavior/样式定义、属性类型与注释悬浮、变量/方法/class 及同文件跳转居中，纯查询不滚动')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}
module.exports = { run }
