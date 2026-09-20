// SPDX-License-Identifier: Apache-2.0
import path from 'node:path'
import { Project, type SymbolLocation } from './project'

/** 样式模块边记录导入方式及 Sass 命名空间、转发过滤规则。 */
interface ImportEdge {
  file: string
  kind: 'import' | 'use' | 'forward'
  namespace: string
  prefix: string
  show?: string[]
  hide?: string[]
  start: number
  length: number
}
/** 样式声明的作用域范围用于排除其他规则内的同名局部变量。 */
interface StyleSymbol extends SymbolLocation { scopeStart: number; scopeEnd: number }
/** 单个文件的只读索引，嵌套规则展开后仍指向原始选择器。 */
interface StyleIndex { symbols: StyleSymbol[]; imports: ImportEdge[] }
/** 花括号规则栈保存父选择器与局部声明。 */
interface Scope { start: number; selectors: string[]; symbols: StyleSymbol[] }

/** 清除注释但保持偏移；字符串里的 URL 不会被误认为注释。 */
function stripComments(text: string): string {
  return text.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\/|\/\/[^\n\r]*/g,
    (match) => match.startsWith('/') ? match.replace(/[^\r\n]/g, ' ') : match)
}

/** 跨 Less/SCSS 模块解析类名、变量与混入，使用访问集合终止循环。 */
export class Styles {
  private readonly cache = new Map<string, StyleIndex>()

  /** 与脚本定位共享未保存内容及路径解析规则。 */
  constructor(readonly project: Project) {}

  /** 单文件扫描同时收集导入、声明、嵌套选择器和块作用域。 */
  private index(file: string): StyleIndex {
    const cached = this.cache.get(file)
    if (cached) return cached
    const original = this.project.read(file) ?? ''
    const text = stripComments(original)
    const result: StyleIndex = { symbols: [], imports: [] }
    this.cache.set(file, result)
    for (const match of text.matchAll(/@(import|use|forward)\s+(?:\([^)]*\)\s*)?([^;\n]+);?/g)) {
      const kind = match[1] as ImportEdge['kind']
      for (const reference of match[2].matchAll(/(['"])(.*?)\1/g)) {
        const target = this.project.style(reference[2], file)
        if (!target) continue
        const tail = match[2].slice(reference.index! + reference[0].length)
        const alias = /\bas\s+([\w*-]+)/.exec(tail)?.[1]
        result.imports.push({ file: target, kind,
          namespace: kind === 'use' ? alias || path.basename(reference[2]).replace(/^_/, '').replace(/\.[^.]+$/, '') : '*',
          prefix: kind === 'forward' ? alias?.replace(/\*$/, '') ?? '' : '',
          show: /\bshow\s+(.+?)(?:\bhide\b|$)/.exec(tail)?.[1].split(',').map((name) => name.trim().replace(/^[$@]/, '')),
          hide: /\bhide\s+(.+?)(?:\bshow\b|$)/.exec(tail)?.[1].split(',').map((name) => name.trim().replace(/^[$@]/, '')),
          start: match.index! + match[0].indexOf(reference[0]) + 1, length: reference[2].length,
        })
      }
    }
    const scopes: Scope[] = [{ start: 0, selectors: [], symbols: [] }]
    let boundary = 0
    let quote = ''
    let parentheses = 0
    let interpolation = 0
    /** 将声明加入当前块；结束花括号出现后补齐可见范围。 */
    const add = (symbol: SymbolLocation): void => {
      const scope = scopes[scopes.length - 1]
      const entry = { ...symbol, scopeStart: scope.start, scopeEnd: text.length }
      scope.symbols.push(entry)
      result.symbols.push(entry)
    }
    /** 扫描语句内的 Less/SCSS 变量声明。 */
    const declaration = (start: number, end: number): void => {
      const statement = text.slice(start, end)
      const variable = /^\s*([$@][\w-]+)\s*:/.exec(statement)
      if (variable) add({ file, start: start + statement.indexOf(variable[1]), length: variable[1].length,
        name: variable[1].slice(1), kind: 'variable' })
    }
    for (let offset = 0; offset < text.length; offset++) {
      const character = text[offset]
      if (quote) {
        if (character === '\\') offset++
        else if (character === quote) quote = ''
        continue
      }
      if (character === '"' || character === "'") { quote = character; continue }
      if (character === '{' && /[#$@]/.test(text[offset - 1] ?? '')) { interpolation++; continue }
      if (interpolation) { if (character === '}') interpolation--; continue }
      if (character === '(') parentheses++
      if (character === ')') parentheses--
      if (parentheses > 0) continue
      if (character === ';') { declaration(boundary, offset); boundary = offset + 1 }
      if (character === '{') {
        const header = text.slice(boundary, offset)
        const parent = scopes[scopes.length - 1]
        const mixin = /@(?:mixin|function)\s+([\w-]+)/.exec(header) || /^\s*([.#][\w-]+)\s*\([^)]*\)/.exec(header)
        if (mixin) {
          const raw = mixin[1]
          add({ file, name: raw.replace(/^[.#]/, ''), kind: 'mixin', start: boundary + header.indexOf(raw), length: raw.length })
        }
        let selectors = parent.selectors
        if (!/^\s*@/.test(header) && !/^\s*[$@][\w-]+\s*:/.test(header)) {
          const own = header.trim().split(',').map((selector) => selector.trim())
          selectors = own.flatMap((selector) => parent.selectors.length
            ? parent.selectors.map((ancestor) => selector.includes('&') ? selector.replace(/&/g, ancestor) : ancestor + ' ' + selector)
            : [selector])
          for (const selector of selectors) for (const match of selector.matchAll(/\.([\w-]+)/g)) {
            const direct = new RegExp('\\.' + match[1] + '(?![\\w-])').exec(header)
            const suffix = /&([\w-]+)/.exec(header)
            // 祖先类名已在父规则记录；& 后缀指向当前规则的原始位置。
            if (!direct && !(suffix && match[1].endsWith(suffix[1]))) continue
            const start = boundary + (direct?.index ?? suffix!.index)
            add({ file, name: match[1], kind: 'class', start, length: direct ? direct[0].length : suffix![0].length })
          }
        }
        scopes.push({ start: offset, selectors, symbols: [] })
        boundary = offset + 1
      }
      if (character === '}') {
        declaration(boundary, offset)
        if (scopes.length > 1) {
          const scope = scopes.pop()!
          for (const symbol of scope.symbols) symbol.scopeEnd = offset
        }
        boundary = offset + 1
      }
    }
    declaration(boundary, text.length)
    return result
  }

  /** 样式根包含同名文件、app 全局样式及显式配置的全局文件。 */
  roots(template: string): string[] {
    const bases = [template.replace(/\.(wxml|scss|less|wxss|css)$/, ''), path.join(this.project.sourceRoot, 'app')]
    const files = bases.flatMap((base) => ['.scss', '.less', '.wxss', '.css'].map((extension) => base + extension))
    files.push(...(this.project.options.styleRoots ?? []).filter((file) => /\.(scss|less|wxss|css)$/.test(file)))
    return [...new Set(files.filter((file) => this.project.exists(file)))]
  }

  /** 模板 class 不受 Sass 变量命名空间限制，沿所有样式导入收集。 */
  classes(template: string): SymbolLocation[] {
    const symbols: SymbolLocation[] = []
    const visited = new Set<string>()
    /** 深度遍历只访问每个文件一次。 */
    const visit = (file: string): void => {
      if (visited.has(file) || visited.size >= this.project.maxFiles) return
      visited.add(file)
      const index = this.index(file)
      symbols.push(...index.symbols.filter((symbol) => symbol.kind === 'class'))
      for (const edge of index.imports) visit(edge.file)
    }
    for (const file of this.roots(template)) visit(file)
    return symbols
  }

  /** 查询模块公开成员，@use 私有成员不会通过转发暴露。 */
  private exported(file: string, name: string, kind: SymbolLocation['kind'], seen: Set<string>): SymbolLocation[] {
    const key = file + ':' + kind + ':' + name
    if (seen.has(key) || seen.size >= this.project.maxFiles) return []
    seen = new Set(seen).add(key)
    const index = this.index(file)
    const local = index.symbols.filter((symbol) => symbol.name === name && symbol.kind === kind && symbol.scopeStart === 0)
    if (local.length) return local.slice(-1)
    for (const edge of [...index.imports].reverse()) {
      if (edge.kind === 'use') continue
      const childName = edge.prefix ? (name.startsWith(edge.prefix) ? name.slice(edge.prefix.length) : '') : name
      if (!childName || edge.hide?.includes(childName) || (edge.show && !edge.show.includes(childName))) continue
      const found = this.exported(edge.file, childName, kind, seen)
      if (found.length) return found
    }
    return []
  }

  /** 支持 import 跳转、变量作用域、Sass 命名空间与 Less 混入引用。 */
  definition(file: string, offset: number): SymbolLocation[] {
    const text = this.project.read(file) ?? ''
    const index = this.index(file)
    const imported = index.imports.find((edge) => offset >= edge.start && offset <= edge.start + edge.length)
    if (imported) return [{ file: imported.file, name: path.basename(imported.file), kind: 'file', start: 0, length: 0 }]
    let start = offset
    let end = offset
    while (start > 0 && /[\w$@-]/.test(text[start - 1])) start--
    while (end < text.length && /[\w$@-]/.test(text[end])) end++
    const raw = text.slice(start, end)
    if (!raw) return []
    const name = raw.replace(/^[$@]/, '')
    const before = text.slice(0, start)
    const namespace = /([\w-]+)\.$/.exec(before)?.[1]
    const kind = /^[$@]/.test(raw) ? 'variable' : /@include\s+(?:[\w-]+\.)?$/.test(before) || /^\s*\(/.test(text.slice(end)) ? 'mixin' : 'class'
    if (kind === 'class') return this.classes(file).filter((symbol) => symbol.name === name)
    if (!namespace) {
      const local = index.symbols.filter((symbol) => symbol.name === name && symbol.kind === kind && symbol.scopeStart <= offset && symbol.scopeEnd >= offset)
        .sort((a, b) => b.scopeStart - a.scopeStart || b.start - a.start)
      if (local.length) return [local[0]]
    }
    for (const edge of [...index.imports].reverse()) {
      if (edge.kind === 'forward') continue
      if (edge.kind === 'use' ? edge.namespace !== (namespace || '*') : !!namespace) continue
      if (edge.kind === 'use' && /^[_-]/.test(name)) continue
      const found = this.exported(edge.file, name, kind, new Set())
      if (found.length) return found
    }
    return []
  }
}
