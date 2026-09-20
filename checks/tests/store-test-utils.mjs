// SPDX-License-Identifier: Apache-2.0
/** Store 回归共用加载器：运行真实 TS 模块，微信生命周期由明确实例桩驱动。 */
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

/** 单次打包保证核心、定义与包装器共享同一模块身份。 */
const result = await build({
  stdin: {
    contents:
      'export * from "@miniprogramlab/core/store/core"; export * from "@miniprogramlab/core/store/definition"; export * from "@miniprogramlab/core/store/global"; export * from "@miniprogramlab/core/store/binding"; export * from "@miniprogramlab/core/store/plugin"; export * from "@miniprogramlab/core/store/setup"; export * from "@miniprogramlab/core/store/plugins/page/index"; export * from "@miniprogramlab/core/store/plugins/overlay/index"; export * from "@miniprogramlab/core/store/plugins/overlay/adapters/index"; export * from "@miniprogramlab/ui/lib/shared/controller"; export { globalStoreDefinition } from "./fixtures/store.ts";',
    resolveDir: fileURLToPath(
      new URL('../', import.meta.url),
    ),
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
})
/** 编译产物只在当前 Node 进程中加载，不改写实际小程序 dist。 */
export const runtime = await import(
  'data:text/javascript;base64,' +
    Buffer.from(
      result.outputFiles[0].text +
        '\n//# sourceURL=miniprogramlab-store-runtime.mjs',
    ).toString('base64')
)

/** 记录真实包装选项的生命周期与 setData 调用，不借用页面栈定位。 */
export function harness() {
  let app = {}
  runtime.installGlobalStore(app, runtime.globalStoreDefinition)
  const installed = new WeakSet([app])
  globalThis.getApp = () => app
  globalThis.Behavior = (value) => value
  /** 微信实例数据是普通可序列化快照，按路径合并 setData。 */
  function host(options, id, owner) {
    const behaviors = options.behaviors ?? []
    const data = Object.assign(
      {},
      ...behaviors.map((item) => item.data),
      options.data,
    )
    const writes = []
    const instance = {
      data,
      writes,
      bar: undefined,
      getPageId() {
        return id
      },
      getTabBar() {
        return this.bar
      },
      selectOwnerComponent() {
        return owner
      },
      setData(patch, callback) {
        writes.push(structuredClone(patch))
        for (const [path, value] of Object.entries(patch)) {
          const keys = path.split('.')
          let target = this.data
          for (const key of keys.slice(0, -1)) target = target[key] ??= {}
          target[keys.at(-1)] = structuredClone(value)
        }
        callback?.()
      },
      ...Object.assign(
        {},
        ...behaviors.map((item) => item.methods),
        options.methods,
      ),
    }
    /** 依照框架行为先于业务钩子的顺序执行原生生命周期。 */
    function life(name, ...args) {
      for (const behavior of behaviors)
        behavior.lifetimes?.[name]?.apply(instance, args)
      ;(options.lifetimes?.[name] ?? options[name])?.apply(instance, args)
    }
    /** 页面可见性只传递到该明确实例。 */
    function visible(name) {
      for (const behavior of behaviors)
        behavior.pageLifetimes?.[name]?.call(instance)
      options.pageLifetimes?.[name]?.call(instance)
    }
    return { instance, options, life, visible }
  }
  return {
    setApp(value) {
      app = value
      if (!installed.has(app)) {
        runtime.installGlobalStore(app, runtime.globalStoreDefinition)
        installed.add(app)
      }
    },
    make(input, id, { isPage = false, owner } = {}) {
      return host(runtime.storeOptions(input, isPage), id, owner)
    },
    mount(input, id, options) {
      const item = this.make(input, id, options)
      item.life('created')
      item.life('attached')
      return item
    },
  }
}
