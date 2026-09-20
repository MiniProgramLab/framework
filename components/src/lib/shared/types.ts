// SPDX-License-Identifier: Apache-2.0
/** 组件公开数据只包含可序列化的值，不依赖宿主 Store 类型。 */
export type ComponentValue =
  | null
  | boolean
  | number
  | string
  | ComponentValue[]
  | { [key: string]: ComponentValue }

/** 组合使用时，遮罩只接收宿主弹层的展示投影，不另建活动条目。 */
export interface MaskPresentation {
  mounted: boolean
  rendered: boolean
  covered: boolean
  windowHeight: number
}
