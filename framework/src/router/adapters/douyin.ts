// SPDX-License-Identifier: Apache-2.0
import type { NativeNavigationApi, NativeNavigationOptions, PlatformNavigationAdapter } from '../types.js'
import { createNativeAdapter } from './native.js'

/** 抖音导航参数的最小契约。 */
export type DouyinNavigationOptions = NativeNavigationOptions
/** 抖音 API 的可注入结构，不要求安装平台全局声明。 */
export type DouyinNavigationApi = NativeNavigationApi
/** 仅在真实导航时访问抖音宿主。 */
declare const tt: DouyinNavigationApi

/** 抖音适配器只绑定 tt，别名为 tt。 */
export function createDouyinAdapter(api: DouyinNavigationApi | (() => DouyinNavigationApi) = () => tt): PlatformNavigationAdapter {
  return createNativeAdapter('douyin', ['tt'], api)
}

/** CLI 注入平台模块时使用统一的工厂导出。 */
export { createDouyinAdapter as createNavigationAdapter }
