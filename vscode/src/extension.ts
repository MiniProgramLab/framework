// SPDX-License-Identifier: Apache-2.0
import * as vscode from 'vscode'
import path from 'node:path'
import { Project, type SymbolLocation } from './project'
import { Language } from './language'
import { DefinitionNavigation } from './navigation'

/** 每次请求读取打开的缓冲区，未保存修改立即参与跨文件跳转。 */
function language(document: vscode.TextDocument, token: vscode.CancellationToken): Language {
  const settings = vscode.workspace.getConfiguration('skylineMiniapp', document.uri)
  const workspace = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath || path.dirname(document.uri.fsPath)
  const source = settings.get<string>('sourceRoot', '')
  const aliases = settings.get<Record<string, string | string[]>>('componentAliases', {})
  return new Language(new Project(document.uri.fsPath, {
    sourceRoot: source ? path.resolve(workspace, source) : undefined,
    styleRoots: settings.get<string[]>('styleRoots', []).map((value) => path.resolve(workspace, value)),
    componentRoots: settings.get<string[]>('componentRoots', []).map((value) => path.resolve(workspace, value)),
    componentAliases: Object.fromEntries(Object.entries(aliases).map(([key, values]) => [key,
      (Array.isArray(values) ? values : [values]).map((value) => path.resolve(workspace, value))])),
    maxFiles: settings.get<number>('maxFiles', 500),
    documents: new Map(vscode.workspace.textDocuments.filter((item) => item.uri.scheme === 'file').map((item) => [item.uri.fsPath, item.getText()])),
    cancelled: () => token.isCancellationRequested,
  }))
}

/** 将源码偏移转换为编辑器位置，目标文件保留未保存缓冲区内容。 */
async function location(symbol: SymbolLocation): Promise<vscode.Location> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(symbol.file))
  return new vscode.Location(document.uri, new vscode.Range(document.positionAt(symbol.start), document.positionAt(symbol.start + symbol.length)))
}

/** 注册语言功能；扩展只读取源码，不执行项目配置或用户脚本。 */
export function activate(context: vscode.ExtensionContext): void {
  const navigation = new DefinitionNavigation()
  context.subscriptions.push(navigation)
  const selector: vscode.DocumentSelector = [
    { language: 'wxml', scheme: 'file' }, { language: 'scss', scheme: 'file' },
    { language: 'less', scheme: 'file' }, { language: 'wxss', scheme: 'file' },
    { language: 'css', scheme: 'file' },
  ]
  context.subscriptions.push(vscode.languages.registerDefinitionProvider(selector, {
    /** 按语言将定义请求交给模板或样式解析器。 */
    async provideDefinition(document, position, token) {
      const symbols = language(document, token).definition(document.uri.fsPath, document.offsetAt(position))
      if (token.isCancellationRequested) return []
      const locations = await Promise.all(symbols.map(location))
      if (token.isCancellationRequested) return []
      navigation.remember(document, locations)
      return locations
    },
  }))
  context.subscriptions.push(vscode.languages.registerHoverProvider({ language: 'wxml', scheme: 'file' }, {
    /** 属性名显示真实声明的类型、注释和默认值，禁用注释中的命令链接。 */
    provideHover(document, position, token) {
      const hover = language(document, token).hover(document.uri.fsPath, document.offsetAt(position))
      if (!hover || token.isCancellationRequested) return undefined
      const markdown = new vscode.MarkdownString()
      markdown.isTrusted = false
      markdown.supportHtml = false
      markdown.appendCodeblock(`${hover.property.name}: ${hover.property.type ?? 'unknown'}`, 'typescript')
      if (hover.property.documentation) markdown.appendText(hover.property.documentation + '\n\n')
      if (hover.property.defaultValue !== undefined) {
        markdown.appendText('默认值：\n')
        markdown.appendCodeblock(hover.property.defaultValue, 'typescript')
      }
      markdown.appendText(`声明于 ${hover.component} · ${path.basename(hover.property.file)}`)
      const range = new vscode.Range(document.positionAt(hover.attribute.start), document.positionAt(hover.attribute.start + hover.attribute.name.length))
      return new vscode.Hover(markdown, range)
    },
  }))
  context.subscriptions.push(vscode.languages.registerCompletionItemProvider({ language: 'wxml', scheme: 'file' }, {
    /** 返回带准确替换范围的补全，避免重复插入已输入的标签或属性。 */
    provideCompletionItems(document, position, token) {
      const suggestions = language(document, token).completion(document.uri.fsPath, document.offsetAt(position))
      const kinds: Record<string, vscode.CompletionItemKind> = {
        tag: vscode.CompletionItemKind.Class, attribute: vscode.CompletionItemKind.Property,
        property: vscode.CompletionItemKind.Property, variable: vscode.CompletionItemKind.Variable,
        method: vscode.CompletionItemKind.Method, class: vscode.CompletionItemKind.Value,
      }
      return suggestions.map((suggestion) => {
        const item = new vscode.CompletionItem(suggestion.label, kinds[suggestion.kind] ?? vscode.CompletionItemKind.Text)
        item.detail = suggestion.detail
        item.insertText = suggestion.insert ? new vscode.SnippetString(suggestion.insert) : suggestion.label
        if (suggestion.start !== undefined) item.range = new vscode.Range(document.positionAt(suggestion.start), document.positionAt(suggestion.end ?? suggestion.start))
        return item
      })
    },
  }, '<', ' ', ':', '"', "'", '{', '.', '-'))
}

/** 提供器、导航事件与待执行的滚动均由订阅容器释放。 */
export function deactivate(): void {}
