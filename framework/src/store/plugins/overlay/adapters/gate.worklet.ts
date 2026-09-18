/** 手势代理只读取共享布尔值，不捕获 Store 或逻辑线程上下文。 */
export type ScrollGate = WechatMiniprogram.Skyline.SharedValue<boolean>
/** 组件模板绑定前创建共享引用，默认允许滚动。 */
export function createScrollGate(): ScrollGate {
  return wx.worklet.shared(true) as ScrollGate
}
/** worklet 方法通过固定实例字段读取滚动门控。 */
export type ScrollGateHost = { _scrollGate: ScrollGate }
