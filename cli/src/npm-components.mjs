/** 收集原生 npm 组件与源码组件，固定底栏入口与普通组件共用同一模块图。 */
import { createRequire } from 'node:module'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { exists, listFiles, posixPath, writeJson } from './files.mjs'
import { readConfig } from './config.mjs'
import { compileStyle } from './styles.mjs'
import { validateSkylineRenderer } from './skyline.mjs'

/** 为一次构建创建组件图，递归收集 usingComponents 并避免循环引用。 */
export function createComponentCollector(root, output, keep, options = {}) {
  const resolveFromApp = createRequire(path.join(root, 'package.json'))
  const packages = new Map()
  const components = new Map()
  const aliases = []

  /** 在源码和已编译 npm 包中查找组件四件套。 */
  async function componentFiles(base) {
    const config = (await exists(base + '.config.ts')) ? base + '.config.ts' : base + '.json'
    const script = (await exists(base + '.ts')) ? base + '.ts' : base + '.js'
    if (!(await exists(config)) || !(await exists(script)) || !(await exists(base + '.wxml')))
      throw new Error('原生组件缺少配置、脚本或 WXML：' + base)
    return { config, script }
  }

  /** 同一组件只能注册一个原生入口，其普通工具依赖仍使用包内共享路径。 */
  async function register(item, base, destination) {
    if (!base.startsWith(item.directory + path.sep)) throw new Error('组件引用越过包根目录：' + base)
    const files = await componentFiles(base)
    const previous = components.get(base)
    if (previous) return '/' + posixPath(previous.destination)
    const component = { ...files, base, item, destination, emitted: false }
    components.set(base, component)
    return '/' + posixPath(destination)
  }

  /** 裸包引用按 miniprogram 字段解析，允许 pnpm workspace 或发布 tarball。 */
  async function componentPath(reference, context, destination) {
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
  async function rewrite(config, context) {
    if (!config.usingComponents) return config
    const usingComponents = {}
    for (const [name, reference] of Object.entries(config.usingComponents))
      usingComponents[name] = await componentPath(reference, context)
    return { ...config, usingComponents }
  }

  /** 预留微信指定的 custom-tab-bar 位置，拒绝本地源码同时占用入口。 */
  async function addNative(reference, destination) {
    if (/^(\.|\/)/.test(reference)) throw new Error('customTabBar 请使用 npm 组件包路径')
    for (const extension of ['.ts', '.js', '.config.ts', '.json', '.wxml', '.scss', '.less', '.wxss']) {
      if (await exists(path.join(options.source, destination + extension)))
        throw new Error('包底栏与本地入口冲突：' + destination + extension)
    }
    await componentPath(reference, undefined, destination)
  }

  /** 写入资源并登记清单，编译失败时只影响本轮暂存目录。 */
  async function asset(filename, destination) {
    const target = path.join(output, destination)
    await mkdir(path.dirname(target), { recursive: true })
    await copyFile(filename, target)
    keep.add(destination)
  }

  /** 仅编译可达组件；样式、模板与静态资源保持包内相对关系。 */
  async function emit() {
    const entries = []
    for (const component of components.values()) {
      if (component.emitted) continue
      component.emitted = true
      const { config: filename, base, destination, script, item } = component
      const config = filename.endsWith('.ts')
        ? await readConfig(filename, options.environment)
        : JSON.parse(await readFile(filename, 'utf8'))
      if (config.component !== true) throw new Error('npm 组件必须声明 component: true：' + filename)
      validateSkylineRenderer(config, filename)
      await writeJson(path.join(output, destination + '.json'), await rewrite(config, component))
      keep.add(destination + '.json')
      await asset(base + '.wxml', destination + '.wxml')
      const styles = []
      for (const extension of ['.scss', '.less', '.wxss']) if (await exists(base + extension)) styles.push(base + extension)
      if (styles.length > 1) throw new Error('组件样式输出重名：' + base)
      const css = styles.length ? await compileStyle(styles[0], { root, source: item.directory, production: options.production }) : ''
      await writeFile(path.join(output, destination + '.wxss'), css)
      keep.add(destination + '.wxss')
      entries.push(script)
      aliases.push({ filename: script, relative: destination + '.js' })
    }
    const roots = []
    for (const [name, item] of packages) {
      roots.push({ directory: item.directory, prefix: item.prefix })
      for (const filename of await listFiles(item.directory)) {
        // TS、预处理样式与文档不直接进入微信产物；模板导入、WXS 和静态图片继续复制。
        if (/\.(?:[cm]?js|tsx?|scss|less|md|map)$/.test(filename)) continue
        if (filename.endsWith('.json') && (await exists(filename.slice(0, -5) + '.wxml'))) continue
        const destination = path.join(item.prefix, path.relative(item.directory, filename))
        if (!keep.has(destination)) await asset(filename, destination)
      }
      console.log('原生 npm 组件已收集：' + name)
    }
    return { entries, roots, aliases }
  }
  return { rewrite, emit, addNative }
}
