// SPDX-License-Identifier: Apache-2.0
import type { NativeNavigationApi, NativeNavigationOptions, PlatformNavigationAdapter } from '../types.js'
import { createNativeAdapter } from './native.js'

/** 微信导航参数的最小契约。 */
export type WechatNavigationOptions = NativeNavigationOptions
/** 微信 API 的可注入结构，不要求安装平台全局声明。 */
export type WechatNavigationApi = NativeNavigationApi
/** 仅在真实导航时访问微信宿主。 */
declare const wx: WechatNavigationApi

/** 微信适配器只绑定 wx，别名为 wx。 */
export function createWechatAdapter(api: WechatNavigationApi | (() => WechatNavigationApi) = () => wx): PlatformNavigationAdapter {
  return createNativeAdapter('wechat', ['wx'], api)
}

/** CLI 注入平台模块时使用统一的工厂导出。 */
export { createWechatAdapter as createNavigationAdapter }
