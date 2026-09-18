import type { StoreState, StoreValue } from './types.js'

/** 只信任本模块完成校验并冻结的节点，不能仅凭 Object.isFrozen 跳过校验。 */
const trusted = new WeakSet<object>()
/** 内部保留名与原型穿透字段不能进入业务状态。 */
const forbidden = new Set(['__proto__', 'prototype', 'constructor'])
/** 整个私有命名空间预留给插件，新增声明不改变已有快照的校验规则。 */
function reservedField(key: string): boolean {
  return forbidden.has(key) || /^__.*__$/.test(key)
}
/** 跨上下文的 Object 构造函数身份不同，但原生构造函数源码一致。 */
const objectConstructor = Function.prototype.toString.call(Object)
/** 草稿仅处理普通对象和数组。 */
type Container = StoreState | StoreValue[]

/** 校验普通容器，拒绝带方法的实例、访问器和 Symbol 字段。 */
function descriptors(value: object): PropertyDescriptorMap {
  const prototype = Object.getPrototypeOf(value)
  if (
    !Array.isArray(value) &&
    prototype !== Object.prototype &&
    prototype !== null
  ) {
    const constructor = Object.getOwnPropertyDescriptor(
      prototype,
      'constructor',
    )
    if (
      Object.getPrototypeOf(prototype) !== null ||
      typeof constructor?.value !== 'function' ||
      Function.prototype.toString.call(constructor.value) !== objectConstructor
    )
      throw new TypeError('Store 仅接受普通对象和数组')
  }
  const result = Object.getOwnPropertyDescriptors(value)
  for (const key of Reflect.ownKeys(result)) {
    if (typeof key !== 'string' || reservedField(key))
      throw new TypeError('Store 包含保留字段或 Symbol')
    const field = result[key]!
    if (
      !('value' in field) ||
      (!field.enumerable && !(Array.isArray(value) && key === 'length'))
    )
      throw new TypeError('Store 不接受访问器或隐藏字段')
    if (
      Array.isArray(value) &&
      key !== 'length' &&
      (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)
    )
      throw new TypeError('Store 数组不能包含额外属性')
  }
  return result
}

/** 校验并隔离输入，未改变的不可变分支继续复用，避免每次更新整树复制。 */
export function immutable(
  value: unknown,
  previous?: StoreValue,
  ancestors = new Set<object>(),
): StoreValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return value
  if (typeof value === 'number' && Number.isFinite(value))
    return value === 0 ? 0 : value
  if (typeof value !== 'object' || value === null)
    throw new TypeError('Store 状态必须为可序列化普通数据')
  if (trusted.has(value) && (previous === undefined || value === previous))
    return value as StoreValue
  if (ancestors.has(value)) throw new TypeError('Store 状态不能包含循环引用')
  const fields = descriptors(value)
  ancestors.add(value)
  try {
    const array = Array.isArray(value)
    const keys = Object.keys(fields).filter(
      (key) => !(array && key === 'length'),
    )
    if (array && keys.length !== value.length)
      throw new TypeError('Store 数组不能包含空洞')
    const old =
      previous !== null &&
      typeof previous === 'object' &&
      Array.isArray(previous) === array
        ? previous
        : undefined
    const result: Record<string, StoreValue> = array
      ? ([] as unknown as Record<string, StoreValue>)
      : {}
    let equal = old !== undefined && Object.keys(old).length === keys.length
    for (const key of keys) {
      const prior =
        old && Object.prototype.hasOwnProperty.call(old, key)
          ? (old as StoreState)[key]
          : undefined
      const item = immutable(fields[key]!.value, prior, ancestors)
      result[key] = item
      if (!Object.is(item, prior)) equal = false
    }
    if (equal) return old!
    Object.freeze(result)
    trusted.add(result)
    return result
  } finally {
    ancestors.delete(value)
  }
}

/** 状态根固定为对象，避免数组或基本值破坏顶层字段合并语义。 */
export function initialState(value: unknown): StoreState {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Store 状态根必须为普通对象')
  return immutable(value) as StoreState
}

/** 补丁只遍历传入字段，未变化时直接返回原状态。 */
export function applyPatch(state: StoreState, patch: unknown): StoreState {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch))
    throw new TypeError('Store 更新补丁必须为普通对象')
  const fields = descriptors(patch)
  let next: StoreState | undefined
  for (const key of Object.keys(fields)) {
    const value = immutable(fields[key]!.value, state[key])
    if (
      Object.prototype.hasOwnProperty.call(state, key) &&
      Object.is(value, state[key])
    )
      continue
    next ??= { ...state }
    next[key] = value
  }
  if (!next) return state
  Object.freeze(next)
  trusted.add(next)
  return next
}

/** 草稿节点只在首次写入时复制当前层，子分支按访问惰性创建。 */
interface DraftNode {
  base: Container
  copy: Container | undefined
  parent: DraftNode | undefined
  key: string
  children: Map<string, DraftNode>
  proxy: Container
}

/** 使用可撤销的写时复制草稿，成功和失败后保留的代理都不能继续操作。 */
export function applyRecipe(
  state: StoreState,
  recipe: (draft: StoreState) => unknown,
): StoreState {
  if (Object.prototype.toString.call(recipe) === '[object AsyncFunction]')
    throw new TypeError('Store 更新不能使用异步草稿函数')
  const nodes = new WeakMap<object, DraftNode>()
  const revokes: (() => void)[] = []
  /** 标记变更并沿仍有效的父子关系逐层复制。 */
  function changed(node: DraftNode): Container {
    node.copy ??= Array.isArray(node.base)
      ? node.base.slice()
      : { ...node.base }
    if (node.parent?.children.get(node.key) === node) changed(node.parent)
    return node.copy
  }
  /** 只归并发生变化的分支，最终冻结和校验仍由统一状态算法完成。 */
  function finish(node: DraftNode): StoreValue {
    if (!node.copy) return node.base
    for (const [key, child] of node.children) {
      if (child.copy) (node.copy as StoreState)[key] = finish(child)
    }
    return immutable(node.copy, node.base)
  }
  /** 创建以空可变对象为代理目标的草稿，避免冻结对象的 Proxy 不变量冲突。 */
  function create(base: Container, parent?: DraftNode, key = ''): DraftNode {
    const node: DraftNode = {
      base,
      copy: undefined,
      parent,
      key,
      children: new Map(),
      proxy: base,
    }
    const revocable = Proxy.revocable(Array.isArray(base) ? [] : {}, {
      /** 读取时惰性代理子节点，数组方法继续以草稿为接收者。 */
      get(_target, property) {
        // splice、map 等原生数组方法通过 constructor 确定结果数组类型。
        if (property === 'constructor' && Array.isArray(base)) return Array
        if (typeof property === 'string' && reservedField(property))
          throw new TypeError('Store 草稿不能访问原型或保留字段')
        const source = node.copy ?? node.base
        const value = Reflect.get(source, property)
        if (value === null || typeof value !== 'object') return value
        const name = String(property)
        let child = node.children.get(name)
        if (!child) {
          child = create(value as Container, node, name)
          node.children.set(name, child)
        }
        return child.proxy
      },
      /** 外部对象在赋值时隔离；草稿引用不能形成祖先循环。 */
      set(_target, property, value) {
        if (typeof property !== 'string' || reservedField(property))
          throw new TypeError('Store 草稿包含非法字段')
        const referenced =
          value && typeof value === 'object' ? nodes.get(value) : undefined
        if (referenced) {
          for (
            let ancestor: DraftNode | undefined = node;
            ancestor;
            ancestor = ancestor.parent
          ) {
            if (ancestor === referenced)
              throw new TypeError('Store 草稿不能包含循环引用')
          }
          value = finish(referenced)
        }
        const source = node.copy ?? node.base
        const normalized = immutable(value, (source as StoreState)[property])
        if (
          Object.prototype.hasOwnProperty.call(source, property) &&
          Object.is((source as StoreState)[property], normalized) &&
          !node.children.get(property)?.copy
        )
          return true
        node.children.delete(property)
        Reflect.set(changed(node), property, normalized)
        if (Array.isArray(node.copy) && property === 'length') {
          for (const name of node.children.keys())
            if (Number(name) >= node.copy.length) node.children.delete(name)
        }
        return true
      },
      /** 删除后断开旧子草稿，迟到的子草稿修改不恢复已删除字段。 */
      deleteProperty(_target, property) {
        if (typeof property !== 'string' || reservedField(property))
          throw new TypeError('Store 草稿包含非法字段')
        if (
          !Object.prototype.hasOwnProperty.call(
            node.copy ?? node.base,
            property,
          )
        )
          return true
        node.children.delete(property)
        return Reflect.deleteProperty(changed(node), property)
      },
      /** 枚举仅反映当前业务草稿。 */
      ownKeys() {
        return Reflect.ownKeys(node.copy ?? node.base)
      },
      /** 属性查询不暴露内部节点。 */
      has(_target, property) {
        return Reflect.has(node.copy ?? node.base, property)
      },
      /** 数组 length 保持代理目标要求的不可配置描述符。 */
      getOwnPropertyDescriptor(_target, property) {
        const descriptor = Object.getOwnPropertyDescriptor(
          node.copy ?? node.base,
          property,
        )
        return (
          descriptor && {
            ...descriptor,
            writable: true,
            configurable: !(Array.isArray(base) && property === 'length'),
          }
        )
      },
      /** 草稿只支持普通赋值，拒绝访问器、隐藏字段及描述符改写。 */
      defineProperty() {
        throw new TypeError('Store 草稿不能改写属性描述符')
      },
      /** 不允许从草稿修改对象原型。 */
      setPrototypeOf() {
        throw new TypeError('Store 草稿不能修改原型')
      },
      /** 草稿不能被业务提前冻结。 */
      preventExtensions() {
        throw new TypeError('Store 草稿不能被提前冻结')
      },
    })
    node.proxy = revocable.proxy as Container
    nodes.set(node.proxy, node)
    revokes.push(revocable.revoke)
    return node
  }
  const root = create(state)
  try {
    const result = recipe(root.proxy as StoreState)
    if (result !== undefined) {
      // 消化异步函数返回的拒绝，草稿仍立即撤销且绝不提交。
      if (result && typeof (result as PromiseLike<unknown>).then === 'function')
        Promise.resolve(result).catch(() => {})
      throw new TypeError('Store 草稿函数必须同步执行且不返回值')
    }
    return finish(root) as StoreState
  } finally {
    for (const revoke of revokes) revoke()
  }
}
