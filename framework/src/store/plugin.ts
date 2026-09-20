// SPDX-License-Identifier: Apache-2.0
import type { StoreSnapshot, StoreState } from './types.js'

/** 插件内部区域统一使用私有命名空间，不允许作为业务状态字段。 */
export type StorePluginKey = `__${string}__`
/** 插件仅接收参与者与所属页面的声明选项，不持有页面实例或根容器。 */
export interface StorePluginContext {
  /** 当前参与实例的声明选项。 */
  readonly options: Readonly<Record<string, unknown>>
  /** 所属页面的声明选项，由插件自行解释其配置。 */
  readonly ownerOptions: Readonly<Record<string, unknown>>
}
/** 插件声明隔离区域及接入约定，状态和生命周期仍由核心托管。 */
export interface StorePlugin<S extends StoreState = StoreState> {
  readonly key: StorePluginKey
  readonly option: string
  /** 插件消费的附加选项，以参与开关为前缀，不透传给原生构造器。 */
  readonly extraOptions?: readonly string[]
  /** 每个所属令牌仅在首个参与者接入时执行。 */
  readonly create: (context: StorePluginContext) => S
  /** 声明时校验附加选项，不创建状态。 */
  readonly validateOptions?: (options: StorePluginContext['options']) => void
  /** 每次连接均校验归属约束，包括复用已初始化区域时。 */
  readonly validateContext?: (context: StorePluginContext) => void
  /** 初始化与每次提交共享结构约束，校验失败不发布状态。 */
  validateState?(state: StoreSnapshot<S>): void
}
/** 类型注册表由插件通过模块扩展添加，值为对应状态类型。 */
export interface StorePluginStates<S extends StoreState = StoreState> {}
/** 插件自行声明附加选项类型，可关联当前实例推导出的状态。 */
export interface StorePluginOptions<S extends StoreState = StoreState> {}
/** 注册时统一擦除状态参数，业务连接仍通过原始插件推导类型。 */
export type RegisteredStorePlugin = StorePlugin<StoreState>
/** 注册器在第一次装配后封存，所有 App 和实例使用同一份配置快照。 */
export interface StorePluginRegistry {
  /** 重复注册同一声明幂等，不同声明的区域名或开关冲突时拒绝。 */
  register<S extends StoreState>(plugin: StorePlugin<S>): void
  /** 首次读取冻结注册集合，禁止运行中的实例错过新插件。 */
  seal(): readonly RegisteredStorePlugin[]
}

/** 校验插件协议，拒绝与全局门面、原生选项和原型字段冲突的名称。 */
export function validateStorePlugin(plugin: RegisteredStorePlugin): void {
  if (
    !plugin ||
    typeof plugin.key !== 'string' ||
    typeof plugin.option !== 'string' ||
    !/^__[A-Za-z][A-Za-z0-9_]*__$/.test(plugin.key) ||
    !/^[a-z][A-Za-z0-9]*Store$/.test(plugin.option) ||
    plugin.option === 'globalStore' ||
    typeof plugin.create !== 'function' ||
    [
      plugin.create,
      plugin.validateOptions,
      plugin.validateContext,
      plugin.validateState,
    ].some(
      (hook) =>
        hook !== undefined &&
        (typeof hook !== 'function' ||
          Object.prototype.toString.call(hook) === '[object AsyncFunction]'),
    )
  )
    throw new TypeError('Store 插件声明无效或名称冲突')
  if (
    plugin.extraOptions !== undefined &&
    (!Array.isArray(plugin.extraOptions) ||
      new Set(plugin.extraOptions).size !== plugin.extraOptions.length ||
      plugin.extraOptions.some(
        (name) =>
          typeof name !== 'string' ||
          !new RegExp('^' + plugin.option + '[A-Z][A-Za-z0-9]*$').test(name),
      ))
  )
    throw new TypeError('Store 插件附加选项必须唯一且使用自身开关前缀')
}

/** 统一列出插件声明的选项，注册冲突检查和原生选项清理使用同一约定。 */
export function storePluginOptionNames(
  plugin: RegisteredStorePlugin,
): readonly string[] {
  return [plugin.option, ...(plugin.extraOptions ?? [])]
}

/** 校验只能同步完成，拒绝返回 Promise 或其他值的钩子。 */
export function runStoreValidation<T>(
  validate: ((value: T) => void) | undefined,
  value: T,
): void {
  const result: unknown = validate?.(value)
  if (result === undefined) return
  if (result && typeof (result as PromiseLike<unknown>).then === 'function')
    Promise.resolve(result).catch(() => {})
  throw new TypeError('Store 插件校验必须同步执行且不返回值')
}

/** 冻结声明，后续不能替换工厂或校验器改变已注册插件的行为。 */
export function defineStorePlugin<S extends StoreState>(
  plugin: StorePlugin<S>,
): StorePlugin<S> {
  validateStorePlugin(plugin)
  return Object.freeze({
    ...plugin,
    ...(plugin.extraOptions
      ? { extraOptions: Object.freeze([...plugin.extraOptions]) }
      : {}),
  })
}

/** 创建独立注册器，测试或独立运行时之间不共享可变配置。 */
export function createStorePluginRegistry(): StorePluginRegistry {
  const plugins: RegisteredStorePlugin[] = []
  let sealed = false
  return Object.freeze({
    /** 所有冲突检查通过后才写入，失败不污染已有配置。 */
    register<S extends StoreState>(plugin: StorePlugin<S>): void {
      if (plugins.includes(plugin)) return
      if (sealed) throw new Error('Store 插件注册已封存，请在实例声明前注册')
      validateStorePlugin(plugin)
      const names = storePluginOptionNames(plugin)
      if (
        plugins.some(
          (item) =>
            item.key === plugin.key ||
            storePluginOptionNames(item).some((name) => names.includes(name)),
        )
      )
        throw new Error('Store 插件区域名或声明选项重复')
      if (plugin.extraOptions) Object.freeze(plugin.extraOptions)
      plugins.push(Object.freeze(plugin))
    },
    /** 返回不可变配置，不暴露状态、连接或所属令牌。 */
    seal(): readonly RegisteredStorePlugin[] {
      sealed = true
      return Object.freeze(plugins)
    },
  })
}
