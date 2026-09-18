import type { CustomTabMotion } from './types.js'

/** 跨组件接续使用的位置与速度，单位分别为逻辑像素及逻辑像素每秒。 */
interface SpringSample {
  value: number
  velocity: number
}

/** 按已用时间采样带初速度的弹簧，避免新 Tab 页面从起点重播整个动画。 */
export function sampleTabSpring(
  from: number,
  to: number,
  elapsed: number,
  motion: CustomTabMotion,
  initialVelocity = 0,
): SpringSample {
  'worklet'
  const time = Math.max(0, elapsed) / 1000
  const offset = from - to
  const decay = motion.damping / (2 * motion.mass)
  const frequencySquared = motion.stiffness / motion.mass
  const discriminant = frequencySquared - decay * decay
  if (Math.abs(discriminant) < 0.0001) {
    // 临界阻尼不经过三角函数，避免接近零频率时除零。
    const envelope = Math.exp(-decay * time)
    const slope = initialVelocity + decay * offset
    return {
      value: to + (offset + slope * time) * envelope,
      velocity: (initialVelocity - decay * slope * time) * envelope,
    }
  }
  if (discriminant > 0) {
    const frequency = Math.sqrt(discriminant)
    const phase = frequency * time
    const envelope = Math.exp(-decay * time)
    return {
      value:
        to +
        envelope *
          (offset * Math.cos(phase) +
            ((initialVelocity + decay * offset) / frequency) * Math.sin(phase)),
      velocity:
        envelope *
        (initialVelocity * Math.cos(phase) -
          ((decay * initialVelocity + frequencySquared * offset) / frequency) *
            Math.sin(phase)),
    }
  }
  // 过阻尼使用两个实根，同样支持用户动态调高阻尼的配置。
  const root = Math.sqrt(-discriminant)
  const slow = -decay + root
  const fast = -decay - root
  const first =
    ((initialVelocity - fast * offset) / (slow - fast)) * Math.exp(slow * time)
  const second =
    ((slow * offset - initialVelocity) / (slow - fast)) * Math.exp(fast * time)
  return { value: to + first + second, velocity: slow * first + fast * second }
}
