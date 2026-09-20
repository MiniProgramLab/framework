// SPDX-License-Identifier: Apache-2.0
/** 按消费项目生成统一的路由模块和编辑器解析配置。 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { DiscoveredRoute, PlatformAdapter } from './types.js'
import { exists } from './files.js'
import { assertRouteName } from './route-name.js'
import { navigationApis, runtimeApiCompilation, runtimeApiSource } from './api.js'
import { resolvePlatform } from './platforms.js'

/** 所有平台共用的应用路由入口，由 CLI 解析，不作为 npm 包安装。 */
export const routesModuleName = '@miniprogramlab/routes'

/** 将虚拟入口定位到当前应用，防止多个应用共享错误的路由表。 */
export function generatedRoutesPath(root: string) {
  return path.resolve(root, '.cache/routes.generated.ts')
}

/** 内容变化时才写入缓存，避免编辑器重复刷新相同声明。 */
async function writeChanged(filename: string, content: string) {
  if (!(await exists(filename)) || await readFile(filename, 'utf8') !== content)
    await writeFile(filename, content)
}

/** 转义注释结束符并整理多行描述，防止页面描述破坏生成代码。 */
function enumMember(route: DiscoveredRoute) {
  assertRouteName(route.name, route.path)
  const description = route.description.replace(/\*\//g, '*\\/').split(/\r\n|[\n\r\u2028\u2029]/).map((line) => '   * ' + line).join('\n')
  return `  /**\n${description}\n   */\n  ${route.name} = ${JSON.stringify('/' + route.path)},`
}

/** 为有参数的页面命名规则，避免 params 悬浮时再次展开原始配置。 */
function routeTypeDeclarations(routes: DiscoveredRoute[]) {
  const parameterized = routes.filter((route) => Object.keys(route.params).length)
  return [
    '/** 从运行时常量推导完整契约，避免重复生成或放宽字段类型。 */',
    'type RouteDefinitions = typeof routes',
    ...(parameterized.length ? [
      '/** 按页面取得原始声明，具名接口只改变类型展示。 */',
      'type RouteDefinitionOf<Name extends keyof RouteDefinitions> = RouteDefinitions[Name]',
      '/** 保留标量种类和必填标记，不维护第二份参数规则。 */',
      'type RouteRulesOf<Name extends keyof RouteDefinitions> = RouteDefinitions[Name]["params"]',
      ...parameterized.flatMap((route) => [
        '/** 隐藏参数规则的结构，编辑器仍按此规则补全参数值。 */',
        `interface RouteRules_${route.name} extends RouteRulesOf<${JSON.stringify(route.name)}> {}`,
        '/** 在保留原始契约的前提下，引用具名参数规则。 */',
        `interface RouteDefinition_${route.name} extends RouteDefinitionOf<${JSON.stringify(route.name)}> {`,
        '  /** 当前页面的完整参数规则。 */',
        `  readonly params: RouteRules_${route.name}`,
        '}',
      ]),
    ] : []),
    ...(parameterized.length ? [
      '/** 仅替换有参数页面的显示名称，键集合仍来自原始路由表。 */',
      'type ParameterizedRoutes = {',
      ...parameterized.flatMap((route) => [
        '  /** 保留页面与参数规则的对应关系。 */',
        `  readonly ${JSON.stringify(route.name)}: RouteDefinition_${route.name}`,
      ]),
      '}',
      '/** 映射类型保留精确键集合及隐式索引兼容性，不增加宽泛的字符串索引。 */',
      'type NamedRouteDefinitions = {',
      '  readonly [Name in keyof RouteDefinitions]: Name extends keyof ParameterizedRoutes ? ParameterizedRoutes[Name] : RouteDefinitions[Name]',
      '}',
    ] : []),
    '/** 以具名接口保留完整契约，导航提示不再展开整张路由表。 */',
    `export interface Routes extends ${parameterized.length ? 'NamedRouteDefinitions' : 'RouteDefinitions'} {}`,
  ].join('\n')
}

/** 一次生成运行时常量、具体应用类型及 TypeScript 路径配置。 */
export async function writeRoutesModule(root: string, contract: { routes: DiscoveredRoute[]; entryPageName: string }, adapter: PlatformAdapter = resolvePlatform(), source = path.join(root, 'src')) {
  const routes = Object.fromEntries(contract.routes.map((route) => [route.name, {
    ...route,
    path: '/' + route.path,
  }]))
  const content = `// SPDX-License-Identifier: Apache-2.0
/** 由 framework 根据页面配置自动生成，请勿手动编辑。 */
import { createRouter } from '@miniprogramlab/core/router'
import type {
  RouteName as InferRouteName,
  RoutePath as InferRoutePath,
  TabPageName as InferTabPageName,
  TabPagePath as InferTabPagePath,
  RouteParams as InferRouteParams,
  RouteArguments as InferRouteArguments,
  Router,
} from '@miniprogramlab/core/router/types'

/** 页面描述作为枚举成员注释，导航时可直接使用 PageEnum.name。 */
export enum PageEnum {
${contract.routes.map(enumMember).join('\n')}
}

/** 当前应用的完整路由契约；所有声明保留路径，由 available 控制导航权限。 */
export const routes = ${JSON.stringify(routes, null, 2)} as const

/** 当前应用的默认入口名称。 */
export const entryPageName = ${JSON.stringify(contract.entryPageName)} as const

${routeTypeDeclarations(contract.routes)}
/** 当前应用声明的全部页面名称，包含当前环境未启用的页面。 */
export type RouteName = InferRouteName<Routes>
/** 编译后的页面路径，可直接使用 PageEnum 成员。 */
export type RoutePath = InferRoutePath<Routes>
/** 当前应用声明的 Tab 页面名称。 */
export type TabPageName = InferTabPageName<Routes>
/** 原生 Tab 页路径。 */
export type TabPagePath = InferTabPagePath<Routes>
/** 当前应用的默认入口名称类型。 */
export type EntryPageName = typeof entryPageName
/** 指定页面的参数对象，自动保留必填项及标量类型。 */
export type RouteParams<Path extends RoutePath> = InferRouteParams<Routes, Path>
/** 指定页面的导航参数列表，控制参数对象能否省略。 */
export type RouteArguments<Path extends RoutePath> = InferRouteArguments<Routes, Path>
/** 已绑定当前应用路由契约的 Router 实例类型。 */
export type AppRouter = Router<Routes>

export type {
  NavigationResult, NavigationError, NavigationSuccess, NavigationSuccessHandler, NavigationFailHandler, NavigationCallbackExecution,
  NavigationBackBuilder, NavigationBackResult, NavigationBackSuccess, NavigationBackSuccessHandler,
  NavigationUrlBuilder,
} from '@miniprogramlab/core/router/types'

/** 当前应用共用的路由实例，导航平台由 CLI 在编译时绑定。 */
export const router: AppRouter = createRouter({ routes, entryPageName })

/** 独立宿主可直接创建路由或适配器注册表。 */
export { createRouter }
export { createNavigationRegistry } from '@miniprogramlab/core/router'

${navigationApis.map((name) => `/** 复用当前应用的 ${name} 方法及参数约束。 */\nexport const ${name}: AppRouter[${JSON.stringify(name)}] = router.${name}`).join('\n')}
`
  const filename = generatedRoutesPath(root)
  await mkdir(path.dirname(filename), { recursive: true })
  await writeChanged(filename, content)
  const apiFile = path.join(root, '.cache/api.generated.ts')
  await writeChanged(apiFile, '// SPDX-License-Identifier: Apache-2.0\n/** 由 CLI 装配的公开 API，请勿手动编辑。 */\n' + await runtimeApiSource(root, adapter, source) + '\n')
  const api = runtimeApiCompilation(apiFile)
  const reserved = new Set(['mini', 'definePage', 'defineComponent', 'defineGlobalStore', 'definePageStore', 'defineStorePlugin'])
  for (const name of api.names) {
    if (reserved.has(name)) throw new Error('公开 API 名称与框架保留入口冲突：' + name)
  }
  const globalsFile = path.join(root, '.cache/api.globals.d.ts')
  await writeChanged(globalsFile, `// SPDX-License-Identifier: Apache-2.0
export {}
declare global {
${api.names.map((name) => `  /** ${(api.documentation[name] || '框架按需注入的独立 API。').replace(/\*\//g, '*\\/').replace(/\r?\n/g, '\n   * ')} */\n  const ${name}: typeof import('./api.generated.js')[${JSON.stringify(name)}]`).join('\n')}
}
`)
  // 使用绝对路径，避免消费项目已有的 baseUrl 改变别名解析结果。
  await writeChanged(path.join(root, '.cache/tsconfig.routes.json'), JSON.stringify({
    files: [globalsFile],
    compilerOptions: { paths: { [routesModuleName]: [filename] } },
  }, null, 2) + '\n')
  // 移除旧生成声明，避免宽泛 include 继续暴露 mini 命名空间。
  await Promise.all(['mini.generated.ts', 'mini.globals.d.ts'].map((name) => rm(path.join(root, '.cache', name), { force: true })))
}
