// SPDX-License-Identifier: Apache-2.0
/** 用真实语言服务验证 CLI 生成的悬浮提示、参数补全与导航类型约束。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { writeRoutesModule } from '../dist/src/route-module.js'
import { resolvePlatform } from '../dist/src/platforms.js'

/** 生成包含普通页、参数页和底栏页的隔离应用，不修改业务缓存或产物。 */
async function fixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'miniprogram-route-hints-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'node_modules/@miniprogramlab'), { recursive: true })
  await symlink(path.dirname(fileURLToPath(import.meta.resolve('@miniprogramlab/core/package.json'))), path.join(root, 'node_modules/@miniprogramlab/core'))
  await writeFile(path.join(root, 'package.json'), '{"private":true,"type":"module"}')
  /** 大量无关页面不应进入导航方法的悬浮提示。 */
  const routes = ['home', 'detail', 'optional', ...Array.from({ length: 30 }, (_, index) => 'unused' + index)].map((name) => ({
    name, path: 'pages/' + name + '/index', description: '页面说明：' + name,
    kind: name === 'home' ? 'tab' : 'page', available: true,
    params: name === 'detail' ? { id: { type: 'string', required: true }, count: { type: 'number' }, preview: { type: 'boolean' } }
      : name === 'optional' ? { query: { type: 'string' } } : {},
    ...(name === 'home' ? { tab: { id: 'home', text: '首页', order: 0, iconPath: '/icons/home.png' } } : {}),
  }))
  await writeRoutesModule(root, { routes, entryPageName: 'home' }, resolvePlatform('douyin'))
  return root
}

test('路由提示隐藏完整契约，同时保留参数补全和导航状态约束', async (context) => {
  const root = await fixture(context)
  /** 覆盖独立全局、显式导入、实例方法及链式状态，防止仅简化某个入口。 */
  const source = `
import { PageEnum, navigateTo as importedNavigateTo, router, routes } from '@miniprogramlab/routes'
import type { Routes, RouteParams, RouteName, TabPagePath } from '@miniprogramlab/routes'
/*global*/navigateTo(PageEnum.detail).params({ id: '42', count: 1, preview: true }).go()
/*import*/importedNavigateTo(PageEnum.optional).go()
router./*instance*/navigateTo(PageEnum.home).go()
navigateTo(PageEnum.detail)./*params*/params({ id: '42' })./*success*/success(() => {}).go()
navigateTo(PageEnum.detail).params({ id: '42' })./*fail*/fail(() => {}).replace()
navigateTo('/pages/detail/index').params({ id: '42' }).replace()
navigateTo(PageEnum.optional).params({ query: '关键字' }).go()
const sameContract: Routes = routes
const sameRuntimeType: typeof routes = sameContract
const params: RouteParams<PageEnum.detail> = { id: '42', count: 1, preview: true }
const tab: TabPagePath = PageEnum.home
// @ts-expect-error 必填参数不能省略，同时检查对象成员补全。
navigateTo(PageEnum.detail).params({/*completion*/})
// @ts-expect-error 必填参数未准备时没有 go。
navigateTo(PageEnum.detail).go()
// @ts-expect-error 注册回调不能绕过必填参数。
navigateTo(PageEnum.detail).success(() => {}).replace()
// @ts-expect-error Tab 页没有 params。
navigateTo(PageEnum.home).params({})
// @ts-expect-error 未声明参数的普通页也没有 params。
navigateTo(PageEnum.unused0).params({})
// @ts-expect-error 参数值必须保留 string、number、boolean 类型。
navigateTo(PageEnum.detail).params({ id: 42, count: '1', preview: 'true' })
// @ts-expect-error 未声明的参数不能传入。
navigateTo(PageEnum.detail).params({ id: '42', extra: true })
// @ts-expect-error 不接受未知页面。
navigateTo('/pages/missing/index')
// @ts-expect-error 页面名称不能放宽成 string。
const missingName: RouteName = 'missing'
// @ts-expect-error 路由契约仍然只读。
sameContract.home.path = '/pages/home/index'
/** Promise 和回调模式的互斥约束不因显示优化而改变。 */
async function checkAwait() {
  await navigateTo(PageEnum.detail).params({ id: '42' }).go()
  await navigateTo(PageEnum.optional).replace()
  await navigateBack().go()
  // @ts-expect-error 已注册成功回调的导航不能 await。
  await navigateTo(PageEnum.optional).success(() => {}).go()
  // @ts-expect-error 先注册失败回调再补参数，仍不能 await。
  await navigateTo(PageEnum.detail).fail(() => {}).params({ id: '42' }).replace()
  // @ts-expect-error 返回导航也保持回调与 await 互斥。
  await navigateBack().success(() => {}).go()
}
`
  const filename = path.join(root, 'probe.ts')
  await writeFile(filename, source)
  const generatedConfig = path.join(root, '.cache/tsconfig.routes.json')
  const config = ts.parseJsonConfigFileContent({
    extends: generatedConfig,
    compilerOptions: { strict: true, noEmit: true, target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', types: [] },
    include: ['probe.ts'],
  }, ts.sys, root)
  /** 直接查询 TypeScript，与编辑器使用相同的提示与检查引擎。 */
  const service = ts.createLanguageService({
    ...ts.sys,
    getCompilationSettings: () => config.options,
    getScriptFileNames: () => config.fileNames,
    getScriptVersion: () => '1',
    getCurrentDirectory: () => root,
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    getScriptSnapshot(name) {
      const text = ts.sys.readFile(name)
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text)
    },
  })
  context.after(() => service.dispose())
  const diagnostics = [...config.errors, ...ts.getPreEmitDiagnostics(service.getProgram())]
  assert.deepEqual(diagnostics.map((item) => ts.flattenDiagnosticMessageText(item.messageText, '\n')), [])
  for (const marker of ['global', 'import', 'instance', 'params', 'success', 'fail']) {
    const position = source.indexOf('/*' + marker + '*/') + marker.length + 5
    const info = service.getQuickInfoAtPosition(filename, position)
    const display = ts.displayPartsToString(info?.displayParts)
    assert.ok(display.length > 0 && display.length < 600, marker + ': ' + display)
    assert.doesNotMatch(display, /readonly home|iconPath|description|unused\d/, marker)
    assert.match(display, /Routes/, marker)
    assert.ok(ts.displayPartsToString(info.documentation), marker + ' 应保留说明注释')
  }
  const completions = service.getCompletionsAtPosition(filename, source.indexOf('/*completion*/') + '/*completion*/'.length, {})
  assert.deepEqual(completions.entries.map((entry) => entry.name).sort(), ['count', 'id', 'preview'])
  const signature = service.getSignatureHelpItems(filename, source.indexOf('/*completion*/'), {})
  assert.ok(signature?.items.length)
  for (const item of signature.items) {
    const display = ts.displayPartsToString([...item.prefixDisplayParts, ...item.parameters.flatMap((param) => param.displayParts), ...item.suffixDisplayParts])
    assert.ok(display.length < 600, display)
    assert.doesNotMatch(display, /iconPath|readonly home/)
  }
})
