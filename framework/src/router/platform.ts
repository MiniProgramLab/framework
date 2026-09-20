// SPDX-License-Identifier: Apache-2.0
import type { NavigationAdapter } from './types.js'

/** CLI 将此入口替换为目标平台实现；独立宿主需显式传入适配器。 */
export function createNavigationAdapter(): NavigationAdapter {
  throw new Error('未注入路由平台，请通过 miniprogram CLI 构建，或向 createRouter 显式传入 adapter')
}
