// SPDX-License-Identifier: Apache-2.0
/** 验证页面元数据、环境隔离、参数契约及实际导航方式。 */
import assert from 'node:assert/strict'
import { readFile, rename, rm, stat, symlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import ts from 'typescript'
import { discoverRoutes, writeRoutesModule } from '@miniprogramlab/cli/routes'
import { compileModules } from '@miniprogramlab/cli/modules'
import { listFiles } from '@miniprogramlab/cli/files'
import { resolvePlatform } from '@miniprogramlab/cli/platforms'
import {
  createModuleLoader,
  temporaryDirectory,
  writeFixture,
} from '../helpers/modules.mjs'

/** 创建含 Tab、参数页面及开发页面的完整路由配置。 */
async function fixture(context, mode = 'development') {
  const root = await temporaryDirectory(context)
  const source = path.join(root, 'src')
  const appRoot = fileURLToPath(new URL('../', import.meta.url))
  // 临时应用直接使用已安装的框架包，不保留本地运行时替身。
  await symlink(path.join(appRoot, 'node_modules'), path.join(root, 'node_modules'))
  const definitions = {
    home: {
      description: '首页：今日概览',
      tabBar: { id: 'home', text: '首页', iconPath: '/home.svg', order: 0 },
    },
    profile: {
      tabBar: {
        id: 'profile',
        text: '我的',
        iconPath: '/profile.svg',
        order: 1,
      },
    },
    detail: {
      description: '详情 */\n第二行',
      params: {
        id: { type: 'string', required: true },
        count: { type: 'number' },
        enabled: { type: 'boolean' },
      },
    },
    demo: {},
  }
  for (const [name, route] of Object.entries(definitions)) {
    await writeFixture(source, {
      [`pages/${name}/index.config.ts`]:
        'definePageConfig(' + JSON.stringify({ page: { name, ...route }, ...(name === 'demo' ? { build: { modes: ['development'] } } : {}) }) + ');',
      [`pages/${name}/index.ts`]: 'export {};',
      [`pages/${name}/index.wxml`]: '<view />',
      [`pages/${name}/index.scss`]: '',
    })
  }
  await writeFixture(root, {
    'tsconfig.json': JSON.stringify({
      extends: './.cache/tsconfig.routes.json',
      compilerOptions: {
        target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true,
        noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, skipLibCheck: true, noEmit: true,
        types: ['miniprogram-api-typings'],
        baseUrl: './src',
      },
      include: ['typecheck.ts', 'src/probe.ts'],
    }),
    'src/second.ts': 'export { router as secondRouter } from "@miniprogramlab/routes";',
    'src/probe.ts': `export { secondRouter } from './second.js';
import { router } from '@miniprogramlab/routes';
export { router, PageEnum } from '@miniprogramlab/routes';
export const { navigateTo, getRouteUrl, isRouteAvailable, navigateToUrl } = router;`,
  })
  const options = {
    source,
    appConfig: { entryPageName: 'home', tabBar: { custom: true } },
    environment: { public: { mode } },
  }
  const contract = await discoverRoutes({
    ...options,
    files: await listFiles(source),
  })
  await writeRoutesModule(root, contract)
  const buildOptions = {
    root,
    source,
    output: path.join(root, 'dist'),
    staging: path.join(root, 'dist'),
    production: mode === 'production',
    environment: { mode },
    excludedDirectories: contract.excludedDirectories,
  }
  return { root, source, options, contract, buildOptions }
}

test('页面重命名自动同步注册路径和默认入口，路由元数据不透传微信配置', async (context) => {
  const { source, options, contract } = await fixture(context)
  assert.deepEqual(
    contract.appConfig.tabBar.list.map((item) => item.pagePath),
    ['pages/home/index', 'pages/profile/index'],
  )
  assert.equal(
    contract.pageConfigs.get(path.join(source, 'pages/home/index'))
      .route,
    undefined,
  )
  await rename(
    path.join(source, 'pages/home'),
    path.join(source, 'pages/start'),
  )
  const renamed = await discoverRoutes({
    ...options,
    files: await listFiles(source),
  })
  assert.equal(renamed.pageNames.home, 'pages/start/index')
  assert.equal(renamed.appConfig.entryPagePath, 'pages/start/index')
  assert.equal(renamed.appConfig.tabBar.list[0].pagePath, 'pages/start/index')
})

test('生产契约排除开发页，并禁止正常页面引用其实现', async (context) => {
  const { root, source, contract, buildOptions } = await fixture(
    context,
    'production',
  )
  assert.equal(contract.pageNames.demo, undefined)
  assert.equal(contract.pages.includes('pages/demo/index'), false)
  await compileModules({
    ...buildOptions,
    entries: [path.join(source, 'probe.ts')],
  })
  const navigation = createModuleLoader(buildOptions.output).load('probe.js')
  assert.equal(navigation.isRouteAvailable('/pages/demo/index'), false)
  await assertRouteFailure(navigation.navigateTo('/pages/demo/index').go(), /未启用/)
  const generated = await readFile(
    path.join(root, '.cache/routes.generated.ts'),
    'utf8',
  )
  assert.equal(generated.includes('/pages/demo/index'), true)
  await writeFixture(source, {
    'probe.ts': 'import "./pages/demo/helper.js";',
    'pages/demo/helper.ts': 'export const value = 1;',
  })
  await assert.rejects(
    compileModules({
      ...buildOptions,
      entries: [path.join(source, 'probe.ts')],
    }),
    /不能导入已排除页面/,
  )
})

test('实际导航按页面类型分发，参数在编码前完成运行时校验', async (context) => {
  const { source, buildOptions } = await fixture(context)
  await compileModules({
    ...buildOptions,
    entries: [path.join(source, 'probe.ts')],
  })
  const calls = []
  /** 记录平台调用，成功回调沿用真实导航封装的 Promise 路径。 */
  const navigate = (kind) => (options) => {
    calls.push({ kind, url: options.url })
    options.success()
  }
  const navigation = createModuleLoader(buildOptions.output, {
    wx: {
      switchTab: navigate('tab'),
      navigateTo: navigate('page'),
      reLaunch: navigate('reset'),
    },
  }).load('probe.js')
  assert.equal(navigation.router, navigation.secondRouter)
  assert.equal(navigation.PageEnum.home, '/pages/home/index')
  await navigation.navigateTo(navigation.PageEnum.home).go()
  await navigation.navigateTo('/pages/detail/index').params({
    id: '中文/空 格',
    count: 0,
    enabled: false,
  }).go()
  await navigation.navigateToUrl('/pages/detail/index?id=abc&count=2&enabled=false').reLaunch()
  assert.deepEqual(calls, [
    { kind: 'tab', url: '/pages/home/index' },
    {
      kind: 'page',
      url:
        '/pages/detail/index?id=' +
        encodeURIComponent('中文/空 格') +
        '&count=0&enabled=false',
    },
    { kind: 'reset', url: '/pages/detail/index?id=abc&count=2&enabled=false' },
  ])
  await assertRouteFailure(navigation.navigateTo('missing').go(), /页面不存在/)
  await assertRouteFailure(
    navigation.navigateToUrl('/pages/home/index?id=x').go(),
    /未知/,
  )
  await assertRouteFailure(navigation.navigateTo('/pages/detail/index').params({}).go(), /必填参数/)
  await assertRouteFailure(
    navigation.navigateTo('/pages/detail/index').params({ id: 'x', count: NaN }).go(),
    /参数类型/,
  )
  await assertRouteFailure(
    navigation.navigateToUrl('/pages/detail/index?id=a&id=b').reLaunch(),
    /重复/,
  )
  assert.equal(calls.length, 3)
})

test('路由名称、必填项和参数类型由 TypeScript 检查', async (context) => {
  const { root } = await fixture(context)
  await writeFixture(root, {
    'typecheck.ts': `import { router, router as sameRouter, PageEnum } from '@miniprogramlab/routes';
const { navigateTo, getRouteUrl } = router;
import type { Routes, RouteName, RoutePath, TabPageName, EntryPageName, RouteParams, RouteArguments, AppRouter } from '@miniprogramlab/routes';
import { routes, entryPageName } from '@miniprogramlab/routes';
const table: Routes = routes;
const page: RoutePath = PageEnum.detail;
const tab: TabPageName = 'profile';
const entry: EntryPageName = entryPageName;
const params: RouteParams<PageEnum.detail> = { id: '42', count: 0, enabled: false };
const args: RouteArguments<'/pages/detail/index'> = [params];
const typedRouter: AppRouter = router;
const identical: typeof router = sameRouter;
router.navigateTo(page).params(...args).go();
router.navigateTo(PageEnum.home).go();
router.navigateTo(PageEnum.detail).params({ id: '42' }).go();
// @ts-expect-error 枚举导航仍需提供必填参数。
router.navigateTo(PageEnum.detail).go();
// @ts-expect-error 枚举导航仍校验参数类型。
router.navigateTo(PageEnum.detail).params({ id: 42 }).go();
// @ts-expect-error 生成类型不能把普通页当作 Tab 页。
const invalidTab: TabPageName = 'detail';
// @ts-expect-error 生成类型必须保留默认入口字面量。
const invalidEntry: EntryPageName = 'detail';
// @ts-expect-error 生成类型不能接受未声明的页面名称。
const invalidName: RouteName = 'missing';
// @ts-expect-error 生成参数类型必须保留必填约束。
const missingParams: RouteParams<PageEnum.detail> = { count: 0 };
// @ts-expect-error 生成参数类型必须保留标量类型。
const invalidParams: RouteParams<PageEnum.detail> = { id: '42', enabled: 'false' };
// @ts-expect-error 无查询参数的页面不能接收参数对象。
const invalidArgs: RouteArguments<'/pages/home/index'> = [{}];
navigateTo('/pages/home/index').go();
navigateTo('/pages/detail/index').params({ id: 'x', count: 1, enabled: false }).go();
getRouteUrl('/pages/detail/index', { id: 'x' });
// @ts-expect-error 页面名称必须存在。
navigateTo('missing').go();
// @ts-expect-error 普通页必填参数不能省略。
navigateTo('/pages/detail/index').go();
// @ts-expect-error 参数对象不能漏填 id。
navigateTo('/pages/detail/index').params({ count: 1 }).go();
// @ts-expect-error 参数类型必须匹配。
navigateTo('/pages/detail/index').params({ id: 'x', count: '1' }).go();
// @ts-expect-error 不能向 Tab 页传查询参数。
navigateTo('/pages/home/index').params({ id: 'x' }).go();
// @ts-expect-error 未声明参数不能传入。
getRouteUrl('/pages/detail/index', { id: 'x', extra: 1 });
`,
  })
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(import.meta.resolve('typescript/bin/tsc')), '-p', root],
    { encoding: 'utf8' },
  )
  assert.equal(result.status, 0, result.stdout + result.stderr)
})

test('生成模块按应用隔离，缓存可重建且相同内容不重复写入', async (context) => {
  const first = await fixture(context)
  const second = await fixture(context, 'production')
  const generated = path.join(first.root, '.cache/routes.generated.ts')
  const tsconfig = path.join(first.root, '.cache/tsconfig.routes.json')
  const generatedContent = await readFile(generated, 'utf8')
  assert.match(generatedContent, /首页：今日概览[\s\S]*home = "\/pages\/home\/index"/)
  assert.ok(generatedContent.includes('详情 *\\/\n   * 第二行'))
  const syntax = ts.createSourceFile(generated, generatedContent, ts.ScriptTarget.Latest, true)
  const enums = syntax.statements.filter(ts.isEnumDeclaration)
  assert.equal(enums.length, 1)
  assert.equal(enums[0].name.text, 'PageEnum')
  assert.ok(enums[0].members.every((member) => ts.isIdentifier(member.name)))
  const before = await stat(generated)
  await writeRoutesModule(first.root, first.contract)
  assert.equal((await stat(generated)).mtimeMs, before.mtimeMs)
  assert.equal(JSON.parse(await readFile(tsconfig, 'utf8')).compilerOptions.paths['@miniprogramlab/routes'][0], generated)
  // 删除配置后仍可解析统一入口，运行时不依赖应用手写的 paths。
  await rm(path.join(first.root, 'tsconfig.json'))
  for (const item of [first, second]) {
    await writeFixture(item.source, { 'probe.ts': 'export { routes, router } from "@miniprogramlab/routes";' })
    await compileModules({ ...item.buildOptions, entries: [path.join(item.source, 'probe.ts')] })
  }
  assert.equal(createModuleLoader(first.buildOptions.output).load('probe.js').routes.demo.available, true)
  assert.equal(createModuleLoader(second.buildOptions.output).load('probe.js').routes.demo.available, false)
  assert.equal(createModuleLoader(first.buildOptions.output).load('probe.js').router.isRouteAvailable('/pages/demo/index'), true)
  assert.equal(createModuleLoader(second.buildOptions.output).load('probe.js').router.isRouteAvailable('/pages/demo/index'), false)
  // 重新发现页面后更新路径与 TS 字面量，不保留旧路径。
  await rename(path.join(first.source, 'pages/home'), path.join(first.source, 'pages/start'))
  const contract = await discoverRoutes({ ...first.options, files: await listFiles(first.source) })
  await rm(path.join(first.root, '.cache'), { recursive: true })
  await writeRoutesModule(first.root, contract)
  await compileModules({ ...first.buildOptions, entries: [path.join(first.source, 'probe.ts')] })
  assert.equal(createModuleLoader(first.buildOptions.output).load('probe.js').routes.home.path, '/pages/start/index')
  assert.doesNotMatch(await readFile(generated, 'utf8'), /\/pages\/home\/index/)
  await readFile(tsconfig)
})

test('拒绝重复名称、重复 Tab 顺序及没有配置的页面', async (context) => {
  const { source, options } = await fixture(context)
  const configFile = 'pages/profile/index.config.ts'
  await writeFixture(source, {
    [configFile]: 'definePageConfig({ page: { name: "home" } });',
  })
  await assert.rejects(
    discoverRoutes({ ...options, files: await listFiles(source) }),
    /page.name 重复/,
  )
  await writeFixture(source, {
    [configFile]:
      'definePageConfig({ page: { name: "profile", tabBar: { id: "other", order: 0, text: "其他", iconPath: "/other.svg" } } });',
  })
  await assert.rejects(
    discoverRoutes({ ...options, files: await listFiles(source) }),
    /order 重复/,
  )
  await writeFixture(source, {
    'pages/orphan/index.ts': 'export {};',
    'pages/orphan/index.wxml': '<view />',
  })
  await assert.rejects(
    discoverRoutes({ ...options, files: await listFiles(source) }),
    /页面缺少配置/,
  )
})

/** 相同应用源码经 CLI 选择不同平台，只包含目标导航实现。 */
for (const [platform, host] of [['wechat', 'wx'], ['douyin', 'tt'], ['alipay', 'my']]) {
  test(`${platform} 自动注入 Core Router 平台，不引入其他宿主或页面包装器`, async (context) => {
    const root = await temporaryDirectory(context)
    const source = path.join(root, 'src')
    const output = path.join(root, 'dist')
    await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), path.join(root, 'node_modules'))
    const adapter = resolvePlatform(platform)
    await writeFixture(root, {
      'src/pages/home/index.config.ts': 'definePageConfig({ page: { name: "home" } })',
      'src/pages/home/index.ts': 'Page({})',
      ['src/pages/home/index' + adapter.templateExtension]: '<view />',
      ['src/pages/home/index' + adapter.styleExtension]: '',
      'src/probe.ts': 'export const router = { navigateTo: navigateTo };',
    })
    const contract = await discoverRoutes({ source, files: await listFiles(source),
      appConfig: { entryPageName: 'home' }, environment: { public: { mode: 'development' } }, adapter })
    await writeRoutesModule(root, contract, adapter, source)
    await compileModules({ root, source, output, staging: output, production: false, environment: {},
      adapter, entries: [path.join(source, 'probe.ts')] })
    const calls = []
    const api = Object.fromEntries(['navigateTo', 'switchTab', 'reLaunch'].map((method) => [method, (options) => {
      calls.push({ method, url: options.url }); options.success()
    }]))
    const { router } = createModuleLoader(output, { [host]: api }).load('probe.js')
    await router.navigateTo('/pages/home/index').go()
    assert.deepEqual(calls, [{ method: 'navigateTo', url: '/pages/home/index' }])
    const files = await listFiles(output)
    const maps = await Promise.all(files.filter((name) => name.endsWith('.map')).map(async (name) => JSON.parse(await readFile(name, 'utf8'))))
    const sources = maps.flatMap((map) => map.sources)
    const adapters = sources.filter((name) => /router\/adapters\/(wechat|douyin|alipay)\.ts$/.test(name))
    assert.equal(adapters.length, 1)
    assert.ok(adapters[0].endsWith(`/adapters/${platform}.ts`))
    assert.equal(sources.some((name) => /framework\/src\/runtime\.ts$/.test(name)), false)
    assert.equal(sources.some((name) => /router\/platform\.ts$/.test(name)), false)
  })
}

test('扩展平台通过构建配置提供导航模块，通用路由与 CLI 不增加平台分支', async (context) => {
  const { root, source, contract, buildOptions } = await fixture(context)
  await writeFixture(root, {
    'src/platform-api.ts': 'let count = 0; export function getNextId() { return ++count }',
    'navigation-adapter.ts': `export function createNavigationAdapter() {
      return { navigateTo: custom.open, switchTab: custom.tab, reLaunch: custom.reset };
    }`,
  })
  const adapter = { ...resolvePlatform('douyin'), id: 'custom', apiModules: ['./src/platform-api.ts'], navigationAdapter: './navigation-adapter.ts' }
  await writeFixture(source, { 'extra.ts': 'export const next = getNextId;' })
  await writeRoutesModule(root, contract, adapter, source)
  await compileModules({ ...buildOptions, adapter, entries: ['probe.ts', 'extra.ts'].map((name) => path.join(source, name)) })
  const calls = []
  const navigation = createModuleLoader(buildOptions.output, { custom: {
    async open(url) { calls.push(['open', url]) },
    async tab(url) { calls.push(['tab', url]) },
    async reset(url) { calls.push(['reset', url]) },
  } }).load('probe.js')
  assert.equal(navigation.router, navigation.secondRouter)
  assert.equal(navigation.PageEnum.home, '/pages/home/index')
  await navigation.navigateTo(navigation.PageEnum.home).go()
  await navigation.navigateTo('/pages/detail/index').params({ id: '42' }).go()
  assert.deepEqual(calls, [['tab', '/pages/home/index'], ['open', '/pages/detail/index?id=42']])
  const customLoader = createModuleLoader(buildOptions.output)
  assert.equal(customLoader.load('extra.js').next(), 1)
  assert.equal(customLoader.load('extra.js').next(), 2)
  const { navigationAdapter, ...missing } = adapter
  await assert.rejects(compileModules({ ...buildOptions, adapter: missing, entries: [path.join(source, 'probe.ts')] }), /未声明路由 navigationAdapter/)
})


/** 断言路由统一结果失败，并核对诊断或平台原始原因。 */
async function assertRouteFailure(pending, expected) {
  const result = await pending
  assert.equal(result.ok, false)
  if (expected instanceof RegExp) assert.match(result.error.message, expected)
  else if (expected) assert.ok(expected(result.error.cause))
  return result.error
}


test('独立 API 注入页面、组件和普通模块，局部绑定不受影响且共享路由实例', async (context) => {
  const { root, source, contract, buildOptions } = await fixture(context)
  await writeFixture(source, {
    'page.ts': `import { PageEnum } from '@miniprogramlab/routes';
definePage({ data: { title: '首页' }, methods: { open() { navigateTo(PageEnum.detail).params({ id: '42' }).go() } } });`,
    'component.ts': `defineComponent({ methods: { home() { return navigateTo('/pages/home/index').go() } } });`,
    'probe.ts': `import { router } from '@miniprogramlab/routes';
export const same = navigateTo === router.navigateTo;
export const entryUrl = getEntryRouteUrl;
export const createGlobalStore = defineGlobalStore;
export const createPageStore = definePageStore;
export const createPlugin = defineStorePlugin;
export function local(mini) { return mini.navigateTo('/test').go() }
/** 业务局部参数与框架入口同名时，不注入或覆盖局部绑定。 */
export function localNavigation(navigateTo) { return navigateTo('/local') }
export function go() { return navigateTo('/pages/detail/index').params({ id: '模块' }).go() }
/** 独立返回入口也必须由 CLI 注入当前应用 Router。 */
export function back() { return navigateBack(2).go() }
/** 回调入口不返回 Promise，编译产物同样禁止等待。 */
export function callbackGo(success) { return navigateTo('/pages/detail/index').params({ id: '回调' }).success(success).go() }`,
  })
  await compileModules({ ...buildOptions, entries: ['page.ts', 'component.ts', 'probe.ts'].map((name) => path.join(source, name)) })
  const definitions = [], calls = []
  const loader = createModuleLoader(buildOptions.output, {
    Component(value) { definitions.push(value); return value }, Behavior: (value) => value,
    wx: Object.fromEntries(['navigateTo', 'switchTab', 'reLaunch', 'navigateBack'].map((method) => [method, (options) => { calls.push([method, method === 'navigateBack' ? options.delta : options.url]); options.success() }])),
  })
  loader.load('page.js'); loader.load('component.js')
  const probe = loader.load('probe.js')
  assert.equal(definitions[0].methods.open(), undefined)
  assert.equal((await definitions[1].methods.home()).ok, true)
  assert.equal((await probe.go()).ok, true)
  assert.equal(probe.same, true)
  assert.equal(probe.local({ navigateTo: () => ({ go: () => 42 }) }), 42)
  assert.equal(probe.localNavigation((target) => target), '/local')
  assert.equal(probe.entryUrl(), '/pages/home/index')
  assert.equal(typeof probe.createGlobalStore, 'function')
  assert.equal(typeof probe.createPageStore, 'function')
  assert.equal(typeof probe.createPlugin, 'function')
  assert.equal(Object.isFrozen(probe.createGlobalStore(() => ({ count: 1 }))), true)
  assert.deepEqual(calls, [['navigateTo', '/pages/detail/index?id=42'], ['switchTab', '/pages/home/index'], ['navigateTo', '/pages/detail/index?id=%E6%A8%A1%E5%9D%97']])
  assert.equal((await probe.back()).ok, true)
  assert.deepEqual(calls.at(-1), ['navigateBack', 2])
  const events = []
  const execution = probe.callbackGo((result) => { events.push(result) })
  await assert.rejects(async () => { await execution }, /已注册 success 或 fail 的导航不能使用 await/)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(events.length, 1)
  assert.equal(events[0].ok, true)
  assert.deepEqual(calls.at(-1), ['navigateTo', '/pages/detail/index?id=%E5%9B%9E%E8%B0%83'])
  assert.equal('mini' in loader.context, false)
  for (const name of ['definePage', 'defineComponent', 'defineGlobalStore', 'definePageStore', 'defineStorePlugin', 'navigateTo', 'navigateToUrl', 'navigateBack', 'getRouteUrl', 'getEntryRouteUrl'])
    assert.equal(name in loader.context, false)
  // 不导入 PageEnum 或 routes 的源文件也必须从生成配置取得全局类型。
  await writeFixture(root, {
    'typecheck.ts': `definePage({ data: { count: 0 }, methods: { increment() { this.setData({ count: this.data.count + 1 }); navigateTo('/pages/detail/index').params({ id: '42' }).go() } } });
defineComponent({ properties: { title: String }, methods: { go() { const title: string = this.properties.title; return getRouteUrl('/pages/detail/index', { id: title }) } } });
const globalStore = defineGlobalStore(() => ({ count: 0 }));
const pageStore = definePageStore(() => ({ title: '页面' }));
const plugin = defineStorePlugin({ key: '__probe__', option: 'probeStore', create: () => ({ enabled: true }) });
const state: import('@miniprogramlab/core').StoreStateOf<typeof globalStore> = { count: 1 };
// @ts-expect-error 独立状态声明仍保留字段类型推导。
const invalidState: import('@miniprogramlab/core').StoreStateOf<typeof globalStore> = { count: '1' };
void [pageStore, plugin, state, invalidState];
// @ts-expect-error 页面声明不再属于 mini。
mini.definePage({});
// @ts-expect-error 组件声明不再属于 mini。
mini.defineComponent({});
// @ts-expect-error 全局状态声明不再属于 mini。
mini.defineGlobalStore(() => ({}));
// @ts-expect-error 页面状态声明不再属于 mini。
mini.definePageStore(() => ({}));
// @ts-expect-error 插件声明不再属于 mini。
mini.defineStorePlugin({});
const result: Promise<import('@miniprogramlab/routes').NavigationResult> = navigateTo('/pages/home/index').go();
const shareUrl: string | undefined = getRouteUrl('/pages/detail/index', { id: '42' });
const entryUrl: string = getEntryRouteUrl();
const tabConfig = createTabBarConfig();
const tabs = getVisibleTabBarItems(tabConfig);
void [shareUrl, entryUrl, tabs];
// @ts-expect-error 独立 URL 入口继续校验目标页必填参数。
getRouteUrl('/pages/detail/index');
// @ts-expect-error 移除旧命名空间，不再声明全局 mini。
mini.navigateTo('/pages/home/index');
// @ts-expect-error 旧的无动词读取名不再作为独立全局入口。
routeUrl('/pages/home/index');
navigateTo('/pages/home/index').success((result) => { const url: string = result.url; void url }).replace();
navigateTo('/pages/detail/index').params({ id: '42' }).fail((error) => { const phase: 'resolve' | 'navigate' = error.phase; void phase }).go();
navigateBack().success((result) => { const delta: number = result.delta; void delta }).go();
/** 自动生成的全局入口保留回调与 await 的互斥约束。 */
async function checkAwaitModes() {
  const base = navigateTo('/pages/detail/index').params({ id: '42' });
  const result = await base.go();
  if (result.ok) { const url: string = result.url; void url; }
  await base.replace();
  await base.reLaunch();
  await navigateToUrl('/pages/detail/index?id=42').reLaunch();
  await navigateBack().go();
  // @ts-expect-error 成功回调不能与 await 混用。
  await base.success(() => {}).go();
  // @ts-expect-error 失败回调不能与 await 混用。
  await base.fail(() => {}).replace();
  // @ts-expect-error 重建页面栈同样禁止混用回调与 await。
  await base.success(() => {}).reLaunch();
  // @ts-expect-error 完整 URL 导航同样禁止混用回调与 await。
  await navigateToUrl('/pages/detail/index?id=42').fail(() => {}).reLaunch();
  // @ts-expect-error 在回调之后设置参数仍然不能等待。
  await navigateTo('/pages/detail/index').success(() => {}).params({ id: '42' }).go();
  // @ts-expect-error Tab 切换同样受回调模式约束。
  await navigateTo('/pages/home/index').fail(() => {}).replace();
  // @ts-expect-error 独立返回同样受回调模式约束。
  await navigateBack().success(() => {}).go();
  const execution = navigateBack().fail(() => {}).go();
  // @ts-expect-error 保存执行结果不能绕过等待限制。
  await execution;
}
// @ts-expect-error 独立返回链不提供参数配置。
navigateBack().params({});
// @ts-expect-error 返回动作不再挂在目标页导航链上。
navigateTo('/pages/home/index').back();
// @ts-expect-error 生成入口保留 Tab 页禁止配置参数的约束。
navigateTo('/pages/home/index').params({});
// @ts-expect-error 回调派生链仍然不能绕过 Tab 限制。
navigateTo('/pages/home/index').success(() => {}).params({});
// @ts-expect-error 必填参数未设置前不提供终结方法。
navigateTo('/pages/detail/index').success(() => {}).go();
// @ts-expect-error 链式参数类型来自所选页面。
navigateTo('/pages/detail/index').params({ id: 42 });
// @ts-expect-error 独立入口仍严格要求页面参数。
navigateTo('/pages/detail/index').go();
// @ts-expect-error 参数类型不能退化为 any。
navigateTo('/pages/detail/index').params({ id: 42 }).go();
// @ts-expect-error 不存在的 API 不能通过类型检查。
missing();
// @ts-expect-error 未声明的路径不能用于导航。
navigateTo('/pages/unknown/index').go();
definePageConfig({ page: { name: 'probe' } });
defineAppConfig({ entryPageName: 'home' });
// @ts-expect-error 配置宏保持独立全局声明，不能挂在 mini 下。
mini.definePageConfig({ page: { name: 'probe' } });
// @ts-expect-error 应用配置宏同样不属于 mini 运行时命名空间。
mini.defineAppConfig({ entryPageName: 'home' });
// @ts-expect-error 独立宏仍然检查页面身份。
definePageConfig({ page: {} });
// @ts-expect-error 独立应用配置仍然要求默认入口。
defineAppConfig({});
configureTabBar({ showLabel: true });`,
  })
  // 类型探针不包含无类型标注的运行时测试文件。
  const config = JSON.parse(await readFile(path.join(root, 'tsconfig.json'), 'utf8'))
  config.include = ['typecheck.ts']
  await writeFixture(root, { 'tsconfig.json': JSON.stringify(config) })
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.resolve('typescript/bin/tsc')), '-p', root], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  await writeRoutesModule(root, contract)
  await writeFixture(source, {
    'motion.worklet.ts': 'export function unsafe() { "worklet"; return getEntryRouteUrl() }',
    'worklet-probe.ts': 'export { unsafe } from "./motion.worklet.js";',
  })
  await assert.rejects(compileModules({ ...buildOptions, entries: [path.join(source, 'worklet-probe.ts')] }), /Worklet 不能调用框架 API/)
  await writeFixture(source, {
    'motion.worklet.ts': `/** 局部同名参数和对象属性仍是普通 Worklet 数据。 */
export function safe(getEntryRouteUrl) { "worklet"; return getEntryRouteUrl() + ({ getEntryRouteUrl: 1 }).getEntryRouteUrl }`,
    'worklet-probe.ts': 'export { safe } from "./motion.worklet.js";',
  })
  await compileModules({ ...buildOptions, entries: [path.join(source, 'worklet-probe.ts')] })
  assert.equal(createModuleLoader(buildOptions.output).load('worklet-probe.js').safe(() => 41), 42)
  await writeFixture(source, {
    'motion.worklet.ts': 'export function unsafe() { "worklet"; return { getEntryRouteUrl } }',
    'worklet-probe.ts': 'export { unsafe } from "./motion.worklet.js";',
  })
  await assert.rejects(compileModules({ ...buildOptions, entries: [path.join(source, 'worklet-probe.ts')] }), /Worklet 不能调用框架 API/)
})

test('公开 API 拒绝重名和保留入口，旧命名空间不会残留在生成类型中', async (context) => {
  const { root, source, contract } = await fixture(context)
  const globals = await readFile(path.join(root, '.cache/api.globals.d.ts'), 'utf8')
  assert.match(globals, /const navigateTo: typeof import/)
  assert.match(globals, /const getEntryRouteUrl: typeof import/)
  assert.doesNotMatch(globals, /const mini\b/)
  await writeFixture(root, {
    '.cache/mini.globals.d.ts': 'declare const mini: any;',
    '.cache/mini.generated.ts': 'export const stale = true;',
    'src/api-extension.ts': 'export const getRouteUrl = () => "冲突";',
  })
  await writeRoutesModule(root, contract)
  await assert.rejects(readFile(path.join(root, '.cache/mini.globals.d.ts')), { code: 'ENOENT' })
  await assert.rejects(readFile(path.join(root, '.cache/mini.generated.ts')), { code: 'ENOENT' })
  const adapter = { ...resolvePlatform(), apiModules: ['./src/api-extension.ts'] }
  await assert.rejects(writeRoutesModule(root, contract, adapter, source), /公开 API 名称冲突：getRouteUrl/)
  await writeFixture(source, { 'api-extension.ts': 'export const definePage = () => {};' })
  await assert.rejects(writeRoutesModule(root, contract, adapter, source), /保留入口冲突：definePage/)
})
