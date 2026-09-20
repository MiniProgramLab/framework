// SPDX-License-Identifier: Apache-2.0
import { definitionFactory } from '../../definition.js'
import { defineStorePlugin } from '../../plugin.js'
import type { StoreState } from '../../types.js'
import { pageDefinition } from './definition.js'

/** 页面业务区域通过统一协议接入，定义身份约束留在插件内部。 */
export const pageStorePlugin = defineStorePlugin<StoreState>({
  key: '__pageStore__',
  option: 'pageStore',
  extraOptions: ['pageStoreDefinition'],
  /** 定义存在时提前验证种类，未开启参与也不能接受伪造定义。 */
  validateOptions(options) {
    if (options.pageStoreDefinition !== undefined)
      definitionFactory(options.pageStoreDefinition as object, 'page')
  },
  /** 组件声明的定义必须与其固定所属页面一致。 */
  validateContext({ options, ownerOptions }) {
    if (
      options.pageStoreDefinition &&
      options.pageStoreDefinition !== pageDefinition(ownerOptions)
    )
      throw new Error('组件与所属页面的 Store 定义不匹配')
  },
  /** 同一页面的首次参与者负责执行页面定义。 */
  create({ ownerOptions }) {
    return definitionFactory(pageDefinition(ownerOptions), 'page')()
  },
})
