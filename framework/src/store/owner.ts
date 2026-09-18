import { releasePage } from './global.js'

/** 归属层只依赖明确的原生实例能力，不依赖路由或页面栈。 */
export interface StoreHost {
  data: Record<string, unknown>
  setData(data: Record<string, unknown>, callback?: () => void): void
  getPageId?(): string
  getTabBar?(): StoreHost | undefined
  selectOwnerComponent?(): StoreHost | null
}
/** 页面仅保存所有权和连接清理函数，状态统一托管在全局根内。 */
export interface PageOwner {
  readonly app: object
  readonly page: StoreHost
  readonly token: object
  /** 配置仅供对应插件解释，归属层不识别业务定义。 */
  readonly options: Readonly<Record<string, unknown>>
  readonly id: string
  readonly cleanups: Set<() => void>
  alive: boolean
}
/** 未绑定实例等待精确归属出现，卸载时必须移除。 */
interface PendingOwner {
  host: StoreHost
  native?: StoreHost
  accept(owner: PageOwner): void
  rejectNative(): void
}
/** 页面索引与等待队列都按 App 隔离。 */
interface PageRegistry {
  pages: Map<string, PageOwner>
  pending: Set<PendingOwner>
  native: boolean
}
/** 页面身份基础设施不创建 Store 根或参与者订阅。 */
const registries = new WeakMap<object, PageRegistry>()
/** 页面对象与原生 Tabbar 的身份都通过弱引用记录。 */
const owners = new WeakMap<StoreHost, PageOwner>()
/** 原生底栏 ID 可能不等于页面 ID，单独保存精确对象关联。 */
const nativeOwners = new WeakMap<StoreHost, PageOwner>()
/** 同一个原生底栏被多个页面复用时，不再授予任何页面子域访问。 */
const ambiguousNative = new WeakSet<StoreHost>()
/** 只登记需要撤销页面归属的参与者，不保存任何业务状态。 */
const nativeParticipants = new WeakMap<StoreHost, Set<() => void>>()

/** 按 App 创建最小页面归属表，不包含业务状态。 */
function registryFor(app: object): PageRegistry {
  let registry = registries.get(app)
  if (!registry) {
    registry = { pages: new Map(), pending: new Set(), native: false }
    registries.set(app, registry)
  }
  return registry
}

/** created 阶段部分基础库尚未提供页面 ID，后续生命周期可以重试。 */
function pageId(host: StoreHost): string | undefined {
  try {
    const id = host.getPageId?.()
    return typeof id === 'string' && id ? id : undefined
  } catch {
    return undefined
  }
}

/** 原生底栏只由明确页面的 getTabBar 关联，不使用屏幕上当前页面。 */
function discoverNative(registry: PageRegistry): void {
  if (!registry.pending.size && !registry.native) return
  for (const owner of registry.pages.values()) {
    let bar: StoreHost | undefined
    try {
      bar = owner.page.getTabBar?.()
    } catch {
      continue
    }
    if (!bar) continue
    if (ambiguousNative.has(bar)) continue
    const previous = nativeOwners.get(bar)
    if (previous && previous !== owner) {
      ambiguousNative.add(bar)
      nativeOwners.delete(bar)
      for (const reject of nativeParticipants.get(bar) ?? []) reject()
      nativeParticipants.delete(bar)
      console.warn(
        'Store 原生 Tabbar 被多页复用，页面门面已失效；全局门面仍可用',
      )
      continue
    }
    nativeOwners.set(bar, owner)
  }
}

/** 普通组件匹配自身页面 ID，底栏后代沿明确的逻辑引用链匹配所属底栏。 */
function findOwner(
  registry: PageRegistry,
  pending: PendingOwner,
): PageOwner | undefined {
  const host = pending.host
  const id = pageId(host)
  const direct = id ? registry.pages.get(id) : undefined
  if (direct?.alive) return direct
  const visited = new Set<StoreHost>()
  for (
    let node: StoreHost | null | undefined = host;
    node && !visited.has(node);
  ) {
    visited.add(node)
    if (ambiguousNative.has(node)) {
      pending.rejectNative()
      registry.pending.delete(pending)
      return undefined
    }
    const owner = nativeOwners.get(node)
    if (owner?.alive) {
      let participants = nativeParticipants.get(node)
      if (!participants) {
        participants = new Set()
        nativeParticipants.set(node, participants)
      }
      participants.add(pending.rejectNative)
      pending.native = node
      registry.native = true
      return owner
    }
    try {
      node = node.selectOwnerComponent?.()
    } catch {
      return undefined
    }
  }
  return undefined
}

/** 归属可用后固定连接，单个绑定失败不阻断其他组件。 */
export function refreshOwners(app: object): void {
  const registry = registries.get(app)
  if (!registry) return
  discoverNative(registry)
  for (const pending of registry.pending) {
    const owner = findOwner(registry, pending)
    if (!owner) continue
    registry.pending.delete(pending)
    try {
      pending.accept(owner)
    } catch (error) {
      console.error(
        'Store 页面绑定失败：' +
          (error instanceof Error ? error.message : '绑定异常'),
      )
    }
  }
}

/** 页面在业务生命周期前登记，相同页面 ID 的不同存活实例不允许覆盖。 */
export function registerPage(
  app: object,
  page: StoreHost,
  options: Readonly<Record<string, unknown>>,
): PageOwner | undefined {
  const existing = owners.get(page)
  if (existing) return existing.alive ? existing : undefined
  const id = pageId(page)
  if (!id) return undefined
  const registry = registryFor(app)
  if (registry.pages.has(id)) throw new Error('Store 页面 ID 与现有页面冲突')
  const owner: PageOwner = {
    app,
    page,
    options,
    id,
    token: Object.freeze({}),
    cleanups: new Set(),
    alive: true,
  }
  owners.set(page, owner)
  registry.pages.set(id, owner)
  refreshOwners(app)
  return owner
}

/** 实例等待一次精确匹配，返回值只负责取消等待。 */
export function whenOwnerReady(
  app: object,
  host: StoreHost,
  accept: (owner: PageOwner) => void,
  rejectNative: () => void,
): () => void {
  const registry = registryFor(app)
  const pending: PendingOwner = { host, accept, rejectNative }
  registry.pending.add(pending)
  refreshOwners(app)
  return () => {
    registry.pending.delete(pending)
    // 取消时不再依赖可能已断开的逻辑父链。
    if (pending.native)
      nativeParticipants.get(pending.native)?.delete(rejectNative)
    delete pending.native
  }
}

/** 页面卸载先失效状态与所有连接，再移除索引，清理始终幂等。 */
export function unregisterPage(page: StoreHost): void {
  const owner = owners.get(page)
  if (!owner?.alive) return
  owner.alive = false
  releasePage(owner.app, owner.token)
  for (const cleanup of owner.cleanups) cleanup()
  owner.cleanups.clear()
  registries.get(owner.app)?.pages.delete(owner.id)
}
