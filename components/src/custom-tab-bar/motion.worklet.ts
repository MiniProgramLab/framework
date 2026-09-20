// SPDX-License-Identifier: Apache-2.0
import { sampleTabSpring } from './spring.worklet.js'
import type { CustomTabAnimation, CustomTabMotion } from './types.js'

/** Worklet 按依赖顺序声明，禁止前向引用；微信转译会在定义时捕获依赖，不能依赖 JS 函数提升。 */
const { shared, derived, runOnJS, cancelAnimation } = wx.worklet
/** 官方支持省略完成回调，收窄旧类型声明，避免拖动中反复创建无用途的回调闭包。 */
const spring = wx.worklet.spring as unknown as (
  target: number,
  options: WechatMiniprogram.SpringOption,
) => number
/** 拖动仅复用一个线性 UI 时钟，松手和隐藏时立即停止。 */
const timing = wx.worklet.timing as unknown as (
  target: number,
  options: WechatMiniprogram.TimingOption,
) => number
/** 共享值的类型约束，普通对象仅在配置变化时跨线程传递。 */
type Shared<T> = WechatMiniprogram.Skyline.SharedValue<T>

/** 布局与主题的 UI 快照，更新时整体替换以触发依赖。 */
export interface FluidSettings {
  epoch: number
  alive: boolean
  locked: boolean
  visible: boolean
  enableDrag: boolean
  /** 底栏的屏幕坐标边界独立于选中块，弹簧拉伸不会扩大提交区域。 */
  barLeft: number
  barWidth: number
  left: number
  top: number
  height: number
  slot: number
  width: number
  enabled: boolean[]
  color: string
  selectedColor: string
  disabledColor: string
  motion: CustomTabMotion
}

/** 原生手势坐标使用屏幕逻辑像素，速度单位为像素每秒。 */
export interface FluidGesture {
  state: number
  absoluteX?: number
  absoluteY?: number
  translationX?: number
  translationY?: number
  velocityX?: number
}

/** 只有跨项预览和最终提交才通知 JS，不传输逐帧位置。 */
export interface FluidEvent {
  kind: 'preview' | 'commit'
  epoch: number
  sequence: number
  index: number
  source: 'tap' | 'drag'
  animation?: CustomTabAnimation
}

/** UI 线程独占手势状态，普通触摸事件无需维护第二份坐标。 */
interface FluidSession {
  /** 0 空闲、1 按下、2 横向拖动、3 长按拖动；取消仅作用于拥有手势的识别器。 */
  phase: number
  /** 原生 END 只标记结束，等待普通 touchend 携带最终触点后统一提交。 */
  ending: boolean
  startX: number
  startY: number
  /** 记录按下前的选择；触摸起点可以位于另一个尚未选中的项目。 */
  originIndex: number
  index: number
  sequence: number
  suppressUntil: number
  /** 长按事件不提供速度，以相邻移动采样补齐松手惯性。 */
  lastX: number
  lastY: number
  lastTime: number
  velocityX: number
}

/** 每次移动只更新采样起点与目标，原生动画对象不随触摸事件数量增加。 */
interface FluidTracking {
  startedAt: number
  from: number
  target: number
  velocity: number
  clockUntil: number
}

/** 双端位置形成拉伸，按压与落位脉冲负责浮起及回弹挤压。 */
export interface FluidState {
  settings: Shared<FluidSettings>
  session: Shared<FluidSession>
  head: Shared<number>
  tail: Shared<number>
  press: Shared<number>
  /** 普通触屏和原生协商共享按压目标，接管时不重复启动扩散。 */
  holding: Shared<boolean>
  kick: Shared<number>
  active: Shared<number>
  hover: Shared<number>
  flight: Shared<CustomTabAnimation | null>
  /** 尾部由时钟采样闭式曲线，手指停住后也能自然追上。 */
  tracking: Shared<FluidTracking | null>
  clock: Shared<number>
  geometry: Shared<{ x: number; scaleX: number; scaleY: number; lift: number }>
  notify: (event: FluidEvent) => void
}

/** 限制形变量和初速度，边缘或快速甩动时也保持可控。 */
function clamp(value: number, min: number, max: number): number {
  'worklet'
  return Math.max(min, Math.min(max, value))
}

/** 线性时钟直接推进时间，函数只定义一次，不随移动创建缓动闭包。 */
function linearTime(progress: number): number {
  'worklet'
  return progress
}

/** 后端用更软的弹簧追随前端，黏性为零时两端完全同步。 */
export function tailMotion(motion: CustomTabMotion): CustomTabMotion {
  'worklet'
  if (motion.viscosity === 0) return motion
  const stiffness = motion.stiffness * (1 - 0.25 * motion.viscosity)
  return Object.assign({}, motion, {
    stiffness,
    damping: Math.max(
      motion.damping,
      2 * Math.sqrt(stiffness * motion.mass) * 0.92,
    ),
  })
}

/** 动画赋值只在 UI 线程执行，减弱动态直接落到目标。 */
function animate(
  value: Shared<number>,
  target: number,
  motion: CustomTabMotion,
  velocity = 0,
): void {
  'worklet'
  value.value =
    !motion.enabled || motion.reducedMotion
      ? target
      : spring(target, {
          stiffness: motion.stiffness,
          damping: motion.damping,
          mass: motion.mass,
          velocity,
          overshootClamping: false,
          restDisplacementThreshold: 0.01,
          restSpeedThreshold: 0.1,
        })
}

/** 跟随使用临界阻尼曲线，反向时保留速度，避免尾部左右来回振荡。 */
function sampleTracking(
  tracking: FluidTracking,
  now: number,
  motion: CustomTabMotion,
): { value: number; velocity: number } {
  'worklet'
  const frequency = 2 / (0.045 + motion.viscosity * 0.09)
  const elapsed = Math.max(0, now - tracking.startedAt) / 1000
  const offset = tracking.from - tracking.target
  const slope = tracking.velocity + frequency * offset
  const envelope = Math.exp(-frequency * elapsed)
  return {
    value: tracking.target + (offset + slope * elapsed) * envelope,
    velocity: (tracking.velocity - frequency * slope * elapsed) * envelope,
  }
}

/** 查找最近可用项，跨过禁用项时不产生无效提交。 */
function nearest(settings: FluidSettings, position: number): number {
  'worklet'
  let index = -1
  let distance = Infinity
  for (let i = 0; i < settings.enabled.length; i += 1) {
    const next = Math.abs(i * settings.slot - position)
    if (settings.enabled[i] && next < distance) {
      index = i
      distance = next
    }
  }
  return index
}

/** 建立一次稳定的共享图，derived 每帧在 UI 线程组合位移和近似体积守恒形变。 */
export function createFluid(
  settings: FluidSettings,
  active: number,
  notify: FluidState['notify'],
): FluidState {
  const config = shared(settings) as Shared<FluidSettings>
  const head = shared(0) as Shared<number>
  const tail = shared(0) as Shared<number>
  const press = shared(0) as Shared<number>
  const kick = shared(0) as Shared<number>
  const clock = shared(0) as Shared<number>
  const tracking = shared(null) as Shared<FluidTracking | null>
  const geometry = derived(() => {
    'worklet'
    const value = config.value
    const motion = value.motion
    const moving = motion.enabled && !motion.reducedMotion
    const width = Math.max(1, value.width)
    const follower = tracking.value
    const tailPosition = follower
      ? sampleTracking(follower, clock.value, motion).value
      : tail.value
    const delta = moving
      ? clamp(
          head.value - tailPosition,
          -width * motion.stretch,
          width * motion.stretch,
        )
      : 0
    const elongation = (Math.abs(delta) / width) * 0.5
    const pressure = moving ? press.value * (motion.pressScale - 1) : 0
    const pulse = moving ? kick.value * motion.stretch * 0.06 : 0
    return {
      x: head.value - delta * 0.12,
      scaleX: clamp(1 + elongation + pressure + pulse, 0.98, 1.28),
      scaleY: clamp(1 + pressure - elongation * 0.32 - pulse * 0.2, 0.94, 1.12),
      lift: moving
        ? -motion.lift * (press.value + Math.max(0, kick.value) * 0.2)
        : 0,
    }
  }) as Shared<FluidState['geometry']['value']>
  return {
    settings: config,
    head,
    tail,
    press,
    kick,
    clock,
    tracking,
    geometry,
    notify,
    active: shared(active),
    hover: shared(active),
    holding: shared(false),
    flight: shared(null),
    session: shared({
      phase: 0,
      ending: false,
      startX: 0,
      startY: 0,
      originIndex: active,
      index: active,
      sequence: 0,
      suppressUntil: 0,
      lastX: 0,
      lastY: 0,
      lastTime: 0,
      velocityX: 0,
    }),
  }
}

/** 采集真实起点及归一化速度，下一页面能接续同一条物理曲线。 */
function release(
  state: FluidState,
  index: number,
  velocity = 0,
): CustomTabAnimation {
  'worklet'
  const { slot, motion } = state.settings.value
  const unit = Math.max(1, slot)
  const previous = state.flight.value
  const now = Date.now()
  const inherited = previous
    ? sampleTabSpring(
        previous.head,
        previous.target,
        now - previous.startedAt,
        previous.motion,
        previous.headVelocity,
      ).velocity * unit
    : 0
  const headVelocity = clamp(velocity || inherited, -unit * 4, unit * 4)
  const tracking = state.tracking.value
  const follower = tracking ? sampleTracking(tracking, now, motion) : null
  const tailVelocity =
    motion.viscosity === 0
      ? headVelocity
      : tracking
        ? clamp(follower!.velocity, -unit * 4, unit * 4)
        : previous
          ? sampleTabSpring(
              previous.tail,
              previous.target,
              now - previous.startedAt,
              tailMotion(previous.motion),
              previous.tailVelocity,
            ).velocity * unit
          : headVelocity * 0.5
  const moving = motion.enabled && !motion.reducedMotion
  const kick = moving
    ? Math.min(
        0.45,
        0.15 +
          (Math.abs(index * slot - state.head.value) / unit) * 0.08 +
          (Math.abs(headVelocity) / unit) * 0.02,
      )
    : 0
  const animation: CustomTabAnimation = {
    startedAt: now,
    head: state.head.value / unit,
    tail: (follower?.value ?? state.tail.value) / unit,
    headVelocity: headVelocity / unit,
    tailVelocity: tailVelocity / unit,
    target: index,
    press: state.press.value,
    kick,
    motion,
  }
  state.flight.value = animation
  cancelAnimation(state.clock)
  if (follower) state.tail.value = follower.value
  state.tracking.value = null
  state.holding.value = false
  state.kick.value = kick
  animate(state.head, index * slot, motion, headVelocity)
  animate(state.tail, index * slot, tailMotion(motion), tailVelocity)
  animate(state.press, 0, motion)
  animate(state.kick, 0, motion)
  return animation
}

/** 取消时恢复本轮按下前的选择；普通松手清理仍保留 tap 的提交机会。 */
export function cancelFluid(
  state: FluidState,
  epoch?: number,
  suppressTap = true,
): void {
  'worklet'
  if (epoch !== undefined)
    state.settings.value = Object.assign({}, state.settings.value, { epoch })
  const session = state.session.value
  if (!session.phase) {
    if (state.holding.value) {
      state.holding.value = false
      animate(state.press, 0, state.settings.value.motion)
      if (suppressTap)
        state.session.value = Object.assign({}, session, {
          suppressUntil: Date.now() + 350,
        })
    }
    return
  }
  state.session.value = Object.assign({}, session, {
    phase: 0,
    ending: false,
    suppressUntil: suppressTap ? Date.now() + 350 : session.suppressUntil,
  })
  state.active.value = session.originIndex
  state.hover.value = session.originIndex
  release(state, session.originIndex)
}

/** 配置和生命周期以一次 UI 命令同步，旧回调通过 epoch 自动失效。 */
export function configureFluid(
  state: FluidState,
  settings: FluidSettings,
  active: number,
  reset: boolean,
): void {
  'worklet'
  cancelFluid(state)
  state.settings.value = settings
  state.active.value = active
  state.hover.value = active
  if (reset || !settings.alive || !settings.visible) {
    cancelAnimation(state.head)
    cancelAnimation(state.tail)
    cancelAnimation(state.press)
    cancelAnimation(state.kick)
    cancelAnimation(state.clock)
    state.head.value = Math.max(0, active) * settings.slot
    state.tail.value = state.head.value
    state.press.value = 0
    state.kick.value = 0
    state.flight.value = null
    state.tracking.value = null
  }
}

/** TS 主动切换也在 UI 线程批量接管，连续调用保留当前运动状态。 */
export function selectFluid(
  state: FluidState,
  index: number,
  animated: boolean,
  epoch: number,
): void {
  'worklet'
  state.settings.value = Object.assign({}, state.settings.value, { epoch })
  const same = state.active.value === index && !state.session.value.phase
  const wasHolding = state.holding.value
  state.holding.value = false
  state.session.value = Object.assign({}, state.session.value, {
    phase: 0,
    ending: false,
  })
  state.active.value = index
  state.hover.value = index
  if (!animated) {
    cancelAnimation(state.clock)
    state.head.value = index * state.settings.value.slot
    state.tail.value = state.head.value
    state.press.value = 0
    state.kick.value = 0
    state.flight.value = null
    state.tracking.value = null
  } else if (!same || wasHolding) release(state, index)
}

/** 接续真实双端曲线，采样与后续弹簧都在目标页面 UI 线程完成。 */
export function resumeFluid(
  state: FluidState,
  animation: CustomTabAnimation,
): void {
  'worklet'
  const settings = state.settings.value
  const elapsed = Date.now() - animation.startedAt
  if (
    elapsed > 1000 ||
    !settings.motion.enabled ||
    settings.motion.reducedMotion
  )
    return
  const head = sampleTabSpring(
    animation.head,
    animation.target,
    elapsed,
    animation.motion,
    animation.headVelocity,
  )
  const tail = sampleTabSpring(
    animation.tail,
    animation.target,
    elapsed,
    tailMotion(animation.motion),
    animation.tailVelocity,
  )
  const press = sampleTabSpring(animation.press, 0, elapsed, animation.motion)
  const kick = sampleTabSpring(animation.kick, 0, elapsed, animation.motion)
  state.flight.value = animation
  state.head.value = head.value * settings.slot
  state.tail.value = tail.value * settings.slot
  state.press.value = press.value
  state.kick.value = kick.value
  animate(
    state.head,
    animation.target * settings.slot,
    animation.motion,
    head.velocity * settings.slot,
  )
  animate(
    state.tail,
    animation.target * settings.slot,
    tailMotion(animation.motion),
    tail.velocity * settings.slot,
  )
  animate(state.press, 0, animation.motion, press.velocity)
  animate(state.kick, 0, animation.motion, kick.velocity)
}

/** 原生手势开始前检查布局和导航锁，隐藏实例不再处理输入。 */
export function acceptsFluid(state: FluidState, drag = false): boolean {
  'worklet'
  const settings = state.settings.value
  return (
    settings.alive &&
    settings.visible &&
    !settings.locked &&
    settings.slot > 0 &&
    (!drag || settings.enableDrag)
  )
}

/** 长按优先使用相对起点的位移；结束事件缺少位置时保留最后有效采样。 */
function gesturePoint(
  state: FluidState,
  event: FluidGesture,
): { x: number; y: number } {
  'worklet'
  const session = state.session.value
  return {
    x: Number.isFinite(event.translationX)
      ? session.startX + (event.translationX as number)
      : Number.isFinite(event.absoluteX)
        ? (event.absoluteX as number)
        : session.lastX,
    y: Number.isFinite(event.translationY)
      ? session.startY + (event.translationY as number)
      : Number.isFinite(event.absoluteY)
        ? (event.absoluteY as number)
        : session.lastY,
  }
}

/** 仅在按压目标变化时赋值，触屏到长按期间保持同一条扩散弹簧。 */
function holdFluid(state: FluidState): void {
  'worklet'
  if (state.holding.value) return
  state.holding.value = true
  animate(state.press, 1, state.settings.value.motion)
}

/** 在原生识别阶段应用可配置阈值，纵向滚动交还页面处理。 */
export function respondsFluid(state: FluidState, event: FluidGesture): boolean {
  'worklet'
  if (!acceptsFluid(state, true)) return false
  const session = state.session.value
  if (session.phase !== 1) return true
  const point = gesturePoint(state, event)
  const dx = Math.abs(point.x - session.startX)
  const dy = Math.abs(point.y - session.startY)
  return dx >= state.settings.value.motion.dragThreshold && dx >= dy
}

/** 按下时打断在途弹簧；手势状态始终留在 UI 线程。 */
function begin(state: FluidState, event: FluidGesture): boolean {
  'worklet'
  const settings = state.settings.value
  if (
    !acceptsFluid(state) ||
    !Number.isFinite(event.absoluteX) ||
    !Number.isFinite(event.absoluteY)
  )
    return false
  const x = event.absoluteX as number
  const y = event.absoluteY as number
  const index = Math.floor((x - settings.left) / settings.slot)
  if (!settings.enabled[index]) return false
  const session = state.session.value
  state.session.value = {
    phase: 1,
    ending: false,
    startX: x,
    startY: y,
    originIndex: state.active.value,
    index,
    sequence: session.sequence + 1,
    suppressUntil: 0,
    lastX: x,
    lastY: y,
    lastTime: Date.now(),
    velocityX: 0,
  }
  cancelAnimation(state.head)
  cancelAnimation(state.tail)
  cancelAnimation(state.clock)
  state.flight.value = null
  state.tracking.value = null
  holdFluid(state)
  return true
}

/** 触屏只补齐按压反馈，不混用 touch 的视口坐标与原生手势屏幕坐标。 */
export function touchPressFluid(
  state: FluidState,
  index: number,
  epoch: number,
): void {
  'worklet'
  if (
    state.settings.value.epoch !== epoch ||
    !acceptsFluid(state) ||
    !state.settings.value.enabled[index] ||
    Date.now() < state.session.value.suppressUntil
  )
    return
  holdFluid(state)
}

/** 识别协商在触屏时立即运行，多个识别器只启动一次按压弹簧。 */
export function pressFluid(
  state: FluidState,
  event?: FluidGesture,
  drag = false,
): boolean {
  'worklet'
  if (!acceptsFluid(state, drag)) return false
  return state.session.value.phase !== 0 || !event || begin(state, event)
}

/** 普通松手必须包含两个方向的最终位置，未知终点不能用预览项代替。 */
function hasEndPoint(event: FluidGesture): boolean {
  'worklet'
  return (
    (Number.isFinite(event.translationX) || Number.isFinite(event.absoluteX)) &&
    (Number.isFinite(event.translationY) || Number.isFinite(event.absoluteY))
  )
}

/** 提交前先完成 UI 吸附，即使 JS 正忙也能立即给出松手反馈。 */
function commit(
  state: FluidState,
  index: number,
  source: 'tap' | 'drag',
  velocity = 0,
): void {
  'worklet'
  if (!acceptsFluid(state) || !state.settings.value.enabled[index]) {
    cancelFluid(state)
    return
  }
  const session = state.session.value
  const animation = release(state, index, velocity)
  state.active.value = index
  state.hover.value = index
  state.session.value = Object.assign({}, session, {
    phase: 0,
    ending: false,
    suppressUntil: Date.now() + 350,
  })
  runOnJS(state.notify)({
    kind: 'commit',
    epoch: state.settings.value.epoch,
    sequence: session.sequence,
    index,
    source,
    animation,
  })
}

/** 点击竞争失败不撤销按压，长按接管时沿用正在扩散的同一条曲线。 */
export function tapFluid(state: FluidState, event: FluidGesture): void {
  'worklet'
  if (event.state === 0 || event.state === 1) {
    if (!state.session.value.phase) begin(state, event)
  } else if (event.state === 3 && state.session.value.phase === 1)
    commit(state, state.session.value.index, 'tap')
}

/** 按住与横向拖动共用跟手动画，长按激活时先平滑移动到指下。 */
function moveFluid(
  state: FluidState,
  event: FluidGesture,
  easeToFinger = false,
): void {
  'worklet'
  const settings = state.settings.value
  const session = state.session.value
  const point = gesturePoint(state, event)
  const now = Date.now()
  const dx = point.x - session.lastX
  if (dx !== 0 || point.y !== session.lastY) {
    state.session.value = Object.assign({}, session, {
      lastX: point.x,
      lastY: point.y,
      lastTime: dx !== 0 ? now : session.lastTime,
      velocityX:
        dx !== 0
          ? clamp(
              (dx * 1000) / Math.max(8, now - session.lastTime),
              -settings.slot * 12,
              settings.slot * 12,
            )
          : session.velocityX,
    })
  }
  const position = point.x - settings.left - settings.slot / 2
  const bounded = clamp(
    position,
    0,
    (settings.enabled.length - 1) * settings.slot,
  )
  const motion = settings.motion
  const moving = motion.enabled && !motion.reducedMotion
  const target =
    bounded +
    (moving
      ? clamp(position - bounded, -settings.slot / 2, settings.slot / 2) *
        motion.edgeResistance
      : 0)
  if (easeToFinger) animate(state.head, target, motion)
  else state.head.value = target
  if (moving && motion.viscosity > 0) {
    const tracking = state.tracking.value
    const follower = tracking
      ? sampleTracking(tracking, now, motion)
      : { value: state.tail.value, velocity: 0 }
    // 同一个时钟连续运行；长时间按住超过一分钟时才续期，不创建逐帧动画或回调。
    const renewClock = !tracking || now >= tracking.clockUntil
    const clockUntil = renewClock ? now + 60000 : tracking.clockUntil
    if (renewClock) {
      state.clock.value = now
      state.clock.value = timing(clockUntil, {
        duration: 60000,
        easing: linearTime,
      })
    }
    state.tracking.value = {
      startedAt: now,
      from: follower.value,
      target,
      velocity: follower.velocity,
      clockUntil,
    }
  } else {
    cancelAnimation(state.clock)
    if (easeToFinger) animate(state.tail, target, motion)
    else state.tail.value = target
    state.tracking.value = null
  }
  let index = nearest(settings, bounded)
  const hover = state.hover.value
  // 交界处留少量滞回，快速反向时图标与文字不会在相邻项之间反复闪烁。
  if (
    settings.enabled[hover] &&
    Math.abs(bounded - hover * settings.slot) <=
      settings.slot / 2 + Math.min(5, settings.slot * 0.06)
  )
    index = hover
  if (index !== state.hover.value) {
    state.hover.value = index
    runOnJS(state.notify)({
      kind: 'preview',
      epoch: settings.epoch,
      sequence: session.sequence,
      index,
      source: 'drag',
    })
  }
}

/** 松手仅命中底栏实际边界内的项目，越界或落在禁用项时回到按下前的选择。 */
function finishDrag(state: FluidState, event: FluidGesture): void {
  'worklet'
  const settings = state.settings.value
  const session = state.session.value
  const point = gesturePoint(state, event)
  if (
    point.x < settings.barLeft ||
    point.x > settings.barLeft + settings.barWidth ||
    point.y < settings.top ||
    point.y > settings.top + settings.height
  ) {
    cancelFluid(state)
    return
  }
  // 内边距属于底栏触摸区；区域之外不能借最近项吸附提交。
  const index = clamp(
    Math.floor((point.x - settings.left) / settings.slot),
    0,
    settings.enabled.length - 1,
  )
  if (!settings.enabled[index]) {
    cancelFluid(state)
    return
  }
  const velocity =
    event.velocityX === undefined
      ? Date.now() - session.lastTime <= 80
        ? session.velocityX
        : 0
      : event.velocityX
  commit(state, index, 'drag', velocity * settings.motion.velocityInfluence)
}

/** 原生长按负责预览，END 的占位坐标不参与提交，等待真实触摸松手统一收尾。 */
export function longPressFluid(state: FluidState, event: FluidGesture): void {
  'worklet'
  const session = state.session.value
  const phase = session.phase
  if (session.ending) return
  if (event.state === 4) {
    if (phase === 3) cancelFluid(state)
    return
  }
  if (event.state === 0 || phase === 2) return
  if (!acceptsFluid(state, true)) {
    if (phase === 3) cancelFluid(state)
    return
  }
  if (event.state === 1) {
    if (phase !== 1 && !begin(state, event)) return
    state.session.value = Object.assign({}, state.session.value, { phase: 3 })
    moveFluid(state, event, true)
  } else if (phase === 3 && event.state === 2) moveFluid(state, event)
  else if (phase === 3 && event.state === 3)
    state.session.value = Object.assign({}, session, { ending: true })
}

/** 横滑同样等待 touchend，避免两种识别器使用不同的终点来源。 */
export function dragFluid(state: FluidState, event: FluidGesture): void {
  'worklet'
  if (state.session.value.ending) return
  if (event.state === 3 && state.session.value.phase === 2) {
    state.session.value = Object.assign({}, state.session.value, {
      ending: true,
    })
    return
  }
  if (state.session.value.phase === 3) return
  if (event.state === 4) {
    if (state.session.value.phase === 2) cancelFluid(state)
    return
  }
  if (event.state === 0) return
  if (!acceptsFluid(state, true)) {
    cancelFluid(state)
    return
  }
  if (!state.session.value.phase && (event.state !== 1 || !begin(state, event)))
    return
  const session = state.session.value
  if (!session.phase) return
  if (event.state === 3) return
  const settings = state.settings.value
  if (
    event.state !== 1 &&
    Math.abs(gesturePoint(state, event).x - session.startX) <
      settings.motion.dragThreshold &&
    session.phase !== 2
  )
    return
  if (session.phase !== 2)
    state.session.value = Object.assign({}, session, { phase: 2 })
  moveFluid(state, event)
}

/** 拖动仅从普通松手提交一次；它的最终触点优先于原生 END 和最后一帧预览。 */
export function endFluid(
  state: FluidState,
  epoch: number,
  sequence: number,
  event: FluidGesture = { state: 3 },
): void {
  'worklet'
  const session = state.session.value
  if (state.settings.value.epoch !== epoch || session.sequence !== sequence)
    return
  if (session.phase >= 2) {
    if (hasEndPoint(event)) finishDrag(state, event)
    else cancelFluid(state)
  } else cancelFluid(state, undefined, false)
}

/** 普通 tap 与原生点击共用提交入口；待定按下可提交，拖动及已消费的操作仍去重。 */
export function fallbackTapFluid(state: FluidState, index: number): void {
  'worklet'
  const session = state.session.value
  if (
    Date.now() < session.suppressUntil ||
    session.phase === 2 ||
    session.phase === 3
  )
    return
  if (!session.phase)
    state.session.value = Object.assign({}, session, {
      sequence: session.sequence + 1,
    })
  commit(state, index, 'tap')
}
