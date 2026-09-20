// SPDX-License-Identifier: Apache-2.0
/** 原生适配公共入口，由组件按需接入；纯状态入口不反向导入此层。 */
export { createScrollIsolation } from './scroll.js'
export { observeBackground } from './background.js'
export type {
  OverlayHost,
  ScrollIsolation,
  ScrollIsolationOptions,
} from './scroll.js'
