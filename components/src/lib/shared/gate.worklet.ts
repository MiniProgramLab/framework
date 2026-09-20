// SPDX-License-Identifier: Apache-2.0
/** 手势共享值属于组件实例，默认允许内容滚动。 */
export function createScrollGate(): WechatMiniprogram.Skyline.SharedValue<boolean> {
  return wx.worklet.shared(
    true,
  ) as WechatMiniprogram.Skyline.SharedValue<boolean>
}

/** 模板中的 worklet 只读取固定共享字段。 */
export type ScrollGateHost = {
  _scrollGate: WechatMiniprogram.Skyline.SharedValue<boolean>
}
