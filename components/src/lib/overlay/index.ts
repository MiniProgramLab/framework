// SPDX-License-Identifier: Apache-2.0
import { defineComponent } from '../adapters/component.js'
import { layerBehavior, layerProperties } from '../shared/layer.js'
import type { MaskPresentation } from '../shared/types.js'

/** 独立使用时管理自身弹层，组合使用时只绘制同一条目的遮罩。 */
defineComponent({
  overlayStore: true,
  options: { multipleSlots: true, virtualHost: true },
  externalClasses: ['surface-class'],
  behaviors: [layerBehavior],
  properties: {
    ...layerProperties,
    /** 仅供库内组合；非空时由面板宿主管理状态和动画，不重复登记。 */
    presentation: { type: Object, value: null as MaskPresentation | null },
  },
  data: { maskInSelf: true },
})
