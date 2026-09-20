// SPDX-License-Identifier: Apache-2.0
import type { NativeConfig } from './types.js'
/** 纯 Skyline 构建约束；监听模式同样校验，避免跳过类型检查后混入其他渲染器。 */

/** 检查固定配置值，错误信息指向需要修改的源文件。 */
function expectValue(actual: unknown, expected: unknown, field: string, filename: string) {
  if (actual !== expected)
    throw new Error(
      '纯 Skyline 要求 ' +
        field +
        '=' +
        JSON.stringify(expected) +
        '：' +
        filename,
    )
}

/** 校验应用渲染器、组件框架、按需加载和灰度区间。 */
export function validateSkylineApp(config: NativeConfig, filename: string) {
  expectValue(config.renderer, 'skyline', 'renderer', filename)
  expectValue(
    config.componentFramework,
    'glass-easel',
    'componentFramework',
    filename,
  )
  expectValue(
    config.lazyCodeLoading,
    'requiredComponents',
    'lazyCodeLoading',
    filename,
  )
  expectValue(
    config.window?.navigationStyle,
    'custom',
    'window.navigationStyle',
    filename,
  )
  if (config.window?.enablePullDownRefresh === true)
    throw new Error('Skyline 下拉刷新请使用 scroll-view：' + filename)
  /** 固定布局语义和支持区间，避免不同环境或页面意外落入灰度。 */
  const expected = {
    defaultDisplayBlock: true,
    defaultContentBox: true,
    disableABTest: true,
    sdkVersionBegin: '3.0.0',
    sdkVersionEnd: '15.255.255',
  }
  for (const [key, value] of Object.entries(expected)) {
    expectValue(
      config.rendererOptions?.skyline?.[key],
      value,
      'rendererOptions.skyline.' + key,
      filename,
    )
  }
}

/** 拒绝本地配置切换渲染器或组件框架。 */
export function validateSkylineRenderer(config: NativeConfig, filename: string) {
  if (config.renderer !== undefined)
    expectValue(config.renderer, 'skyline', 'renderer', filename)
  if (config.componentFramework !== undefined)
    expectValue(
      config.componentFramework,
      'glass-easel',
      'componentFramework',
      filename,
    )
  if (config.rendererOptions !== undefined)
    throw new Error('rendererOptions 请统一写在 app.config.ts：' + filename)
}

/** 为每个自动发现的页面补齐 Skyline 配置，并拒绝相冲突的手工覆盖。 */
export function withSkylinePage(config: NativeConfig, filename: string) {
  validateSkylineRenderer(config, filename)
  if (config.navigationStyle !== undefined)
    expectValue(config.navigationStyle, 'custom', 'navigationStyle', filename)
  if (config.disableScroll !== undefined)
    expectValue(config.disableScroll, true, 'disableScroll', filename)
  if (config.enablePullDownRefresh === true)
    throw new Error('Skyline 下拉刷新请使用 scroll-view：' + filename)
  return {
    ...config,
    renderer: 'skyline',
    componentFramework: 'glass-easel',
    navigationStyle: 'custom',
    disableScroll: true,
  }
}

/** 开发者工具必须开启 Skyline 模拟和 worklet 编译。 */
export function validateSkylineProject(config: NativeConfig, filename: string) {
  expectValue(
    config.setting?.skylineRenderEnable,
    true,
    'setting.skylineRenderEnable',
    filename,
  )
  expectValue(
    config.setting?.compileWorklet,
    true,
    'setting.compileWorklet',
    filename,
  )
}
