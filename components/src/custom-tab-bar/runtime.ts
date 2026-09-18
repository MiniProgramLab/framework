import { createDefaultConfig } from './config.js'
import type { CustomTabBarConfig, CustomTabItem } from './types.js'
import type { FluidState } from './motion.worklet.js'
import type { MotionBindings } from './bindings.worklet.js'
import type { TabNavigationState } from './navigation.js'

/** 组件的逻辑线程状态不进入 data，各实例独立拥有布局、绑定和导航会话。 */
export interface TabRuntime {
  config: CustomTabBarConfig
  items: CustomTabItem[]
  activeId: string
  attached: boolean
  ready: boolean
  shown: boolean
  /** 异步测量代次及最后一次有效几何信息。 */
  revision: number
  rect: { left: number; top: number; width: number; height: number }
  slot: number
  padding: number
  pendingMeasure: number
  renderedConfig: CustomTabBarConfig | null
  windowKey: string
  geometryKey: string
  /** 共享动画图只创建一次，代次与提交序号过滤过期 UI 回调。 */
  motion: FluidState | null
  epoch: number
  committedSequence: number
  lastHapticAt: number
  bindings: MotionBindings
  navigation: TabNavigationState
}

/** 弱引用随组件回收，销毁后的异步事件不能重新创建有效实例。 */
const runtimes = new WeakMap<object, TabRuntime>()

/** 属性观察器可能先于 attached，因此允许创建空闲的实例状态。 */
export function runtimeFor(instance: object): TabRuntime {
  let runtime = runtimes.get(instance)
  if (!runtime) {
    runtime = {
      config: createDefaultConfig(),
      items: [],
      activeId: '',
      attached: false,
      ready: false,
      shown: true,
      revision: 0,
      rect: { left: 0, top: 0, width: 0, height: 0 },
      slot: 0,
      padding: 0,
      pendingMeasure: 0,
      renderedConfig: null,
      windowKey: '',
      geometryKey: '',
      motion: null,
      epoch: 0,
      committedSequence: 0,
      lastHapticAt: 0,
      bindings: {
        alive: false,
        bound: false,
        itemKey: '',
        revision: 0,
        handles: [],
      },
      navigation: {
        unsubscribe: null,
        configRevision: -1,
        transition: null,
        played: null,
        originId: '',
      },
    }
    runtimes.set(instance, runtime)
  }
  return runtime
}

/** 回调只查询已有状态，避免在销毁后把旧实例重新放入 WeakMap。 */
export function findRuntime(instance: object): TabRuntime | undefined {
  return runtimes.get(instance)
}

/** 生命周期清理完成后释放实例索引。 */
export function deleteRuntime(instance: object): void {
  runtimes.delete(instance)
}
