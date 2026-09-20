// SPDX-License-Identifier: Apache-2.0
/** 独立声明 API 清单，CLI 按需注入，统一使用 define 前缀。 */
export { defineGlobalStore } from './store/definition.js'
export { definePageStore } from './store/plugins/page/definition.js'
export { defineStorePlugin } from './store/plugin.js'
