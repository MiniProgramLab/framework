// SPDX-License-Identifier: Apache-2.0
import type { PlatformAdapter } from './types.js'
import { wechat } from './platforms/wechat.js'
import { douyin } from './platforms/douyin.js'
import { alipay } from './platforms/alipay.js'

/** 内置适配器仅在注册入口汇总，公共构建流程通过协议调用。 */
export const builtinPlatforms: readonly PlatformAdapter[] = Object.freeze([wechat, douyin, alipay].map((adapter) => Object.freeze({ ...adapter, aliases: Object.freeze([...(adapter.aliases ?? [])]) })))

/** 声明适配器，不在模块导入时修改全局注册状态。 */
export function definePlatformAdapter(adapter: PlatformAdapter): PlatformAdapter { return adapter }

/** 每次加载配置创建独立注册表，拒绝平台名和别名冲突。 */
export function createPlatformRegistry(adapters: PlatformAdapter[] = []) {
  if (!Array.isArray(adapters)) throw new Error('platformAdapters 必须是适配器数组')
  const registry = new Map<string, PlatformAdapter>()
  for (const adapter of [...builtinPlatforms, ...adapters]) {
    if (!adapter || !/^[a-z][a-z0-9-]*$/.test(adapter.id)) throw new Error('平台适配器缺少合法 id')
    if (typeof adapter.label !== 'string' || !adapter.label.trim()) throw new Error('平台缺少显示名称：' + adapter.id)
    if (adapter.privateConfigFile !== undefined && adapter.privateConfigFile !== 'project.private.config.json')
      throw new Error('当前私有文件保护仅支持 project.private.config.json')
    for (const hook of ['runtime', 'validateProject', 'validateDependency', 'nativeEntries'] as const) {
      if (adapter[hook] !== undefined && typeof adapter[hook] !== 'function') throw new Error('平台钩子必须是函数：' + hook)
    }
    for (const field of ['templateExtension', 'styleExtension'] as const) {
      if (!/^\.[a-z][a-z0-9]*$/.test(adapter[field])) throw new Error('平台扩展名无效：' + field)
    }
    if (!/^[a-z][a-z0-9.-]*\.json$/.test(adapter.projectFile)) throw new Error('平台工程配置名称无效')
    if (!/^[A-Z][A-Z0-9_]*$/.test(adapter.envPrefix) || !/^__[A-Z][A-Z0-9_]*__$/.test(adapter.envGlobal))
      throw new Error('平台环境变量声明无效：' + adapter.id)
    for (const hook of ['validateApp', 'validateConfig', 'pageConfig', 'appConfig', 'projectConfig', 'validateTabs'] as const) {
      if (typeof adapter[hook] !== 'function') throw new Error('平台适配器缺少 ' + hook + '：' + adapter.id)
    }
    if (adapter.aliases !== undefined && !Array.isArray(adapter.aliases)) throw new Error('平台 aliases 必须为数组')
    if (adapter.navigationAdapter !== undefined && (typeof adapter.navigationAdapter !== 'string' || !adapter.navigationAdapter.trim()))
      throw new Error('平台 navigationAdapter 必须为非空模块路径：' + adapter.id)
    if (adapter.apiModules !== undefined && (!Array.isArray(adapter.apiModules) || adapter.apiModules.some((name) => typeof name !== 'string' || !name.trim())))
      throw new Error('平台 apiModules 必须是非空模块路径数组：' + adapter.id)
    const registered = Object.freeze({ ...adapter })
    for (const name of [adapter.id, ...(adapter.aliases ?? [])]) {
      if (!/^[a-z][a-z0-9-]*$/.test(name) || registry.has(name)) throw new Error('平台名称无效或重复：' + name)
      registry.set(name, registered)
    }
  }
  return {
    /** 按名称或别名解析适配器，未知平台在写入任何产物前报错。 */
    resolve(name = 'wechat') {
      const adapter = registry.get(name)
      if (!adapter) throw new Error('未注册的平台：' + name + '；可用平台：' + [...new Set([...registry.values()].map((item) => item.id))].join(', '))
      return adapter
    },
  }
}

/** 供底层独立调用沿用默认微信行为，完整构建传入已解析的适配器。 */
export function resolvePlatform(platform: string | PlatformAdapter = 'wechat'): PlatformAdapter {
  return typeof platform === 'object' ? platform : createPlatformRegistry().resolve(platform)
}

/** 共用源码目录中的其他平台模板和原生样式不进入本平台产物。 */
export function isForeignAsset(filename: string, adapter: PlatformAdapter) {
  return builtinPlatforms.some((item) =>
    (item.templateExtension !== adapter.templateExtension && filename.endsWith(item.templateExtension)) ||
    (item.styleExtension !== adapter.styleExtension && filename.endsWith(item.styleExtension)))
}
