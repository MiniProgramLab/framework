/** 运行真实解析器验证跨文件定义，不依赖编辑器 UI 或执行用户工程代码。 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, symlink, realpath } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import test, { after } from 'node:test'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

/** 打包纯语言核心，和发布扩展使用相同实现。 */
const temporary = await mkdtemp(path.join(os.tmpdir(), 'skyline-language-'))
after(() => rm(temporary, { recursive: true, force: true }))
const result = await build({
  stdin: { contents: 'export { Language } from "./language"; export { Project } from "./project";',
    loader: 'ts', resolveDir: fileURLToPath(new URL('../src', import.meta.url)) },
  bundle: true, platform: 'node', format: 'cjs', write: false,
})
const moduleFile = path.join(temporary, 'language.cjs')
await writeFile(moduleFile, result.outputFiles[0].contents)
const { Language, Project } = createRequire(import.meta.url)(moduleFile)

/** 创建独立项目并支持覆盖编辑器中尚未保存的内容。 */
async function fixture(files, documents = {}) {
  const root = await realpath(await mkdtemp(path.join(temporary, 'project-')))
  for (const [name, content] of Object.entries({ 'app.config.ts': 'defineAppConfig({})', ...files })) {
    if (content === null) continue
    await mkdir(path.dirname(path.join(root, name)), { recursive: true })
    await writeFile(path.join(root, name), content)
  }
  const buffers = new Map(Object.entries(documents).map(([name, content]) => [path.join(root, name), content]))
  const language = new Language(new Project(path.join(root, 'index.wxml'), { documents: buffers }))
  /** 按可见文本选择点击位置，并断言唯一目标的文件和名称。 */
  function definition(file, needle, expectedFile, expectedName = needle, shift = 1) {
    const content = documents[file] ?? files[file]
    const offset = content.lastIndexOf(needle) + shift
    assert.ok(offset >= shift, '用例中的定位文本必须存在')
    const found = language.definition(path.join(root, file), offset)
    assert.equal(found.length, 1, JSON.stringify(found))
    assert.equal(path.relative(root, found[0].file), expectedFile)
    assert.equal(found[0].name, expectedName)
    return found[0]
  }
  return { root, language, definition }
}

/** 将真实组件包链接到独立夹具，避免测试依赖宿主项目页面。 */
async function componentFixture(files = {}) {
  const env = await fixture({
    'package.json': '{"name":"framework-component-fixture","private":true}',
    'app.config.ts': 'import { libraryComponents } from "@miniprogramlab/ui"; defineAppConfig({ usingComponents: libraryComponents })',
    'index.wxml': '<page-header/>',
    ...files,
  })
  const scope = path.join(env.root, 'node_modules/@miniprogramlab')
  await mkdir(scope, { recursive: true })
  await symlink(fileURLToPath(new URL('../../components/', import.meta.url)), path.join(scope, 'ui'), 'dir')
  return env
}

test('Behavior 穿透别名、重导出、对象展开与工厂参数，排除无关同名函数', async () => {
  const files = {
    'tsconfig.json': '{"compilerOptions":{"baseUrl":".","paths":{"@behavior/*":["behavior/*"]}}}',
    'behavior/base.ts': 'export const base = Behavior({ data: { profile: { nickname: "名字" } }, methods: { save() {} } });',
    'behavior/barrel.ts': 'export { base as shared } from "./base";',
    'behavior/middle.ts': 'import { shared } from "./barrel"; const all = [shared]; export default function create(extra) { return Behavior({ behaviors: [...all], data: { ...extra } }) }',
    'unused.ts': 'export function save() {}',
    'index.ts': 'import factory from "@behavior/middle"; import { save } from "./unused"; const extra = { count: 1 }; definePage({ behaviors: [factory(extra)] });',
    'index.wxml': '<view bindtap="save">{{profile.nickname}} {{count}}</view>',
  }
  const env = await fixture(files)
  env.definition('index.wxml', 'save', 'behavior/base.ts')
  env.definition('index.wxml', 'nickname', 'behavior/base.ts')
  env.definition('index.wxml', 'count', 'index.ts')
})

test('本地方法覆盖 Behavior，未保存文件立即参与定位与补全', async () => {
  const files = {
    'behavior.ts': 'export default Behavior({ methods: { submit() {} }, data: { title: "旧值" } })',
    'index.ts': 'import behavior from "./behavior"; Component({ behaviors: [behavior], methods: { submit() {} } })',
    'index.wxml': '<view bindtap="submit">{{fresh}}</view>',
  }
  const env = await fixture(files, { 'behavior.ts': 'export default Behavior({ data: { fresh: "未保存" } })' })
  env.definition('index.wxml', 'submit', 'index.ts')
  env.definition('index.wxml', 'fresh', 'behavior.ts')
  const offset = files['index.wxml'].indexOf('fresh') + 2
  assert.ok(env.language.completion(path.join(env.root, 'index.wxml'), offset).some((item) => item.label === 'fresh'))
})

test('CommonJS 多层 Behavior 与循环引用正常结束', async () => {
  const env = await fixture({
    'base.js': 'module.exports = Behavior({ data: { total: 1 } })',
    'middle.js': 'const base = require("./base"); module.exports = Behavior({ behaviors: [base] })',
    'index.js': 'const middle = require("./middle"); Component({ behaviors: [middle] })',
    'index.wxml': '<view>{{total}}</view>',
  })
  env.definition('index.wxml', 'total', 'base.js')
  const circular = await fixture({
    'a.ts': 'import b from "./b"; export default Behavior({ behaviors: [b], data: { shared: 1 } })',
    'b.ts': 'import a from "./a"; export default Behavior({ behaviors: [a] })',
    'index.ts': 'import a from "./a"; Page({ behaviors: [a] })',
    'index.wxml': '<view>{{shared}}</view>',
  })
  circular.definition('index.wxml', 'shared', 'a.ts')
})

test('SCSS 穿透 use 与 forward，命名空间、前缀及嵌套类名定位到原文件', async () => {
  const env = await fixture({
    '_tokens.scss': '$brand: #fff; @mixin panel { color: $brand; } .card { &__title { color: red; } }',
    '_theme.scss': '@forward "tokens" as ui-* show brand, panel;',
    'index.scss': '@use "theme" as theme; .host { color: theme.$ui-brand; @include theme.ui-panel; }',
    'index.wxml': '<view class="card__title"/>',
  })
  env.definition('index.wxml', 'card__title', '_tokens.scss')
  env.definition('index.scss', '$ui-brand', '_tokens.scss', 'brand')
  env.definition('index.scss', 'ui-panel', '_tokens.scss', 'panel')
})

test('Less 穿透多层 reference 导入并正确处理局部变量和 mixin', async () => {
  const env = await fixture({
    'palette.less': '@brand: #fff; .panel() { color: @brand; } .shared { color: red; }',
    'middle.less': '@import (reference) "palette";',
    'index.less': '@import "middle"; .host { color: @brand; .panel(); }',
    'index.wxml': '<view class="shared"/>',
  })
  env.definition('index.wxml', 'shared', 'palette.less')
  env.definition('index.less', '@brand', 'palette.less', 'brand')
  env.definition('index.less', 'panel', 'palette.less')
  const scoped = await fixture({ 'index.less': '@tone: red; .other { @tone: blue; } .host { color: @tone; }', 'index.wxml': '' })
  assert.equal(scoped.definition('index.less', '@tone', 'index.less', 'tone').start, 0)
})

test('样式循环引用、同名命名空间隔离与类名补全', async () => {
  const files = {
    '_a.scss': '@forward "b"; $tone: red; .shared { color: red; }',
    '_b.scss': '@forward "a";',
    '_other.scss': '$tone: blue;',
    'index.scss': '@use "a" as left; @use "other" as right; .x { color: left.$tone; }',
    'index.wxml': '<view class="sha"/>',
  }
  const env = await fixture(files)
  env.definition('index.scss', '$tone', '_a.scss', 'tone')
  const completions = env.language.completion(path.join(env.root, 'index.wxml'), files['index.wxml'].indexOf('sha') + 3)
  assert.ok(completions.some((item) => item.label === 'shared'))
})

test('组件注册支持配置常量与展开，标签和属性补全读取真实组件', async () => {
  const files = {
    'registry.ts': 'export const components = { "custom-card": "./card/index" }',
    'app.config.ts': 'import { components } from "./registry"; defineAppConfig({ usingComponents: { ...components } })',
    'card/index.ts': 'Component({ properties: { headingText: String } })',
    'index.wxml': '<custom-card >',
  }
  const env = await fixture(files)
  env.definition('index.wxml', 'custom-card', 'card/index.ts')
  assert.ok(env.language.completion(path.join(env.root, 'index.wxml'), files['index.wxml'].indexOf('>')).some((item) => item.label === 'heading-text'))
})

test('独立应用能跨 npm 组件包定位 page-header 属性', async () => {
  const { root, language } = await componentFixture()
  const file = path.join(root, 'index.wxml')
  const target = language.scripts.components(file).get('page-header')
  assert.ok(target?.endsWith('page-header/index.ts'), target)
  assert.ok(language.scripts.members(target).some((item) => item.name === 'autoBack' && item.kind === 'property'))
})

test('方法别名定位函数实现，properties 描述对象不污染模板字段', async () => {
  const env = await fixture({
    'actions.ts': 'export function perform() {}',
    'behavior.ts': 'import { perform } from "./actions"; export default Behavior({ methods: { submit: perform }, properties: { user: { type: Object, value: { nickname: "名字" } } } })',
    'index.ts': 'import behavior from "./behavior"; defineComponent({ behaviors: [behavior] })',
    'index.wxml': '<view bindtap="submit">{{user.nickname}}</view>',
  })
  env.definition('index.wxml', 'submit', 'actions.ts')
  env.definition('index.wxml', 'nickname', 'behavior.ts')
  const members = env.language.scripts.members(path.join(env.root, 'index.ts'))
  assert.equal(members.some((item) => item.path.join('.') === 'user.type'), false)
})

test('Sass 样式包通配 exports 可跳到实际 token 文件', async () => {
  const text = '@use "pkg:@miniprogramlab/ui/styles/_tokens.scss" as ui; .test { color: ui.$text-primary; }'
  const { root, language } = await componentFixture({ 'index.scss': text })
  const file = path.join(root, 'index.scss')
  const found = language.definition(file, text.indexOf('$text-primary') + 2)
  assert.equal(found.length, 1)
  assert.ok(found[0].file.endsWith('lib/styles/_tokens.scss'))
})


test('本地组件支持根路径、目录及显式扩展名，跳到真实注册位置', async () => {
  const files = {
    'app.config.ts': null,
    'app.json': '{}',
    'pages/index/index.json': JSON.stringify({ usingComponents: {
      'root-card': '/components/card/index', 'relative-card': '../../components/card/index.ts',
      'directory-card': '../../components/card', 'template-card': '../../components/card/index.wxml',
      'json-card': '../../components/card/index.json', 'script-card': '../../components/card/index.js',
    } }),
    'components/card/index.ts': '/** 卡片组件声明。 */\nconst title = "卡片";\nComponent({ properties: { titleText: String } })',
    'pages/index/index.wxml': '<root-card/><relative-card/><directory-card/><template-card/><json-card/><script-card/>',
  }
  const env = await fixture(files)
  for (const name of ['root-card', 'relative-card', 'directory-card', 'template-card', 'json-card', 'script-card']) {
    const target = env.definition('pages/index/index.wxml', name, 'components/card/index.ts')
    assert.equal(target.start, files['components/card/index.ts'].indexOf('Component('))
    assert.equal(target.length, 'Component'.length)
  }
})

test('组件路径别名继承 tsconfig，注册调用支持导入别名和命名空间', async () => {
  const files = {
    'tsconfig.base.json': '{"compilerOptions":{"baseUrl":".","paths":{"@ui/*":["components/*"]}}}',
    'tsconfig.json': '{"extends":"./tsconfig.base.json"}',
    'index.config.ts': 'definePageConfig({ usingComponents: { "alias-card": "@ui/card", "namespace-card": "@ui/namespace" } })',
    'components/card.ts': 'import { defineComponent as register } from "@miniprogramlab/core";\nexport const card = register({ properties: { titleText: String } })',
    'components/namespace.ts': 'import * as kit from "@miniprogramlab/core";\nkit.defineComponent({})',
    'index.wxml': '<alias-card ></alias-card><namespace-card/>',
  }
  const env = await fixture(files)
  const target = env.definition('index.wxml', 'alias-card', 'components/card.ts')
  assert.equal(target.start, files['components/card.ts'].indexOf('register('))
  env.definition('index.wxml', 'namespace-card', 'components/namespace.ts')
  const offset = files['index.wxml'].indexOf('>')
  assert.ok(env.language.completion(path.join(env.root, 'index.wxml'), offset).some((item) => item.label === 'title-text'))
})

test('npm 组件兼容 miniprogram、带扩展名的子路径及传统 main', async () => {
  const env = await fixture({
    'node_modules/@sample/ui/package.json': '{"name":"@sample/ui","miniprogram":"dist"}',
    'node_modules/@sample/ui/dist/card/index.js': '/** 发布的组件实现。 */\nComponent({ properties: { labelText: String } })',
    'node_modules/one-card/package.json': '{"name":"one-card","main":"component/card.cjs"}',
    'node_modules/one-card/component/card.cjs': '/** 单入口组件。 */\nComponent({})',
    'index.json': '{"usingComponents":{"npm-card":"@sample/ui/card/index.js","main-card":"one-card","dist-card":"@sample/ui/dist/card/index"}}',
    'index.wxml': '<npm-card/><main-card/><dist-card/>',
  })
  env.definition('index.wxml', 'npm-card', 'node_modules/@sample/ui/dist/card/index.js')
  env.definition('index.wxml', 'dist-card', 'node_modules/@sample/ui/dist/card/index.js')
  env.definition('index.wxml', 'main-card', 'node_modules/one-card/component/card.cjs')
})

test('pnpm 链接组件支持 exports 条件、通配子路径，并跳过 d.ts', async () => {
  const packageRoot = 'node_modules/.pnpm/export-ui@1.0.0/node_modules/export-ui'
  const files = {
    [packageRoot + '/package.json']: JSON.stringify({ name: 'export-ui', exports: {
      './*': { types: './types/*.d.ts', miniprogram: { default: './source/*.ts' } },
    } }),
    [packageRoot + '/source/card.ts']: '/** 组件注册。 */\nComponent({})',
    [packageRoot + '/types/card.d.ts']: 'declare const card: unknown; export default card;',
    'index.json': '{"usingComponents":{"export-card":"export-ui/card"}}',
    'index.wxml': '<export-card/>',
  }
  const env = await fixture(files)
  await symlink(path.join(env.root, packageRoot), path.join(env.root, 'node_modules/export-ui'))
  const found = env.language.definition(path.join(env.root, 'index.wxml'), 3)
  assert.equal(found.length, 1)
  assert.equal(await realpath(found[0].file), await realpath(path.join(env.root, packageRoot, 'source/card.ts')))
  assert.equal(found[0].start, files[packageRoot + '/source/card.ts'].indexOf('Component('))
})

test('尚未生成 miniprogram_npm 时回源 npm，已生成时可直接定位声明', async () => {
  const files = {
    'node_modules/ui/package.json': '{"name":"ui","miniprogram":"src"}',
    'node_modules/ui/src/card/index.js': '/** 安装包中的组件。 */\nComponent({})',
    'miniprogram_npm/ui/ready/index.js': '/** 已构建的组件。 */\nComponent({})',
    'pages/index.json': '{"usingComponents":{"pending-card":"../miniprogram_npm/ui/card/index","ready-card":"/miniprogram_npm/ui/ready/index"}}',
    'pages/index.wxml': '<pending-card/><ready-card/>',
  }
  const env = await fixture(files)
  env.definition('pages/index.wxml', 'pending-card', 'node_modules/ui/src/card/index.js')
  env.definition('pages/index.wxml', 'ready-card', 'miniprogram_npm/ui/ready/index.js')
})

test('跨分包异步组件始终跳实际组件，componentPlaceholder 不替换目标', async () => {
  const files = {
    'app.config.ts': null,
    'app.json': JSON.stringify({ pages: ['pages/index'], subPackages: [{ root: 'async', pages: ['page/index'] }], usingComponents: { 'async-card': '/placeholder/index' } }),
    'pages/index.json': JSON.stringify({ usingComponents: { 'async-card': '/async/components/card/index', 'loading-card': '/placeholder/index' },
      componentPlaceholder: { 'async-card': 'loading-card' } }),
    'async/components/card/index.ts': '/** 按需下载后注册的真实组件。 */\nComponent({ properties: { orderName: String } })',
    'placeholder/index.ts': 'Component({ properties: { loading: Boolean } })',
    'pages/index.wxml': '<async-card ></async-card><loading-card/>',
  }
  const env = await fixture(files)
  const target = env.definition('pages/index.wxml', 'async-card', 'async/components/card/index.ts')
  assert.equal(target.start, files['async/components/card/index.ts'].indexOf('Component('))
  env.definition('pages/index.wxml', 'loading-card', 'placeholder/index.ts')
  const suggestions = env.language.completion(path.join(env.root, 'pages/index.wxml'), files['pages/index.wxml'].indexOf('>'))
  assert.ok(suggestions.some((item) => item.label === 'order-name'))
  assert.equal(suggestions.some((item) => item.label === 'loading'), false)
})

test('异步组件配置支持常量、多层转发及未保存的占位配置', async () => {
  const files = {
    'routes.ts': 'export const asyncPath = "/async/card/index";',
    'registry.ts': 'export { asyncPath as cardPath } from "./routes";',
    'index.config.ts': 'definePageConfig({ usingComponents: { "async-card": "./placeholder" } })',
    'async/card/index.ts': '/** 异步卡片。 */\nComponent({})',
    'placeholder.ts': 'Component({})',
    'index.wxml': '<async-card/>',
  }
  const env = await fixture(files, {
    'index.config.ts': 'import { cardPath } from "./registry"; const components = { "async-card": cardPath }; definePageConfig({ usingComponents: { ...components }, componentPlaceholder: { "async-card": "view" } })',
  })
  env.definition('index.wxml', 'async-card', 'async/card/index.ts')
})

test('组件入口穿透 ESM、CommonJS 及副作用转发，并沿实现补全属性', async () => {
  const files = {
    'card/index.ts': 'export { default } from "./middle";',
    'card/middle.ts': 'import card from "./implementation"; export default card;',
    'card/implementation.ts': '/** 卡片实现。 */\nexport default Component({ properties: { headingText: String } });',
    'cjs/index.js': 'module.exports = require("./middle");',
    'cjs/middle.js': 'require("./implementation");',
    'cjs/implementation.js': '/** CommonJS 组件。 */\nComponent({});',
    'side/index.ts': 'import "./middle";',
    'side/middle.ts': 'export * from "./implementation";',
    'side/implementation.ts': '/** 副作用组件。 */\ndefineComponent({});',
    'index.json': '{"usingComponents":{"esm-card":"./card","cjs-card":"./cjs","side-card":"./side"}}',
    'index.wxml': '<esm-card ></esm-card><cjs-card/><side-card/>',
  }
  const env = await fixture(files)
  env.definition('index.wxml', 'esm-card', 'card/implementation.ts')
  env.definition('index.wxml', 'cjs-card', 'cjs/implementation.js')
  env.definition('index.wxml', 'side-card', 'side/implementation.ts')
  assert.ok(env.language.completion(path.join(env.root, 'index.wxml'), files['index.wxml'].indexOf('>')).some((item) => item.label === 'heading-text'))
})

test('缺失或动态的局部组件覆盖全局注册，循环引用不跳无关占位组件', async () => {
  const files = {
    'app.config.ts': 'defineAppConfig({ usingComponents: { "missing-card": "./placeholder", "dynamic-card": "./placeholder" } })',
    'index.config.ts': 'definePageConfig({ usingComponents: { "missing-card": "/async/not-downloaded", "dynamic-card": chooseComponent(), "loop-card": "./loop/a" }, componentPlaceholder: { "missing-card": "view" } })',
    'placeholder.ts': 'Component({})',
    'loop/a.ts': 'export * from "./b";',
    'loop/b.ts': 'export * from "./a";',
    'index.wxml': '<missing-card/><dynamic-card/><loop-card/>',
  }
  const env = await fixture(files)
  for (const name of ['missing-card', 'dynamic-card']) {
    assert.deepEqual(env.language.definition(path.join(env.root, 'index.wxml'), files['index.wxml'].indexOf(name) + 1), [])
  }
  env.definition('index.wxml', 'loop-card', 'loop/a.ts')
})


test('WXML 属性悬浮显示声明注释、实际类型和默认值，支持 kebab-case 与 model', async () => {
  const files = {
    'index.json': '{"usingComponents":{"my-card":"./card"}}',
    'card.ts': `Component({ properties: {
      /** 主标题。\n       * 支持多行说明。\n       * @example 今天的训练 */
      headingText: { type: String, value: '标题' },
      // 是否启用卡片。
      enabled: Boolean,
    } })`,
    'index.wxml': '<my-card heading-text="{{title}}" model:enabled="{{active}}"/>',
  }
  const env = await fixture(files)
  const file = path.join(env.root, 'index.wxml')
  const hover = env.language.hover(file, files['index.wxml'].indexOf('heading-text') + 2)
  assert.equal(hover.property.type, 'string')
  assert.match(hover.property.documentation, /主标题。\n支持多行说明。\n@example 今天的训练/)
  assert.equal(hover.property.defaultValue, "'标题'")
  assert.equal(hover.attribute.name, 'heading-text')
  const enabled = env.language.hover(file, files['index.wxml'].indexOf('model:enabled') + 8)
  assert.equal(enabled.property.type, 'boolean')
  assert.equal(enabled.property.documentation, '是否启用卡片。')
  assert.equal(env.language.hover(file, files['index.wxml'].indexOf('title') + 1), undefined)
  env.definition('index.wxml', 'heading-text', 'card.ts', 'headingText')
})

test('属性注释穿透 npm、Behavior 和对象展开，本地定义覆盖继承声明', async () => {
  const files = {
    'node_modules/ui/package.json': '{"name":"ui","miniprogram":"src"}',
    'node_modules/ui/src/shared.ts': `export const props = {
      /** 继承的数量。 */ count: { type: Number, value: 0 },
      /** 继承的标题。 */ title: String,
    };`,
    'node_modules/ui/src/base.ts': 'import { props } from "./shared"; export default Behavior({ properties: { ...props } })',
    'node_modules/ui/src/middle.ts': 'import base from "./base"; export default Behavior({ behaviors: [base] })',
    'node_modules/ui/src/card/index.ts': `import middle from "../middle"; Component({ behaviors: [middle], properties: {
      /** 本地标题是否展示。 */ title: Boolean,
    } })`,
    'index.json': '{"usingComponents":{"my-card":"ui/card"}}',
    'index.wxml': '<my-card count="2" title="true"/>',
  }
  const env = await fixture(files)
  const file = path.join(env.root, 'index.wxml')
  const count = env.language.hover(file, files['index.wxml'].indexOf('count'))
  assert.equal(count.property.type, 'number')
  assert.equal(count.property.documentation, '继承的数量。')
  assert.ok(count.property.file.endsWith('shared.ts'))
  const title = env.language.hover(file, files['index.wxml'].indexOf('title'))
  assert.equal(title.property.type, 'boolean')
  assert.equal(title.property.documentation, '本地标题是否展示。')
})

test('属性类型识别构造器别名、optionalTypes、泛型断言及任意类型', async () => {
  const files = {
    'types.ts': 'export const Text = String; export const Options = Object as PropType<{ id: number }>',
    'card.ts': `import { Text, Options } from './types'; Component({ properties: {
      value: { type: Text, optionalTypes: [Number, Boolean], value: '' },
      options: Options,
      items: { type: Array as PropType<Item[]>, value: [] },
      detail: Object as () => Details,
      anything: null,
      array: Array,
      object: Object,
      missing: runtimeConstructor(),
    } })`,
    'index.json': '{"usingComponents":{"my-card":"./card"}}',
    'index.wxml': '<my-card value options items detail anything array object missing/>',
  }
  const env = await fixture(files)
  for (const [name, expected] of Object.entries({ value: 'string | number | boolean', options: '{ id: number }', items: 'Item[]', detail: 'Details', anything: 'any', array: 'unknown[]', object: 'object', missing: 'unknown' })) {
    const hover = env.language.hover(path.join(env.root, 'index.wxml'), files['index.wxml'].indexOf(name))
    assert.equal(hover.property.type, expected, name)
  }
})

test('未保存属性说明立即参与悬浮，原生属性和未知字段不显示误导信息', async () => {
  const files = {
    'card.ts': 'Component({ properties: { count: Number } })',
    'index.json': '{"usingComponents":{"my-card":"./card"}}',
    'index.wxml': '<my-card count="{{count}}" unknown=""/><view class="card"/>',
  }
  const env = await fixture(files, { 'card.ts': 'Component({ properties: { /** 新的数量说明。 */ count: String } })' })
  const file = path.join(env.root, 'index.wxml')
  const hover = env.language.hover(file, files['index.wxml'].indexOf('count'))
  assert.equal(hover.property.type, 'string')
  assert.equal(hover.property.documentation, '新的数量说明。')
  for (const name of ['unknown', 'class']) assert.equal(env.language.hover(file, files['index.wxml'].indexOf(name)), undefined)
})

test('真实 page-header 包中导入的 properties 提供原始中文注释与类型', async () => {
  const text = '<page-header title="示例" auto-back="{{true}}"/>'
  const { root, language } = await componentFixture({ 'index.wxml': text })
  const file = path.join(root, 'index.wxml')
  const hover = language.hover(file, text.indexOf('title'))
  assert.equal(hover.property.type, 'string')
  assert.match(hover.property.documentation, /主标题、副标题与日期/)
  assert.ok(hover.property.file.endsWith('page-header/properties.ts'))
  assert.equal(language.hover(file, text.indexOf('auto-back')).property.type, 'boolean')
})

test('源码根外组件按应用包和工作区根定位，不依赖仓库名称', async () => {
  const files = {
    'app.config.ts': null,
    'pnpm-workspace.yaml': 'packages: ["applications/*"]',
    'applications/mini/package.json': '{"name":"mini"}',
    'applications/mini/source/app.json': '{}',
    'applications/mini/source/index.json': '{"usingComponents":{"external-card":"/resources/card","shared-card":"/shared/card"}}',
    'applications/mini/source/index.wxml': '<external-card/><shared-card/>',
    'applications/mini/resources/card.ts': 'Component({})',
    'shared/card.ts': 'Component({})',
  }
  const env = await fixture(files)
  const file = path.join(env.root, 'applications/mini/source/index.wxml')
  const language = new Language(new Project(file))
  for (const [name, target] of [['external-card', 'applications/mini/resources/card.ts'], ['shared-card', 'shared/card.ts']])
    assert.equal(path.relative(env.root, language.definition(file, files['applications/mini/source/index.wxml'].indexOf(name) + 1)[0].file), target)
})

test('编译后的组件与 mixin 工厂穿透逗号调用、require 和 d.ts，保留注释与类型', async () => {
  const files = {
    'index.json': '{"usingComponents":{"vendor-popup":"./vendor/popup"}}',
    'index.wxml': '<vendor-popup title="弹层" show="{{true}}"/>',
    'vendor/popup.js': 'var component_1 = require("./component"); var transition_1 = require("./transition"); (0, component_1.VantComponent)({ mixins: [(0, transition_1.transition)(false)], props: { /** 弹层标题。 */ title: String } });',
    'vendor/component.js': 'exports.VantComponent = void 0; function VantComponent(options) { Component(options) } exports.VantComponent = VantComponent;',
    'vendor/transition.d.ts': 'export declare function transition(show: boolean): any;',
    'vendor/transition.js': 'exports.transition = void 0; function transition(value) { return Behavior({ properties: { /** 控制弹层显隐。 */ show: { type: Boolean, value } } }) } exports.transition = transition;',
  }
  const env = await fixture(files)
  const target = env.definition('index.wxml', 'vendor-popup', 'vendor/popup.js')
  assert.equal(target.start, files['vendor/popup.js'].indexOf('component_1.VantComponent'))
  for (const [name, type, description] of [['title', 'string', '弹层标题。'], ['show', 'boolean', '控制弹层显隐。']]) {
    const hover = env.language.hover(path.join(env.root, 'index.wxml'), files['index.wxml'].indexOf(name + '=') + 1)
    assert.equal(hover?.property.type, type)
    assert.equal(hover?.property.documentation, description)
  }
})

test('构建配置按静态路径函数和复制规则回溯组件，忽略无关同名文件', async () => {
  const files = {
    'package.json': '{"name":"copy-demo"}',
    'webpack/webpack.config.js': 'const path = require("path"); const locate = value => path.resolve(__dirname, "..", value); module.exports = { output: { path: locate("output") }, resolve: { alias: { "@cards": locate("vendor/source") } }, plugins: [new CopyPlugin({ patterns: [{ from: locate("vendor/source"), to: "widgets" }] })] };',
    'index.json': '{"usingComponents":{"copied-card":"/widgets/card","alias-card":"@cards/card"}}',
    'index.wxml': '<copied-card/><alias-card/>',
    'vendor/source/card.ts': 'Component({})',
    'unrelated/card.ts': 'Component({})',
  }
  const env = await fixture(files)
  env.definition('index.wxml', 'copied-card', 'vendor/source/card.ts')
  env.definition('index.wxml', 'alias-card', 'vendor/source/card.ts')
})

test('配置导入、字符串模板、复制 glob 与 context 可组合推断输出路径', async () => {
  const env = await fixture({
    'package.json': '{"name":"glob-demo"}',
    'config/paths.ts': 'import path from "node:path"; export const locate = (value: string) => path.join(__dirname, "..", value);',
    'config/index.ts': 'import { locate } from "./paths"; const prefix = "ui"; export default { outputRoot: locate("build"), copy: { patterns: [{ context: locate("assets"), from: `ui/**/*.js`, to: "published" }] } };',
    'index.json': '{"usingComponents":{"glob-card":"/published/ui/card"}}',
    'index.wxml': '<glob-card/>',
    'assets/ui/card.js': 'Component({})',
  })
  env.definition('index.wxml', 'glob-card', 'assets/ui/card.js')
})

test('动态和冲突的构建映射不猜测，手动别名可消除歧义且优先于 npm', async () => {
  const files = {
    'package.json': '{"name":"ambiguous-demo"}',
    'build.config.js': 'module.exports = { outputRoot: "output", alias: { "@card": ["./one/card", "./two/card"] }, copy: { patterns: [{ from: "one", to: "widgets" }, { from: "two", to: "widgets" }, { from: process.env.COMPONENT_DIR, to: "dynamic" }] } };',
    'index.json': '{"usingComponents":{"ambiguous-card":"/widgets/card","dynamic-card":"/dynamic/card","alias-card":"@card"}}',
    'index.wxml': '<ambiguous-card/><dynamic-card/><alias-card/>',
    'one/card.ts': 'Component({})',
    'two/card.ts': 'Component({})',
    'node_modules/@card/package.json': '{"name":"@card","main":"index.js"}',
    'node_modules/@card/index.js': 'Component({})',
  }
  const env = await fixture(files)
  assert.equal(env.language.scripts.components(path.join(env.root, 'index.wxml')).size, 0)
  const language = new Language(new Project(path.join(env.root, 'index.wxml'), { componentAliases: { '@card': [path.join(env.root, 'two/card')] } }))
  assert.equal(language.scripts.components(path.join(env.root, 'index.wxml')).get('alias-card'), path.join(env.root, 'two/card.ts'))
})

test('JavaScript/CommonJS 配置、磁盘绝对路径与额外组件根共用标准注册解析', async () => {
  const env = await fixture({
    'index.config.cjs': 'const registry = { "extra-card": "/card" }; module.exports = { usingComponents: registry };',
    'index.wxml': '<extra-card/>',
    'external/card.ts': 'Component({})',
  })
  const project = new Project(path.join(env.root, 'index.wxml'), { componentRoots: [path.join(env.root, 'external')] })
  assert.equal(new Language(project).scripts.components(path.join(env.root, 'index.wxml')).get('extra-card'), path.join(env.root, 'external/card.ts'))
  assert.equal(project.component(path.join(env.root, 'external/card'), project.entry), path.join(env.root, 'external/card.ts'))
  assert.equal(project.component(new URL('file://' + path.join(env.root, 'external/card')).href, project.entry), path.join(env.root, 'external/card.ts'))
})

test('配置里的 Node 路径导入别名和 ESM URL 可解析，同名业务函数不能冒充路径函数', async () => {
  const env = await fixture({
    'package.json': '{"name":"esm-config-demo"}',
    'vite.config.mjs': 'import { resolve as resolvePath } from "node:path"; import { fileURLToPath as urlPath } from "node:url"; const directory = urlPath(new URL(".", import.meta.url)); function join() { return unknownRuntimeValue } export default { resolve: { alias: [{ find: "@mapped", replacement: resolvePath(directory, "external") }, { find: "@unknown", replacement: join("external") }] } };',
    'index.json': '{"usingComponents":{"mapped-card":"@mapped/card","unknown-card":"@unknown/card"}}',
    'index.wxml': '<mapped-card/><unknown-card/>',
    'external/card.ts': 'Component({})',
  })
  env.definition('index.wxml', 'mapped-card', 'external/card.ts')
  assert.equal(env.language.scripts.components(path.join(env.root, 'index.wxml')).has('unknown-card'), false)
})

test('工程自定义注册函数沿实现识别 Component，不依赖函数名且跳过未调用的闭包', async () => {
  const files = {
    'index.json': '{"usingComponents":{"wrapped-card":"./card"}}',
    'index.wxml': '<wrapped-card/>',
    'base.ts': 'export function createWidget(options) { return Component(options) }',
    'wrapper.ts': 'import { createWidget } from "./base"; export const assemble = (options) => createWidget(options);',
    'card.ts': 'import { assemble } from "./wrapper"; const unused = () => Component({}); assemble({ properties: { title: String } });',
  }
  const env = await fixture(files)
  const target = env.definition('index.wxml', 'wrapped-card', 'card.ts')
  assert.equal(target.start, files['card.ts'].indexOf('assemble({'))
  assert.equal(target.length, 'assemble'.length)
})
