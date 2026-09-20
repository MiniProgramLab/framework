// SPDX-License-Identifier: Apache-2.0
import type { PlatformNavigationAdapter } from './types.js'

/** 创建显式、隔离的平台注册表，不导入平台实现或修改全局单例。 */
export function createNavigationRegistry(adapters: readonly PlatformNavigationAdapter[] = []) {
  const registry = new Map<string, PlatformNavigationAdapter>()

  /** 完整校验后一次性注册，名称冲突时不留下部分别名。 */
  function register(adapter: PlatformNavigationAdapter): void {
    if (!adapter || (adapter.aliases !== undefined && !Array.isArray(adapter.aliases)))
      throw new TypeError('导航适配器声明无效')
    const names = [adapter.id, ...(adapter.aliases ?? [])]
    const pending = new Set<string>()
    for (const name of names) {
      if (typeof name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(name) || registry.has(name) || pending.has(name))
        throw new Error('导航平台名称无效或重复：' + name)
      pending.add(name)
    }
    for (const method of ['navigateTo', 'switchTab', 'reLaunch'] as const) {
      if (typeof adapter[method] !== 'function') throw new TypeError('导航适配器缺少方法：' + method)
    }
    // 可选的平台能力一旦声明就必须是函数，避免注册一半后失败。
    for (const method of ['redirectTo', 'navigateBack'] as const) {
      if (adapter[method] !== undefined && typeof adapter[method] !== 'function')
        throw new TypeError('导航适配器方法无效：' + method)
    }
    const registered = Object.freeze({
      id: adapter.id, aliases: Object.freeze([...(adapter.aliases ?? [])]),
      navigateTo: adapter.navigateTo.bind(adapter),
      ...(adapter.redirectTo ? { redirectTo: adapter.redirectTo.bind(adapter) } : {}),
      ...(adapter.navigateBack ? { navigateBack: adapter.navigateBack.bind(adapter) } : {}),
      switchTab: adapter.switchTab.bind(adapter),
      reLaunch: adapter.reLaunch.bind(adapter),
    })
    for (const name of names) registry.set(name, registered)
  }

  for (const adapter of adapters) register(adapter)
  return Object.freeze({
    register,
    /** 省略名称时选择已注册的微信适配器，不隐式加载平台实现。 */
    resolve(platform = 'wechat'): PlatformNavigationAdapter {
      const adapter = registry.get(platform)
      if (!adapter) throw new Error('未注册导航平台：' + platform)
      return adapter
    },
  })
}
