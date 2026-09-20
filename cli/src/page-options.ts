// SPDX-License-Identifier: Apache-2.0
/** 校验页面分组 API，并归一化为构建器内部契约。 */
import type { DiscoveredRoute, NativeConfig } from './types.js'
import { assertRouteName } from './route-name.js'

/** 配置只能使用普通对象，避免数组、日期和空值被误当作字段集合。 */
function object(value: unknown, field: string, filename: string): NativeConfig {
  if (!value || Object.prototype.toString.call(value) !== '[object Object]')
    throw new Error(field + ' 必须为对象：' + filename)
  return value as NativeConfig
}

/** 框架字段严格校验名称，拼写错误不能静默落入原生 JSON。 */
function keys(value: NativeConfig, allowed: readonly string[], field: string, filename: string) {
  for (const key of Object.keys(value)) if (!allowed.includes(key))
    throw new Error(field + ' 不支持字段 ' + key + '：' + filename)
}

/** 校验构建维度，空数组通常是配置错误，因此不默认为全部关闭。 */
function scope(value: unknown, field: string, filename: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.length || value.some((name) => typeof name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(name)))
    throw new Error(field + ' 必须为非空名称数组：' + filename)
  return value
}

/** 原生配置必须可完整序列化，禁止函数或循环结构被静默丢弃。 */
function jsonValue(value: unknown, field: string, filename: string, parents = new Set<unknown>()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return
  if (typeof value !== 'object' || parents.has(value)) throw new Error(field + ' 必须为可序列化的 JSON 值：' + filename)
  const next = new Set(parents).add(value)
  if (!Array.isArray(value)) object(value, field, filename)
  for (const [key, item] of Object.entries(value!)) jsonValue(item, field + '.' + key, filename, next)
}

/** 配置分组不能嵌套框架元数据；组件映射保持名称与路径的明确对应。 */
function native(value: unknown, field: string, filename: string): NativeConfig {
  const config = object(value, field, filename)
  for (const key of ['page', 'route', 'build', 'config', 'platform', 'platforms', 'pagesName']) {
    if (Object.hasOwn(config, key)) throw new Error(field + '.' + key + ' 是框架字段，不能放入原生配置：' + filename)
  }
  if (config.component !== undefined && config.component !== false) throw new Error('页面不能配置 component: true：' + filename)
  if (config.usingComponents !== undefined) {
    const components = object(config.usingComponents, field + '.usingComponents', filename)
    for (const [name, reference] of Object.entries(components)) {
      if (!name.trim() || typeof reference !== 'string' || !reference.trim()) throw new Error(field + '.usingComponents 必须为组件名称到非空路径的映射：' + filename)
    }
  }
  jsonValue(config, field, filename)
  return config
}

/** 参数与 Tab 配置互斥，保留严格的标量类型供生成路由声明复用。 */
function parameters(route: NativeConfig, filename: string): DiscoveredRoute['params'] {
  if (route.tabBar !== undefined && route.params !== undefined) throw new Error('Tab 路由不能声明 page.params：' + filename)
  const params = object(route.params === undefined ? {} : route.params, 'page.params', filename)
  for (const [name, value] of Object.entries(params)) {
    const rule = object(value, 'page.params.' + name, filename)
    keys(rule, ['type', 'required'], 'page.params.' + name, filename)
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name) || !['string', 'number', 'boolean'].includes(rule.type) ||
        rule.required !== undefined && typeof rule.required !== 'boolean') throw new Error('路由参数规则无效：' + name + '（' + filename + '）')
  }
  return params
}

/** 单页面归一化不关心目录、重复名称或平台实现，跨页面约束由发现层处理。 */
export function normalizePageOptions(input: unknown, filename: string, mode: string) {
  const options = object(input, 'definePageConfig', filename)
  if (Object.hasOwn(options, 'pagesName')) throw new Error('definePageConfig 已改为分组结构：pagesName 请迁移到 page.name，原生字段放入 config：' + filename)
  keys(options, ['page', 'build', 'config'], 'definePageConfig（原生字段请放入 config）', filename)
  const route = object(options.page, 'page', filename)
  keys(route, ['name', 'description', 'params', 'tabBar'], 'page', filename)
  assertRouteName(route.name, filename)
  if (route.description !== undefined && (typeof route.description !== 'string' || !route.description.trim())) throw new Error('page.description 必须为非空字符串：' + filename)
  const build = object(options.build === undefined ? {} : options.build, 'build', filename)
  keys(build, ['modes'], 'build', filename)
  const modes = scope(build.modes, 'build.modes', filename)
  const params = parameters(route, filename)
  let tab: DiscoveredRoute['tab']
  if (route.tabBar !== undefined) {
    const value = object(route.tabBar, 'page.tabBar', filename)
    keys(value, ['id', 'text', 'order', 'iconPath', 'selectedIconPath'], 'page.tabBar', filename)
    const id = value.id === undefined ? route.name : value.id
    if (!Number.isInteger(value.order) || value.order < 0 || typeof id !== 'string' || !id.trim() ||
        typeof value.text !== 'string' || !value.text.trim() || typeof value.iconPath !== 'string' || !value.iconPath.trim() ||
        value.selectedIconPath !== undefined && (typeof value.selectedIconPath !== 'string' || !value.selectedIconPath.trim())) {
      throw new Error('page.tabBar 需要有效的 order、text 和 iconPath，id 省略时使用 page.name：' + filename)
    }
    tab = { id, text: value.text, order: value.order, iconPath: value.iconPath,
      ...(value.selectedIconPath !== undefined ? { selectedIconPath: value.selectedIconPath } : {}) }
  }
  const config = native(options.config === undefined ? {} : options.config, 'config', filename)
  const available = !modes || modes.includes(mode)
  return {
    name: route.name as string,
    description: (route.description ?? route.name) as string,
    kind: tab ? 'tab' as const : 'page' as const,
    params, tab, available,
    config,
  }
}
