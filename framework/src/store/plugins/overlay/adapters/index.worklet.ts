/** 手势适配单独作为 Worklet 入口，保持运行时依赖随组件内联。 */
export { createScrollGate } from './gate.worklet.js'
export type { ScrollGate, ScrollGateHost } from './gate.worklet.js'
