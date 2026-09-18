import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import type { Project } from './project'

/** 静态值只保留配置字面量；函数和模块作为 AST 引用，不执行工程代码。 */
type Static = string | number | boolean | null | undefined | Static[] | { [key: string]: Static }
/** 表达式及工厂实参共同确定静态求值环境。 */
interface Expression { node: ts.Node; bindings: Map<string, Expression> }
/** 从构建输出路径回溯到源码路径的确定映射。 */
interface CopyRule { from: string; to: string }

/** 按工程配置推断目录布局，作为标准组件路径解析失败后的通用兜底。 */
export class ProjectLayout {
  readonly aliases: Record<string, string[]> = {}
  readonly sources = new Set<string>()
  readonly outputs = new Set<string>()
  private readonly copies: CopyRule[] = []
  private readonly scanned = new Set<string>()
  private steps = 0

  /** 每次语言请求独立解析，未保存的构建配置可立即参与定位。 */
  constructor(private readonly project: Project, private readonly roots: string[]) {
    for (const root of roots) for (const file of this.configs(root)) this.scan(file, root)
  }

  /** 仅枚举约定配置目录和脚本入口，不递归搜索业务文件或依赖目录。 */
  private configs(root: string): string[] {
    const files = new Set<string>()
    let entries = 0
    /** 限制目录层级和条目数量，避免大型仓库拖慢悬浮请求。 */
    const visit = (directory: string, depth: number): void => {
      if (this.project.options.cancelled?.() || entries > this.project.maxFiles) return
      let items: fs.Dirent[]
      try { items = fs.readdirSync(directory, { withFileTypes: true }) } catch { return }
      for (const item of items) {
        if (++entries > this.project.maxFiles) break
        if (item.isFile() && /\.(?:[cm]?[jt]s|json)$/.test(item.name)
          && (depth > 0 || /(?:config|webpack|rollup|vite|gulp|build)/i.test(item.name))) files.add(path.join(directory, item.name))
        if (item.isDirectory() && depth < 2 && /^(?:\.?config|scripts?|build|webpack|rollup|vite)$/.test(item.name)) visit(path.join(directory, item.name), depth + 1)
      }
    }
    visit(root, 0)
    const scripts = this.project.json(path.join(root, 'package.json')).scripts
    if (scripts && typeof scripts === 'object') for (const script of Object.values(scripts)) {
      if (typeof script !== 'string') continue
      for (const match of script.matchAll(/(?:^|\s)["']?([^\s"']+\.[cm]?[jt]s)(?=["']?\s|["']?$)/g)) {
        const candidate = path.resolve(root, match[1])
        if (this.project.exists(candidate)) files.add(candidate)
      }
    }
    return [...files].slice(0, Math.min(40, this.project.maxFiles))
  }

  /** 查找词法作用域中的常量、函数及静态导入，避免混入同名局部变量。 */
  private binding(node: ts.Node, name: string): Expression | undefined {
    for (let scope: ts.Node | undefined = node.parent; scope; scope = scope.parent) {
      if (!ts.isSourceFile(scope) && !ts.isBlock(scope)) continue
      for (const statement of scope.statements) {
        if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer)
            return { node: declaration.initializer, bindings: new Map() }
        }
        if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return { node: statement, bindings: new Map() }
        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
          const clause = statement.importClause
          const bindings = clause?.namedBindings
          const imported = clause?.name?.text === name ? 'default'
            : bindings && ts.isNamedImports(bindings) ? bindings.elements.find((element) => element.name.text === name) : undefined
          if (!imported) continue
          const file = this.project.resolveScript(statement.moduleSpecifier.text, node.getSourceFile().fileName)
          const source = file && this.project.source(file)
          if (!source) continue
          const exportedName = typeof imported === 'string' ? imported : (imported.propertyName ?? imported.name).text
          for (const exported of source.statements) {
            if (exportedName === 'default' && ts.isExportAssignment(exported)) return { node: exported.expression, bindings: new Map() }
            if (ts.isFunctionDeclaration(exported) && (exported.name?.text === exportedName || exportedName === 'default'
              && ts.getModifiers(exported)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword))) return { node: exported, bindings: new Map() }
            if (ts.isVariableStatement(exported)) for (const declaration of exported.declarationList.declarations)
              if (ts.isIdentifier(declaration.name) && declaration.name.text === exportedName && declaration.initializer)
                return { node: declaration.initializer, bindings: new Map() }
          }
        }
      }
    }
    return undefined
  }

  /** 核对路径函数的真实模块来源，支持导入别名并排除同名业务函数。 */
  private builtin(node: ts.Expression, seen = new Set<ts.Node>()): string | undefined {
    if (seen.has(node) || seen.size > 30) return undefined
    seen = new Set(seen).add(node)
    if (ts.isPropertyAccessExpression(node)) {
      const owner = this.builtin(node.expression, seen)
      return owner && owner + '.' + node.name.text
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require'
      && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) return node.arguments[0].text.replace(/^node:/, '')
    if (!ts.isIdentifier(node)) return undefined
    for (const statement of node.getSourceFile().statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const module = statement.moduleSpecifier.text.replace(/^node:/, '')
        const clause = statement.importClause
        const bindings = clause?.namedBindings
        if (clause?.name?.text === node.text || bindings && ts.isNamespaceImport(bindings) && bindings.name.text === node.text) return module
        if (bindings && ts.isNamedImports(bindings)) {
          const imported = bindings.elements.find((element) => element.name.text === node.text)
          if (imported) return module + '.' + (imported.propertyName ?? imported.name).text
        }
      }
      if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
        if (!declaration.initializer || !ts.isObjectBindingPattern(declaration.name)) continue
        const imported = declaration.name.elements.find((element) => ts.isIdentifier(element.name) && element.name.text === node.text)
        if (imported) {
          const owner = this.builtin(declaration.initializer, seen)
          const name = imported.propertyName ?? imported.name
          return owner && ts.isIdentifier(name) ? owner + '.' + name.text : undefined
        }
      }
    }
    const local = this.binding(node, node.text)
    if (local) return ts.isExpression(local.node) ? this.builtin(local.node, seen) : undefined
    return ['require', 'process', 'URL'].includes(node.text) ? node.text : undefined
  }

  /** 只解释字符串计算和少量无副作用路径函数，无法确定的表达式保持未知。 */
  private evaluate(node: ts.Node, root: string, bindings = new Map<string, Expression>(), seen = new Set<ts.Node>()): Static {
    if (++this.steps > this.project.maxFiles * 100 || seen.size > 40 || seen.has(node) || this.project.options.cancelled?.()) return undefined
    seen = new Set(seen).add(node)
    /** 子表达式继承当前作用域与递归预算。 */
    const read = (child: ts.Node): Static => this.evaluate(child, root, bindings, seen)
    if (ts.isStringLiteralLike(node)) return node.text
    if (ts.isNumericLiteral(node)) return Number(node.text)
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false
    if (node.kind === ts.SyntaxKind.NullKeyword) return null
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return read(node.expression)
    if (ts.isIdentifier(node)) {
      if (node.text === '__dirname') return path.dirname(node.getSourceFile().fileName)
      if (node.text === '__filename') return node.getSourceFile().fileName
      const target = bindings.get(node.text) ?? this.binding(node, node.text)
      return target && this.evaluate(target.node, root, target.bindings, seen)
    }
    if (ts.isTemplateExpression(node)) {
      let text = node.head.text
      for (const span of node.templateSpans) {
        const value = read(span.expression)
        if (typeof value !== 'string' && typeof value !== 'number') return undefined
        text += value + span.literal.text
      }
      return text
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = read(node.left), right = read(node.right)
      if (typeof left === 'string' && (typeof right === 'string' || typeof right === 'number')) return left + right
      if (typeof left === 'number' && typeof right === 'number') return left + right
      return undefined
    }
    if (ts.isConditionalExpression(node)) {
      const condition = read(node.condition)
      if (typeof condition === 'boolean') return read(condition ? node.whenTrue : node.whenFalse)
      const left = read(node.whenTrue), right = read(node.whenFalse)
      return left === right ? left : undefined
    }
    if (ts.isArrayLiteralExpression(node)) {
      const values: Static[] = []
      for (const item of node.elements) {
        if (ts.isSpreadElement(item)) { const value = read(item.expression); if (Array.isArray(value)) values.push(...value) }
        else values.push(read(item))
      }
      return values
    }
    if (ts.isObjectLiteralExpression(node)) {
      const value: Record<string, Static> = Object.create(null)
      for (const property of node.properties) {
        if (ts.isSpreadAssignment(property)) {
          const spread = read(property.expression)
          if (spread && typeof spread === 'object' && !Array.isArray(spread)) Object.assign(value, spread)
        } else if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
          const name = ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name) ? property.name.text : undefined
          if (name) value[name] = read(ts.isPropertyAssignment(property) ? property.initializer : property.name)
        }
      }
      return value
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      if (node.getText() === 'import.meta.url') return pathToFileURL(node.getSourceFile().fileName).href
      const value = read(node.expression)
      const key = ts.isPropertyAccessExpression(node) ? node.name.text : read(node.argumentExpression)
      if (value && typeof value === 'object' && !Array.isArray(value) && typeof key === 'string') return value[key]
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const name = this.builtin(node.expression)
      const args = (node.arguments ?? []).map(read)
      if (name && /^path\.(?:join|resolve|dirname|basename|normalize)$/.test(name) && args.every((item) => typeof item === 'string')) {
        const operation = name.split('.').pop()!
        const values = args as string[]
        if (operation === 'join') return path.join(...values)
        if (operation === 'resolve') return path.resolve(root, ...values)
        if (operation === 'dirname' && values[0]) return path.dirname(values[0])
        if (operation === 'basename' && values[0]) return path.basename(values[0], values[1])
        if (operation === 'normalize' && values[0]) return path.normalize(values[0])
      }
      if (name === 'process.cwd' && args.length === 0) return root
      if (name === 'require.resolve' && typeof args[0] === 'string') {
        try { return createRequire(node.getSourceFile().fileName).resolve(args[0]) } catch { return undefined }
      }
      if (name === 'URL' && typeof args[0] === 'string' && typeof args[1] === 'string') {
        try { return new URL(args[0], args[1]).href } catch { return undefined }
      }
      if (name === 'url.fileURLToPath' && typeof args[0] === 'string') {
        try { return fileURLToPath(args[0]) } catch { return undefined }
      }
      if (name === 'require' && typeof args[0] === 'string' && args[0].startsWith('.')) {
        const file = this.project.resolveScript(args[0], node.getSourceFile().fileName)
        if (file?.endsWith('.json')) return this.project.json(file) as Static
        const source = file && this.project.source(file)
        if (source) for (const statement of source.statements)
          if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression) && statement.expression.left.getText() === 'module.exports') return read(statement.expression.right)
      }
      const target = ts.isIdentifier(node.expression) && this.binding(node.expression, node.expression.text)
      if (target && (ts.isArrowFunction(target.node) || ts.isFunctionDeclaration(target.node) || ts.isFunctionExpression(target.node))) {
        const parameters = new Map(target.bindings)
        target.node.parameters.forEach((parameter, index) => {
          const argument = node.arguments?.[index] ?? parameter.initializer
          if (argument && ts.isIdentifier(parameter.name)) parameters.set(parameter.name.text, { node: argument, bindings })
        })
        const body = target.node.body
        const result = body && (ts.isBlock(body) ? body.statements.find(ts.isReturnStatement)?.expression : body)
        return result && this.evaluate(result, root, parameters, seen)
      }
    }
    return undefined
  }

  /** 提取别名、源码/输出目录与复制规则；所有字段均由静态表达式求值。 */
  private scan(file: string, root: string): void {
    if (this.scanned.has(file) || this.scanned.size >= Math.min(60, this.project.maxFiles) || this.project.options.cancelled?.()) return
    this.scanned.add(file)
    if (file.endsWith('.json')) {
      const config = this.project.json(file)
      if (typeof config.miniprogramRoot === 'string') this.outputs.add(path.resolve(path.dirname(file), config.miniprogramRoot))
      return
    }
    const source = this.project.source(file)
    if (!source) return
    const objects: Record<string, Static>[] = []
    /** 收集配置对象；忽略对象内的函数执行，但允许静态读取其路径常量。 */
    const visit = (node: ts.Node): void => {
      if (this.project.options.cancelled?.()) return
      if (ts.isObjectLiteralExpression(node)) {
        const value = this.evaluate(node, root)
        if (value && typeof value === 'object' && !Array.isArray(value)) objects.push(value)
      }
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith('.')) {
        const target = this.project.resolveScript(node.moduleSpecifier.text, file)
        if (target) this.scan(target, root)
      }
      if (ts.isCallExpression(node) && node.expression.getText() === 'require' && node.arguments[0]
        && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text.startsWith('.')) {
        const target = this.project.resolveScript(node.arguments[0].text, file)
        if (target) this.scan(target, root)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    const outputs = new Set<string>()
    for (const object of objects) {
      for (const key of ['sourceRoot', 'srcRoot', 'srcDir']) if (typeof object[key] === 'string') this.sources.add(path.resolve(root, object[key]))
      for (const key of ['outputRoot', 'outDir', 'miniprogramRoot']) if (typeof object[key] === 'string') outputs.add(path.resolve(root, object[key]))
      const output = object.output
      if (output && typeof output === 'object' && !Array.isArray(output) && typeof output.path === 'string') outputs.add(path.resolve(root, output.path))
      const aliases = object.alias
      if (aliases && typeof aliases === 'object') {
        const entries = Array.isArray(aliases) ? aliases.flatMap((item) => item && typeof item === 'object' && !Array.isArray(item)
          && typeof item.find === 'string' ? [[item.find, item.replacement] as const] : []) : Object.entries(aliases)
        for (const [key, value] of entries) for (const target of Array.isArray(value) ? value : [value])
          if (typeof target === 'string') (this.aliases[key] ??= []).push(path.resolve(root, target))
      }
    }
    for (const output of outputs) this.outputs.add(output)
    for (const object of objects) {
      if (typeof object.from !== 'string' || typeof object.to !== 'string' || /\[(?!path\]|name\]|ext\])/.test(object.to)) continue
      const context = typeof object.context === 'string' ? path.resolve(root, object.context) : root
      const from = path.resolve(context, object.from)
      const glob = from.search(/[*?{[]/)
      const base = glob < 0 ? from : from.slice(0, from.lastIndexOf('/', glob))
      // 只支持保持目录层级的复制；哈希、重命名函数及不明模板不推断。
      const destination = object.to.replace(/\[path\]\[name\]\[ext\]$/, '')
      if (destination.includes('[')) continue
      for (const output of outputs.size ? outputs : [root]) {
        const to = path.resolve(output, destination)
        this.copies.push({ from: base, to: glob >= 0 && typeof object.context === 'string' ? path.join(to, path.relative(context, base)) : to })
      }
    }
  }

  /** 将虚拟输出路径按复制规则反向映射，保留完整路径后缀而非组件名称。 */
  candidates(reference: string, from: string): string[] {
    const candidates: string[] = []
    const virtual: string[] = []
    if (!reference.startsWith('.')) for (const root of [this.project.sourceRoot, ...this.outputs]) virtual.push(path.join(root, reference))
    else if (reference.startsWith('.')) {
      const source = path.resolve(path.dirname(from), reference)
      virtual.push(source)
      for (const root of [this.project.sourceRoot, ...this.sources]) {
        const relative = path.relative(root, source)
        if (relative.startsWith('../')) continue
        for (const output of this.outputs) virtual.push(path.join(output, relative))
      }
    }
    if (!reference.startsWith('.')) for (const source of this.sources) candidates.push(path.join(source, reference))
    for (const file of virtual) for (const rule of this.copies) {
      const relative = path.relative(rule.to, file)
      if (relative !== '..' && !relative.startsWith('../') && !path.isAbsolute(relative)) candidates.push(path.join(rule.from, relative))
    }
    return [...new Set(candidates)]
  }

  /** 构建别名支持精确项、目录前缀、通配符及 webpack 的末尾 $。 */
  aliasCandidates(reference: string): string[] {
    for (const key of Object.keys(this.aliases).sort((left, right) => right.length - left.length)) {
      const exact = key.endsWith('$')
      const name = exact ? key.slice(0, -1) : key.replace(/\/$/, '')
      if (name.includes('*')) {
        const [prefix, suffix] = name.split('*')
        if (reference.startsWith(prefix) && reference.endsWith(suffix)) {
          const middle = reference.slice(prefix.length, suffix ? -suffix.length : undefined)
          return this.aliases[key].map((target) => target.replace('*', middle))
        }
      } else if (reference === name || !exact && reference.startsWith(name + '/')) {
        return this.aliases[key].map((target) => path.join(target, reference.slice(name.length)))
      }
    }
    return []
  }
}
