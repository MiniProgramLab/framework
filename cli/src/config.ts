// SPDX-License-Identifier: Apache-2.0
/** 在独立执行上下文中读取配置，避免监听重编译时共享全局注册状态。 */
import type { NativeConfig, BuildEnvironment } from './types.js'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { Script } from 'node:vm'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { environmentDefines } from './env.js'
import { extractPageConfig, inspectPageSource } from './page-config.js'
import { configApiSource } from './api.js'

/** 编译 TS 配置并捕获一次对应的 define 调用；本地组件保留默认导出语法。 */
export async function readConfig(filename: string, environment: BuildEnvironment | undefined, kind = 'component'): Promise<NativeConfig> {
  if (!environment) throw new Error('读取配置时缺少构建环境：' + filename)
  /** 应用和页面配置共同检查宏写法，原生组件仍使用默认导出。 */
  const configSource = kind === 'app' || kind === 'page' ? await readFile(filename, 'utf8') : undefined
  if (kind === 'app') inspectPageSource(filename, configSource!)
  const result = await build({
    ...(kind === 'page' ? {
      stdin: {
        contents: extractPageConfig(filename, configSource!),
        sourcefile: filename,
        resolveDir: path.dirname(filename),
        loader: 'ts' as const,
      },
    } : { entryPoints: [filename] }),
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    define: environmentDefines(environment.public, environment.adapter || environment.public?.platform),
    logLevel: 'silent',
    inject: ['miniprogram:config-inject'],
    plugins: [{
      name: 'miniprogram-config-api',
      /** 配置阶段只装配纯函数，宏通过当前 VM 上下文注册。 */
      setup(context) {
        context.onResolve({ filter: /^miniprogram:config-/ }, (args) => ({ path: args.path, namespace: 'config-api', sideEffects: false }))
        context.onLoad({ filter: /.*/, namespace: 'config-api' }, () => ({
          contents: configApiSource(path.dirname(filename)),
          loader: 'js', resolveDir: path.dirname(filename),
        }))
      },
    }],
  })
  const registrations: { type: string; config: NativeConfig }[] = []
  const module: { exports: { default?: NativeConfig } } = { exports: {} }
  /** 记录全部调用，执行后统一校验类型与次数，避免被后一次覆盖。 */
  function register(type: string, config: NativeConfig) {
    registrations.push({ type, config })
  }
  new Script(result.outputFiles[0].text, { filename }).runInNewContext(
    {
      module,
      exports: module.exports,
      require: createRequire(filename),
      defineAppConfig: (config: NativeConfig) => register('app', config),
      definePageConfig: (config: NativeConfig) => register('page', config),
    },
    { timeout: 1000 },
  )

  let config
  if (kind === 'component') {
    if (registrations.length)
      throw new Error(
        '本地组件配置请默认导出对象，不调用页面或应用配置函数：' + filename,
      )
    config = module.exports.default
  } else {
    const helper = kind === 'app' ? 'defineAppConfig' : 'definePageConfig'
    if (
      registrations.length !== 1 ||
      registrations[0].type !== kind ||
      'default' in module.exports
    ) {
      throw new Error(
        '配置必须且只能直接调用一次 ' +
          helper +
          '()，无须 export default：' +
          filename,
      )
    }
    config = registrations[0].config
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('配置必须为非空对象：' + filename)
  }
  return config
}
