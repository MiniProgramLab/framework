// SPDX-License-Identifier: Apache-2.0
import type { PlatformAdapter } from '../types.js'
import path from 'node:path'
import { createRequire } from 'node:module'
import { exists } from '../files.js'
import { validateSkylineApp, validateSkylineProject, validateSkylineRenderer, withSkylinePage } from '../skyline.js'
import { validateCustomTabBar } from '../tab-bar.js'
import { nativeTabItems } from './native.js'

/** 微信 Skyline 的全部原生构建差异。 */
export const wechat: PlatformAdapter = {
  id: 'wechat', aliases: ['wx'], label: '微信',
  templateExtension: '.wxml', styleExtension: '.wxss', projectFile: 'project.config.json',
  privateConfigFile: 'project.private.config.json',
  envPrefix: 'WX', envGlobal: '__WX_ENV__', worklets: true,
  navigationAdapter: '@miniprogramlab/core/router/adapters/wechat',
  validateApp: validateSkylineApp, validateConfig: validateSkylineRenderer,
  validateProject: validateSkylineProject, pageConfig: withSkylinePage, validateTabs: validateCustomTabBar,
  /** 自定义底栏仅注册页面和文字，原生底栏同时保留图标。 */
  appConfig(config, { entry, tabs }) {
    return { ...config, entryPagePath: entry.path,
      ...(config.tabBar ? { tabBar: { ...config.tabBar, list: config.tabBar.custom
        ? tabs.map((route) => ({ pagePath: route.path, text: route.tab.text })) : nativeTabItems(tabs) } } : {}) }
  },
  /** 仅显式设置的环境 AppID 覆盖工程配置，输出根始终指向当前产物。 */
  projectConfig(config, environment) {
    return { ...config, miniprogramRoot: './', appid: environment.appid || config.appid || 'touristappid' }
  },
  /** 微信自定义底栏的固定入口由适配器声明。 */
  nativeEntries(config, options) {
    return config.tabBar?.custom && options.customTabBar
      ? [{ reference: options.customTabBar, destination: 'custom-tab-bar/index' }] : []
  },
  /** 微信包装器注入由本适配器提供，其他平台无需安装 Core。 */
  async runtime({ root, source }) {
    const local = path.join(source, 'framework/runtime.ts')
    return await exists(local) ? local : createRequire(path.join(root, 'package.json')).resolve('@miniprogramlab/core/runtime')
  },
}
