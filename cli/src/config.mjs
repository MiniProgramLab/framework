/** 在独立执行上下文中读取配置，避免监听重编译时共享全局注册状态。 */
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { Script } from 'node:vm'

/** 编译 TS 配置并捕获一次对应的 define 调用；本地组件保留默认导出语法。 */
export async function readConfig(filename, environment, kind = 'component') {
  const result = await build({
    entryPoints: [filename],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    define: { __WX_ENV__: JSON.stringify(environment.public) },
    logLevel: 'silent',
  })
  const registrations = []
  const module = { exports: {} }
  /** 记录全部调用，执行后统一校验类型与次数，避免被后一次覆盖。 */
  function register(type, config) {
    registrations.push({ type, config })
  }
  new Script(result.outputFiles[0].text, { filename }).runInNewContext(
    {
      module,
      exports: module.exports,
      require: createRequire(filename),
      defineAppConfig: (config) => register('app', config),
      definePageConfig: (config) => register('page', config),
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
