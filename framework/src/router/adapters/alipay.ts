// SPDX-License-Identifier: Apache-2.0
import type { NativeNavigationApi, NativeNavigationOptions, PlatformNavigationAdapter } from '../types.js'
import { createNativeAdapter } from './native.js'

/** 支付宝导航参数的最小契约。 */
export type AlipayNavigationOptions = NativeNavigationOptions
/** 支付宝 API 的可注入结构，不要求安装平台全局声明。 */
export type AlipayNavigationApi = NativeNavigationApi
/** 仅在真实导航时访问支付宝宿主。 */
declare const my: AlipayNavigationApi

/** 支付宝适配器只绑定 my，别名为 my。 */
export function createAlipayAdapter(api: AlipayNavigationApi | (() => AlipayNavigationApi) = () => my): PlatformNavigationAdapter {
  return createNativeAdapter('alipay', ['my'], api)
}

/** CLI 注入平台模块时使用统一的工厂导出。 */
export { createAlipayAdapter as createNavigationAdapter }
