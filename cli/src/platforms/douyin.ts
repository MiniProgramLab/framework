// SPDX-License-Identifier: Apache-2.0
import type { PlatformAdapter } from '../types.js'
import { createDouyinApp, nativePage, validateNativeConfig, validateNativeTabs, validateNativeDependency } from './native.js'

/** 抖音原生源码构建适配器。 */
export const douyin: PlatformAdapter = {
  id: 'douyin', aliases: ['tt'], label: '抖音',
  templateExtension: '.ttml', styleExtension: '.ttss', projectFile: 'project.config.json',
  envPrefix: 'TT', envGlobal: '__TT_ENV__', worklets: false,
  navigationAdapter: '@miniprogramlab/core/router/adapters/douyin',
  validateDependency: validateNativeDependency,
  validateApp: validateNativeConfig, validateConfig: validateNativeConfig,
  pageConfig: nativePage, appConfig: createDouyinApp, validateTabs: validateNativeTabs,
  /** 使用抖音原生工程配置，不继承微信 Skyline 设置。 */
  projectConfig(config, environment) {
    return { ...config, miniprogramRoot: './',
      ...(environment.appid ? { appid: environment.appid } : {}) }
  },
}
