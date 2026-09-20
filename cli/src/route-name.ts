// SPDX-License-Identifier: Apache-2.0
/** 路由名直接作为枚举成员，统一限制为无需引号的稳定标识符。 */
export function assertRouteName(name: unknown, filename: string): asserts name is string {
  if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(name))
    throw new Error('page.name 将作为 PageEnum 成员，必须以英文字母开头，且仅含字母、数字和下划线：' + filename)
}
