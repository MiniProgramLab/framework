// SPDX-License-Identifier: Apache-2.0
/** 组件注册路径为纯数据，配置求值不加载组件运行时。 */
export const libraryComponents = {
  page: '@miniprogramlab/ui/page/index',
  'page-header': '@miniprogramlab/ui/page-header/index',
  overlay: '@miniprogramlab/ui/lib/overlay/index',
  popup: '@miniprogramlab/ui/lib/popup/index',
  'action-sheet': '@miniprogramlab/ui/lib/action-sheet/index',
} as const
