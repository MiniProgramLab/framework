// SPDX-License-Identifier: Apache-2.0
/** 生成按平台和已安装包装配的独立 API，不向宿主写入全局变量。 */
import { createRequire } from 'node:module'
import path from 'node:path'
import type { PlatformAdapter } from './types.js'
import ts from 'typescript'

/** 路由方法通过同一个应用实例提供，保留每个泛型方法的精确类型。 */
export const navigationApis = [
  'navigateTo', 'navigateToUrl', 'navigateBack',
  'getRouteUrl', 'getEntryRouteUrl', 'isRouteAvailable',
] as const

/** 可选包不存在时不增加依赖，包自身导出错误仍由构建器报告。 */
export function hasPackage(root: string, name: string) {
  try { createRequire(path.join(root, 'package.json')).resolve(name + '/package.json'); return true }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') return false
    throw error
  }
}

/** 运行时成员来自包的公开清单，扩展平台可追加自己的 API 模块。 */
export async function runtimeApiSource(root: string, adapter: PlatformAdapter, source: string) {
  const runtime = await adapter.runtime?.({ root, source })
  const modules = [
    ...(runtime && hasPackage(root, '@miniprogramlab/core') ? ['@miniprogramlab/core/api'] : []),
    ...(runtime && hasPackage(root, '@miniprogramlab/ui') ? ['@miniprogramlab/ui/api'] : []),
    ...(adapter.apiModules ?? []),
  ]
  return [
    ...(runtime ? ['import type {} from "@miniprogramlab/core/globals";'] : []),
    ...modules.map((name) => 'export * from ' + JSON.stringify((name.startsWith('.') ? path.resolve(root, name) : name).replace(/\.([cm]?)ts$/, '.$1js')) + ';'),
    'export { ' + [...navigationApis, 'createRouter', 'createNavigationRegistry'].join(', ') + ' } from "./routes.generated.js";',
    `import type { PageConfig, ${runtime ? 'AppConfig' : 'NativePageConfig'} } from "@miniprogramlab/core/config";`,
    'declare global {',
    '  /** 独立配置宏，仅在构建期求值；同文件声明由编译器从运行代码中移除。 */',
    `  function definePageConfig(config: PageConfig${runtime ? '' : '<NativePageConfig>'}): void;`,
    '  /** 独立声明应用配置，无须导入。 */',
    `  function defineAppConfig(config: ${runtime ? 'AppConfig' : 'Record<string, unknown> & { entryPageName: string }'}): void;`,
    '}',
  ].join('\n')
}

/** 配置阶段只注入纯辅助函数，配置宏由独立求值上下文提供。 */
export function configApiSource(root: string) {
  if (!hasPackage(root, '@miniprogramlab/ui')) return 'export {};'
  const filename = createRequire(path.join(root, 'package.json')).resolve('@miniprogramlab/ui/config-api')
  return 'export { ' + runtimeApiCompilation(filename).names.join(', ') + ' } from "@miniprogramlab/ui/config-api";'
}

/** 从公开模块的实际导出生成独立注入，保留扩展 API，排除纯类型和配置宏。 */
export function runtimeApiCompilation(filename: string) {
  const program = ts.createProgram([filename], {
    noLib: true, types: [], skipLibCheck: true, allowJs: true,
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  })
  const source = program.getSourceFile(filename)
  const checker = program.getTypeChecker()
  const module = source && checker.getSymbolAtLocation(source)
  if (!module || !source) throw new Error('无法读取公开 API：' + filename)
  /** 类型声明与配置宏不参与运行时注入。 */
  function isRuntime(item: ts.Symbol) {
    const name = item.getName()
    if (['defineAppConfig', 'definePageConfig', 'default'].includes(name)) return false
    const symbol = item.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(item) : item
    return !!(symbol.flags & ts.SymbolFlags.Value)
  }
  const names = checker.getExportsOfModule(module).filter(isRuntime).map((item) => item.getName())
  /** 保留来源注释，使独立全局入口与原始函数拥有相同的悬浮说明。 */
  const documentation = Object.fromEntries(checker.getExportsOfModule(module).filter(isRuntime).map((item) => {
    const symbol = item.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(item) : item
    return [item.getName(), ts.displayPartsToString(symbol.getDocumentationComment(checker))]
  }))
  const providers = new Map<string, string>()
  let contents = source.text
  // 显式展开导出星号，避免外部模块的未知导出迫使 esbuild 保留整个命名空间。
  for (const statement of [...source.statements].reverse()) {
    if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier || statement.isTypeOnly) continue
    const provider = checker.getSymbolAtLocation(statement.moduleSpecifier)
    if (!provider) throw new Error('无法解析 API 模块：' + statement.moduleSpecifier.getText(source))
    const exports = statement.exportClause && ts.isNamedExports(statement.exportClause)
      ? statement.exportClause.elements.filter((item) => !item.isTypeOnly && names.includes(item.name.text)).map((item) => item.name.text)
      : checker.getExportsOfModule(provider).filter(isRuntime).map((item) => item.getName())
    for (const name of exports) {
      if (!/^[a-z][A-Za-z0-9]*$/.test(name)) throw new Error('公开 API 必须使用小驼峰命名：' + name)
      if (providers.has(name)) throw new Error('公开 API 名称冲突：' + name + '，来自 ' + providers.get(name) + ' 和 ' + statement.moduleSpecifier.getText(source))
      providers.set(name, statement.moduleSpecifier.getText(source))
    }
    if (statement.exportClause) continue
    const replacement = 'export { ' + exports.join(', ') + ' } from ' + statement.moduleSpecifier.getText(source) + ';'
    contents = contents.slice(0, statement.getStart(source)) + replacement + contents.slice(statement.end)
  }
  return { names, contents, documentation }
}
