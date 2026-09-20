// SPDX-License-Identifier: Apache-2.0
import type {
  Router, RouterOptions, RouteDefinition, RouteTable,
  NavigationBackResult, NavigationError, NavigationMethod, NavigationResult,
} from './types.js'
import { createNavigationAdapter } from '@miniprogramlab/core/router/platform'
import { createRouteIndex } from './contract.js'
import { decodeQuery, encodeRoute } from './codec.js'
import { createNavigationBackBuilder, createNavigationBuilder, createNavigationUrlBuilder } from './builder.js'
import type { NavigationAction } from './builder.js'

/** 从应用契约创建隔离的路由实例，平台能力仅通过适配器注入。 */
export function createRouter<const R extends RouteTable>(options: RouterOptions<R>): Router<R> {
  const adapter = options.adapter ?? createNavigationAdapter()
  for (const method of ['navigateTo', 'switchTab', 'reLaunch'] as const) {
    if (typeof adapter?.[method] !== 'function') throw new TypeError('导航适配器缺少方法：' + method)
  }
  const { byPath, entry } = createRouteIndex(options.routes, options.entryPageName)

  /** 错误上报本身不能产生第二个未处理异常或 Promise 拒绝。 */
  function logError(error: unknown): void {
    try { console.error('[MiniProgramLab Router]', error) } catch { /* 宿主日志不可用时不影响导航调用。 */ }
  }

  /** 每次失败记录一次内部诊断并保留平台原因，不弹窗或要求业务注册监听器。 */
  function report(cause: unknown, target: string, phase: NavigationError['phase']): NavigationError {
    let message = '路由跳转失败'
    try {
      if (typeof cause === 'string') message = cause
      else if (cause && typeof cause === 'object') {
        const value = cause as { message?: unknown; errMsg?: unknown }
        message = String(value.message ?? value.errMsg ?? message)
      }
    } catch { /* 保留无法读取属性的原始错误对象。 */ }
    const error: NavigationError = Object.freeze({ phase, target, message, cause })
    logError(error)
    return error
  }

  /** 路径直接对应枚举值，JS 与模板输入仍校验页面存在性及当前环境。 */
  function requireRoute(path: string): RouteDefinition {
    const route = byPath.get(path)
    if (!route) throw new Error('页面不存在：' + path)
    if (!route.available) throw new Error('当前环境未启用页面：' + path)
    return route
  }

  /** 路径与 URL 导航共享结果模型，同步异常和异步失败均在此收敛。 */
  async function execute(target: string, resolve: () => { route: RouteDefinition; url: string }, action: NavigationAction): Promise<NavigationResult> {
    let phase: NavigationError['phase'] = 'resolve'
    try {
      const { route, url } = resolve()
      const method: NavigationMethod = route.kind === 'tab' ? 'switchTab'
        : action === 'reLaunch' ? 'reLaunch' : action === 'replace' ? 'redirectTo' : 'navigateTo'
      phase = 'navigate'
      const operation = adapter[method]
      if (typeof operation !== 'function') throw new Error('导航适配器缺少方法：' + method)
      await operation.call(adapter, url)
      return { ok: true, url, method }
    } catch (cause) {
      return { ok: false, error: report(cause, target, phase) }
    }
  }

  /** 校验路由参数后执行导航；内部 Promise 始终正常完成。 */
  function navigate(path: string, params: unknown, action: NavigationAction = 'go'): Promise<NavigationResult> {
    return execute(path, () => {
      const route = requireRoute(path)
      return { route, url: encodeRoute(route, params === undefined ? {} : params) }
    }, action)
  }

  /** 返回层数只在执行时校验，原生失败仍进入统一诊断通道。 */
  async function navigateBack(delta: number): Promise<NavigationBackResult> {
    let phase: NavigationError['phase'] = 'resolve'
    try {
      if (!Number.isSafeInteger(delta) || delta < 1) throw new RangeError('返回层数必须是正安全整数')
      phase = 'navigate'
      if (typeof adapter.navigateBack !== 'function') throw new Error('导航适配器缺少方法：navigateBack')
      await adapter.navigateBack(delta)
      return { ok: true, method: 'navigateBack', delta }
    } catch (cause) {
      return { ok: false, error: report(cause, 'navigateBack', phase) }
    }
  }

  /** 对完整应用内 URL 解码并校验，终结方法显式决定页面栈操作。 */
  function navigateUrl(url: string, action: NavigationAction): Promise<NavigationResult> {
    return execute(url, () => {
      if (typeof url !== 'string' || url.includes('#') || url.split('?').length > 2)
        throw new Error('页面地址包含无效的片段或查询标识')
      const [pathname, query = ''] = url.split('?')
      const route = requireRoute(pathname!)
      return { route, url: encodeRoute(route, decodeQuery(route, query)) }
    }, action)
  }

  return Object.freeze({
    /** 查询当前环境可用性，不启动导航。 */
    isRouteAvailable(path) { return byPath.get(path)?.available ?? false },
    /** 选择页面只创建配置，平台操作由链上的终结方法触发。 */
    navigateTo(path) { return createNavigationBuilder<R, typeof path>(path, byPath.get(path), navigate, logError) },
    /** URL 保留原始快照，直到执行时才读取与校验路由。 */
    navigateToUrl(url) { return createNavigationUrlBuilder((action) => navigateUrl(url, action), logError) },
    /** 返回操作没有目标页，不参与路由参数推导。 */
    navigateBack(delta = 1) { return createNavigationBackBuilder(() => navigateBack(delta), logError) },
    /** 无效参数通过同一错误通道报告，不把错误地址交给调用方。 */
    getRouteUrl(path, ...args) {
      try { return encodeRoute(requireRoute(path), args[0] === undefined ? {} : args[0]) }
      catch (cause) { report(cause, path, 'resolve'); return undefined }
    },
    /** 默认入口已在实例初始化时完成校验。 */
    getEntryRouteUrl() { return encodeRoute(entry, {}) },
  } satisfies Router<R>)
}
