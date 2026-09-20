// SPDX-License-Identifier: Apache-2.0
import type { RouteDefinition } from './types.js'

/** 校验调用参数并生成确定顺序的 URL，拒绝未知字段与非有限数值。 */
export function encodeRoute(route: RouteDefinition, params: unknown): string {
  if (!params || typeof params !== 'object' || Array.isArray(params))
    throw new TypeError('页面参数必须为对象')
  for (const key of Object.keys(params)) {
    if (!Object.hasOwn(route.params, key)) throw new Error('页面未声明参数：' + key)
  }
  const values = params as Record<string, unknown>
  const query: string[] = []
  for (const [key, rule] of Object.entries(route.params)) {
    const value = Object.hasOwn(values, key) ? values[key] : undefined
    if (value === undefined) {
      if (rule.required) throw new Error('页面缺少必填参数：' + key)
      continue
    }
    if (typeof value !== rule.type || (rule.type === 'number' && !Number.isFinite(value)))
      throw new TypeError('页面参数类型不正确：' + key)
    query.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)))
  }
  return route.path + (query.length ? '?' + query.join('&') : '')
}

/** 按当前路由契约解析外部查询，拒绝重复参数和不合法的布尔、数值输入。 */
export function decodeQuery(route: RouteDefinition, query: string): Record<string, unknown> {
  const params: Record<string, unknown> = Object.create(null)
  for (const part of query.split('&').filter(Boolean)) {
    const separator = part.indexOf('=')
    const key = decodeURIComponent(separator < 0 ? part : part.slice(0, separator))
    const value = decodeURIComponent(separator < 0 ? '' : part.slice(separator + 1))
    if (!Object.hasOwn(route.params, key) || Object.hasOwn(params, key))
      throw new Error('返回入口参数未知或重复：' + key)
    const rule = route.params[key]!
    if (rule.type === 'boolean' && value !== 'true' && value !== 'false')
      throw new TypeError('返回入口布尔参数无效：' + key)
    if (rule.type === 'number' && !value.trim())
      throw new TypeError('返回入口数值参数不能为空：' + key)
    params[key] = rule.type === 'number' ? Number(value) : rule.type === 'boolean' ? value === 'true' : value
  }
  return params
}
