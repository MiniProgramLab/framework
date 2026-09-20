// SPDX-License-Identifier: Apache-2.0
/** 使用真实原生工程验证平台注册、产物格式、依赖隔离和构建失败保护。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rename, rm, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { createContext, Script } from 'node:vm'
import { loadOptions, createPlatformRegistry, builtinPlatforms } from '../dist/src/options.js'
import { buildProject } from '../dist/src/build.js'
import { loadEnvironment } from '../dist/src/env.js'

/** 写入隔离工程文件，测试不修改真实应用产物。 */
async function write(root, name, text) {
  const filename = path.join(root, name)
  await mkdir(path.dirname(filename), { recursive: true })
  await writeFile(filename, text)
}

/** 生成含两页、原生 npm 组件和混合样式的最小原生项目。 */
async function fixture(context, platform = 'douyin') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'miniprogram-platform-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const adapter = createPlatformRegistry().resolve(platform)
  const app = { entryPageName: 'home', tabBar: {}, window: {} }
  if (platform === 'wechat') Object.assign(app, {
    renderer: 'skyline', componentFramework: 'glass-easel', lazyCodeLoading: 'requiredComponents',
    window: { navigationStyle: 'custom' },
    rendererOptions: { skyline: { defaultDisplayBlock: true, defaultContentBox: true,
      disableABTest: true, sdkVersionBegin: '3.0.0', sdkVersionEnd: '15.255.255' } },
  })
  const files = {
    'package.json': '{"private":true}',
    'src/app.config.ts': 'defineAppConfig(' + JSON.stringify(app) + ')',
    'src/app.js': `import { state } from './state.js';
import { router } from '@miniprogramlab/routes';
App({ state, router, platform: __MINIPROGRAM_PLATFORM__, title: __MINIPROGRAM_ENV__.title });`,
    'src/state.ts': 'export const state = { count: 0 }',
    'src/components/local/index.json': '{"component":true,"usingComponents":{"badge":"fixture-ui/badge/index"}}',
    'src/components/local/index.js': 'import { state } from "../../state.js"; Component({ state })',
    ['src/components/local/index' + adapter.templateExtension]: '<view><badge /></view>',
    'src/app.scss': '$gap: 8px; page { padding: $gap; }',
    '.env.development': 'WX_APP_TITLE=微信标题\nTT_APP_TITLE=抖音标题\nALIPAY_APP_TITLE=支付宝标题\n',
    [adapter.projectFile]: JSON.stringify({ appid: 'source-app-id', setting: { skylineRenderEnable: true, compileWorklet: true } }),
    'node_modules/fixture-ui/package.json': '{"name":"fixture-ui","miniprogram":"mini"}',
    'node_modules/fixture-ui/mini/badge/index.json': '{"component":true}',
    'node_modules/fixture-ui/mini/badge/index.js': 'Component({})',
    ['node_modules/fixture-ui/mini/badge/index' + adapter.templateExtension]: '<view />',
    ['node_modules/fixture-ui/mini/badge/index' + adapter.styleExtension]: 'view { color: red; }',
  }
  if (platform === 'wechat') files['src/framework/runtime.ts'] = 'export const definePage = Page; export const defineComponent = Component;'
  for (const [i, name] of ['home', 'detail'].entries()) {
    files[`src/pages/${name}/index.config.ts`] = 'definePageConfig(' + JSON.stringify({ page: { name, tabBar: { id: name, order: i, text: name, iconPath: 'images/icon.png', selectedIconPath: 'images/active.png' } },
      config: { usingComponents: { local: '/components/local/index', badge: 'fixture-ui/badge/index' } },
    }) + ')'
    files[`src/pages/${name}/index.js`] = 'import { state } from "../../state.js"; state.count++; Page({ state })'
    files[`src/pages/${name}/index${adapter.templateExtension}`] = '<view><badge /></view>'
    files[`src/pages/${name}/index.less`] = '@color: blue; view { color: @color; }'
  }
  for (const [name, text] of Object.entries(files)) await write(root, name, text)
  await mkdir(path.join(root, 'node_modules/@miniprogramlab'), { recursive: true })
  await symlink(path.dirname(fileURLToPath(import.meta.resolve('@miniprogramlab/core/package.json'))), path.join(root, 'node_modules/@miniprogramlab/core'))
  const options = await loadOptions({ root, platform, mode: 'development' })
  return { root, options, adapter }
}

/** 按小程序相对路径及模块缓存执行实际生成的 CommonJS 文件。 */
async function execute(output, host, pages = ['home', 'detail']) {
  const { readFileSync } = await import('node:fs')
  const registered = []
  const context = createContext({
    App: (value) => registered.push(value), Page: (value) => registered.push(value), Component() {},
    // 只提供当前宿主，注入了错误平台的产物会在导航时失败。
    ...(host ? { [host]: Object.fromEntries(['navigateTo', 'switchTab', 'reLaunch'].map((method) => [method, (options) => options.success()])) } : {}),
  })
  const cache = new Map()
  /** 同一路径仅加载一次，保留共享模块状态。 */
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports
    const module = { exports: {} }
    cache.set(filename, module)
    new Script('(function(require,module,exports){' + readFileSync(filename, 'utf8') + '\n})').runInContext(context)((reference) => {
      assert.ok(reference.startsWith('.'), reference)
      return load(path.resolve(path.dirname(filename), reference))
    }, module, module.exports)
    return module.exports
  }
  load(path.join(output, 'app.js'))
  for (const page of pages) load(path.join(output, 'pages', page, 'index.js'))
  return registered
}

for (const platform of ['wechat', 'douyin', 'alipay']) {
  test(platform + '：真实构建、原生后缀、底栏字段和共享模块执行一致', async (context) => {
    const { root, options, adapter } = await fixture(context, platform)
    // 任意文件名的独立配置和同文件配置都必须按页面入口输出 JSON。
    await rename(path.join(root, 'src/pages/home/index.config.ts'), path.join(root, 'src/pages/home/metadata.ts'))
    const detailConfig = await readFile(path.join(root, 'src/pages/detail/index.config.ts'), 'utf8')
    await rm(path.join(root, 'src/pages/detail/index.config.ts'))
    await write(root, 'src/pages/detail/index.js', `
import { router } from '@miniprogramlab/routes';
import { state } from '../../state.js';
import { basename } from 'node:path';
const configTitle = basename('/compile/配置标题'), shared = '共享数据';
/** 配置依赖 Node 函数，不能进入小程序运行时。 */
function title() { return configTitle + shared }
${detailConfig.replace('"config":{', '"config":{"navigationBarTitleText": title(),')}
state.count++;
${platform === 'wechat' ? 'definePage' : 'Page'}({ state, shared, router, go: () => navigateTo('/pages/home/index').go() });`)
    await buildProject(options)
    const app = JSON.parse(await readFile(path.join(options.output, 'app.json'), 'utf8'))
    assert.equal(app.pages[0], 'pages/home/index')
    assert.equal(app.pages.length, 2)
    const tab = (app.tabBar.items ?? app.tabBar.list)[0]
    assert.equal(tab[platform === 'alipay' ? 'name' : 'text'], 'home')
    assert.equal(tab[platform === 'alipay' ? 'activeIcon' : 'selectedIconPath'], 'images/active.png')
    assert.ok(await readFile(path.join(options.output, 'app' + adapter.styleExtension), 'utf8'))
    assert.ok(await readFile(path.join(options.output, 'pages/home/index' + adapter.templateExtension), 'utf8'))
    assert.ok(await readFile(path.join(options.output, 'miniprogram_npm/fixture-ui/badge/index' + adapter.styleExtension), 'utf8'))
    const project = JSON.parse(await readFile(path.join(options.output, adapter.projectFile), 'utf8'))
    assert.equal(project.miniprogramRoot, './')
    assert.equal(project.appid, 'source-app-id')
    const page = JSON.parse(await readFile(path.join(options.output, 'pages/home/index.json'), 'utf8'))
    assert.equal(page.renderer, platform === 'wechat' ? 'skyline' : undefined)
    const detail = JSON.parse(await readFile(path.join(options.output, 'pages/detail/index.json'), 'utf8'))
    assert.equal(detail.navigationBarTitleText ?? detail.defaultTitle, '配置标题共享数据')
    await assert.rejects(readFile(path.join(options.output, 'pages/home/metadata.json')), { code: 'ENOENT' })
    await assert.rejects(readFile(path.join(options.output, 'pages/home/metadata.js')), { code: 'ENOENT' })
    assert.doesNotMatch(await readFile(path.join(options.output, 'pages/detail/index.js'), 'utf8'), /definePageConfig|node:path|configTitle/)
    assert.ok(await readFile(path.join(options.output, 'components/local/index.js'), 'utf8'))
    const local = JSON.parse(await readFile(path.join(options.output, 'components/local/index.json'), 'utf8'))
    assert.equal(local.usingComponents.badge, '/miniprogram_npm/fixture-ui/badge/index')
    const records = await execute(options.output, { wechat: 'wx', douyin: 'tt', alipay: 'my' }[platform])
    assert.equal((await records[0].router.navigateTo('/pages/home/index').go()).ok, true)
    assert.equal(records[0].platform, platform)
    assert.equal(records[0].title, adapter.label + '标题')
    assert.equal(records[0].state, records[1].state)
    assert.equal(records[0].state.count, 2)
    assert.equal(records[2].shared, '共享数据')
    assert.equal((await records[2].go()).ok, true)
    assert.equal((await loadOptions({ root })).platform, 'wechat')
  })
}

test('页面入口任意命名，重复配置及手写 JSON 冲突均明确拒绝', async (context) => {
  const { root, options, adapter } = await fixture(context)
  for (const suffix of ['.js', '.less', adapter.templateExtension]) {
    await rename(path.join(root, 'src/pages/home/index' + suffix), path.join(root, 'src/pages/home/screen' + suffix))
  }
  await rename(path.join(root, 'src/pages/home/index.config.ts'), path.join(root, 'src/pages/home/settings.mjs'))
  // 注释、字符串、对象同名方法以及嵌套子目录都不能冒充页面配置。
  await write(root, 'src/pages/home/helpers.ts', `
// definePageConfig({ page: { name: 'fake' } })
const text = "definePageConfig({})";
function run(definePageConfig: () => void) { definePageConfig() }
const object = { definePageConfig() {} }; object.definePageConfig();`)
  await write(root, 'src/pages/home/child/helper.ts', 'export const note = "子目录普通模块"')
  await buildProject(options)
  const app = JSON.parse(await readFile(path.join(options.output, 'app.json'), 'utf8'))
  assert.equal(app.pages[0], 'pages/home/screen')
  assert.ok(await readFile(path.join(options.output, 'pages/home/screen.json'), 'utf8'))
  await write(root, 'src/pages/home/duplicate.ts', 'definePageConfig({ page: { name: "duplicate" } })')
  await assert.rejects(buildProject(options), /页面配置重复[\s\S]*duplicate.ts[\s\S]*settings.mjs/)
  await rm(path.join(root, 'src/pages/home/duplicate.ts'))
  await write(root, 'src/pages/home/screen.json', '{}')
  await assert.rejects(buildProject(options), /手写 JSON 与自动生成配置冲突/)
})

test('页面配置必须唯一、位于顶层且与唯一入口同目录', async (context) => {
  const { root, options } = await fixture(context)
  const config = 'src/pages/home/index.config.ts'
  const original = await readFile(path.join(root, config), 'utf8')
  await write(root, config, original + '\ndefinePageConfig({ page: { name: "another" } })')
  await assert.rejects(buildProject(options), /页面配置重复/)
  await write(root, config, 'if (true) { ' + original + ' }')
  await assert.rejects(buildProject(options), /必须在文件顶层直接调用/)
  await rm(path.join(root, config))
  await write(root, 'src/pages/home/nested/settings.ts', original)
  await assert.rejects(buildProject(options), /页面缺少配置/)
  await rm(path.join(root, 'src/pages/home/nested'), { recursive: true })
  await write(root, config, original)
  await write(root, 'src/pages/home/other.js', 'Page({})')
  await assert.rejects(buildProject(options), /只能包含一个页面入口/)
})

test('名称别名、默认微信、平台覆盖及未知平台拒绝', async (context) => {
  const { root } = await fixture(context)
  await write(root, 'miniprogram.config.mjs', 'export default { platforms: { douyin: { source: "src-tt", outDir: "dist-tt", projectConfig: "tt.project.json" } } }')
  const options = await loadOptions({ root, platform: 'tt' })
  assert.equal(options.configFile, path.join(root, 'miniprogram.config.mjs'))
  assert.equal(options.platform, 'douyin')
  assert.equal(options.source, path.join(root, 'src-tt'))
  assert.equal(options.output, path.join(root, 'dist-tt'))
  assert.equal(options.projectConfig, 'tt.project.json')
  assert.equal(createPlatformRegistry().resolve('wx').id, 'wechat')
  assert.equal(createPlatformRegistry().resolve('my').id, 'alipay')
  await assert.rejects(loadOptions({ root, platform: 'unknown' }), /未注册的平台/)
  assert.throws(() => createPlatformRegistry([{ ...builtinPlatforms[1], id: 'other', aliases: ['wx'] }]), /重复/)
})

test('第三方适配器通过配置注册后可由命令行完成构建', async (context) => {
  const { root } = await fixture(context)
  const moduleUrl = pathToFileURL(path.resolve('dist/src/options.js')).href
  await write(root, 'miniprogram.config.mjs', `import { builtinPlatforms, definePlatformAdapter } from ${JSON.stringify(moduleUrl)};
export default { platformAdapters: [definePlatformAdapter({ ...builtinPlatforms.find(p => p.id === 'douyin'), id: 'custom', aliases: ['cx'], label: '自定义', envPrefix: 'CUSTOM', envGlobal: '__CUSTOM_ENV__' })] }`)
  const cli = path.resolve('bin/miniprogram.mjs')
  const result = spawnSync(process.execPath, [cli, 'build', '--root', root, '--platform', 'cx', '--mode', 'development'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /目标平台：自定义（custom） · 构建环境：development/)
  assert.match(result.stdout, /TypeScript 类型检查：未启用，仅转译/)
  assert.match(result.stdout, /页面 2 个 · 本地组件 1 个 · npm 组件 1 个/)
  assert.match(result.stdout, /产物 \d+ 个文件 · 总大小/)
  const generated = await readdir(path.join(root, 'dist-custom'), { recursive: true })
  const scripts = generated.filter((filename) => filename.endsWith('.js')).length
  const maps = generated.filter((filename) => filename.endsWith('.map')).length
  assert.ok(maps > 0)
  assert.ok(result.stdout.includes(`JavaScript ${scripts} 个 · Source Map ${maps} 个`))
  for (let phase = 1; phase <= 6; phase++) {
    assert.match(result.stdout, new RegExp('\\[SUCCESS\\].*' + phase + '/6'))
  }
  assert.ok(result.stdout.includes('输出目录：' + path.join(root, 'dist-custom')))
  assert.equal((await execute(path.join(root, 'dist-custom')))[0].platform, 'custom')
})

test('开发监听完整报告首次失败、删除文件恢复和合并变更路径', async (context) => {
  const { root, options } = await fixture(context)
  await write(root, 'src/app.less', 'page { color: red; }')
  const child = spawn(process.execPath, [path.resolve('bin/miniprogram.mjs'), 'dev', '--root', root, '--platform', 'douyin', '--poll'], {
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
  child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
  const closed = new Promise((resolve) => child.once('close', resolve))
  context.after(async () => { child.kill('SIGTERM'); await closed })
  /** 等待真实子进程输出目标状态，异常退出时保留完整诊断。 */
  async function until(pattern) {
    const deadline = Date.now() + 15000
    while (!pattern.test(stdout)) {
      assert.equal(child.exitCode, null, stdout + stderr)
      assert.ok(Date.now() < deadline, stdout + stderr)
      await new Promise((resolve) => setTimeout(resolve, 30))
    }
  }
  await until(/等待文件变更/)
  assert.match(stderr, /第 1 次构建失败/)
  assert.match(stderr, /3\/6.*本阶段未完成/)
  assert.doesNotMatch(stdout, /抖音编译完成/)
  assert.match(stdout, /文件监听已启动 · 轮询（300 ms）/)
  await rm(path.join(root, 'src/app.less'))
  await until(/抖音编译完成 · 第 2 次构建/)
  assert.match(stdout, /本轮合并 1 个变更路径：\n\[INFO\]   src\/app.less/)
  assert.ok(await readFile(path.join(options.output, 'app.json'), 'utf8'))
  // 同一次保存操作产生的不同路径合并报告，下一轮只包含新的变更。
  await write(root, 'src/new.txt', '新增资源')
  await write(root, 'src/app.js', 'App({ updated: true })')
  await until(/抖音编译完成 · 第 3 次构建/)
  const rebuild = stdout.slice(stdout.indexOf('第 3 次构建'))
  assert.match(rebuild, /本轮合并 2 个变更路径/)
  assert.match(rebuild, /src\/app.js/)
  assert.match(rebuild, /src\/new.txt/)
  assert.doesNotMatch(rebuild, /src\/app.less/)
  assert.equal(await readFile(path.join(options.output, 'new.txt'), 'utf8'), '新增资源')
  // 配置文件更名和内容修改都应自动重建，JSON 名称始终跟随页面入口。
  await rename(path.join(root, 'src/pages/home/index.config.ts'), path.join(root, 'src/pages/home/metadata.js'))
  await until(/抖音编译完成 · 第 4 次构建/)
  const config = await readFile(path.join(root, 'src/pages/home/metadata.js'), 'utf8')
  await write(root, 'src/pages/home/metadata.js', config.replace('"config":{', '"config":{"navigationBarTitleText":"重建标题",'))
  await until(/抖音编译完成 · 第 5 次构建/)
  assert.equal(JSON.parse(await readFile(path.join(options.output, 'pages/home/index.json'), 'utf8')).navigationBarTitleText, '重建标题')
  await assert.rejects(readFile(path.join(options.output, 'pages/home/metadata.json')), { code: 'ENOENT' })
  child.kill('SIGTERM')
  assert.equal(await closed, 0)
  assert.match(stdout, /开发监听已停止/)
})

test('样式冲突或不兼容配置导致构建失败时保留原产物和私有配置', async (context) => {
  const { root, options } = await fixture(context, 'wechat')
  await buildProject(options)
  const privateFile = path.join(options.output, 'project.private.config.json')
  await writeFile(privateFile, '{\r\n  "个人配置": true\r\n}\r\n')
  const before = await readFile(path.join(options.output, 'app.json'))
  const privateBefore = await readFile(privateFile)
  await write(root, 'src/app.less', 'page { color: red; }')
  await assert.rejects(buildProject(options), /样式输出重名/)
  assert.deepEqual(await readFile(path.join(options.output, 'app.json')), before)
  assert.deepEqual(await readFile(privateFile), privateBefore)
  await assert.rejects(buildProject(await loadOptions({ root, platform: 'douyin', mode: 'development' })), /微信专用配置/)
})

test('跨平台环境变量隔离，平台专用系统变量优先', async (context) => {
  const { root } = await fixture(context)
  const before = process.env.TT_APP_TITLE
  process.env.TT_APP_TITLE = '系统抖音标题'
  context.after(() => { if (before === undefined) delete process.env.TT_APP_TITLE; else process.env.TT_APP_TITLE = before })
  const env = await loadEnvironment(root, 'development', 'douyin')
  assert.equal(env.public.title, '系统抖音标题')
  assert.equal((await loadEnvironment(root, 'development', 'alipay')).public.title, '支付宝标题')
  await assert.rejects(loadEnvironment(root, '../secret', 'douyin'), /环境名称/)
})

test('非微信平台拒绝微信运行时与 Worklet 依赖', async (context) => {
  const { root, options } = await fixture(context)
  await write(root, 'src/app.js', 'import "@miniprogramlab/core"; App({})')
  await assert.rejects(buildProject(options), /仅支持微信/)
  await write(root, 'src/app.js', 'import { value } from "./motion.worklet.js"; App({ value })')
  await write(root, 'src/motion.worklet.ts', 'export const value = 1')
  await assert.rejects(buildProject(options), /不支持微信 Worklet/)
})

test('产物目录符号链接不能覆盖源码或项目外目录', async (context) => {
  const { root } = await fixture(context)
  await assert.rejects(loadOptions({ root, 'out-dir': '.cache' }), /工具缓存目录/)
  await assert.rejects(loadOptions({ root, 'out-dir': 'node_modules' }), /工具缓存目录/)
  await symlink(path.join(root, 'src'), path.join(root, 'linked-output'))
  await assert.rejects(loadOptions({ root, 'out-dir': 'linked-output' }), /符号链接/)
  await symlink(os.tmpdir(), path.join(root, 'external-output'))
  await assert.rejects(loadOptions({ root, 'out-dir': 'external-output/build' }), /符号链接/)
})

test('原生项目可通过发布声明启用严格类型检查，类型错误不覆盖旧产物', async (context) => {
  const { root, options } = await fixture(context)
  await mkdir(path.join(root, 'node_modules/@miniprogramlab'), { recursive: true })
  await symlink(process.cwd(), path.join(root, 'node_modules/@miniprogramlab/cli'))
  await write(root, 'tsconfig.json', JSON.stringify({ compilerOptions: {
    strict: true, noEmit: true, target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
    types: ['@miniprogramlab/cli/globals'],
  }, include: ['src/**/*.ts'] }))
  await write(root, 'src/type-probe.ts', 'const target: string = __MINIPROGRAM_PLATFORM__; const title: string = __MINIPROGRAM_ENV__.title; export { target, title };')
  await buildProject({ ...options, typecheck: true })
  const before = await readFile(path.join(options.output, 'app.json'))
  await write(root, 'src/type-probe.ts', 'export const invalid: number = "错误类型";')
  await assert.rejects(buildProject({ ...options, typecheck: true }), /TypeScript 类型检查失败/)
  assert.deepEqual(await readFile(path.join(options.output, 'app.json')), before)
})

test('page.tabBar 自动选择页面入口注入，普通页和原生底栏不接入自定义行为', async (context) => {
  const { root, options } = await fixture(context, 'wechat')
  const appSource = await readFile(path.join(root, 'src/app.config.ts'), 'utf8')
  const app = JSON.parse(appSource.slice('defineAppConfig('.length, -1))
  app.tabBar = { custom: true, color: '#000000', selectedColor: '#111111', backgroundColor: '#FFFFFF' }
  await write(root, 'src/app.config.ts', 'defineAppConfig(' + JSON.stringify(app) + ')')
  await write(root, 'src/framework/runtime.ts', `
/** 记录编译器注入的第二参数，不引入页面生命周期替身。 */
export function definePage(options, compiledTabPage = false) { return Page({ ...options, compiledTabPage }) }
export const defineComponent = Component;`)
  await write(root, 'src/pages/home/index.js', 'definePage({ label: "home" })')
  await write(root, 'src/pages/detail/index.js', 'definePage({ label: "detail" })')
  await write(root, 'src/pages/plain/index.js', 'definePage({ label: "plain" })')
  await write(root, 'src/pages/plain/config.ts', 'definePageConfig({ page: { name: "plain", description: "普通页" } })')
  await write(root, 'src/pages/plain/index.wxml', '<view />')
  await write(root, 'src/pages/plain/index.wxss', '')
  await write(root, 'src/custom-tab-bar/index.ts', 'Component({})')
  await write(root, 'src/custom-tab-bar/index.config.ts', 'export default { component: true }')
  await write(root, 'src/custom-tab-bar/index.wxml', '<view />')
  await write(root, 'src/custom-tab-bar/index.wxss', '')
  await buildProject(options)
  const records = await execute(options.output, 'wx', ['home', 'detail', 'plain'])
  assert.equal(records[1].compiledTabPage, true)
  assert.equal(records[2].compiledTabPage, true)
  assert.equal(records[3].compiledTabPage, false)
  const json = JSON.parse(await readFile(path.join(options.output, 'pages/home/index.json'), 'utf8'))
  assert.equal(json.page, undefined)
  app.tabBar.custom = false
  await write(root, 'src/app.config.ts', 'defineAppConfig(' + JSON.stringify(app) + ')')
  await buildProject(options)
  const native = await execute(options.output, 'wx')
  assert.equal(native[1].compiledTabPage, false)
  assert.equal(native[2].compiledTabPage, false)
})
