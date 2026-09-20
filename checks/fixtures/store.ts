// SPDX-License-Identifier: Apache-2.0
import { defineGlobalStore } from '@miniprogramlab/core/store/definition'

/** 测试状态使用通用主题偏好，不引用消费项目的业务类型。 */
export type Theme = 'light' | 'dark' | 'system'

/** 运行时与类型回归共用同一个最小全局状态定义。 */
export const globalStoreDefinition = defineGlobalStore(() => ({
  theme: 'light' as Theme,
}))
