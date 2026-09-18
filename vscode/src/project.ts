import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { ProjectLayout } from './layout'

/** 编辑器缓冲区与磁盘共用的读取接口；测试可注入未保存文档。 */
export interface ProjectOptions {
  sourceRoot?: string
  styleRoots?: string[]
  /** 额外组件目录与构建路径前缀映射，均已由编辑器转换为绝对路径。 */
  componentRoots?: string[]
  componentAliases?: Record<string, string[]>
  maxFiles?: number
  documents?: Map<string, string>
  cancelled?: () => boolean
}

/** 定义跳转与补全共用的位置，不依赖 VS Code 扩展宿主。 */
export interface SymbolLocation {
  file: string
  start: number
  length: number
  name: string
  kind: 'variable' | 'method' | 'property' | 'class' | 'mixin' | 'file'
  path?: string[]
  /** 组件属性的公开类型、声明注释与显式默认值。 */
  type?: string
  documentation?: string
  defaultValue?: string
}

/** 一次语言请求的只读项目视图，缓存不会跨请求保留过期内容。 */
export class Project {
  private readonly texts = new Map<string, string | undefined>()
  private readonly sources = new Map<string, ts.SourceFile>()
  private readonly compilerOptions = new Map<string, ts.CompilerOptions>()
  private readonly scriptPaths = new Map<string, string | undefined>()
  private componentDirectories?: string[]
  private layout?: ProjectLayout
  readonly sourceRoot: string
  readonly maxFiles: number

  /** 默认向上查找小程序根，允许显式覆盖与未保存文件。 */
  constructor(readonly entry: string, readonly options: ProjectOptions = {}) {
    this.maxFiles = options.maxFiles ?? 500
    this.sourceRoot = options.sourceRoot || this.findRoot(entry)
  }

  /** 读取前检查取消和数量预算，避免循环依赖无限占用宿主。 */
  read(file: string): string | undefined {
    file = path.resolve(file)
    if (this.options.cancelled?.()) return undefined
    if (this.options.documents?.has(file)) return this.options.documents.get(file)
    if (this.texts.has(file)) return this.texts.get(file)
    if (this.texts.size >= this.maxFiles) return undefined
    let text: string | undefined
    try { text = fs.readFileSync(file, 'utf8') } catch { /* 缺失文件允许继续编辑。 */ }
    this.texts.set(file, text)
    return text
  }

  /** 未保存的新文件同样参与模块解析。 */
  exists(file: string): boolean {
    if (this.options.documents?.has(path.resolve(file))) return true
    try { return fs.statSync(file).isFile() } catch { return false }
  }

  /** 只解析实际访问的脚本，不加载所有依赖声明文件。 */
  source(file: string): ts.SourceFile | undefined {
    const text = this.read(file)
    if (text === undefined) return undefined
    if (!this.sources.has(file)) this.sources.set(file, ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true))
    return this.sources.get(file)
  }

  /** 读取最近的 tsconfig，包括 extends 与 paths；无需枚举项目文件。 */
  private optionsFor(file: string): ts.CompilerOptions {
    const config = ts.findConfigFile(path.dirname(file), (name) => this.exists(name))
    const key = config || ''
    if (!this.compilerOptions.has(key)) {
      const parsed = config ? ts.getParsedCommandLineOfConfigFile(config, {}, {
        useCaseSensitiveFileNames: true,
        getCurrentDirectory: () => path.dirname(config),
        readDirectory: () => [],
        fileExists: (name) => this.exists(name),
        readFile: (name) => this.read(name),
        onUnRecoverableConfigFileDiagnostic: () => {},
      }) : undefined
      this.compilerOptions.set(key, {
        module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
        allowJs: true, ...parsed?.options,
      })
    }
    return this.compilerOptions.get(key)!
  }

  /** 使用 TypeScript 官方解析器支持路径别名、pnpm 与 package exports。 */
  resolveScript(reference: string, from: string): string | undefined {
    const key = from + '\0' + reference
    if (this.scriptPaths.has(key)) return this.scriptPaths.get(key)
    const resolved = ts.resolveModuleName(reference, from, this.optionsFor(from), {
      fileExists: (name) => this.exists(name), readFile: (name) => this.read(name),
      directoryExists: ts.sys.directoryExists, realpath: ts.sys.realpath,
    }).resolvedModule?.resolvedFileName
    // 第三方组件常同时携带 JS 和 d.ts，跳转与行为追踪优先采用可读实现。
    let target = resolved
    if (resolved && /\.d\.[cm]?ts$/.test(resolved)) {
      const stem = resolved.replace(/\.d\.[cm]?ts$/, '')
      target = this.first(['.ts', '.js', '.mts', '.cts', '.mjs', '.cjs'].map((extension) => stem + extension))
      if (!target) {
        try { target = createRequire(from).resolve(reference) } catch { /* 没有运行时入口时保留声明文件。 */ }
      }
      target ||= resolved
    }
    const base = path.resolve(path.dirname(from), reference)
    target ||= this.first([base, ...['.ts', '.js', '.tsx', '.mjs', '.cjs', '/index.ts', '/index.js'].map((ext) => base + ext)])
    this.scriptPaths.set(key, target)
    return target
  }

  /** 查找同名脚本或样式。 */
  sibling(file: string, extensions: string[]): string | undefined {
    const base = file.replace(/\.[^.\/]+$/, '')
    return this.first(extensions.map((extension) => base + extension))
  }

  /** 返回候选中的首个真实文件。 */
  first(files: string[]): string | undefined { return files.find((file) => this.exists(file)) }

  /** 读取 JSONC 配置，输入不完整时返回空对象。 */
  json(file: string): Record<string, unknown> {
    const text = this.read(file)
    return text ? ts.parseConfigFileTextToJson(file, text).config ?? {} : {}
  }

  /** 定位 npm 包清单，兼容未导出 package.json 的普通包。 */
  package(reference: string, from: string): { root: string; manifest: Record<string, unknown>; subpath: string } | undefined {
    const parts = reference.replace(/^(?:pkg:|~)/, '').split('/')
    const name = parts.splice(0, reference.replace(/^(?:pkg:|~)/, '').startsWith('@') ? 2 : 1).join('/')
    const resolver = createRequire(from)
    let manifestFile: string | undefined
    try { manifestFile = resolver.resolve(name + '/package.json') } catch {
      for (let directory = path.dirname(from); ; directory = path.dirname(directory)) {
        const candidate = path.join(directory, 'node_modules', name, 'package.json')
        if (this.exists(candidate)) { manifestFile = candidate; break }
        if (directory === path.dirname(directory)) break
      }
    }
    if (!manifestFile) return undefined
    return { root: path.dirname(manifestFile), manifest: this.json(manifestFile), subpath: parts.join('/') }
  }

  /** 同名脚本优先于模板，兼容目录入口和已带扩展名的配置路径。 */
  private componentFile(base: string): string | undefined {
    if (/\.d\.[cm]?ts$/.test(base)) return undefined
    const stem = base.replace(/\.(?:json|wxml)$/, '')
    const extensions = ['.ts', '.js', '.cts', '.mts', '.cjs', '.mjs']
    const files = /\.[cm]?[jt]s$/.test(stem)
      ? [stem, ...extensions.map((extension) => stem.replace(/\.[cm]?[jt]s$/, extension))]
      : [...extensions.map((extension) => stem + extension), ...extensions.map((extension) => path.join(stem, 'index' + extension))]
    return this.first([...files, stem + '.wxml', path.join(stem, 'index.wxml')])
  }

  /** 按组件运行时条件解析 exports；类型声明不作为组件实现。 */
  private componentExport(exports: unknown, subpath: string): string[] {
    const key = subpath ? './' + subpath : '.'
    let target: unknown = exports
    let wildcard = ''
    if (exports && typeof exports === 'object' && !Array.isArray(exports)) {
      const entries = exports as Record<string, unknown>
      if (Object.keys(entries).some((name) => name.startsWith('.'))) {
        target = entries[key]
        if (target === undefined) for (const pattern of Object.keys(entries).sort((a, b) => b.length - a.length)) {
          if (!pattern.includes('*')) continue
          const [prefix, suffix] = pattern.split('*')
          if (key.startsWith(prefix) && key.endsWith(suffix)) {
            wildcard = key.slice(prefix.length, suffix ? -suffix.length : undefined)
            target = entries[pattern]
            break
          }
        }
      } else if (subpath) return []
    } else if (subpath) return []
    /** 仅采用已知运行时条件，允许嵌套条件及回退数组。 */
    const paths = (value: unknown): string[] => {
      if (typeof value === 'string') return [value.replace(/\*/g, wildcard)]
      if (Array.isArray(value)) return value.flatMap(paths)
      if (!value || typeof value !== 'object') return []
      const conditions = value as Record<string, unknown>
      return ['miniprogram', 'source', 'import', 'require', 'default'].flatMap((name) => paths(conditions[name]))
    }
    return paths(target)
  }

  /** npm 入口兼容 pnpm 链接、miniprogram、子路径导出及传统 main。 */
  private packageComponent(reference: string, from: string): string | undefined {
    const pkg = this.package(reference, from)
    if (!pkg) return undefined
    const entries = this.componentExport(pkg.manifest.exports, pkg.subpath)
    if (typeof pkg.manifest.miniprogram === 'string') entries.push(path.join(pkg.manifest.miniprogram, pkg.subpath))
    if (pkg.subpath) entries.push(pkg.subpath)
    else {
      if (typeof pkg.manifest.main === 'string') entries.push(pkg.manifest.main)
      entries.push('index')
    }
    for (const entry of entries) {
      const file = this.componentFile(path.resolve(pkg.root, entry))
      if (file) return file
    }
    return undefined
  }

  /** 在小程序根、应用包与仓库根查找同一路径，不按组件名模糊匹配。 */
  private componentRoots(): string[] {
    if (this.componentDirectories) return this.componentDirectories
    const roots = [this.sourceRoot, ...(this.options.componentRoots ?? [])]
    for (let directory = this.sourceRoot; ; directory = path.dirname(directory)) {
      const workspace = this.exists(path.join(directory, 'pnpm-workspace.yaml'))
        || this.exists(path.join(directory, 'lerna.json'))
      let repository = false
      try { repository = fs.existsSync(path.join(directory, '.git')) } catch { /* 不可访问的目录不作为候选。 */ }
      if (workspace || repository || this.exists(path.join(directory, 'package.json')) || this.exists(path.join(directory, 'project.config.json'))) roots.push(directory)
      if (workspace || repository || directory === path.dirname(directory)) break
    }
    this.componentDirectories = [...new Set(roots.map((root) => path.resolve(root)))]
    return this.componentDirectories
  }

  /** 支持精确、目录前缀及单通配别名，路径映射按最长前缀优先。 */
  private mappedComponents(reference: string, from: string): string[] {
    const candidates: string[] = []
    /** 同时复用编辑器别名与 tsconfig paths 的候选匹配规则。 */
    const append = (aliases: Record<string, string[]>, base: string, allowPrefix = true): void => {
      for (const key of Object.keys(aliases).sort((left, right) => right.length - left.length)) {
        let suffix: string | undefined
        if (key.includes('*')) {
          const [start, end] = key.split('*')
          if (reference.startsWith(start) && reference.endsWith(end)) suffix = reference.slice(start.length, end ? -end.length : undefined)
        } else if (reference === key) suffix = ''
        else if (allowPrefix && reference.startsWith(key.replace(/\/$/, '') + '/')) suffix = reference.slice(key.replace(/\/$/, '').length + 1)
        if (suffix === undefined) continue
        for (const target of aliases[key]) candidates.push(path.resolve(base, key.includes('*') ? target.replace('*', suffix) : path.join(target, suffix)))
        break
      }
    }
    append(this.options.componentAliases ?? {}, this.sourceRoot)
    const config = this.optionsFor(from)
    // paths 的相对基准可能来自 extends 中的配置文件，由 TypeScript 保留解析结果。
    const base = config.baseUrl || (config as ts.CompilerOptions & { pathsBasePath?: string }).pathsBasePath || path.dirname(from)
    append(config.paths ?? {}, base, false)
    if (config.baseUrl && !reference.startsWith('.') && !reference.startsWith('/')) candidates.push(path.resolve(config.baseUrl, reference))
    return candidates
  }

  /** 构建配置仅在需要兜底时加载；一个请求复用相同工程关系。 */
  private projectLayout(): ProjectLayout {
    return this.layout ??= new ProjectLayout(this, this.componentRoots())
  }

  /** 相同真实文件的多个路径合并；冲突候选不按文件遍历顺序猜测。 */
  private uniqueComponent(candidates: string[]): string | undefined {
    const targets = new Map<string, string>()
    for (const candidate of candidates) {
      const file = this.componentFile(candidate)
      if (!file) continue
      let canonical = file
      try { canonical = fs.realpathSync(file) } catch { /* 未保存文档没有磁盘真实路径。 */ }
      targets.set(canonical, file)
    }
    return targets.size === 1 ? [...targets.values()][0] : undefined
  }

  /** 解析真实组件入口；跨分包异步组件同样使用 usingComponents 中的路径。 */
  component(reference: string, from: string): string | undefined {
    if (!reference) return undefined
    if (reference.startsWith('file://')) {
      try { return this.componentFile(fileURLToPath(reference)) } catch { return undefined }
    }
    if (/^[\w-]+:\/\//.test(reference)) return undefined
    const candidates = this.mappedComponents(reference, from)
    if (reference.startsWith('.')) candidates.push(path.resolve(path.dirname(from), reference))
    else if (reference.startsWith('/')) {
      for (const root of this.componentRoots()) candidates.push(path.join(root, reference))
      candidates.push(reference)
    } else {
      const npm = this.packageComponent(reference, from)
      // 显式路径别名优先于同名 npm 包；普通裸包名保持 npm 解析规则。
      for (const candidate of candidates) { const file = this.componentFile(candidate); if (file) return file }
      const aliases = this.projectLayout().aliasCandidates(reference)
      if (aliases.length) return this.uniqueComponent(aliases)
      if (npm) return npm
      candidates.push(path.resolve(path.dirname(from), reference))
      for (const root of this.componentRoots()) candidates.push(path.resolve(root, reference))
    }
    for (const candidate of candidates) { const file = this.componentFile(candidate); if (file) return file }
    // 构建 npm 尚未执行时可回源安装包；也支持分包内部的 miniprogram_npm。
    const npmPath = reference.replace(/\\/g, '/').split('miniprogram_npm/')[1]
    if (npmPath) {
      const npm = this.packageComponent(npmPath, from)
      if (npm) return npm
    }
    const layout = this.projectLayout()
    const aliases = layout.aliasCandidates(reference)
    if (aliases.length) return this.uniqueComponent(aliases)
    return this.uniqueComponent(layout.candidates(reference, from))
  }

  /** 解析 Sass 局部模块、目录入口、Less 扩展及 npm 样式路径。 */
  style(reference: string, from: string): string | undefined {
    if (/^(?:https?:|sass:|url\()/i.test(reference)) return undefined
    const candidates = [path.resolve(path.dirname(from), reference), path.resolve(this.sourceRoot, reference)]
    for (const directory of this.options.styleRoots ?? []) candidates.push(path.resolve(directory, reference))
    const pkg = this.package(reference, from)
    if (pkg) {
      const exports = pkg.manifest.exports as Record<string, unknown> | undefined
      const key = pkg.subpath ? './' + pkg.subpath : '.'
      let exported = exports?.[key]
      let wildcard = ''
      if (!exported && exports) for (const pattern of Object.keys(exports).sort((a, b) => b.length - a.length)) {
        if (!pattern.includes('*')) continue
        const [prefix, suffix] = pattern.split('*')
        if (key.startsWith(prefix) && key.endsWith(suffix)) {
          wildcard = key.slice(prefix.length, suffix ? -suffix.length : undefined)
          exported = exports[pattern]
          break
        }
      }
      // Sass 和 CSS 条件导出优先，避免把 JavaScript 入口作为样式解析。
      if (exported && typeof exported === 'object') {
        const conditions = exported as Record<string, unknown>
        exported = conditions.sass || conditions.style || conditions.default
      }
      const target = typeof exported === 'string' ? exported.replace(/\*/g, wildcard) : pkg.subpath || pkg.manifest.sass || pkg.manifest.style || 'index'
      candidates.push(path.resolve(pkg.root, String(target)))
      if (pkg.subpath) candidates.push(path.resolve(pkg.root, String(pkg.manifest.miniprogram || '.'), pkg.subpath))
    }
    for (const base of candidates) {
      const extension = /\.(scss|sass|less|wxss|css)$/.test(base) ? [''] : ['', '.scss', '.less', '.wxss', '.css', '/_index.scss', '/index.scss', '/index.less']
      const found = this.first(extension.flatMap((suffix) => {
        const candidate = base + suffix
        return [candidate, path.join(path.dirname(candidate), '_' + path.basename(candidate))]
      }))
      if (found) return found
    }
    return undefined
  }

  /** 从文件向上定位小程序根；普通目录回退到当前文件所在位置。 */
  private findRoot(file: string): string {
    for (let directory = path.dirname(file); ; directory = path.dirname(directory)) {
      if (this.exists(path.join(directory, 'app.config.ts')) || this.exists(path.join(directory, 'app.config.js')) || this.exists(path.join(directory, 'app.json'))) return directory
      // libs 等独立资源目录的模板仍属于同级 src 中的小程序。
      const src = path.join(directory, 'src')
      if (this.exists(path.join(src, 'app.config.ts')) || this.exists(path.join(src, 'app.config.js')) || this.exists(path.join(src, 'app.json'))) return src
      const config = this.json(path.join(directory, 'project.config.json'))
      if (typeof config.miniprogramRoot === 'string') {
        const root = path.resolve(directory, config.miniprogramRoot)
        if (this.exists(path.join(root, 'app.json')) || this.exists(path.join(root, 'app.config.ts'))) return root
      }
      if (directory === path.dirname(directory)) return path.dirname(file)
    }
  }
}
