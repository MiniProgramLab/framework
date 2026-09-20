// SPDX-License-Identifier: Apache-2.0
/** 通用入口仅导出路由能力与协议，不加载任何平台适配器。 */
export { createRouter } from './router.js'
export { createNavigationRegistry } from './registry.js'
export type {
  NavigationAdapter, NativeNavigateBackOptions, NativeNavigationApi, NativeNavigationOptions, PlatformNavigationAdapter,
  NavigationBackBuilder, NavigationBackResult, NavigationBackSuccess, NavigationBackSuccessHandler,
  NavigationBuilder, NavigationCallbackExecution, NavigationError, NavigationFailHandler, NavigationMethod, NavigationResult,
  NavigationSuccess, NavigationSuccessHandler, NavigationUrlBuilder,
  RouteArguments, RouteDefinition,
  RouteName, RoutePath, RouteParamRule, RouteParams, Router, RouterOptions, RouteTable,
  TabPageName, TabPagePath, TabRouteMetadata,
} from './types.js'
