// SPDX-License-Identifier: Apache-2.0
import { logger, errorMessage } from './logger.js'
/** 收集原生 npm 组件与源码组件，固定底栏入口与普通组件共用同一模块图。 */
import type { BuildEnvironment, PlatformAdapter, NativeConfig } from './types.js'
import { createRequire } from 'node:module'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { exists, listFiles, posixPath, writeJson } from './files.js'
import { readConfig } from './config.js'
import { compileStyle } from './styles.js'
import { resolvePlatform, isForeignAsset } from './platforms.js'

/** 原生组件所在的包及其独立依赖解析器。 */
interface ComponentPackage {
  /** 原生源码根目录。 */
  directory: string
  /** 包内文件的产物前缀。 */
  prefix: string
  /** 从当前包解析依赖。 */
  resolver: NodeRequire
}

/** 已发现的组件入口及其输出位置。 */
interface CollectedComponent {
  /** 配置、脚本与无扩展名入口路径。 */
  config: string
  script: string
  base: string
  /** 所属包。 */
  item: ComponentPackage
  /** 无扩展名的产物入口。 */
  destination: string
  /** 是否已写出，避免循环组件重复处理。 */
  emitted: boolean
}

/** 为一次构建创建组件图，递归收集 usingComponents 并避免循环引用。 */
export function createComponentCollector(root: string, output: string, keep: Set<string>, options: { source?: string; production?: boolean; environment?: BuildEnvironment; adapter?: PlatformAdapter } = {}) {
  const adapter = options.adapter ?? resolvePlatform()
  const resolveFromApp = createRequire(path.join(root, 'package.json'))
  const packages = new Map<string, ComponentPackage>()
  const components = new Map<string, CollectedComponent>()
  const aliases: { filename: string; relative: string }[] = []

  /** 在源码和已编译 npm 包中查找组件四件套。 */
  async function componentFiles(base: string) {
    const config = (await exists(base + '.config.ts')) ? base + '.config.ts' : base + '.json'
    const script = (await exists(base + '.ts')) ? base + '.ts' : base + '.js'
    if (!(await exists(config)) || !(await exists(script)) || !(await exists(base + adapter.templateExtension)))
      throw new Error('原生组件缺少配置、脚本或平台模板：' + base)
    return { config, script }
  }

  /** 同一组件只能注册一个原生入口，其普通工具依赖仍使用包内共享路径。 */
  async function register(item: ComponentPackage, base: string, destination: string) {
    if (!base.startsWith(item.directory + path.sep)) throw new Error('组件引用越过包根目录：' + base)
    const files = await componentFiles(base)
    const previous = components.get(base)
    if (previous) return '/' + posixPath(previous.destination)
    const component = { ...files, base, item, destination, emitted: false }
    components.set(base, component)
    return '/' + posixPath(destination)
  }

  /** 裸包引用按 miniprogram 字段解析，允许 pnpm workspace 或发布 tarball。 */
  async function componentPath(reference: string, context?: CollectedComponent, destination?: string): Promise<string> {
    if (/^(plugin:|dynamicLib:)/.test(reference)) return reference
    if (reference.startsWith('.') && context) {
      const base = path.resolve(path.dirname(context.base), reference)
      return register(context.item, base, path.join(context.item.prefix, path.relative(context.item.directory, base)))
    }
    if (reference.startsWith('/') && context) {
      const base = path.join(context.item.directory, reference.slice(1))
      return register(context.item, base, path.join(context.item.prefix, reference.slice(1)))
    }
    if (/^(\.|\/)/.test(reference)) return reference
    const segments = reference.split('/')
    const name = segments.splice(0, reference.startsWith('@') ? 2 : 1).join('/')
    const resolver = context?.item.resolver ?? resolveFromApp
    const manifestPath = resolver.resolve(name + '/package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    const packageRoot = path.dirname(manifestPath)
    const directory = path.resolve(packageRoot, manifest.miniprogram || '.')
    if (directory !== packageRoot && !directory.startsWith(packageRoot + path.sep))
      throw new Error('miniprogram 目录必须在 npm 包内：' + name)
    let item = packages.get(name)
    if (item && item.directory !== directory) throw new Error('原生组件存在冲突版本：' + name)
    if (!item) {
      item = { directory, prefix: path.join('miniprogram_npm', name), resolver: createRequire(manifestPath) }
      packages.set(name, item)
    }
    const subpath = segments.join('/')
    if (!subpath) throw new Error('组件引用缺少子路径：' + reference)
    return register(item, path.resolve(directory, subpath), destination || path.join(item.prefix, subpath))
  }

  /** 应用引用输出绝对包路径，包内引用也归一化以支持原生底栏重定位。 */
  async function rewrite(config: NativeConfig, context?: CollectedComponent): Promise<NativeConfig> {
    if (!config.usingComponents) return config
    const usingComponents: Record<string, string> = {}
    for (const [name, reference] of Object.entries(config.usingComponents as Record<string, string>))
      usingComponents[name] = await componentPath(reference, context)
    return { ...config, usingComponents }
  }

  /** 预留平台指定的 custom-tab-bar 位置，拒绝本地源码同时占用入口。 */
  async function addNative(reference: string, destination: string) {
    if (/^(\.|\/)/.test(reference)) throw new Error('平台固定入口请使用 npm 组件包路径')
    for (const extension of ['.ts', '.js', '.config.ts', '.json', adapter.templateExtension, '.scss', '.less', adapter.styleExtension]) {
      if (await exists(path.join(options.source || root, destination + extension)))
        throw new Error('组件包与平台固定入口冲突：' + destination + extension)
    }
    await componentPath(reference, undefined, destination)
  }

  /** 写入资源并登记清单，编译失败时只影响本轮暂存目录。 */
  async function asset(filename: string, destination: string) {
    const target = path.join(output, destination)
    await mkdir(path.dirname(target), { recursive: true })
    await copyFile(filename, target)
    keep.add(destination)
  }

  /** 仅编译可达组件；样式、模板与静态资源保持包内相对关系。 */
  async function emit() {
    const entries: string[] = []
    for (const component of components.values()) {
      if (component.emitted) continue
      component.emitted = true
      const { config: filename, base, destination, script, item } = component
      const config = filename.endsWith('.ts')
        ? await readConfig(filename, options.environment)
        : JSON.parse(await readFile(filename, 'utf8'))
      if (config.component !== true) throw new Error('npm 组件必须声明 component: true：' + filename)
      adapter.validateConfig(config, filename)
      await writeJson(path.join(output, destination + '.json'), await rewrite(config, component))
      keep.add(destination + '.json')
      await asset(base + adapter.templateExtension, destination + adapter.templateExtension)
      const styles: string[] = []
      for (const extension of ['.scss', '.less', adapter.styleExtension]) if (await exists(base + extension)) styles.push(base + extension)
      if (styles.length > 1) throw new Error('组件样式输出重名：' + base)
      const css = styles.length ? await compileStyle(styles[0], { root, source: item.directory, production: options.production }) : ''
      await writeFile(path.join(output, destination + adapter.styleExtension), css)
      keep.add(destination + adapter.styleExtension)
      entries.push(script)
      aliases.push({ filename: script, relative: destination + '.js' })
    }
    const roots: { directory: string; prefix: string }[] = []
    for (const [name, item] of packages) {
      roots.push({ directory: item.directory, prefix: item.prefix })
      for (const filename of await listFiles(item.directory)) {
        // TS、预处理样式与文档不直接进入原生产物；模板导入、WXS 和静态图片继续复制。
        if (isForeignAsset(filename, adapter)) continue
        if (/\.(?:[cm]?js|tsx?|scss|less|md|map)$/.test(filename)) continue
        if (filename.endsWith('.json') && (await exists(filename.slice(0, -5) + adapter.templateExtension))) continue
        const destination = path.join(item.prefix, path.relative(item.directory, filename))
        if (!keep.has(destination)) await asset(filename, destination)
      }
      logger.info('原生 npm 组件已收集：' + name)
    }
    return { entries, roots, aliases }
  }
  return { rewrite, emit, addNative }
}
