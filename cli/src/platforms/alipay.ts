// SPDX-License-Identifier: Apache-2.0
import type { PlatformAdapter } from '../types.js'
import { createAlipayApp, nativePage, validateNativeConfig, validateNativeTabs, validateNativeDependency } from './native.js'

/** 支付宝原生源码构建适配器。 */
export const alipay: PlatformAdapter = {
  id: 'alipay', aliases: ['my'], label: '支付宝',
  templateExtension: '.axml', styleExtension: '.acss', projectFile: 'mini.project.json',
  envPrefix: 'ALIPAY', envGlobal: '__ALIPAY_ENV__', worklets: false,
  navigationAdapter: '@miniprogramlab/core/router/adapters/alipay',
  validateDependency: validateNativeDependency,
  validateApp: validateNativeConfig, validateConfig: validateNativeConfig,
  pageConfig: nativePage, appConfig: createAlipayApp, validateTabs: validateNativeTabs,
  /** 支付宝应用身份由开发者工具管理，工程文件仅写入其原生配置。 */
  projectConfig(config) { return { ...config, miniprogramRoot: './' } },
}
