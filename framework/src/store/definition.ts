import type { StoreDefinition, StoreInitialState, StoreState } from './types.js'

/** 纯定义的工厂保存在私有索引中，不随定义对象向业务暴露。 */
const definitions = new WeakMap<
  object,
  { kind: string; factory: () => StoreState }
>()

/** 登记惰性工厂，模块加载时不创建状态或读取 App。 */
export function defineStoreDefinition<S extends StoreState, K extends string>(
  kind: K,
  factory: () => S,
): StoreDefinition<S, K> {
  if (typeof factory !== 'function')
    throw new TypeError('Store 定义必须提供同步状态工厂')
  const definition = Object.freeze(Object.create(null)) as StoreDefinition<S, K>
  definitions.set(definition, { kind, factory })
  return definition
}

/** 定义 App 的公开全局状态，各 App 分别初始化。 */
export function defineGlobalStore<S extends StoreState>(
  factory: () => StoreInitialState<S>,
): StoreDefinition<S, 'global'> {
  return defineStoreDefinition('global', factory)
}

/** 框架校验定义身份，不接受伪造定义或不同种类的定义混用。 */
export function definitionFactory(
  definition: object,
  kind: string,
): () => StoreState {
  const record = definitions.get(definition)
  if (!record || record.kind !== kind)
    throw new TypeError('Store 定义无效或种类不匹配')
  return record.factory
}
