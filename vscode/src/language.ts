import path from 'node:path'
import { Project, type SymbolLocation } from './project'
import { Scripts } from './scripts'
import { Styles } from './styles'
import { expressionAt, loopBinding, tags, type Attribute } from './wxml'

/** 补全条目与编辑器解耦，方便验证实际解析结果。 */
export interface Suggestion { label: string; kind: SymbolLocation['kind'] | 'tag' | 'attribute'; detail?: string; insert?: string; start?: number; end?: number }

/** 悬浮内容保留原始声明，Markdown 由编辑器层安全渲染。 */
export interface PropertyHover { component: string; attribute: Attribute; property: SymbolLocation }

/** WXML 原生标签的常用属性，与公共属性合并后提供补全。 */
const nativeAttributes: Record<string, string[]> = {
  view: ['hover-class', 'hover-start-time', 'hover-stay-time', 'hover-stop-propagation'],
  text: ['selectable', 'user-select', 'space', 'decode', 'max-lines', 'overflow'],
  image: ['src', 'mode', 'lazy-load', 'show-menu-by-longpress', 'bindload', 'binderror', 'fade-in'],
  'scroll-view': ['scroll-x', 'scroll-y', 'scroll-top', 'scroll-left', 'scroll-into-view', 'scroll-with-animation', 'enhanced', 'type', 'enable-flex', 'show-scrollbar', 'refresher-enabled', 'refresher-triggered', 'bindscroll', 'bindscrolltolower', 'bindscrolltoupper', 'bindrefresherrefresh'],
  button: ['type', 'size', 'plain', 'disabled', 'loading', 'form-type', 'open-type'],
  input: ['value', 'type', 'password', 'placeholder', 'placeholder-class', 'disabled', 'maxlength', 'focus', 'confirm-type', 'bindinput', 'bindfocus', 'bindblur', 'bindconfirm'],
  textarea: ['value', 'placeholder', 'placeholder-class', 'disabled', 'maxlength', 'auto-height', 'focus', 'bindinput', 'bindfocus', 'bindblur', 'bindconfirm'],
  navigator: ['url', 'open-type', 'delta', 'target', 'app-id', 'path', 'extra-data'],
  swiper: ['indicator-dots', 'autoplay', 'interval', 'duration', 'circular', 'current', 'vertical', 'bindchange'],
  'swiper-item': ['item-id', 'skip-hidden-item-layout'],
  picker: ['mode', 'range', 'range-key', 'value', 'disabled', 'bindchange', 'bindcancel'],
  'picker-view': ['value', 'indicator-style', 'indicator-class', 'bindchange'],
  'picker-view-column': [], switch: ['checked', 'disabled', 'type', 'color', 'bindchange'],
  slider: ['min', 'max', 'step', 'disabled', 'value', 'show-value', 'bindchange', 'bindchanging'],
  checkbox: ['value', 'disabled', 'checked', 'color'], radio: ['value', 'checked', 'disabled', 'color'],
  'checkbox-group': ['bindchange'], 'radio-group': ['bindchange'], form: ['bindsubmit', 'bindreset'],
  label: ['for'], icon: ['type', 'size', 'color'], progress: ['percent', 'show-info', 'stroke-width', 'activeColor', 'backgroundColor'],
  'rich-text': ['nodes', 'space', 'user-select'], canvas: ['type', 'canvas-id', 'disable-scroll'],
  video: ['src', 'poster', 'controls', 'autoplay', 'loop', 'muted', 'object-fit', 'bindplay', 'bindpause', 'bindended'],
  map: ['longitude', 'latitude', 'scale', 'markers', 'polylines', 'bindmarkertap'],
  camera: ['device-position', 'flash', 'binderror'], 'web-view': ['src', 'bindmessage', 'bindload', 'binderror'],
  'cover-view': ['scroll-top'], 'cover-image': ['src'], 'page-container': ['show', 'duration', 'z-index', 'overlay', 'position', 'bindbeforeenter', 'bindafterleave'],
  'root-portal': ['enable'], 'share-element': ['key', 'transform', 'duration'], 'sticky-section': [], 'sticky-header': [],
  'grid-view': ['type', 'cross-axis-count', 'cross-axis-gap', 'main-axis-gap', 'padding'], 'list-view': [],
  'draggable-sheet': ['initial-child-size', 'min-child-size', 'max-child-size', 'snap', 'snap-sizes'],
  'span': [], 'open-container': ['closed-color', 'open-color', 'transition-type', 'transition-duration'],
  'tap-gesture-handler': ['tag', 'worklet:ontap', 'worklet:should-accept-gesture'],
  'pan-gesture-handler': ['tag', 'worklet:on-gesture-event', 'worklet:should-accept-gesture', 'worklet:should-response-to-move'],
  'long-press-gesture-handler': ['tag', 'worklet:on-gesture-event', 'min-duration'],
  'horizontal-drag-gesture-handler': ['tag', 'worklet:on-gesture-event'],
  'vertical-drag-gesture-handler': ['tag', 'worklet:on-gesture-event'],
  block: [], template: ['is', 'name', 'data'], import: ['src'], include: ['src'], wxs: ['src', 'module'], slot: ['name'],
  'movable-area': ['scale-area'], 'movable-view': ['direction', 'x', 'y', 'inertia', 'disabled', 'out-of-bounds', 'damping', 'friction', 'bindchange'],
  'match-media': ['min-width', 'max-width', 'width', 'min-height', 'max-height', 'height', 'orientation'],
}
/** 各原生及自定义节点都可使用的公共属性。 */
const commonAttributes = ['id', 'class', 'style', 'hidden', 'slot', 'mark:', 'data-', 'wx:if', 'wx:elif', 'wx:else', 'wx:for', 'wx:for-item', 'wx:for-index', 'wx:key', 'bindtap', 'catchtap', 'bind:tap', 'catch:tap', 'bindtouchstart', 'bindtouchmove', 'bindtouchend', 'bindtouchcancel', 'bindlongpress', 'capture-bind:tap', 'capture-catch:tap']

/** 一次请求统一使用脚本、模板及样式索引。 */
export class Language {
  readonly scripts: Scripts
  readonly styles: Styles

  /** 创建轻量请求对象，缓冲区内容由 Project 统一提供。 */
  constructor(readonly project: Project) {
    this.scripts = new Scripts(project)
    this.styles = new Styles(project)
  }

  /** 仅在自定义组件的属性名上显示说明，不覆盖属性值中的变量悬浮。 */
  hover(file: string, offset: number): PropertyHover | undefined {
    if (!file.endsWith('.wxml')) return undefined
    const tag = tags(this.project.read(file) ?? '').find((item) => !item.closing && offset >= item.start && offset < item.end)
    const attribute = tag?.attributes.find((item) => offset >= item.start && offset < item.start + item.name.length)
    if (!tag || !attribute) return undefined
    const component = this.scripts.components(file).get(tag.name)
    if (!component) return undefined
    const name = attribute.name.replace(/^model:/, '')
    const property = this.scripts.members(component).find((symbol) => symbol.kind === 'property' && symbol.path?.length === 1
      && (symbol.name === name || symbol.name.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase()) === name))
    return property && { component: tag.name, attribute, property }
  }

  /** 查找模板绑定的脚本定义，循环局部变量指向 wx:for 声明。 */
  private scriptDefinition(file: string, text: string, offset: number): SymbolLocation[] {
    const token = expressionAt(text, offset)
    const script = this.project.sibling(file, ['.ts', '.js', '.tsx'])
    if (!token || !script) return []
    const binding = loopBinding(text, offset, token.path[0])
    if (binding && token.path.length === 1) return [{ file, name: token.name, start: binding.start, length: binding.length, kind: 'variable' }]
    const wanted = binding?.path ? [...binding.path, ...token.path.slice(1)] : token.path
    const members = this.scripts.members(script)
    return members.filter((symbol) => symbol.path?.join('.') === wanted.join('.'))
  }

  /** WXML 标签、事件、表达式和 class 分别进入对应依赖图。 */
  definition(file: string, offset: number): SymbolLocation[] {
    if (/\.(scss|less|wxss|css)$/.test(file)) return this.styles.definition(file, offset)
    const text = this.project.read(file) ?? ''
    const tag = tags(text).find((item) => offset >= item.start && offset <= item.end)
    if (tag && offset >= tag.nameStart && offset <= tag.nameStart + tag.name.length) {
      const target = this.scripts.components(file).get(tag.name)
      return target ? [this.scripts.componentDefinition(target, tag.name)] : []
    }
    const property = this.hover(file, offset)?.property
    if (property) return [property]
    const attribute = tag?.attributes.find((item) => offset >= item.valueStart && offset <= item.valueEnd)
    const expressionStart = text.lastIndexOf('{{', offset)
    const inExpression = expressionStart > text.lastIndexOf('}}', offset) && text.indexOf('}}', offset) >= 0
    if (inExpression) return this.scriptDefinition(file, text, offset)
    if (attribute && /^(?:class|hover-class|[\w-]+-class)$/.test(attribute.name)) {
      const start = text.slice(attribute.valueStart, offset).search(/[\w-]*$/) + attribute.valueStart
      const end = offset + (/^[\w-]*/.exec(text.slice(offset))?.[0].length ?? 0)
      const name = text.slice(start, end)
      return this.styles.classes(file).filter((symbol) => symbol.name === name)
    }
    if (attribute && /^(?:(?:capture-)?(?:bind|catch)|worklet:)/.test(attribute.name)) return this.scriptDefinition(file, text, offset)
    if (attribute?.name === 'src') {
      const target = path.resolve(path.dirname(file), attribute.value)
      if (this.project.exists(target)) return [{ file: target, start: 0, length: 0, name: attribute.value, kind: 'file' }]
    }
    return []
  }

  /** 根据当前标签和属性提供原生、组件属性、类名及绑定符号补全。 */
  completion(file: string, offset: number): Suggestion[] {
    const text = this.project.read(file) ?? ''
    const before = text.slice(0, offset)
    const script = this.project.sibling(file, ['.ts', '.js', '.tsx'])
    const tag = tags(text).find((item) => offset >= item.start && offset <= item.end)
    const attribute = tag?.attributes.find((item) => offset >= item.valueStart && offset <= item.valueEnd && item.valueStart > item.start + item.name.length)
    const token = expressionAt(text, offset)
    const expression = before.lastIndexOf('{{') > before.lastIndexOf('}}')
    if (expression || (attribute && /^(?:(?:capture-)?(?:bind|catch)|worklet:)/.test(attribute.name))) {
      const parent = /([\w$.]+)\.$/.exec(before)?.[1] || (token && token.path.length > 1 ? token.path.slice(0, -1).join('.') : '')
      const symbols = script ? this.scripts.members(script) : []
      return symbols.filter((symbol) => symbol.path?.slice(0, -1).join('.') === parent && (expression || symbol.kind === 'method'))
        .map((symbol) => ({ label: symbol.name, kind: symbol.kind, detail: path.basename(symbol.file), start: token?.start ?? offset, end: token?.end ?? offset }))
    }
    if (attribute && /^(?:class|hover-class|[\w-]+-class)$/.test(attribute.name)) {
      const start = offset - (/[-\w]*$/.exec(before)?.[0].length ?? 0)
      return [...new Map(this.styles.classes(file).map((symbol) => [symbol.name, symbol])).values()]
        .map((symbol) => ({ label: symbol.name, kind: 'class', detail: path.basename(symbol.file), start, end: offset }))
    }
    if (/<\/?[\w:-]*$/.test(before)) {
      const start = offset - (/[\w:-]*$/.exec(before)?.[0].length ?? 0)
      return [...new Set([...Object.keys(nativeAttributes), ...this.scripts.components(file).keys()])]
        .map((label) => ({ label, kind: 'tag', start, end: offset }))
    }
    if (attribute) {
      const values = attribute.name === 'mode' && tag?.name === 'image'
        ? ['scaleToFill', 'aspectFit', 'aspectFill', 'widthFix', 'heightFix', 'center']
        : ['true', 'false']
      return values.map((label) => ({ label, kind: 'variable', start: attribute.valueStart, end: attribute.valueEnd }))
    }
    if (!tag || tag.closing) return []
    const component = this.scripts.components(file).get(tag.name)
    const properties = component ? this.scripts.members(component).filter((symbol) => symbol.kind === 'property' && symbol.path?.length === 1).map((symbol) => symbol.name.replace(/[A-Z]/g, (character) => '-' + character.toLowerCase())) : []
    const current = /[\w:@-]*$/.exec(before)?.[0] ?? ''
    return [...new Set([...commonAttributes, ...(nativeAttributes[tag.name] ?? []), ...properties])]
      .filter((name) => !tag.attributes.some((item) => item.name === name && !(offset >= item.start && offset <= item.start + item.name.length)))
      .map((label) => ({ label, kind: 'attribute', insert: label + '="$1"', start: offset - current.length, end: offset }))
  }
}
