/** 按实际依赖生成微信 CommonJS 模块，普通依赖共享，Worklet 依赖随调用方内联。 */
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { posixPath } from './files.mjs'
import { exists } from './files.mjs'
import { createRequire } from 'node:module'

/** 将产物间引用转换为明确的相对路径，交由微信模块缓存复用实例。 */
function moduleReference(importer, target) {
  const relative = posixPath(path.relative(path.dirname(importer), target))
  return relative.startsWith('.') ? relative : './' + relative
}

/** 从原生入口遍历依赖，只生成可达模块，不把普通工具文件视作启动入口。 */
export async function compileModules({
  entries,
  root,
  source,
  output,
  staging,
  production,
  environment,
  componentRoots = [],
  entryAliases = [],
  excludedDirectories = [],
}) {
  // pnpm 和 macOS 临时目录含符号链接，统一真实路径后判断模块身份及目录归属。
  root = await realpath(root)
  source = await realpath(source)
  entries = await Promise.all(entries.map((filename) => realpath(filename)))
  componentRoots = await Promise.all(
    componentRoots.map(async (item) => ({
      ...item,
      directory: await realpath(item.directory),
    })),
  )
  excludedDirectories = await Promise.all(
    excludedDirectories.map((directory) => realpath(directory)),
  )
  const modules = new Map()
  const destinations = new Map()
  const nativeEntries = new Set(entries)
  const files = []
  const aliases = new Map(await Promise.all(entryAliases.map(async (item) => [await realpath(item.filename), item.relative])))
  // 保留旧项目本地包装器兼容；独立项目从自身依赖解析框架实例。
  const localRuntime = path.join(source, 'framework/runtime.ts')
  const frameworkRuntime = await exists(localRuntime)
    ? localRuntime
    : createRequire(path.join(root, 'package.json')).resolve('@miniprogramlab/core/runtime')

  /** 本地模块保留源码目录，外部依赖按相对工作区的稳定身份分配唯一产物。 */
  function register(filename) {
    if (modules.has(filename)) return modules.get(filename)
    const owner = [{ directory: source, prefix: '' }, ...componentRoots].find(
      (item) => filename.startsWith(item.directory + path.sep),
    )
    const relative = aliases.get(filename) ?? (owner
      ? path.join(
          owner.prefix,
          path
            .relative(owner.directory, filename)
            .replace(/\.(?:[cm]?js|tsx?|json)$/, '.js'),
        )
      : path.join(
          'common/vendor',
          createHash('sha256')
            .update(posixPath(path.relative(root, filename)))
            .digest('hex')
            .slice(0, 16) + '.js',
        ))
    if (destinations.has(relative))
      throw new Error('模块产物路径冲突：' + relative)
    modules.set(filename, relative)
    destinations.set(relative, filename)
    return relative
  }

  for (const entry of entries) register(entry)
  const pending = new Set(entries)
  // 只追踪最终产物保留的导入，类型导入及被消除的注入依赖不会额外输出。
  for (const filename of pending) {
    const relative = modules.get(filename)
    const dependencies = new Map()
    const result = await build({
      absWorkingDir: root,
      entryPoints: [filename],
      outfile: path.join(output, relative),
      write: false,
      bundle: true,
      platform: 'neutral',
      format: 'cjs',
      target: 'es2018',
      metafile: true,
      mainFields: ['module', 'main'],
      sourcemap: !production,
      minify: production,
      define: { __WX_ENV__: JSON.stringify(environment) },
      logLevel: 'silent',
      inject: ['wx:framework'],
      plugins: [
        {
          name: 'wx-common-modules',
          /** 普通依赖留作 require，显式标记的 Worklet 模块保持同一编译闭包。 */
          setup(context) {
            context.onResolve({ filter: /^wx:framework$/ }, () => ({
              path: 'runtime',
              namespace: 'wx-inject',
              sideEffects: false,
            }))
            context.onLoad({ filter: /.*/, namespace: 'wx-inject' }, () => ({
              contents:
                'export { definePage, defineComponent } from ' + JSON.stringify(frameworkRuntime) + ';',
              resolveDir: root,
              loader: 'js',
            }))
            context.onResolve({ filter: /.*/ }, async (args) => {
              if (args.kind === 'entry-point' || args.pluginData?.nativeResolve)
                return
              const resolved = await context.resolve(args.path, {
                importer: args.importer,
                resolveDir: args.resolveDir,
                kind: args.kind,
                pluginData: { nativeResolve: true },
              })
              if (resolved.errors.length) return { errors: resolved.errors }
              if (resolved.external || !resolved.path)
                return {
                  errors: [
                    { text: '微信模块无法解析运行时依赖：' + args.path },
                  ],
                }
              if (
                excludedDirectories.some((directory) =>
                  resolved.path.startsWith(directory + path.sep),
                )
              ) {
                return {
                  errors: [
                    { text: '当前环境不能导入已排除页面的实现：' + args.path },
                  ],
                }
              }
              if (/\.worklet\.[jt]s$/.test(resolved.path))
                return { path: resolved.path }
              if (/\.worklet\.[jt]s$/.test(args.importer)) {
                return {
                  errors: [
                    {
                      text:
                        'Worklet 的运行时依赖也必须使用 .worklet.ts，类型依赖请使用 import type：' +
                        args.path,
                    },
                  ],
                }
              }
              if (nativeEntries.has(resolved.path)) {
                return {
                  errors: [
                    {
                      text:
                        '普通模块不能导入原生注册入口，请将复用逻辑提取为独立模块：' +
                        args.path,
                    },
                  ],
                }
              }
              const target = register(resolved.path)
              const reference = moduleReference(relative, target)
              dependencies.set(reference, resolved.path)
              return {
                path: reference,
                external: true,
                sideEffects: resolved.sideEffects,
              }
            })
          },
        },
      ],
    })
    for (const emitted of Object.values(result.metafile.outputs)) {
      for (const imported of emitted.imports) {
        if (dependencies.has(imported.path))
          pending.add(dependencies.get(imported.path))
      }
    }
    for (const file of result.outputFiles) {
      const target = path.relative(output, file.path)
      await mkdir(path.dirname(path.join(staging, target)), { recursive: true })
      await writeFile(path.join(staging, target), file.contents)
      files.push(target)
    }
  }
  return files
}
