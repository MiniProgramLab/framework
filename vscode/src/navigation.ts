// SPDX-License-Identifier: Apache-2.0
import * as vscode from 'vscode'

/** 一次定义查询的目标，只有实际选中目标后才允许滚动。 */
interface PendingNavigation {
  locations: readonly vscode.Location[]
  expires: number
}

/** 保留原生 Cmd+点击/F12，只在导航完成时把对应声明置于视口中部。 */
export class DefinitionNavigation implements vscode.Disposable {
  private pending?: PendingNavigation
  private timer?: ReturnType<typeof setTimeout>
  private readonly subscriptions: vscode.Disposable[]

  /** 同文件跳转监听选区变化，新文件及旁侧打开同时监听活动编辑器。 */
  constructor() {
    this.subscriptions = [
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.kind === vscode.TextEditorSelectionChangeKind.Mouse || event.kind === vscode.TextEditorSelectionChangeKind.Keyboard) {
          this.clear()
          return
        }
        this.schedule(event.textEditor)
      }),
      vscode.window.onDidChangeActiveTextEditor((editor) => { if (editor) this.schedule(editor) }),
    ]
  }

  /** 悬浮也可能触发定义查询，这里只登记位置，不打开文件或滚动。 */
  remember(document: vscode.TextDocument, locations: readonly vscode.Location[]): void {
    this.clear()
    if (!vscode.workspace.getConfiguration('skylineMiniapp', document.uri).get('centerDefinitions', true)) return
    if (vscode.window.activeTextEditor?.document.uri.toString() !== document.uri.toString() || !locations.length) return
    this.pending = { locations, expires: Date.now() + 10_000 }
  }

  /** 必须命中刚解析的声明选区；普通切换文件和手动移动光标不触发。 */
  private target(editor: vscode.TextEditor, navigation: PendingNavigation): vscode.Location | undefined {
    if (Date.now() > navigation.expires || editor !== vscode.window.activeTextEditor || editor.selections.length !== 1) return undefined
    return navigation.locations.find((location) => location.uri.toString() === editor.document.uri.toString()
      && location.range.contains(editor.selection.active))
  }

  /** 等待原生导航完成初始滚动，再执行一次居中；执行前重新核对选区。 */
  private schedule(editor: vscode.TextEditor): void {
    const navigation = this.pending
    if (!navigation || !this.target(editor, navigation)) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (this.pending !== navigation) return
      const target = this.target(editor, navigation)
      this.pending = undefined
      if (target) editor.revealRange(target.range, vscode.TextEditorRevealType.InCenter)
    }, 40)
  }

  /** 用户继续编辑或新查询到来时，撤销上一轮尚未执行的滚动。 */
  private clear(): void {
    this.pending = undefined
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }

  /** 扩展卸载时释放编辑器事件和短时任务。 */
  dispose(): void {
    this.clear()
    for (const subscription of this.subscriptions) subscription.dispose()
  }
}
