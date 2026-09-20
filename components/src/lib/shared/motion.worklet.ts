// SPDX-License-Identifier: Apache-2.0
/** 动画在 UI 线程执行，只在完成时回传逻辑线程。 */
const { shared, cancelAnimation, runOnJS } = wx.worklet
/** 原生动画对象可直接赋给数值共享值，补齐官方声明中的赋值类型。 */
const timing = wx.worklet.timing as unknown as (
  target: number,
  options: WechatMiniprogram.TimingOption,
  callback: (finished: boolean) => void,
) => number
/** 位移方向与测量尺寸组成轻量共享配置。 */
export type OverlayGeometry = {
  position: string
  width: number
  height: number
}
/** 每个 Overlay 单独持有动画值和完成回调。 */
export interface OverlayMotion {
  progress: WechatMiniprogram.Skyline.SharedValue<number>
  geometry: WechatMiniprogram.Skyline.SharedValue<OverlayGeometry>
  done(generation: number): void
}
/** 组件创建时建立共享值，避免模板捕获尚未创建的引用。 */
export function createOverlayMotion(
  done: OverlayMotion['done'],
): OverlayMotion {
  return {
    progress: shared(0),
    geometry: shared({ position: 'center', width: 0, height: 0 }),
    done,
  } as OverlayMotion
}
/** 平滑减速仅用于位移与透明度，不逐帧跨线程更新模板。 */
function easeOut(value: number): number {
  'worklet'
  return 1 - Math.pow(1 - value, 3)
}
/** 反向开关从当前位置续接；被取消的动画不发送完成事件。 */
export function playOverlayMotion(
  motion: OverlayMotion,
  open: boolean,
  generation: number,
): void {
  const { progress, done } = motion
  wx.worklet.runOnUI(() => {
    'worklet'
    cancelAnimation(progress)
    progress.value = timing(
      open ? 1 : 0,
      { duration: open ? 240 : 180, easing: easeOut },
      (finished) => {
        'worklet'
        if (finished) runOnJS(done)(generation)
      },
    )
  })()
}
/** 隐藏或卸载停止动画，不伪造完成。 */
export function pauseOverlayMotion(motion: OverlayMotion): void {
  const { progress } = motion
  wx.worklet.runOnUI(() => {
    'worklet'
    cancelAnimation(progress)
  })()
}
/** 首次挂载及内容重建时从关闭位置开始，不闪现完整表面。 */
export function resetOverlayMotion(motion: OverlayMotion): void {
  const { progress } = motion
  wx.worklet.runOnUI(() => {
    'worklet'
    cancelAnimation(progress)
    progress.value = 0
  })()
}
/** 表面仅改变合成属性，边缘弹层按自己的测量尺寸滑入。 */
export function overlaySurfaceStyle(
  progress: number,
  geometry: OverlayGeometry,
): Record<string, string> {
  'worklet'
  const distance = 1 - progress
  let x = 0
  let y = 0
  if (geometry.position === 'bottom') y = distance * geometry.height
  if (geometry.position === 'top') y = -distance * geometry.height
  if (geometry.position === 'left') x = -distance * geometry.width
  if (geometry.position === 'right') x = distance * geometry.width
  return {
    opacity: String(progress),
    transform:
      geometry.position === 'center'
        ? `scale(${0.96 + 0.04 * progress})`
        : `translate(${x}px, ${y}px)`,
  }
}

/** 原生样式句柄必须随原节点清理，不能跨内容重建复用。 */
export interface OverlayBindings {
  epoch: number
  handles: { host: MotionHost; selector: string; id: number }[]
}
/** 动画宿主只需要原生样式绑定能力。 */
type MotionHost = Pick<
  WechatMiniprogram.Component.TrivialInstance,
  'applyAnimatedStyle' | 'clearAnimatedStyle'
>
/** 绑定两个可复用表面，异步返回的旧句柄立即释放。 */
export function bindOverlayMotion(
  host: MotionHost,
  maskHost: MotionHost,
  motion: OverlayMotion,
  bindings: OverlayBindings,
): Promise<void> {
  const epoch = bindings.epoch
  const { progress, geometry } = motion
  /** 每个绑定回执核对原生节点代次，迟到句柄立即清理。 */
  const accept =
    (target: MotionHost, selector: string, resolve: () => void) =>
    (result: { styleId: number }): void => {
      if (epoch === bindings.epoch)
        bindings.handles.push({
          host: target,
          selector,
          id: result.styleId,
        })
      else target.clearAnimatedStyle(selector, [result.styleId])
      resolve()
    }
  // 保持 updater 直接作为原生 API 参数，微信编译器才能建立共享值的样式依赖。
  return Promise.all([
    new Promise<void>((resolve) =>
      maskHost.applyAnimatedStyle(
        '.overlay__mask',
        () => {
          'worklet'
          return { opacity: `${progress.value * 0.36}` }
        },
        { immediate: true, flush: 'async' },
        accept(maskHost, '.overlay__mask', resolve),
      ),
    ),
    new Promise<void>((resolve) =>
      host.applyAnimatedStyle(
        '.layer__surface',
        () => {
          'worklet'
          return overlaySurfaceStyle(progress.value, geometry.value)
        },
        { immediate: true, flush: 'async' },
        accept(host, '.layer__surface', resolve),
      ),
    ),
  ]).then(() => {})
}
/** 弃用当前节点上的全部样式订阅，同时使在途绑定失效。 */
export function clearOverlayMotion(
  bindings: OverlayBindings,
): void {
  bindings.epoch += 1
  for (const binding of bindings.handles)
    binding.host.clearAnimatedStyle(binding.selector, [binding.id])
  bindings.handles = []
}
