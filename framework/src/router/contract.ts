// SPDX-License-Identifier: Apache-2.0
import type { RouteDefinition, RouteParamRule, RouteTable } from './types.js'

/** 初始化时复制并校验契约，后续修改输入对象不会悄悄改变实例行为。 */
export function createRouteIndex(routes: RouteTable, entryPageName: string) {
  if (!routes || typeof routes !== 'object' || Array.isArray(routes))
    throw new TypeError('路由表必须为对象')
  const byName = new Map<string, RouteDefinition>()
  const byPath = new Map<string, RouteDefinition>()
  for (const [name, input] of Object.entries(routes)) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name) || !input || input.name !== name
      || !['page', 'tab'].includes(input.kind) || typeof input.available !== 'boolean')
      throw new Error('路由声明无效：' + name)
    if (typeof input.path !== 'string' || !/^\/(?!\/)[^?#\s]+$/.test(input.path))
      throw new Error('路由路径无效：' + name)
    if (!input.params || typeof input.params !== 'object' || Array.isArray(input.params))
      throw new Error('路由参数规则必须为对象：' + name)
    const params: Record<string, RouteParamRule> = Object.create(null)
    for (const [key, rule] of Object.entries(input.params)) {
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key) || !rule
        || !['string', 'number', 'boolean'].includes(rule.type)
        || (rule.required !== undefined && typeof rule.required !== 'boolean'))
        throw new Error('路由参数规则无效：' + name + '.' + key)
      params[key] = Object.freeze({ type: rule.type, ...(rule.required === undefined ? {} : { required: rule.required }) })
    }
    if (input.kind === 'tab' && Object.keys(params).length)
      throw new Error('Tab 路由不能声明查询参数：' + name)
    const route = Object.freeze({ name, path: input.path, kind: input.kind, available: input.available, params: Object.freeze(params) })
    byName.set(name, route)
    if (byPath.has(route.path)) throw new Error('路由路径重复：' + route.path)
    byPath.set(route.path, route)
  }
  const entry = byName.get(entryPageName)
  if (!entry?.available) throw new Error('默认入口必须是已启用的页面：' + entryPageName)
  if (Object.values(entry.params).some((rule) => rule.required))
    throw new Error('应用入口不能要求必填查询参数')
  return { byName, byPath, entry }
}
