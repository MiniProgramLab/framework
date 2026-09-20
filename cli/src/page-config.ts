// SPDX-License-Identifier: Apache-2.0
/** 按语法声明发现页面配置，并隔离编译期配置与页面运行时代码。 */
import ts from 'typescript'

/** 可参与页面配置发现的脚本，不包含类型声明文件。 */
export function isPageScript(filename: string) {
  return /\.[cm]?[jt]s$/.test(filename) && !/\.d\.[cm]?ts$/.test(filename)
}

/** 识别 Core 的全局注册函数、命名导入别名及命名空间导入，忽略局部同名函数。 */
function registrationName(expression: ts.Expression, checker: ts.TypeChecker): string | undefined {
  const target = ts.isIdentifier(expression) ? expression
    : ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) ? expression.expression : undefined
  if (!target) return undefined
  const symbol = checker.getSymbolAtLocation(target)
  if (!symbol) {
    if (ts.isIdentifier(expression)) return expression.text
    if (target.text !== 'mini' || !ts.isPropertyAccessExpression(expression)) return undefined
    const name = expression.name.text
    if (name.startsWith('define'))
      throw new Error('声明函数请直接调用 ' + name + '(...)，不要添加 mini.：' + expression.getSourceFile().fileName)
    return name
  }
  for (const declaration of symbol.declarations ?? []) {
    let name: string | undefined
    if (ts.isImportSpecifier(declaration) && ts.isIdentifier(expression)) name = (declaration.propertyName ?? declaration.name).text
    if (ts.isNamespaceImport(declaration) && ts.isPropertyAccessExpression(expression)) name = expression.name.text
    if (!name) continue
    let ancestor: ts.Node | undefined = declaration.parent
    while (ancestor && !ts.isImportDeclaration(ancestor)) ancestor = ancestor.parent
    if (ancestor && ts.isImportDeclaration(ancestor) && ts.isStringLiteral(ancestor.moduleSpecifier) &&
        ['@miniprogramlab/core', '@miniprogramlab/core/runtime'].includes(ancestor.moduleSpecifier.text)) return name
  }
  return undefined
}

/** 单个源码文件的页面声明和配置调用。 */
export function inspectPageSource(filename: string, content: string, apiNames: ReadonlySet<string> = new Set()) {
  const source = ts.createSourceFile(filename, content, ts.ScriptTarget.Latest, true)
  // 单文件绑定足以区分全局宏与局部同名函数，不加载业务依赖或生成路由。
  const host = ts.createCompilerHost({ noLib: true, noResolve: true })
  host.getSourceFile = (name) => name === filename ? source : undefined
  const checker = ts.createProgram([filename], { noLib: true, noResolve: true, allowJs: true, types: [] }, host).getTypeChecker()
  const configs: ts.CallExpression[] = []
  const registrations: ts.CallExpression[] = []
  let page = false
  let component = false
  let usesMini = false
  const usedApis = new Set<string>()
  /** 仅识别真实调用，注释、字符串及业务同名函数不参与发现。 */
  function visit(node: ts.Node) {
    if (ts.isIdentifier(node) && (node.text === 'mini' || apiNames.has(node.text))) {
      const parent = node.parent
      const propertyName = (ts.isPropertyAccessExpression(parent) || ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent)) && parent.name === node
      const symbol = ts.isShorthandPropertyAssignment(parent)
        ? checker.getShorthandAssignmentValueSymbol(parent) : checker.getSymbolAtLocation(node)
      if (!propertyName && !symbol) {
        if (node.text === 'mini') usesMini = true
        else usedApis.add(node.text)
      }
    }
    if (ts.isCallExpression(node)) {
      const name = registrationName(node.expression, checker)
      if (name === 'definePageConfig') configs.push(node)
      if (name === 'definePage') registrations.push(node)
      if (name === 'definePage' || name === 'Page') page = true
      if (name === 'defineComponent' || name === 'Component') component = true
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (usesMini) throw new Error('框架 API 请直接调用，不再提供 mini 命名空间：' + filename)
  for (const call of configs) {
    if (!ts.isExpressionStatement(call.parent) || call.parent.parent !== source ||
        call.arguments.length !== 1 || ts.isSpreadElement(call.arguments[0]!)) {
      throw new Error('definePageConfig 必须在文件顶层直接调用，并且只传入一个配置对象：' + filename)
    }
  }
  return { source, checker, configs, registrations, page, component, usedApis }
}

/** 只在已确认的自定义底栏入口注入内部参数，不改动源码中的业务对象。 */
export function injectTabPage(filename: string, content: string) {
  const { registrations } = inspectPageSource(filename, content)
  for (const call of [...registrations].reverse()) {
    if (call.arguments.length !== 1 || ts.isSpreadElement(call.arguments[0]!))
      throw new Error('definePage 只接受一个页面选项对象，底栏由 page.tabBar 自动启用：' + filename)
    const position = call.arguments[0]!.end
    content = content.slice(0, position) + ', true' + content.slice(position)
  }
  return content
}

/** 可独立保留或移除的顶层声明，变量列表和导入绑定按项处理。 */
type Declaration = ts.VariableDeclaration | ts.ImportClause | ts.ImportSpecifier | ts.NamespaceImport |
  ts.FunctionDeclaration | ts.ClassDeclaration | ts.EnumDeclaration

/** 计算配置和运行时各自真正使用的声明，保留共享常量与函数。 */
function dependencies(analysis: ReturnType<typeof inspectPageSource>) {
  const { source, checker, configs } = analysis
  const declarations = new Set<Declaration>()
  const symbols = new Map<ts.Symbol, Declaration>()
  /** 将解构名称和普通声明映射到同一可独立裁剪的单元。 */
  function bind(name: ts.BindingName | ts.Identifier | undefined, declaration: Declaration) {
    if (!name) return
    if (ts.isIdentifier(name)) {
      const symbol = checker.getSymbolAtLocation(name)
      if (symbol) symbols.set(symbol, declaration)
    } else for (const element of name.elements) {
      if (ts.isBindingElement(element)) bind(element.name, declaration)
    }
  }
  /** 登记声明及其本地符号，不把函数参数误认为顶层变量。 */
  function add(declaration: Declaration, name: ts.BindingName | ts.Identifier | undefined) {
    declarations.add(declaration)
    bind(name, declaration)
  }
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause) {
      const clause = statement.importClause
      if (clause.name) add(clause, clause.name)
      if (clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) add(clause.namedBindings, clause.namedBindings.name)
        else for (const item of clause.namedBindings.elements) add(item, item.name)
      }
    } else if (ts.isVariableStatement(statement)) {
      for (const item of statement.declarationList.declarations) add(item, item.name)
    } else if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) {
      add(statement, statement.name)
    }
  }
  /** 根据 TypeScript 符号跟踪引用，支持同名局部变量和对象简写属性。 */
  function collect(roots: readonly ts.Node[]) {
    const used = new Set<Declaration>()
    /** 声明自身的名称不会反复展开，循环引用也只访问一次。 */
    function visit(node: ts.Node) {
      if (ts.isIdentifier(node)) {
        const symbol = ts.isShorthandPropertyAssignment(node.parent)
          ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node)
        const declaration = symbol && symbols.get(symbol)
        if (declaration && !used.has(declaration)) {
          used.add(declaration)
          // 导入只保留被引用的绑定，不能因默认导入而连带保留其他命名导入。
          if (!ts.isImportClause(declaration) && !ts.isImportSpecifier(declaration) && !ts.isNamespaceImport(declaration)) visit(declaration)
        }
      }
      ts.forEachChild(node, visit)
    }
    for (const root of roots) visit(root)
    return used
  }
  const config = collect(configs)
  const statements = new Set(configs.map((call) => call.parent))
  const runtimeRoots: ts.Node[] = []
  for (const statement of source.statements) {
    if (statements.has(statement) || ts.isImportDeclaration(statement)) continue
    const exported = ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some((item) => item.kind === ts.SyntaxKind.ExportKeyword)
    if (ts.isVariableStatement(statement)) {
      runtimeRoots.push(...statement.declarationList.declarations.filter((item) => exported || !config.has(item)))
    } else if (!config.has(statement as Declaration) || exported) runtimeRoots.push(statement)
  }
  return { declarations, config, runtime: collect(runtimeRoots), statements }
}

/** 保持换行与列位置不变地去除源码片段，避免破坏后续 Source Map。 */
function erase(content: string, ranges: [number, number][], emptyStatements: number[]) {
  const characters = content.split('')
  for (const [start, end] of ranges) {
    for (let index = start; index < end; index++) {
      if (characters[index] !== '\n' && characters[index] !== '\r') characters[index] = ' '
    }
  }
  // 保留语句边界，防止后面的括号或数组表达式与前一条无分号语句连写。
  for (const start of emptyStatements) characters[start] = ';'
  return characters.join('')
}

/** 按声明集合裁剪源码，同时正确处理多变量声明和混合导入中的逗号。 */
function sliceSource(analysis: ReturnType<typeof inspectPageSource>, keep: Set<Declaration>, configOnly: boolean) {
  const { source, configs } = analysis
  const statements = new Set(configs.map((call) => call.parent))
  const ranges: [number, number][] = []
  const emptyStatements: number[] = []
  /** 删除整个节点，但保留其原始行号。 */
  function remove(node: ts.Node) {
    const start = node.getStart(source)
    ranges.push([start, node.end])
    emptyStatements.push(start)
  }
  /** 删除列表中的连续片段，每组连同一侧逗号一起移除。 */
  function prune(items: readonly Declaration[]) {
    for (let index = 0; index < items.length; index++) {
      if (keep.has(items[index]!)) continue
      const start = index
      while (index + 1 < items.length && !keep.has(items[index + 1]!)) index++
      ranges.push(index + 1 < items.length
        ? [items[start]!.getStart(source), items[index + 1]!.getStart(source)]
        : [items[start - 1]!.end, items[index]!.end])
    }
  }
  for (const statement of source.statements) {
    if (statements.has(statement)) {
      if (!configOnly) remove(statement)
    } else if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause
      if (!clause) { if (configOnly) remove(statement); continue }
      const named = clause.namedBindings
      const bindings = named ? ts.isNamedImports(named) ? [...named.elements] : [named] : []
      const hasDefault = !!clause.name && keep.has(clause)
      const hasNamed = bindings.some((item) => keep.has(item))
      if (!hasDefault && !hasNamed) remove(statement)
      else {
        if (clause.name && !hasDefault) ranges.push([clause.name.getStart(source), named!.getStart(source)])
        if (named && !hasNamed) ranges.push([clause.name!.end, named.end])
        else if (named && ts.isNamedImports(named)) prune(bindings)
      }
    } else if (ts.isVariableStatement(statement)) {
      const items = [...statement.declarationList.declarations]
      if (!items.some((item) => keep.has(item))) remove(statement)
      else prune(items)
    } else if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) {
      if (!keep.has(statement)) remove(statement)
    } else if (configOnly) remove(statement)
  }
  return erase(source.text, ranges, emptyStatements)
}

/** 只执行配置依赖；页面注册、业务初始化和路由导入不进入配置求值。 */
export function extractPageConfig(filename: string, content: string) {
  const analysis = inspectPageSource(filename, content)
  if (analysis.configs.length !== 1) throw new Error('配置必须且只能直接调用一次 definePageConfig()：' + filename)
  return sliceSource(analysis, dependencies(analysis).config, true)
}

/** 从运行时移除配置宏及其专用依赖，共享业务声明与副作用保持原样。 */
export function stripPageConfig(filename: string, content: string) {
  if (!content.includes('definePageConfig')) return content
  const analysis = inspectPageSource(filename, content)
  if (!analysis.configs.length) return content
  const { declarations, config, runtime } = dependencies(analysis)
  const keep = new Set([...declarations].filter((item) => !config.has(item) || runtime.has(item)))
  return sliceSource(analysis, keep, false)
}
