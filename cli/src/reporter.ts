// SPDX-License-Identifier: Apache-2.0
import path from 'node:path'
import { BuildProgress, formatDuration, logger } from './logger.js'
import type { BuildOptions } from './types.js'
import type { WatchTarget } from './watch.js'

/** 由实际编译结果产生的统计，不包含开发者工具私有配置。 */
export interface BuildSummary {
  /** 当前环境参与构建的页面数。 */
  pages: number
  /** 本地原生组件入口数。 */
  localComponents: number
  /** 可达 npm 组件入口数。 */
  npmComponents: number
  /** 生成的 JavaScript 文件数。 */
  scripts: number
  /** 开发构建生成的源码映射文件数。 */
  sourceMaps: number
  /** 实际产物文件数及字节数之和，包含源码映射。 */
  files: number
  bytes: number
}

/** 统一启动、重编译和监听信息，编译流程只提供事实与统计。 */
export class BuildReporter {
  /** 构建序号与整轮开始时间，方便连续监听时定位本轮结果。 */
  private sequence = 0
  private started = 0

  /** 每个项目使用独立报告实例。 */
  constructor(private readonly options: BuildOptions) {}

  /** 配置只在启动时完整列出，避免每次保存文件都重复刷屏。 */
  session(configExists: boolean): void {
    const { adapter, root, source, output, mode, watch, typecheck, configFile, projectConfig } = this.options
    logger.info('MiniProgramLab CLI · ' + (watch ? '开发监听' : '单次构建'))
    logger.info(`目标平台：${adapter.label}（${adapter.id}） · 构建环境：${mode}`)
    logger.info('项目目录：' + root)
    logger.info('源码目录：' + source)
    logger.info('产物目录：' + output)
    logger.info('构建配置：' + (configExists ? configFile : '使用默认配置（未找到 ' + configFile + '）'))
    logger.info('工程配置：' + path.resolve(root, projectConfig || adapter.projectFile))
    logger.info('TypeScript 类型检查：' + (typecheck ? '已启用' : '未启用，仅转译；可添加 --typecheck'))
    logger.info('脚本与 SCSS/Less 压缩：' + (mode === 'production' ? '已启用' : '未启用'))
  }

  /** 显示时间、构建序号与完整变更路径，区分首次编译和后续重编译。 */
  begin(changes: string[]): BuildProgress {
    this.sequence++
    this.started = performance.now()
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    logger.info(`第 ${this.sequence} 次构建 · ${time} · ${changes.length ? '文件变更触发' : '首次构建'}`)
    if (changes.length) {
      logger.info(`本轮合并 ${changes.length} 个变更路径：`)
      for (const filename of changes) logger.info('  ' + (path.relative(this.options.root, filename) || '.'))
    }
    return new BuildProgress(`${this.options.adapter.label} #${this.sequence}`)
  }

  /** 分行展示结果与路径，文件大小取自暂存产物的实际统计。 */
  success(summary: BuildSummary, hadPrivateConfig: boolean): void {
    const { adapter, output } = this.options
    logger.success(`${adapter.label}编译完成 · 第 ${this.sequence} 次构建 · 总耗时 ${formatDuration(performance.now() - this.started)}`)
    logger.success(`页面 ${summary.pages} 个 · 本地组件 ${summary.localComponents} 个 · npm 组件 ${summary.npmComponents} 个`)
    const size = summary.bytes < 1024 ? `${summary.bytes} B` : summary.bytes < 1024 ** 2
      ? `${(summary.bytes / 1024).toFixed(1)} KiB` : `${(summary.bytes / 1024 ** 2).toFixed(2)} MiB`
    logger.success(`JavaScript ${summary.scripts} 个 · Source Map ${summary.sourceMaps} 个`)
    logger.success(`产物 ${summary.files} 个文件 · 总大小 ${size}（不含私有配置）`)
    logger.info('输出目录：' + output)
    if (adapter.privateConfigFile) {
      logger.info(`私有配置：${adapter.privateConfigFile} · ${hadPrivateConfig ? '保留已有内容' : '首次初始化完成'}`)
    }
  }

  /** 失败仍保留阶段和总耗时，具体错误由调用方完整报告。 */
  failure(): void {
    logger.error(`${this.options.adapter.label}第 ${this.sequence} 次构建失败 · 总耗时 ${formatDuration(performance.now() - this.started)}`)
  }

  /** 列出真实监听范围和机制，避免把所有源码概括为少量扩展名。 */
  watching(targets: WatchTarget[], mode: 'native' | 'poll'): void {
    logger.info(`文件监听已启动 · ${mode === 'poll' ? '轮询（300 ms）' : '系统文件监听'} · ${targets.length} 个目录`)
    for (const target of targets) {
      logger.info('监听目录：' + target.directory + (target.recursive ? '（递归）' : '（仅环境文件、工程配置、package.json、tsconfig.json）'))
    }
    logger.info(`源码监听：TS/JS、${this.options.adapter.templateExtension} 模板、SCSS/Less/${this.options.adapter.styleExtension} 样式、页面与组件配置及静态资源`)
    logger.info('修改平台、--mode 或构建配置后需重启命令；按 Ctrl+C 结束监听。')
    this.waiting()
  }

  /** 每轮构建结束都明确回到等待状态，失败时也保持可恢复。 */
  waiting(): void {
    logger.info('等待文件变更；保存后自动重新构建。')
  }
}
