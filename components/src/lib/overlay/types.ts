/** 关闭原因用于区分业务控制、用户取消和正常选择。 */
export type OverlayCloseReason =
  | 'programmatic'
  | 'mask'
  | 'close'
  | 'cancel'
  | 'select'
  | 'error'

/** 显示状态改变时透传给包装组件和单向绑定的调用方。 */
export interface OverlayChangeDetail {
  show: boolean
  reason: OverlayCloseReason
}

/** 组合组件只通过此接口控制内部 Overlay，不接触 Store 或动画资源。 */
export interface OverlayHandle
  extends WechatMiniprogram.Component.TrivialInstance {
  /** 按统一协议请求关闭，自动同步显示状态。 */
  requestClose(reason?: OverlayCloseReason): void
  /** 标题或选项异步变化后重新测量内容。 */
  refreshLayout(): void
}
