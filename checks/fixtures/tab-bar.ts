// SPDX-License-Identifier: Apache-2.0
import { createDefaultConfig, mergeTabBarConfig } from '@miniprogramlab/ui/custom-tab-bar/config'
import type { CustomTabItem } from '@miniprogramlab/ui/custom-tab-bar/types'

/** 显式提供原生路由，组件测试无需复制消费应用的页面。 */
export const registeredTabs: Array<CustomTabItem & { pagePath: string }> = [
  { id: 'home', text: '首页', pagePath: '/pages/home/index', iconPath: '/icons/home.svg' },
  { id: 'activity', text: '动态', pagePath: '/pages/activity/index', iconPath: '/icons/activity.svg' },
  { id: 'stats', text: '统计', pagePath: '/pages/stats/index', iconPath: '/icons/stats.svg' },
  { id: 'profile', text: '我的', pagePath: '/pages/profile/index', iconPath: '/icons/profile.svg' },
]

/** 预览实例与原生实例沿用同一组默认导航项。 */
export const appTabBarConfig = mergeTabBarConfig(createDefaultConfig(), {
  items: registeredTabs,
})
