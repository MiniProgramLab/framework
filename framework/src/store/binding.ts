// SPDX-License-Identifier: Apache-2.0
import { viewPatch } from './view.js'
import { connectGlobal, connectPlugin } from './global.js'
import type { StoreConnection } from './core.js'
import { outsideUpdate } from './core.js'
import { storePlugins } from './setup.js'
import { runStoreValidation, storePluginOptionNames } from './plugin.js'
import type { RegisteredStorePlugin } from './plugin.js'
import {
  refreshOwners,
  registerPage,
  unregisterPage,
  whenOwnerReady,
} from './owner.js'
import type { PageOwner, StoreHost } from './owner.js'
import type { Store, StoreListener, StoreState } from './types.js'

/** 包装器只消费这些框架选项，不将其变成组件属性。 */
interface Settings {
  global: boolean
  plugins: readonly RegisteredStorePlugin[]
  reserved: readonly string[]
  options: Readonly<Options>
  isPage: boolean
}
/** 每个启用区域持有独立连接与等待订阅，新增插件不增加实例字段。 */
interface BoundScope {
  plugin: RegisteredStorePlugin | undefined
  connection: StoreConnection | undefined
  subscriptions: Set<PendingSubscription>
}
/** 原生底栏可能先于页面就绪，订阅请求仅在确认归属后激活。 */
interface PendingSubscription {
  active: boolean
  listener: StoreListener<StoreState> | undefined
  immediate: boolean
  cancel: (() => void) | undefined
}
/** 每个实例独立持有连接，页面或组件卸载后清空引用。 */
interface Binding {
  settings: Settings
  app: object | undefined
  owner: PageOwner | undefined
  scopes: Map<string, BoundScope>
  waiting: (() => void) | undefined
  /** 原生资源在连接失效前清理，弹层可先删除自己的条目。 */
  cleanups: Set<() => void>
  alive: boolean
  hidden: boolean
  scheduled: boolean
  warned: boolean
  pageBlocked: boolean
  pendingView: StoreState | undefined
  renderedView: StoreState | undefined
  setData: StoreHost['setData'] | undefined
  dispose(): void
}
/** 包装后的实例状态不挂载到 this 或公开门面。 */
const bindings = new WeakMap<StoreHost, Binding>()
/** 生命周期函数经窄适配层统一调度，不改变业务参数和返回值。 */
type Hook = (this: StoreHost, ...args: unknown[]) => unknown
/** 原生选项只在包装器边界动态处理，业务类型由 runtime.ts 保留。 */
type Options = Record<string, unknown>

/** 无 Store 参与时不装配生命周期行为，但仍拒绝保留字段冲突。 */
function validate(options: Options): Settings {
  const plugins = storePlugins()
  const reserved = [
    '$globalStore',
    ...plugins.map((plugin) => '$' + plugin.option),
  ]
  const flags = ['globalStore', ...plugins.map((plugin) => plugin.option)]
  const names = ['globalStore', ...plugins.flatMap(storePluginOptionNames)]
  for (const name of Object.keys(options)) {
    if (/^[a-z][A-Za-z0-9]*Store$/.test(name) && !names.includes(name))
      throw new TypeError('Store 参与选项对应的插件尚未注册')
  }
  for (const name of flags) {
    if (options[name] !== undefined && typeof options[name] !== 'boolean')
      throw new TypeError('Store 参与选项必须为布尔值')
  }
  for (const plugin of plugins)
    runStoreValidation(plugin.validateOptions, options)
  for (const section of [
    options,
    options.data,
    options.properties,
    options.methods,
  ]) {
    if (
      section &&
      typeof section === 'object' &&
      reserved.some((name) =>
        Object.prototype.hasOwnProperty.call(section, name),
      )
    )
      throw new TypeError('Store 保留名称与业务字段冲突')
  }
  return {
    global: options.globalStore === true,
    plugins: plugins.filter((plugin) => options[plugin.option] === true),
    reserved,
    options: Object.freeze({ ...options }),
    isPage: false,
  }
}

/** 仅绑定时取得 App 身份，后续操作不再读取显示页面或当前 App。 */
function appInstance(): object | undefined {
  try {
    const app: unknown = getApp()
    return app && typeof app === 'object' ? app : undefined
  } catch {
    return undefined
  }
}

/** 模板仅在全局参与者上同步，更新合并到微任务并在隐藏时暂存。 */
function scheduleView(binding: Binding): void {
  if (
    !binding.alive ||
    binding.hidden ||
    binding.scheduled ||
    !binding.pendingView
  )
    return
  binding.scheduled = true
  Promise.resolve().then(() => {
    binding.scheduled = false
    if (!binding.alive || binding.hidden || !binding.pendingView) return
    const next = binding.pendingView
    binding.pendingView = undefined
    const patch = viewPatch(next, binding.renderedView)
    if (!Object.keys(patch).length) return
    try {
      binding.setData!(patch)
      binding.renderedView = next
    } catch (error) {
      console.error(
        'Store 视图同步失败：' +
          (error instanceof Error ? error.message : '更新异常'),
      )
    }
  })
}

/** 公开句柄通过私有连接转发，卸载后不再保留内部区域引用。 */
function facade(binding: Binding, scope: BoundScope): Store<StoreState> {
  return Object.freeze(
    Object.assign(Object.create(null), {
      /** 失效或未绑定时拒绝更新，不执行用户草稿函数。 */
      update(change: Parameters<Store<StoreState>['update']>[0]): boolean {
        return binding.alive
          ? (scope.connection?.store.update(change) ?? false)
          : false
      },
      /** 订阅只进入当前实例固定绑定的区域。 */
      on(
        listener: StoreListener<StoreState>,
        options?: { immediate?: boolean },
      ): () => void {
        if (!binding.alive) return () => {}
        if (scope.plugin && binding.pageBlocked) return () => {}
        if (scope.connection)
          return scope.connection.store.on(listener, options)
        outsideUpdate()
        if (
          typeof listener !== 'function' ||
          (options?.immediate !== undefined &&
            typeof options.immediate !== 'boolean')
        )
          throw new TypeError('Store 响应参数无效')
        const queue = scope.subscriptions
        const subscription: PendingSubscription = {
          active: true,
          listener,
          immediate: options?.immediate === true,
          cancel: undefined,
        }
        queue.add(subscription)
        /** 取消在绑定前后都生效，绑定前不读取任何状态。 */
        return () => {
          if (!subscription.active) return
          outsideUpdate()
          subscription.active = false
          subscription.listener = undefined
          queue.delete(subscription)
          subscription.cancel?.()
          subscription.cancel = undefined
        }
      },
    }),
  )
}

/** 连接就绪后迁移等待订阅，首次立即响应允许取消自己或触发卸载。 */
function activateSubscriptions(binding: Binding, scope: BoundScope): void {
  const connection = scope.connection
  if (!connection) return
  for (const subscription of scope.subscriptions) {
    const listener = subscription.listener
    if (binding.alive && subscription.active && listener) {
      const cancel = connection.store.on(listener, {
        immediate: subscription.immediate,
      })
      if (binding.alive && subscription.active) subscription.cancel = cancel
      else cancel()
    }
    subscription.listener = undefined
    scope.subscriptions.delete(subscription)
  }
}

/** 在业务 created 前准备稳定门面，实际连接从 attached 开始可用。 */
function prepare(host: StoreHost, settings: Settings): Binding {
  const existing = bindings.get(host)
  if (existing) return existing
  const binding: Binding = {
    settings,
    app: undefined,
    owner: undefined,
    scopes: new Map(),
    waiting: undefined,
    cleanups: new Set(),
    alive: true,
    hidden: false,
    scheduled: false,
    warned: false,
    pageBlocked: false,
    pendingView: undefined,
    renderedView: undefined,
    setData: host.setData.bind(host),
    /** 先清理原生资源，再失效所有连接；旧门面不跟随新页面。 */
    dispose(): void {
      if (!binding.alive) return
      runCleanups(binding)
      binding.alive = false
      binding.waiting?.()
      binding.waiting = undefined
      binding.owner?.cleanups.delete(binding.dispose)
      binding.owner = undefined
      for (const scope of binding.scopes.values()) disposeScope(scope)
      binding.pendingView = undefined
      binding.renderedView = undefined
      binding.app = undefined
      binding.setData = undefined
    },
  }
  bindings.set(host, binding)
  const enabled: [string, RegisteredStorePlugin | undefined][] =
    settings.plugins.map((plugin) => ['$' + plugin.option, plugin])
  if (settings.global) enabled.unshift(['$globalStore', undefined])
  for (const [name, plugin] of enabled) {
    if (name in host || settings.reserved.some((field) => field in host.data))
      throw new TypeError('Store 保留名称与实例字段冲突')
    const scope: BoundScope = {
      plugin,
      connection: undefined,
      subscriptions: new Set(),
    }
    binding.scopes.set(name, scope)
    Object.defineProperty(host, name, {
      value: facade(binding, scope),
      writable: false,
      configurable: false,
      enumerable: false,
    })
  }
  if (settings.global || settings.plugins.length) {
    /** 保留字段只能由框架内部同步，业务 setData 继续操作其他展示数据。 */
    host.setData = (data, callback) => {
      if (
        Object.keys(data).some((key) =>
          settings.reserved.some(
            (name) =>
              key === name ||
              key.startsWith(name + '.') ||
              key.startsWith(name + '['),
          ),
        )
      )
        throw new TypeError('不能通过 setData 写入 Store 保留字段')
      binding.setData?.(data, callback)
    }
  }
  return binding
}

/** 归属确认后建立页面连接，同时登记整页卸载时的实例清理。 */
function acceptOwner(binding: Binding, owner: PageOwner): void {
  if (!binding.alive || !owner.alive || binding.owner) return
  binding.owner = owner
  owner.cleanups.add(binding.dispose)
  const connected: BoundScope[] = []
  try {
    for (const scope of binding.scopes.values()) {
      if (!scope.plugin) continue
      scope.connection = connectPlugin(
        owner.app,
        scope.plugin,
        owner.token,
        {
          options: binding.settings.options,
          ownerOptions: owner.options,
        },
        () => binding.alive && owner.alive,
      )
      connected.push(scope)
    }
  } catch (error) {
    // 一个插件接入失败时撤销本实例已建连接，避免只接入部分插件。
    binding.pageBlocked = true
    for (const scope of binding.scopes.values()) {
      if (scope.plugin) disposeScope(scope)
    }
    // 保留所属页清理关系，页面卸载仍必须释放本实例的全局连接。
    throw error
  }
  // 所有连接就绪后再激活订阅，立即回调可使用同一实例的其他插件。
  for (const scope of connected) activateSubscriptions(binding, scope)
}

/** 连接与等待订阅一起失效，不因区域种类遗漏资源。 */
function disposeScope(scope: BoundScope): void {
  scope.connection?.dispose()
  scope.connection = undefined
  for (const subscription of scope.subscriptions) {
    subscription.active = false
    subscription.listener = undefined
    subscription.cancel = undefined
  }
  scope.subscriptions.clear()
}

/** 共享原生底栏没有唯一页面归属，撤销页面连接但保持仍存活实例的全局连接。 */
function rejectNativeOwner(binding: Binding): void {
  binding.pageBlocked = true
  runCleanups(binding)
  for (const scope of binding.scopes.values()) {
    if (scope.plugin) disposeScope(scope)
  }
  binding.owner?.cleanups.delete(binding.dispose)
  binding.owner = undefined
}

/** 根据固定注册选项接入，单独启用页面时不生成全局订阅或模板字段。 */
function attach(host: StoreHost, settings: Settings): void {
  if (!settings.global && !settings.plugins.length) {
    const app = appInstance()
    if (app && settings.isPage) {
      registerPage(app, host, settings.options)
      refreshOwners(app)
    }
    return
  }
  const binding = prepare(host, settings)
  if (!binding.alive) return
  const app = binding.app ?? appInstance()
  if (!app) return
  binding.app = app
  if (settings.isPage) registerPage(app, host, settings.options)
  const globalScope = binding.scopes.get('$globalStore')
  if (globalScope && !globalScope.connection) {
    globalScope.connection = connectGlobal(app, () => binding.alive)
    globalScope.connection.store.on(
      (state) => {
        binding.pendingView = state as StoreState
        scheduleView(binding)
      },
      { immediate: true },
    )
    activateSubscriptions(binding, globalScope)
  }
  if (!binding.alive) return
  if (!binding.owner && !binding.waiting && !binding.pageBlocked) {
    binding.waiting = whenOwnerReady(
      app,
      host,
      (owner) => acceptOwner(binding, owner),
      () => rejectNativeOwner(binding),
    )
  }
  refreshOwners(app)
}

/** 生命周期包装保留 this、原参数及返回值，清理动作先于业务卸载。 */
function wrap(before: (host: StoreHost) => void, original: unknown): Hook {
  return function (...args) {
    before(this)
    return typeof original === 'function'
      ? (original as Hook).apply(this, args)
      : undefined
  }
}

/** 只为启用实例或页面身份基础设施增加行为，关闭的普通组件直接注册。 */
export function storeOptions(input: object, isPage: boolean): object {
  const options = input as Options
  const settings = validate(options)
  settings.isPage = isPage
  const native = { ...options }
  for (const plugin of storePlugins()) {
    for (const name of storePluginOptionNames(plugin)) delete native[name]
  }
  delete native.globalStore
  if (!isPage && !settings.global && !settings.plugins.length) return native
  /** 页面登记必须早于后代 attached，不能依赖页面 onLoad 才登记。 */
  const created = (host: StoreHost): void => {
    if (settings.global || settings.plugins.length) prepare(host, settings)
    if (isPage) {
      const app = appInstance()
      if (app) registerPage(app, host, settings.options)
    }
  }
  /** 显示时恢复视图，精确归属尚未就绪时再尝试绑定。 */
  const show = (host: StoreHost): void => {
    attach(host, settings)
    const binding = bindings.get(host)
    if (binding) {
      binding.hidden = false
      scheduleView(binding)
    }
  }
  /** 隐藏不改变所有权或业务订阅，只暂停自动模板推送。 */
  const hide = (host: StoreHost): void => {
    const binding = bindings.get(host)
    if (binding) binding.hidden = true
  }
  /** 卸载首先失效状态与连接，业务异常不影响资源释放。 */
  const detach = (host: StoreHost): void => {
    if (isPage) unregisterPage(host)
    bindings.get(host)?.dispose()
  }
  const behavior = Behavior({
    lifetimes: {
      /** 框架行为排在业务行为前，预先准备实例归属。 */
      created() {
        created(this as unknown as StoreHost)
      },
      /** attached 前完成首次可用连接。 */
      attached() {
        attach(this as unknown as StoreHost, settings)
      },
      /** 原生底栏或页面 ID 延迟就绪时通过 ready 补齐归属。 */
      ready() {
        const host = this as unknown as StoreHost
        attach(host, settings)
        const binding = bindings.get(host)
        if (
          binding &&
          binding.settings.plugins.length > 0 &&
          !binding.owner &&
          !binding.warned
        ) {
          binding.warned = true
          console.warn('Store 页面归属尚未确认，页面门面暂不可用')
        }
      },
      /** 生命周期重复调用时清理保持幂等。 */
      detached() {
        detach(this as unknown as StoreHost)
      },
    },
    pageLifetimes: {
      /** 页面可见时恢复最新全局快照。 */
      show() {
        show(this as unknown as StoreHost)
      },
      /** 后台实例仍保留业务响应。 */
      hide() {
        hide(this as unknown as StoreHost)
      },
    },
  })
  native.behaviors = [
    behavior,
    ...((native.behaviors as unknown[] | undefined) ?? []),
  ]
  if (isPage) {
    const methods = { ...(native.methods as Options | undefined) }
    // 只包装页面自己声明的方法，保留由业务 Behavior 提供的同名方法。
    // 未声明方法时由 attached、pageLifetimes 和 detached 完成框架生命周期。
    if (typeof methods.onLoad === 'function')
      methods.onLoad = wrap((host) => attach(host, settings), methods.onLoad)
    if (typeof methods.onShow === 'function')
      methods.onShow = wrap(show, methods.onShow)
    if (typeof methods.onHide === 'function')
      methods.onHide = wrap(hide, methods.onHide)
    if (typeof methods.onUnload === 'function')
      methods.onUnload = wrap(detach, methods.onUnload)
    native.methods = methods
  }
  return native
}

/** 清理错误相互隔离，回调先移除以避免重复清理时重入。 */
function runCleanups(binding: Binding): void {
  const callbacks = [...binding.cleanups]
  binding.cleanups.clear()
  for (const cleanup of callbacks) {
    try {
      cleanup()
    } catch (error) {
      console.error(
        'Store 资源清理失败：' +
          (error instanceof Error ? error.message : '清理异常'),
      )
    }
  }
}

/** 框架适配器只读取自身已确认归属，不通过页面栈猜测。 */
export function storeOwner(host: StoreHost): PageOwner | undefined {
  const binding = bindings.get(host)
  return binding?.alive && binding.owner?.alive ? binding.owner : undefined
}

/** 组件内部登记连接失效前的资源清理，普通业务门面不暴露此能力。 */
export function onStoreDispose(
  host: StoreHost,
  cleanup: () => void,
): () => void {
  const binding = bindings.get(host)
  if (!binding?.alive) {
    cleanup()
    return () => {}
  }
  binding.cleanups.add(cleanup)
  return () => {
    binding.cleanups.delete(cleanup)
  }
}
