// SPDX-License-Identifier: Apache-2.0
import { initialOverlayState, validateOverlayState } from './state.js'
import type { OverlayState } from './types.js'
import { defineStorePlugin } from '../../plugin.js'

/** 弹层区域只贡献初始化与结构校验，复用统一提交及页面释放机制。 */
export const overlayStorePlugin = defineStorePlugin<OverlayState>({
  key: '__overlayState__',
  option: 'overlayStore',
  create: initialOverlayState,
  validateState: validateOverlayState,
})
