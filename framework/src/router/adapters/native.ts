// SPDX-License-Identifier: Apache-2.0
import type { NativeNavigationApi, PlatformNavigationAdapter } from '../types.js'

/** 复用回调转换，宿主来源和平台身份由各适配器显式提供。 */
export function createNativeAdapter(
  id: string,
  aliases: readonly string[],
  api: NativeNavigationApi | (() => NativeNavigationApi),
): PlatformNavigationAdapter {
  /** 保留 API 接收者，回调失败与同步异常均通过 Promise 传递。 */
  function invoke(method: Exclude<keyof NativeNavigationApi, 'navigateBack'>, url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const native = typeof api === 'function' ? api() : api
      if (typeof native?.[method] !== 'function') throw new Error('平台导航能力不可用：' + id + '.' + method)
      native[method]({ url, success: () => resolve(), fail: reject })
    })
  }
  return Object.freeze({
    id, aliases: Object.freeze([...aliases]),
    /** 打开普通页面。 */
    navigateTo: (url: string) => invoke('navigateTo', url),
    /** 替换当前普通页面。 */
    redirectTo: (url: string) => invoke('redirectTo', url),
    /** 返回层数使用独立参数形状，保留平台接收者及原始错误。 */
    navigateBack: (delta: number) => new Promise<void>((resolve, reject) => {
      const native = typeof api === 'function' ? api() : api
      if (typeof native?.navigateBack !== 'function') throw new Error('平台导航能力不可用：' + id + '.navigateBack')
      native.navigateBack({ delta, success: () => resolve(), fail: reject })
    }),
    /** 切换原生底栏。 */
    switchTab: (url: string) => invoke('switchTab', url),
    /** 重建原生页面栈。 */
    reLaunch: (url: string) => invoke('reLaunch', url),
  })
}
