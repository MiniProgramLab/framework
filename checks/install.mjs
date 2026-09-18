/** 在仓库外安装实际 tarball，验证独立构建、原生底栏、监听与私有配置保护。 */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'

/** 检查项目自动清理，失败时保留路径便于定位。 */
const root = await mkdtemp(path.join(os.tmpdir(), 'skyline-install-'))
const artifacts = fileURLToPath(new URL('../artifacts/', import.meta.url))
const pnpm = process.env.npm_execpath
if (!pnpm) throw new Error('请通过 pnpm dev:framework:install-check 执行')

/** 写入检查项目所需文件，不复用应用源码或 workspace 链接。 */
async function write(name, text) {
  const filename = path.join(root, name)
  await mkdir(path.dirname(filename), { recursive: true })
  await writeFile(filename, text)
}

/** 执行消费项目命令；失败输出作为具体诊断保留。 */
function command(args, expected = 0) {
  const result = spawnSync(process.execPath, [pnpm, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, CI: 'true' } })
  if (result.error) throw result.error
  if (expected === 0 && result.status !== 0) throw new Error(result.stdout + result.stderr)
  if (expected !== 0) assert.notEqual(result.status, 0, '错误源码必须导致 CLI 失败')
  return result
}

try {
  const dependencies = Object.fromEntries(['core', 'ui', 'cli'].map((name) => [
    '@miniprogramlab/' + name, 'file:' + path.join(artifacts, 'miniprogramlab-' + name + '-0.1.0.tgz'),
  ]))
  await write('package.json', JSON.stringify({ name: 'skyline-external-check', private: true, type: 'module',
    dependencies, devDependencies: { typescript: '5.9.3', 'miniprogram-api-typings': '5.2.3' },
    scripts: { 'dev:check': 'skyline build --mode=development --typecheck' } }))
  await write('skyline.config.mjs', 'export default { source: "mini", outDir: "output", customTabBar: "@miniprogramlab/ui/custom-tab-bar/index" }')
  await write('tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true,
    noEmit: true, skipLibCheck: true, types: ['miniprogram-api-typings', '@miniprogramlab/core/globals'], paths: { '@wx/routes': ['./.cache/routes.generated.ts'] } }, include: ['mini/**/*.ts'] }))
  await write('project.config.json', JSON.stringify({ compileType: 'miniprogram', miniprogramRoot: './', setting: { skylineRenderEnable: true, compileWorklet: true } }))
  await write('project.private.config.example.json', '{ "note": "私有配置原始字节", "setting": { "urlCheck": false } }\n')
  await write('mini/app.config.ts', `import { libraryComponents } from '@miniprogramlab/ui';
    defineAppConfig({ entryPageName: 'home', renderer: 'skyline', componentFramework: 'glass-easel', lazyCodeLoading: 'requiredComponents',
      usingComponents: libraryComponents, window: { navigationStyle: 'custom' },
      tabBar: { custom: true, color: '#000000', selectedColor: '#111111', backgroundColor: '#FFFFFF' },
      rendererOptions: { skyline: { defaultDisplayBlock: true, defaultContentBox: true, disableABTest: true, sdkVersionBegin: '3.0.0', sdkVersionEnd: '15.255.255' } } });`)
  await write('mini/app.ts', `import { defineGlobalStore, installGlobalStore } from '@miniprogramlab/core';
    import { installComponents } from '@miniprogramlab/ui';
    import { installTabBar } from '@miniprogramlab/ui/custom-tab-bar/controller';
    import { routes } from '@wx/routes';
    const definition = defineGlobalStore(() => ({ count: 0 }));
    App({ onLaunch() {
      installGlobalStore(this, definition);
      installComponents(this, { homeUrl: () => '/pages/home/index', returnTo: async () => {} });
      installTabBar(this, { tabs: Object.values(routes).map(route => ({ ...route.tab, pagePath: route.path })) });
    } });`)
  for (const [index, name] of ['home', 'mine'].entries()) {
    await write('mini/pages/' + name + '/index.config.ts', 'definePageConfig(' + JSON.stringify({ pagesName: name,
      route: { kind: 'tab', tab: { id: name, text: name, iconPath: '/icons/home.svg', order: index } } }) + ')')
    await write('mini/pages/' + name + '/index.ts', 'definePage({ globalStore: true, methods: { increase() { this.$globalStore.update({ count: 1 }) } } })')
    await write('mini/pages/' + name + '/index.wxml', '<page title="独立检查"><view class="label" bindtap="increase">{{$globalStore.count}}</view></page>')
  }
  await write('mini/pages/home/index.scss', '@use "pkg:@miniprogramlab/ui/styles/_tokens.scss" as ui; .label { color: ui.$text-primary; }')
  await write('mini/pages/mine/palette.less', '@tone: #123456; .paint() { color: @tone; }')
  await write('mini/pages/mine/index.less', '@import "palette"; .label { .paint(); }')
  await write('mini/icons/home.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><path d="M0 0h20v20H0z"/></svg>')
  command(['install', '--ignore-scripts', '--store-dir', path.join(root, '.pnpm-store')])
  console.log('独立 tarball 安装完成：' + root)
  command(['dev:check'])
  const privateFile = path.join(root, 'output/project.private.config.json')
  const privateBytes = await readFile(privateFile)
  const app = JSON.parse(await readFile(path.join(root, 'output/app.json'), 'utf8'))
  assert.equal(app.pages.length, 2)
  assert.match(app.usingComponents.page, /^\/miniprogram_npm\/@miniprogramlab\/ui\//)
  for (const extension of ['js', 'json', 'wxml', 'wxss']) await readFile(path.join(root, 'output/custom-tab-bar/index.' + extension))
  assert.match(await readFile(path.join(root, 'output/pages/mine/index.wxss'), 'utf8'), /#123456/)
  command(['dev:check'])
  assert.deepEqual(await readFile(privateFile), privateBytes)
  const appBytes = await readFile(path.join(root, 'output/app.js'))
  await write('mini/pages/home/index.scss', '.broken { color:')
  command(['dev:check'], 1)
  assert.deepEqual(await readFile(path.join(root, 'output/app.js')), appBytes)
  assert.deepEqual(await readFile(privateFile), privateBytes)
  await write('mini/pages/home/index.scss', '.label { color: red; }')
  // 从项目外启动 CLI，验证 --root 不依赖脚本所在目录。
  const resolver = createRequire(path.join(root, 'package.json'))
  const cli = path.join(path.dirname(resolver.resolve('@miniprogramlab/cli/package.json')), 'bin/skyline.mjs')
  const worker = spawn(process.execPath, [cli, 'dev', '--root', root], { cwd: os.tmpdir(), stdio: ['ignore', 'pipe', 'pipe'] })
  let builds = 0
  let output = ''
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('CLI 监听检查超时：' + output)), 15000)
      worker.once('error', (error) => { clearTimeout(timeout); reject(error) })
      worker.once('exit', () => { clearTimeout(timeout); reject(new Error('CLI 提前退出：' + output)) })
      worker.stderr.on('data', (chunk) => { output += chunk })
      worker.stdout.on('data', async (chunk) => {
        output += chunk
        if (!chunk.toString().includes('微信编译完成')) return
        builds++
        if (builds === 1) {
          // 等待首轮建立监听后再触发真实文件变更。
          setTimeout(() => write('mini/pages/mine/palette.less', '@tone: #654321; .paint() { color: @tone; }').catch(reject), 200)
        } else {
          clearTimeout(timeout)
          resolve()
        }
      })
    })
  } finally {
    if (worker.exitCode === null && worker.signalCode === null) {
      const exited = new Promise((resolve) => worker.once('exit', resolve))
      worker.kill('SIGTERM')
      await exited
    }
  }
  assert.match(await readFile(path.join(root, 'output/pages/mine/index.wxss'), 'utf8'), /#654321/)
  assert.deepEqual(await readFile(privateFile), privateBytes)
  console.log('仓库外 tarball 安装、SCSS/Less、原生底栏、失败回滚、--root 和监听检查通过')
  await rm(root, { recursive: true, force: true })
} catch (error) {
  console.error('检查项目保留在：' + root)
  throw error
}
