// SPDX-License-Identifier: Apache-2.0
import ts from 'typescript'
import path from 'node:path'
import { Project, type SymbolLocation } from './project'

/** 解析后的表达式携带工厂实参，避免执行用户代码。 */
interface Value { node: ts.Node; bindings: Map<string, Value> }
/** 对象成员记录名称位置及值，保留最终覆盖顺序。 */
interface Field { name: string; node: ts.PropertyName; value: Value }

/** 沿静态 import、export、对象展开与 Behavior 链追踪实际声明。 */
export class Scripts {
  /** 一个请求共享项目文件缓存，递归路径各自记录访问节点。 */
  constructor(readonly project: Project) {}

  /** 获取字面量、标识符及带引号属性的名称。 */
  name(node: ts.Node | undefined): string | undefined {
    if (!node) return undefined
    if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text
    return undefined
  }

  /** 建立不带工厂实参的表达式引用。 */
  value(node: ts.Node): Value { return { node, bindings: new Map() } }

  /** TypeScript CommonJS 输出常用 (0, module.factory) 调用，保留实际被调用表达式。 */
  private callable(expression: ts.Expression): ts.Expression {
    if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) return this.callable(expression.expression)
    if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.CommaToken) return this.callable(expression.right)
    return expression
  }

  /** 识别原生调用及框架导入别名，命名空间调用保留原始定位范围。 */
  private callName(call: ts.CallExpression): string {
    const expression = this.callable(call.expression)
    const source = call.getSourceFile()
    if (ts.isIdentifier(expression)) {
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement)) continue
        const bindings = statement.importClause?.namedBindings
        if (bindings && ts.isNamedImports(bindings)) {
          const match = bindings.elements.find((item) => item.name.text === expression.text)
          if (match) return match.propertyName?.text ?? match.name.text
        }
      }
      return expression.text
    }
    if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
      const namespace = expression.expression.text
      if (namespace === 'mini' && !this.local(source, namespace, new Set())) {
        // 声明函数仅识别独立调用，mini 成员不作为页面或组件注册入口。
        return expression.getText(source)
      }
      if (source.statements.some((statement) => ts.isImportDeclaration(statement)
        && statement.importClause?.namedBindings && ts.isNamespaceImport(statement.importClause.namedBindings)
        && statement.importClause.namedBindings.name.text === namespace)) return expression.name.text
      const local = this.local(source, namespace, new Set())
      if (local && ts.isCallExpression(local.node) && ['require', '__importDefault', '__importStar'].includes(local.node.expression.getText(source))) return expression.name.text
    }
    return expression.getText(source)
  }

  /** 沿工程自定义注册函数追踪原生 Component，避免依赖特定框架命名。 */
  private wrapsComponent(call: ts.CallExpression, seen = new Set<ts.Node>()): boolean {
    if (seen.has(call) || seen.size > 20) return false
    seen = new Set(seen).add(call)
    const callee = this.resolve(this.value(this.callable(call.expression)))?.node
    if (!callee || !(ts.isFunctionDeclaration(callee) || ts.isFunctionExpression(callee) || ts.isArrowFunction(callee)) || !callee.body) return false
    if (seen.has(callee)) return false
    seen.add(callee)
    /** 不进入未执行的嵌套函数体，防止把生命周期里的代码当作组件声明。 */
    const visit = (node: ts.Node): boolean => {
      if (ts.isFunctionLike(node)) return false
      if (ts.isCallExpression(node) && (['Component', 'defineComponent'].includes(this.callName(node)) || this.wrapsComponent(node, seen))) return true
      return ts.forEachChild(node, visit) ?? false
    }
    return visit(callee.body)
  }

  /** 查找实际执行的注册调用，排除函数体内尚未执行的工厂定义。 */
  private registrationCall(source: ts.SourceFile, componentOnly = false, runtimeOnly = false): ts.CallExpression | undefined {
    const names = componentOnly ? ['Component', 'defineComponent', 'VantComponent']
      : runtimeOnly ? ['Page', 'Component', 'definePage', 'defineComponent', 'VantComponent']
        : ['Page', 'Component', 'definePage', 'defineComponent', 'VantComponent', 'definePageConfig', 'defineAppConfig', 'defineComponentConfig']
    /** 按源码顺序扫描表达式，声明中的箭头函数不代表已注册组件。 */
    const visit = (node: ts.Node): ts.CallExpression | undefined => {
      if (ts.isFunctionLike(node)) return undefined
      if (ts.isCallExpression(node) && (names.includes(this.callName(node)) || this.wrapsComponent(node))) return node
      return ts.forEachChild(node, visit)
    }
    return visit(source)
  }

  /** 获取模块指定导出，支持默认导出、重命名导出和多层桶文件。 */
  private exported(file: string, name: string, seen: Set<string>): Value | undefined {
    const key = file + ':' + name
    if (seen.has(key)) return undefined
    seen = new Set(seen).add(key)
    const source = this.project.source(file)
    if (!source) return undefined
    let commonjs: Value | undefined
    for (const statement of source.statements) {
      if (name === 'default' && ts.isExportAssignment(statement)) return this.value(statement.expression)
      if (ts.isExportDeclaration(statement)) {
        const reference = statement.moduleSpecifier && this.name(statement.moduleSpecifier)
        const target = reference && this.project.resolveScript(reference, file)
        if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
          const match = statement.exportClause.elements.find((item) => item.name.text === name)
          if (match) return target
            ? this.exported(target, match.propertyName?.text ?? match.name.text, seen)
            : this.local(source, match.propertyName?.text ?? match.name.text, seen)
        } else if (target) {
          const result = this.exported(target, name, seen)
          if (result) return result
        }
      }
      if (ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
        if (ts.isVariableStatement(statement)) {
          const declaration = statement.declarationList.declarations.find((item) => this.name(item.name) === name)
          if (declaration?.initializer) return this.value(declaration.initializer)
        }
        if (ts.isFunctionDeclaration(statement) && (statement.name?.text === name || (name === 'default' && ts.getModifiers(statement)?.some((item) => item.kind === ts.SyntaxKind.DefaultKeyword)))) return this.value(statement)
      }
      // CommonJS 行为文件仍常见于原生小程序。
      if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression)) {
        const left = statement.expression.left.getText(source)
        if ((left === 'module.exports' && name === 'default') || left === 'exports.' + name || left === 'module.exports.' + name)
          commonjs = this.value(statement.expression.right)
      }
    }
    return commonjs
  }

  /** 查找局部绑定和导入，只沿确实使用的标识符递归。 */
  private local(source: ts.SourceFile, name: string, seen: Set<string>): Value | undefined {
    for (const statement of source.statements) {
      if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
        if (this.name(declaration.name) === name && declaration.initializer) return this.value(declaration.initializer)
        if (ts.isObjectBindingPattern(declaration.name) && declaration.initializer) {
          const binding = declaration.name.elements.find((item) => this.name(item.name) === name)
          if (binding) {
            const field = this.fields(this.value(declaration.initializer), new Set()).find((item) => item.name === this.name(binding.propertyName ?? binding.name))
            if (field) return field.value
          }
        }
      }
      if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return this.value(statement)
      if (ts.isImportDeclaration(statement) && statement.importClause) {
        const reference = this.name(statement.moduleSpecifier)
        const file = reference && this.project.resolveScript(reference, source.fileName)
        if (!file) continue
        if (statement.importClause.name?.text === name) return this.exported(file, 'default', seen)
        const bindings = statement.importClause.namedBindings
        if (bindings && ts.isNamedImports(bindings)) {
          const match = bindings.elements.find((item) => item.name.text === name)
          if (match) return this.exported(file, match.propertyName?.text ?? name, seen)
        }
      }
    }
    return undefined
  }

  /** 获取 namespace 导入或 require 对象上的指定导出。 */
  private namespace(node: ts.Expression, name: string, seen: Set<string>): Value | undefined {
    node = this.callable(node)
    const source = node.getSourceFile()
    const key = source.fileName + ':' + node.pos + ':' + name
    if (seen.has(key)) return undefined
    seen = new Set(seen).add(key)
    if (ts.isCallExpression(node) && ['__importDefault', '__importStar'].includes(node.expression.getText(source))) {
      const argument = node.arguments[0]
      return argument && this.namespace(argument, name, seen)
    }
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'require') {
      const reference = this.name(node.arguments[0])
      const file = reference && this.project.resolveScript(reference, source.fileName)
      return file ? this.exported(file, name, seen) : undefined
    }
    if (ts.isIdentifier(node)) for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement)) continue
      const binding = statement.importClause?.namedBindings
      if (binding && ts.isNamespaceImport(binding) && binding.name.text === node.text) {
        const reference = this.name(statement.moduleSpecifier)
        const file = reference && this.project.resolveScript(reference, source.fileName)
        return file ? this.exported(file, name, seen) : undefined
      }
    }
    if (ts.isIdentifier(node)) {
      const local = this.local(source, node.text, seen)
      if (local && ts.isExpression(local.node)) return this.namespace(local.node, name, seen)
    }
    return undefined
  }

  /** 归约表达式与静态工厂返回值，循环或无法确定的运行时代码不猜测。 */
  resolve(value: Value, seen = new Set<ts.Node>()): Value | undefined {
    const { node, bindings } = value
    if (seen.has(node) || seen.size > this.project.maxFiles) return undefined
    seen = new Set(seen).add(node)
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.CommaToken)
      return this.resolve({ node: node.right, bindings }, seen)
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node)) return this.resolve({ node: node.expression, bindings }, seen)
    if (ts.isIdentifier(node)) {
      const target = bindings.get(node.text) || this.local(node.getSourceFile(), node.text, new Set())
      return target ? this.resolve(target, seen) : value
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const name = ts.isPropertyAccessExpression(node) ? node.name.text : this.name(node.argumentExpression)
      if (!name) return undefined
      const exported = this.namespace(node.expression, name, new Set())
      if (exported) return this.resolve(exported, seen)
      const field = this.fields({ node: node.expression, bindings }, seen).find((item) => item.name === name)
      return field && this.resolve(field.value, seen)
    }
    if (ts.isCallExpression(node)) {
      const name = this.callName(node)
      if (['Behavior', 'Component', 'Page', 'definePage', 'defineComponent', 'VantComponent', 'definePageConfig', 'defineAppConfig', 'defineComponentConfig'].includes(name))
        return node.arguments[0] && this.resolve({ node: node.arguments[0], bindings }, seen)
      if (name === 'require') {
        const reference = this.name(node.arguments[0])
        const file = reference && this.project.resolveScript(reference, node.getSourceFile().fileName)
        const target = file && this.exported(file, 'default', new Set())
        return target ? this.resolve(target, seen) : undefined
      }
      const callee = this.resolve({ node: node.expression, bindings }, seen)
      if (callee && (ts.isFunctionDeclaration(callee.node) || ts.isFunctionExpression(callee.node) || ts.isArrowFunction(callee.node))) {
        const argumentsMap = new Map(callee.bindings)
        callee.node.parameters.forEach((parameter, index) => {
          const argument = node.arguments[index] || parameter.initializer
          if (argument && ts.isIdentifier(parameter.name)) argumentsMap.set(parameter.name.text, { node: argument, bindings })
        })
        const body = callee.node.body
        const result = body && (ts.isBlock(body) ? body.statements.find(ts.isReturnStatement)?.expression : body)
        return result ? this.resolve({ node: result, bindings: argumentsMap }, seen) : undefined
      }
      return undefined
    }
    return value
  }

  /** 展开对象属性；靠后的显式成员覆盖展开或继承成员。 */
  fields(value: Value, seen = new Set<ts.Node>()): Field[] {
    const resolved = this.resolve(value, seen)
    if (!resolved || !ts.isObjectLiteralExpression(resolved.node) || seen.has(resolved.node)) return []
    seen = new Set(seen).add(resolved.node)
    const fields = new Map<string, Field>()
    for (const property of resolved.node.properties) {
      if (ts.isSpreadAssignment(property)) {
        for (const field of this.fields({ node: property.expression, bindings: resolved.bindings }, seen)) fields.set(field.name, field)
      } else {
        const name = this.name(property.name)
        if (!name || !property.name) continue
        const node = ts.isPropertyAssignment(property) ? property.initializer : ts.isShorthandPropertyAssignment(property) ? property.name : property
        fields.set(name, { name, node: property.name, value: { node, bindings: resolved.bindings } })
      }
    }
    return [...fields.values()]
  }

  /** 找到文件中的原生注册或配置声明。 */
  registration(file: string): Value | undefined {
    const source = this.project.source(file)
    if (!source) return undefined
    const call = this.registrationCall(source, false, true) ?? this.registrationCall(source)
    if (call) return this.value(call)
    for (const statement of source.statements) {
      if (ts.isExportAssignment(statement)) return this.value(statement.expression)
    }
    return this.exported(file, 'default', new Set())
  }

  /** 保留注册调用本身，沿默认导出绑定和 CommonJS 转发追踪组件。 */
  private componentValue(value: Value, files: Set<string>, seen = new Set<ts.Node>()): ts.Node | undefined {
    const { node, bindings } = value
    if (seen.has(node) || seen.size >= this.project.maxFiles) return undefined
    seen = new Set(seen).add(node)
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node))
      return this.componentValue({ node: node.expression, bindings }, files, seen)
    if (ts.isIdentifier(node)) {
      const target = bindings.get(node.text) || this.local(node.getSourceFile(), node.text, new Set())
      return target && this.componentValue(target, files, seen)
    }
    if (ts.isPropertyAccessExpression(node)) {
      const target = this.namespace(node.expression, node.name.text, new Set())
      return target && this.componentValue(target, files, seen)
    }
    if (ts.isCallExpression(node)) {
      if (['Component', 'defineComponent', 'VantComponent'].includes(this.callName(node))) return this.callable(node.expression)
      if (this.callName(node) === 'require') {
        const reference = this.name(node.arguments[0])
        const target = reference && this.project.resolveScript(reference, node.getSourceFile().fileName)
        return target ? this.componentRegistration(target, files) : undefined
      }
    }
    return undefined
  }

  /** 穿透只有转发作用的入口；多个不同组件目标时保留入口而不猜测。 */
  private componentRegistration(file: string, visited = new Set<string>()): ts.Node | undefined {
    if (visited.has(file) || visited.size >= this.project.maxFiles) return undefined
    visited = new Set(visited).add(file)
    const source = this.project.source(file)
    if (!source) return undefined
    const direct = this.registrationCall(source, true)
    if (direct) return this.callable(direct.expression)
    const targets = new Set<ts.Node>()
    const exported = this.exported(file, 'default', new Set())
    const defaultTarget = exported && this.componentValue(exported, visited)
    if (defaultTarget) return defaultTarget
    for (const statement of source.statements) {
      let reference: string | undefined
      if (ts.isExportDeclaration(statement) && statement.moduleSpecifier)
        reference = this.name(statement.moduleSpecifier)
      else if (ts.isImportDeclaration(statement) && !statement.importClause)
        reference = this.name(statement.moduleSpecifier)
      else if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)
        && this.callName(statement.expression) === 'require') reference = this.name(statement.expression.arguments[0])
      const target = reference && this.project.resolveScript(reference, file)
      const declaration = target && this.componentRegistration(target, visited)
      if (declaration) targets.add(declaration)
    }
    return targets.size === 1 ? [...targets][0] : undefined
  }

  /** 标签跳转落在 Component/defineComponent 声明，纯模板入口回退到文件。 */
  componentDefinition(file: string, name: string): SymbolLocation {
    const node = this.componentRegistration(file)
    if (!node) return { file, start: 0, length: 0, name, kind: 'file' }
    const source = node.getSourceFile()
    return { file: source.fileName, start: node.getStart(source), length: node.getWidth(source), name, kind: 'file' }
  }

  /** 递归解析 Behavior 数组与展开数组，并保持原生覆盖顺序。 */
  private behaviors(value: Value, seen = new Set<ts.Node>()): Value[] {
    const resolved = this.resolve(value, seen)
    if (!resolved || seen.has(resolved.node)) return []
    seen = new Set(seen).add(resolved.node)
    if (ts.isArrayLiteralExpression(resolved.node)) return resolved.node.elements.flatMap((node) =>
      ts.isSpreadElement(node) ? this.behaviors({ node: node.expression, bindings: resolved.bindings }, seen) : [{ node, bindings: resolved.bindings }])
    return []
  }

  /** 将对象字段转换为精确的声明位置，嵌套 data 保留完整访问路径。 */
  private symbols(fields: Field[], kind: SymbolLocation['kind'], prefix: string[] = [], depth = 0): SymbolLocation[] {
    if (depth > 20) return []
    return fields.flatMap((field) => {
      let location: ts.Node = field.node
      if (kind === 'method' && (ts.isIdentifier(field.value.node) || ts.isPropertyAccessExpression(field.value.node))) {
        const resolved = this.resolve(field.value)?.node
        if (resolved && ts.isFunctionDeclaration(resolved) && resolved.name) location = resolved.name
        else if (resolved && (ts.isArrowFunction(resolved) || ts.isFunctionExpression(resolved)) && ts.isVariableDeclaration(resolved.parent)) location = resolved.parent.name
      }
      const source = location.getSourceFile()
      const quoted = ts.isStringLiteralLike(location)
      const symbol: SymbolLocation = { file: source.fileName, name: field.name, kind, path: [...prefix, field.name],
        start: location.getStart(source) + (quoted ? 1 : 0), length: quoted ? location.getWidth(source) - 2 : location.getWidth(source) }
      let nested = this.fields(field.value)
      if (kind === 'property') {
        Object.assign(symbol, this.propertyDetails(field))
        const initial = nested.find((item) => item.name === 'value')
        nested = initial ? this.fields(initial.value) : []
      }
      return [symbol, ...this.symbols(nested, kind === 'property' ? 'variable' : kind, symbol.path, depth + 1)]
    })
  }

  /** 读取紧邻声明的块注释和行注释，保留段落与 JSDoc 标签。 */
  private documentation(node: ts.Node): string | undefined {
    const source = node.getSourceFile()
    const leading = ts.getLeadingCommentRanges(source.text, node.getFullStart()) ?? []
    const inline = (ts.getTrailingCommentRanges(source.text, node.getFullStart()) ?? [])
      .filter((comment) => comment.kind === ts.SyntaxKind.MultiLineCommentTrivia)
    const comments = [...new Map([...leading, ...inline].map((comment) => [comment.pos, comment])).values()]
      .sort((left, right) => left.pos - right.pos)
    const text = comments.map((comment) => source.text.slice(comment.pos, comment.end)
      .replace(/^\/\*\*?/, '').replace(/\*\/$/, '').replace(/^\/\//, '')
      .split('\n').map((line) => line.replace(/^\s*\* ?/, '').trimEnd()).join('\n').trim())
      .filter(Boolean).join('\n\n')
    return text || undefined
  }

  /** 将构造器类型断言转换为属性值类型，避免显示构造器本身。 */
  private assertedPropertyType(type: ts.TypeNode): string | undefined {
    if (ts.isParenthesizedTypeNode(type)) return this.assertedPropertyType(type.type)
    if (ts.isFunctionTypeNode(type) || ts.isConstructorTypeNode(type)) return type.type.getText()
    if (ts.isTypeReferenceNode(type)) {
      const name = type.typeName.getText()
      if (/(?:^|\.)PropType$/.test(name) && type.typeArguments?.[0]) return type.typeArguments[0].getText()
      const constructors: Record<string, string> = {
        StringConstructor: 'string', NumberConstructor: 'number', BooleanConstructor: 'boolean',
        ObjectConstructor: 'object', ArrayConstructor: 'unknown[]', FunctionConstructor: 'Function',
      }
      return constructors[name]
    }
    if (ts.isTypeLiteralNode(type)) {
      const construct = type.members.find(ts.isConstructSignatureDeclaration)
      return construct?.type?.getText()
    }
    return undefined
  }

  /** 静态读取 type 字段；保留泛型断言并处理导入或局部构造器别名。 */
  private constructorType(value: Value, seen = new Set<ts.Node>()): string {
    const { node, bindings } = value
    if (seen.has(node) || seen.size >= this.project.maxFiles) return 'unknown'
    seen = new Set(seen).add(node)
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      const declared = this.assertedPropertyType(node.type)
      return declared || this.constructorType({ node: node.expression, bindings }, seen)
    }
    if (ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression(node))
      return this.constructorType({ node: node.expression, bindings }, seen)
    if (node.kind === ts.SyntaxKind.NullKeyword) return 'any'
    if (ts.isIdentifier(node)) {
      const target = bindings.get(node.text) || this.local(node.getSourceFile(), node.text, new Set())
      if (target) return this.constructorType(target, seen)
      const primitives: Record<string, string> = {
        String: 'string', Number: 'number', Boolean: 'boolean', Object: 'object', Array: 'unknown[]', Function: 'Function',
      }
      return primitives[node.text] || 'unknown'
    }
    const resolved = this.resolve(value)
    return resolved && resolved.node !== node ? this.constructorType(resolved, seen) : 'unknown'
  }

  /** 属性悬浮信息以声明为准；optionalTypes 合并为联合类型。 */
  private propertyDetails(field: Field): Pick<SymbolLocation, 'type' | 'documentation' | 'defaultValue'> {
    const descriptor = this.fields(field.value)
    const typeField = descriptor.find((item) => item.name === 'type')
    const type = this.constructorType(typeField?.value ?? field.value)
    const alternatives = descriptor.find((item) => item.name === 'optionalTypes')
    const optional = alternatives && this.resolve(alternatives.value)
    const types = [type]
    if (optional && ts.isArrayLiteralExpression(optional.node)) for (const element of optional.node.elements)
      types.push(this.constructorType({ node: element, bindings: optional.bindings }))
    const initial = descriptor.find((item) => item.name === 'value')
    // 注释跟随展开后的原始字段，未保存的源码同样由 Project 读取。
    const documentation = this.documentation(field.node.parent)
    return {
      type: types.includes('any') ? 'any' : [...new Set(types)].join(' | '), documentation,
      defaultValue: initial?.value.node.getText().slice(0, 240),
    }
  }

  /** 仅收集选定页面/组件及其 Behavior 链，排除无关 import 中的同名函数。 */
  members(file: string, value = this.registration(file), visited = new Set<ts.Node>()): SymbolLocation[] {
    if (!value) return []
    const resolved = this.resolve(value)
    if (!resolved || visited.has(resolved.node)) return []
    visited = new Set(visited).add(resolved.node)
    const fields = this.fields(resolved)
    const members = new Map<string, SymbolLocation>()
    const behaviors = fields.filter((field) => field.name === 'behaviors' || field.name === 'mixins')
    for (const group of behaviors) for (const behavior of this.behaviors(group.value))
      for (const symbol of this.members(file, behavior, visited)) members.set(symbol.path!.join('.'), symbol)
    for (const field of fields) {
      const kind = field.name === 'methods' ? 'method' : ['properties', 'props'].includes(field.name) ? 'property' : 'variable'
      if (['data', 'properties', 'props', 'methods'].includes(field.name)) {
        for (const symbol of this.symbols(this.fields(field.value), kind)) members.set(symbol.path!.join('.'), symbol)
      } else if (ts.isMethodDeclaration(field.value.node) || ts.isArrowFunction(field.value.node) || ts.isFunctionExpression(field.value.node)) {
        for (const symbol of this.symbols([field], 'method')) members.set(symbol.path!.join('.'), symbol)
      }
    }
    return [...members.values()]
  }

  /** 静态提取全局及当前组件注册，不执行配置文件或外部模块。 */
  components(template: string): Map<string, string> {
    const result = new Map<string, string>()
    const local = template.replace(/\.wxml$/, '')
    for (const base of [path.join(this.project.sourceRoot, 'app'), local]) {
      // 页面配置按同目录声明发现，原生组件和应用仍沿用各自配置文件。
      const script = base === local && this.project.first([local + '.ts', local + '.js'])
      const source = script && this.project.source(script)
      const runtime = source && this.registrationCall(source, false, true)
      const component = runtime && ['Component', 'defineComponent', 'VantComponent'].includes(this.callName(runtime))
      const pageConfigs = base === local && !component ? this.project.siblingScripts(path.dirname(local)).flatMap((file) => {
        const source = this.project.source(file)
        if (!source) return []
        return source.statements.flatMap((statement) => ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)
          && this.callName(statement.expression) === 'definePageConfig' && !this.local(source, 'definePageConfig', new Set())
            ? [{ file, value: this.value(statement.expression) }] : [])
      }) : []
      if (pageConfigs.length > 1) continue
      const page = pageConfigs[0]
      const config = page?.file ?? this.project.first([base + '.config.ts', base + '.config.js', base + '.config.mjs', base + '.config.cjs', base + '.json'])
      if (!config) continue
      if (config.endsWith('.json')) {
        const registrations = this.project.json(config).usingComponents as Record<string, string> | undefined
        for (const [name, reference] of Object.entries(registrations ?? {})) {
          result.delete(name)
          const target = typeof reference === 'string' && this.project.component(reference, config)
          if (target) result.set(name, this.componentDefinition(target, name).file)
        }
      } else {
        const registration = page?.value ?? this.registration(config)
        if (!registration) continue
        const fields = this.fields(registration)
        const common = page && fields.find((field) => field.name === 'config')
        const configurations = page ? [common?.value] : [registration]
        for (const configuration of configurations) {
          const using = configuration && this.fields(configuration).find((field) => field.name === 'usingComponents')
          if (!using) continue
          for (const field of this.fields(using.value)) {
            result.delete(field.name)
            const value = this.resolve(field.value)
            const reference = value && this.name(value.node)
            const target = reference && this.project.component(reference, config)
            if (target) result.set(field.name, this.componentDefinition(target, field.name).file)
          }
        }
      }
    }
    return result
  }
}
