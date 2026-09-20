// SPDX-License-Identifier: Apache-2.0
/** 页面配置分组在编辑器中保持严格校验，目标平台由 CLI 统一选择。 */
import type { NativePageConfig, PageConfig } from '@miniprogramlab/core/config'

/** 最小声明只需要稳定的路由名称。 */
definePageConfig({ page: { name: 'home' } })
/** 参数类型、构建范围与原生字段互不混用。 */
definePageConfig({
  page: { name: 'detail', params: { id: { type: 'string', required: true }, page: { type: 'number' } } },
  build: { modes: ['development', 'staging'] },
  config: { navigationBarTitleText: '详情', usingComponents: { card: '/components/card/index' } },
})
/** Tab 种类由 tabBar 推导，省略 id 时使用路由名称。 */
definePageConfig({ page: { name: 'mine', tabBar: { text: '我的', order: 1, iconPath: '/mine.png' } } })
/** 原生项目可声明平台自有字段，不受微信默认配置类型约束。 */
const native: PageConfig<NativePageConfig> = { page: { name: 'native' }, config: { defaultTitle: '原生页' } }
void native
// @ts-expect-error Tab 路由与查询参数互斥。
definePageConfig({ page: { name: 'mine', tabBar: { text: '我的', order: 1, iconPath: '/mine.png' }, params: { id: { type: 'string' } } } })
// @ts-expect-error 旧 pagesName 顶层格式不再接受。
definePageConfig({ pagesName: 'home' })
// @ts-expect-error 原生配置必须放入 config。
definePageConfig({ page: { name: 'home' }, navigationBarTitleText: '首页' })
// @ts-expect-error 构建维度名称必须准确。
definePageConfig({ page: { name: 'home' }, build: { environments: ['development'] } })
// @ts-expect-error kind 由 tabBar 推导，不能重复声明。
definePageConfig({ page: { name: 'home', kind: 'tab' } })
// @ts-expect-error 参数类型只能为支持的标量。
definePageConfig({ page: { name: 'detail', params: { id: { type: 'object' } } } })
// @ts-expect-error 页面不能声明平台覆盖。
definePageConfig({ page: { name: 'home' }, platforms: { wechat: {} } })
// @ts-expect-error 页面不能按平台筛选。
definePageConfig({ page: { name: 'home' }, build: { platforms: ['wechat'] } })
// @ts-expect-error usingComponents 必须是路径映射。
definePageConfig({ page: { name: 'home' }, config: { usingComponents: { card: 1 } } })
