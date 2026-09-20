// SPDX-License-Identifier: Apache-2.0
import type { NativeConfig, PublicEnvironment } from './types.js'
import type { PageConfig, NativePageConfig } from '@miniprogramlab/core/config'

/** 原生平台工程可通过 types 引入本模块，微信 Core 工程沿用自身配置声明。 */
declare global {
  /** 当前目标平台的规范名称。 */
  const __MINIPROGRAM_PLATFORM__: string
  /** 所有平台共用的公开环境字段。 */
  const __MINIPROGRAM_ENV__: Readonly<PublicEnvironment>
  /** 抖音编译时可用的公开环境字段。 */
  const __TT_ENV__: Readonly<PublicEnvironment>
  /** 支付宝编译时可用的公开环境字段。 */
  const __ALIPAY_ENV__: Readonly<PublicEnvironment>
  /** 仅由构建器读取应用配置时提供，不是小程序运行时函数。 */
  function defineAppConfig(config: NativeConfig & { entryPageName: string }): void
  /** 按路由、构建范围与原生配置分组声明页面，不依赖微信全局类型。 */
  function definePageConfig(config: PageConfig<NativePageConfig>): void
}
