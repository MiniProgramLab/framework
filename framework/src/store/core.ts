// SPDX-License-Identifier: Apache-2.0
import { applyPatch, applyRecipe, initialState } from './state.js'
import type {
  Store,
  StoreListener,
  StoreSnapshot,
  StoreState,
} from './types.js'
import { createStorePluginRegistry, runStoreValidation } from './plugin.js'
import type {
  RegisteredStorePlugin,
  StorePlugin,
  StorePluginContext,
} from './plugin.js'

/** 连接对外只给出门面，释放能力仅供实例生命周期使用。 */
export interface StoreConnection<S extends StoreState = StoreState> {
  readonly store: Store<S>
  /** 失效当前实例连接并释放其全部订阅。 */
  dispose(): void
}
/** 内部管理器不提供状态、根引用或页面枚举。 */
export interface StoreRoot {
  /** 公开区与插件区域分别提交，彼此不产生通知。 */
  connectGlobal(alive: () => boolean): StoreConnection
  /** 使用已注册声明和固定所属令牌连接隔离区域。 */
  connectPlugin<S extends StoreState>(
    plugin: StorePlugin<S>,
    token: object,
    context: StorePluginContext,
    alive: () => boolean,
  ): StoreConnection<S>
  /** 一次释放该令牌的全部插件区域，旧令牌永久失效。 */
  releaseOwner(token: object): void
  /** 销毁公开区与全部插件连接。 */
  dispose(): void
}
/** 每个插件仅管理自己的区域索引与初始化标记，状态始终保存在根内。 */
interface PluginScopes {
  scopes: Map<object, Scope>
  initializing: WeakMap<object, { failed: boolean }>
}
/** 单个实例的订阅记录，用内部版本排除注册前的排队通知。 */
interface Subscription {
  active: boolean
  version: number
  alive: () => boolean
  listener: StoreListener<StoreState> | undefined
}
/** 一笔更新的前后快照和版本始终对应同一次提交。 */
interface Notification {
  next: StoreState
  previous: StoreState
  version: number
}
/** 各区域独立保存状态和订阅，页面区域只存放在根的私有 Map 内。 */
interface Scope {
  state: StoreState
  version: number
  alive: boolean
  listeners: Set<Subscription>
  notifications: Notification[]
  cursor: number
  /** 可选的框架区域结构校验，不影响普通业务状态。 */
  validate: ((state: StoreState) => void) | undefined
}
/** 更新期间的防重入标记只负责拒绝嵌套操作，从不用于定位数据。 */
let updating: { failed: boolean } | undefined
/** 调度器只记录待派发区域，数据快照仍保存在各自的私有通知队列中。 */
const scheduledScopes: Scope[] = []
/** 标记通知正在派发，避免响应中的更新递归打断当前批次。 */
let notifying = false

/** 拒绝在草稿计算中嵌套更新或改变订阅，捕获异常也不能提交外层。 */
export function outsideUpdate(): void {
  if (!updating) return
  updating.failed = true
  throw new Error('Store 草稿中不能再次更新或管理订阅')
}

/** 响应异常不回滚状态，不把状态对象或内部句柄附带到诊断输出。 */
function respond(
  subscription: Subscription,
  next: StoreState,
  previous?: StoreState,
): void {
  if (!subscription.active || !subscription.alive() || !subscription.listener)
    return
  try {
    const result: unknown = subscription.listener(
      next as StoreSnapshot<StoreState>,
      previous as StoreSnapshot<StoreState> | undefined,
    )
    if (result && typeof (result as PromiseLike<unknown>).then === 'function')
      Promise.resolve(result).catch(reportResponseError)
  } catch (error) {
    reportResponseError(error)
  }
}

/** 日志仅记录错误消息，避免输出完整回调对象。 */
function reportResponseError(error: unknown): void {
  console.error(
    'Store 响应执行失败：' +
      (error instanceof Error ? error.message : '回调异常'),
  )
}

/** 同一提交的所有订阅者使用同一份不可变快照，响应过程中提交的更新依次排队。 */
function publish(scope: Scope, previous: StoreState): void {
  if (!scope.listeners.size) return
  scope.notifications.push({
    next: scope.state,
    version: scope.version,
    previous,
  })
  scheduledScopes.push(scope)
  if (notifying) return
  notifying = true
  try {
    // 游标读取避免 shift 的重复搬移，并保留跨区域实际提交顺序。
    for (let index = 0; index < scheduledScopes.length; index += 1) {
      const target = scheduledScopes[index]!
      if (!target.alive) continue
      const notification = target.notifications[target.cursor++]!
      for (const subscription of target.listeners) {
        if (subscription.version < notification.version)
          respond(subscription, notification.next, notification.previous)
      }
      if (target.cursor === target.notifications.length) {
        target.notifications.length = 0
        target.cursor = 0
      }
    }
  } finally {
    scheduledScopes.length = 0
    notifying = false
  }
}

/** 创建隔离区域，工厂完成且校验通过后才发布给根容器。 */
function createScope(
  factory: () => StoreState,
  validate?: (state: StoreState) => void,
): Scope {
  const state = initialState(factory())
  runStoreValidation(validate, state)
  return {
    state,
    version: 0,
    alive: true,
    listeners: new Set(),
    notifications: [],
    cursor: 0,
    validate,
  }
}

/** 连接持有单个区域与实例存活检查，对业务永远只公开 update 和 on。 */
function connect(scope: Scope, alive: () => boolean): StoreConnection {
  let connected = true
  const subscriptions = new Set<Subscription>()
  /** 失效检查同时覆盖区域销毁与当前实例卸载。 */
  const active = () => connected && scope.alive && alive()
  const store: Store<StoreState> = Object.freeze(
    Object.assign(Object.create(null), {
      /** 草稿计算失败不改写状态，有变化才增加版本和响应。 */
      update(change: unknown): boolean {
        if (!active()) return false
        outsideUpdate()
        const context = { failed: false }
        const previous = scope.state
        let next: StoreState
        updating = context
        try {
          next =
            typeof change === 'function'
              ? applyRecipe(previous, change as (draft: StoreState) => unknown)
              : applyPatch(previous, change)
          runStoreValidation(scope.validate, next)
          if (context.failed) throw new Error('Store 更新已因嵌套操作失败')
        } finally {
          updating = undefined
        }
        if (!active()) return false
        if (next !== previous) {
          scope.state = next
          scope.version += 1
          publish(scope, previous)
        }
        return true
      },
      /** 订阅从当前版本之后开始，立即响应只是展示当前快照。 */
      on(
        listener: StoreListener<StoreState>,
        options?: { immediate?: boolean },
      ): () => void {
        if (!active()) return () => {}
        outsideUpdate()
        if (
          typeof listener !== 'function' ||
          (options?.immediate !== undefined &&
            typeof options.immediate !== 'boolean')
        )
          throw new TypeError('Store 响应参数无效')
        const subscription: Subscription = {
          listener,
          version: scope.version,
          active: true,
          alive: active,
        }
        subscriptions.add(subscription)
        scope.listeners.add(subscription)
        if (options?.immediate) respond(subscription, scope.state)
        /** 提前取消和自动清理都移除同一订阅，重复取消不产生副作用。 */
        return () => {
          if (!subscription.active) return
          outsideUpdate()
          subscription.active = false
          subscription.listener = undefined
          subscriptions.delete(subscription)
          scope.listeners.delete(subscription)
        }
      },
    }),
  )
  return {
    store,
    /** 生命周期清理不经过业务取消入口，即使业务失败也必须释放。 */
    dispose(): void {
      connected = false
      for (const subscription of subscriptions) {
        subscription.active = false
        subscription.listener = undefined
        scope.listeners.delete(subscription)
      }
      subscriptions.clear()
    },
  }
}

/** 销毁时释放大状态及回调引用，旧句柄永久失效。 */
function release(scope: Scope): void {
  scope.alive = false
  for (const subscription of scope.listeners) {
    subscription.active = false
    subscription.listener = undefined
  }
  scope.listeners.clear()
  scope.notifications.length = 0
  scope.cursor = 0
  scope.state = initialState({})
}

/** 核心只识别插件协议，按注册声明创建私有索引，具体领域由装配层决定。 */
export function createStoreRoot(
  factory: () => StoreState,
  plugins: readonly RegisteredStorePlugin[] = [],
): StoreRoot {
  const registry = createStorePluginRegistry()
  for (const plugin of plugins) registry.register(plugin)
  const regions = new Map<RegisteredStorePlugin, PluginScopes>()
  for (const plugin of registry.seal())
    regions.set(plugin, { scopes: new Map(), initializing: new WeakMap() })
  const root = {
    publicState: createScope(factory),
    alive: true,
  }
  /** 弱引用墓碑阻止旧令牌复活，不延长页面令牌生命周期。 */
  const released = new WeakSet<object>()
  return {
    /** 仅连接公开全局区，不返回内部根或其 Map。 */
    connectGlobal(alive) {
      return connect(root.publicState, alive)
    },
    /** 按声明身份连接，名称相同的伪造插件不能取得已注册区域。 */
    connectPlugin<S extends StoreState>(
      plugin: StorePlugin<S>,
      token: object,
      context: StorePluginContext,
      alive: () => boolean,
    ): StoreConnection<S> {
      outsideUpdate()
      if (!root.alive || released.has(token) || !alive())
        throw new Error('Store 所属实例或 App 已销毁')
      const region = regions.get(plugin)
      if (!region) throw new Error('Store 插件尚未注册')
      const pending = region.initializing.get(token)
      if (pending) {
        pending.failed = true
        throw new Error('Store 插件不能递归初始化或连接')
      }
      const attempt = { failed: false }
      region.initializing.set(token, attempt)
      try {
        runStoreValidation(plugin.validateContext, context)
        let scope = region.scopes.get(token)
        if (!scope) {
          scope = createScope(
            () => plugin.create(context),
            plugin.validateState as Scope['validate'],
          )
          if (
            attempt.failed ||
            !root.alive ||
            released.has(token) ||
            !alive()
          ) {
            release(scope)
            throw new Error('Store 插件初始化已失效')
          }
          region.scopes.set(token, scope)
        } else if (
          attempt.failed ||
          !root.alive ||
          released.has(token) ||
          !alive()
        ) {
          throw new Error('Store 插件连接已失效')
        }
        // 区域只由同一插件工厂创建，类型擦除限制在核心连接出口。
        return connect(scope, alive) as StoreConnection<S>
      } finally {
        region.initializing.delete(token)
      }
    },
    /** 按注册集合统一清理，新插件自动获得相同的墓碑与释放语义。 */
    releaseOwner(token): void {
      released.add(token)
      for (const { scopes } of regions.values()) {
        const scope = scopes.get(token)
        if (scope) {
          release(scope)
          scopes.delete(token)
        }
      }
    },
    /** 仅供框架销毁 App，不向实例业务门面公开。 */
    dispose(): void {
      root.alive = false
      release(root.publicState)
      for (const { scopes } of regions.values()) {
        for (const scope of scopes.values()) release(scope)
        scopes.clear()
      }
    },
  }
}
