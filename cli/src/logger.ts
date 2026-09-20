// SPDX-License-Identifier: Apache-2.0
/** 控制台消息等级及其终端颜色。 */
type LogLevel = 'info' | 'success' | 'warn' | 'error'

/** 短标签便于在无颜色终端和 CI 日志中区分构建阶段。 */
const levels: Record<LogLevel, { label: string; color: number }> = {
  info: { label: 'INFO', color: 36 },
  success: { label: 'SUCCESS', color: 32 },
  warn: { label: 'WARN', color: 33 },
  error: { label: 'ERROR', color: 31 },
}

/** 交互终端默认启用颜色；NO_COLOR、FORCE_COLOR 和 TERM 控制重定向行为。 */
export function supportsColor(stream: { isTTY?: boolean }): boolean {
  if (process.env.NO_COLOR !== undefined || process.env.FORCE_COLOR === '0') return false
  if (process.env.FORCE_COLOR !== undefined) return true
  return stream.isTTY === true && process.env.TERM !== 'dumb'
}

/** 仅给等级标签着色，保留路径、错误堆栈和构建结果的可读性。 */
export function formatLog(level: LogLevel, message: string, color: boolean): string {
  const { label, color: code } = levels[level]
  const prefix = color ? `\u001b[${code}m[${label}]\u001b[0m` : `[${label}]`
  return message.split(/\r?\n/).map((line) => `${prefix} ${line}`).join('\n')
}

/** 短任务使用毫秒，长任务使用秒，统一阶段与整轮构建的耗时格式。 */
export function formatDuration(milliseconds: number): string {
  return milliseconds < 1000 ? `${Math.round(milliseconds)} ms` : `${(milliseconds / 1000).toFixed(2)} s`
}

/** 将未知异常转换为可读文本，命令行入口可保留完整堆栈。 */
export function errorMessage(error: unknown, stack = false): string {
  return error instanceof Error ? (stack ? error.stack || error.message : error.message) : String(error)
}

/** 常规输出进入 stdout，警告和错误进入 stderr。 */
function write(level: LogLevel, message: string): void {
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout
  activeProgress?.clear()
  stream.write(formatLog(level, message, supportsColor(stream)) + '\n')
  activeProgress?.render()
}

/** 所有构建模块共用的彩色控制台入口。 */
export const logger = {
  /** 输出平台、环境及监听状态。 */
  info(message: string): void { write('info', message) },
  /** 输出已完成的构建结果。 */
  success(message: string): void { write('success', message) },
  /** 输出可恢复的异常。 */
  warn(message: string): void { write('warn', message) },
  /** 输出导致本轮构建失败的错误。 */
  error(message: string): void { write('error', message) },
}

/** 安全提取文件系统错误码，不假设抛出的值一定是 Error。 */
export function errorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code
  return undefined
}

/** 动画只占用一行；日志写入前清行，写入后继续绘制。 */
let activeProgress: BuildProgress | undefined

/** 所有终端保留相同阶段记录，交互终端额外绘制临时动画。 */
export class BuildProgress {
  /** 旋转动画帧。 */
  private readonly frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  /** 当前阶段开始时间与动画帧序号。 */
  private started = performance.now()
  private frame = 0
  /** 当前真实构建阶段。 */
  private stage = ''
  /** 动画定时器不延长进程生命周期。 */
  private timer: ReturnType<typeof setInterval> | undefined
  private stopped = false
  /** 仅交互终端显示动画，CI 和重定向输出保持逐行可读。 */
  private readonly animated: boolean

  /** 创建独立进度句柄，并清理此前未结束的动画。 */
  constructor(
    private readonly title: string,
    private readonly stream = process.stdout,
    private readonly errorStream = stream === process.stdout ? process.stderr : stream,
  ) {
    this.animated = stream.isTTY === true && process.env.TERM !== 'dumb' && !process.env.CI
    activeProgress?.stop()
    activeProgress = this
    if (this.animated) {
      this.timer = setInterval(() => this.render(), 80)
      this.timer.unref()
    }
  }

  /** 只在实际进入新阶段时更新状态，不显示估算完成百分比。 */
  update(stage: string): void {
    if (this.stopped || this.stage === stage) return
    if (this.stage) this.complete()
    this.stage = stage
    this.started = performance.now()
    this.stream.write(formatLog('info', this.title + ' · ' + stage, supportsColor(this.stream)) + '\n')
    this.render()
  }

  /** 成功后永久保留阶段、实际耗时及统计，不依赖动画回放。 */
  complete(details = ''): void {
    this.finish('success', details)
  }

  /** 失败阶段单独标红，后续错误详情由命令或监听入口输出。 */
  fail(): void {
    this.finish('error', '本阶段未完成')
  }

  /** 写入阶段结果前清除临时行，避免结果被下一帧覆盖。 */
  private finish(level: LogLevel, details: string): void {
    if (this.stopped || !this.stage) return
    this.clear()
    const message = `${this.title} · ${this.stage} · ${formatDuration(performance.now() - this.started)}${details ? ' · ' + details : ''}`
    this.stage = ''
    const stream = level === 'error' ? this.errorStream : this.stream
    stream.write(formatLog(level, message, supportsColor(stream)) + '\n')
  }

  /** 清除当前动画行，让普通日志和错误信息完整显示。 */
  clear(): void {
    if (this.animated && !this.stopped && this.stage) this.stream.write('\r\u001b[2K')
  }

  /** 以当前终端宽度绘制单行状态，避免窄终端产生滚屏。 */
  render(): void {
    if (!this.animated || this.stopped || !this.stage) return
    const elapsed = ((performance.now() - this.started) / 1000).toFixed(1)
    const text = `${this.frames[this.frame++ % this.frames.length]} ${this.title} › ${this.stage}  ${elapsed}s`
    let width = 0
    let visible = ''
    for (const character of text) {
      const size = character.charCodeAt(0) >= 0x2e80 ? 2 : 1
      if (width + size >= (this.stream.columns || 80) - 1) break
      visible += character
      width += size
    }
    const line = supportsColor(this.stream) ? `\u001b[36m${visible}\u001b[0m` : visible
    this.stream.write('\r\u001b[2K' + line)
  }

  /** 成功、失败和退出都清理动画，不改变用户的光标可见性。 */
  stop(): void {
    this.clear()
    this.stopped = true
    clearInterval(this.timer)
    if (activeProgress === this) activeProgress = undefined
  }
}
