/** 页头与页面容器共用属性，避免透传时默认值产生差异。 */
export const headerProperties = {
  /** 主标题、副标题与日期等辅助信息。 */
  title: { type: String, value: '' },
  subtitle: { type: String, value: '' },
  eyebrow: { type: String, value: '' },
  /** compact 为导航内标题，large 为导航下方大标题。 */
  variant: { type: String, value: 'compact' },
  /** 一级页面关闭返回按钮；表单可关闭自动返回以处理未保存内容。 */
  back: { type: Boolean, value: true },
  autoBack: { type: Boolean, value: true },
  /** 单页面入口没有上一页时，返回应用首页。 */
  homeUrl: { type: String, value: '' },
  /** 右侧文字操作只派发事件，具体行为由业务页面决定。 */
  actionText: { type: String, value: '' },
  actionDisabled: { type: Boolean, value: false },
  /** 大标题短色条：lime、blue、peach、lavender 或 none。 */
  accent: { type: String, value: 'lime' },
  /** 与页面画布保持一致，也允许业务页面传入其他纯色。 */
  background: { type: String, value: '#F7F8F2' },
}
