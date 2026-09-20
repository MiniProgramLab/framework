// SPDX-License-Identifier: Apache-2.0
import type { FluidState } from './motion.worklet.js'
import type { CustomTabItem } from './types.js'

/** 动画绑定由实例独立持有，异步句柄按生命周期及列表代次失效。 */
export interface MotionBindings {
  alive: boolean
  bound: boolean
  itemKey: string
  revision: number
  handles: { selector: string; id: number }[]
}

/** 绑定模块只依赖原生样式接口，不读取组件 data 或应用导航。 */
type BindingHost = Pick<
  WechatMiniprogram.Component.TrivialInstance,
  'applyAnimatedStyle' | 'clearAnimatedStyle'
>

/** 异步返回的旧句柄立即释放，不允许列表更新或销毁后残留绑定。 */
function bindStyle(
  host: BindingHost,
  bindings: MotionBindings,
  selector: string,
  updater: () => Record<string, string>,
  revision = -1,
): void {
  host.applyAnimatedStyle(
    selector,
    updater,
    { immediate: true, flush: 'async' },
    (result) => {
      if (bindings.alive && (revision < 0 || revision === bindings.revision))
        bindings.handles.push({ selector, id: result.styleId })
      else host.clearAnimatedStyle(selector, [result.styleId])
    },
  )
}

/** 基座与选中块的共享图只绑定一次，Worklet 闭包仅捕获共享值。 */
export function bindBaseMotion(
  host: BindingHost,
  bindings: MotionBindings,
  state: FluidState,
): void {
  if (bindings.bound) return
  bindings.bound = true
  const { geometry } = state
  bindStyle(host, bindings, '.custom-tab__position', () => {
    'worklet'
    return { transform: `translateX(${geometry.value.x}px)` }
  })
  bindStyle(host, bindings, '.custom-tab__indicator', () => {
    'worklet'
    const value = geometry.value
    return {
      transform: `translateY(${value.lift}px) scaleX(${value.scaleX}) scaleY(${value.scaleY})`,
    }
  })
}

/** 只在条目身份或顺序变化时重绑，主题、角标变化继续使用原节点。 */
export function bindItemMotion(
  host: BindingHost,
  bindings: MotionBindings,
  state: FluidState,
  items: readonly CustomTabItem[],
): void {
  const key = items.map((item) => item.id).join('\0')
  if (key === bindings.itemKey) return
  bindings.itemKey = key
  const revision = ++bindings.revision
  bindings.handles = bindings.handles.filter((binding) => {
    if (!binding.selector.includes('__ui-')) return true
    host.clearAnimatedStyle(binding.selector, [binding.id])
    return false
  })
  const { hover, settings, press, kick } = state
  items.forEach((_item, index) => {
    bindStyle(
      host,
      bindings,
      `.custom-tab__ui-content-${index}`,
      () => {
        'worklet'
        const motion = settings.value.motion
        const amount =
          hover.value === index && motion.enabled && !motion.reducedMotion
            ? press.value
            : 0
        const bounce =
          hover.value === index && motion.enabled && !motion.reducedMotion
            ? kick.value
            : 0
        return {
          transform: `translateY(${-motion.lift * (amount * 0.45 + bounce * 0.35)}px) scale(${1 - amount * 0.04 + bounce * 0.025})`,
        }
      },
      revision,
    )
    bindStyle(
      host,
      bindings,
      `.custom-tab__ui-normal-${index}`,
      () => {
        'worklet'
        return { opacity: hover.value === index ? '0' : '1' }
      },
      revision,
    )
    bindStyle(
      host,
      bindings,
      `.custom-tab__ui-selected-${index}`,
      () => {
        'worklet'
        return { opacity: hover.value === index ? '1' : '0' }
      },
      revision,
    )
    bindStyle(
      host,
      bindings,
      `.custom-tab__ui-label-${index}`,
      () => {
        'worklet'
        const value = settings.value
        return {
          color: !value.enabled[index]
            ? value.disabledColor
            : hover.value === index
              ? value.selectedColor
              : value.color,
        }
      },
      revision,
    )
  })
}

/** 销毁时同时废弃在途绑定回调并释放已获得的全部句柄。 */
export function clearMotionBindings(
  host: BindingHost,
  bindings: MotionBindings,
): void {
  bindings.alive = false
  bindings.revision += 1
  bindings.handles.forEach((binding) =>
    host.clearAnimatedStyle(binding.selector, [binding.id]),
  )
  bindings.handles = []
  bindings.bound = false
  bindings.itemKey = ''
}
