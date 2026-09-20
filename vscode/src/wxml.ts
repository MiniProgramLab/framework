// SPDX-License-Identifier: Apache-2.0
/** 属性与标签的偏移用于未完成输入时的补全和定义定位。 */
export interface Attribute { name: string; start: number; valueStart: number; valueEnd: number; value: string }
/** 标签扫描结果保留首尾位置，允许没有闭合尖括号的输入。 */
export interface Tag { name: string; start: number; nameStart: number; end: number; closing: boolean; selfClosing: boolean; attributes: Attribute[] }

/** 按引号扫描 WXML，插值中的 > 不会提前终止标签。 */
export function tags(text: string): Tag[] {
  const result: Tag[] = []
  const pattern = /<!--[^]*?-->|<\/?([\w:-]+)/g
  for (let match; (match = pattern.exec(text));) {
    if (!match[1]) continue
    const start = match.index
    let offset = pattern.lastIndex
    const attributes: Attribute[] = []
    while (offset < text.length) {
      while (/\s/.test(text[offset] ?? '') && offset < text.length) offset++
      if (text[offset] === '>' || text[offset] === '<' || (text[offset] === '/' && text[offset + 1] === '>')) break
      const attribute = /^[\w:@-]+/.exec(text.slice(offset))
      if (!attribute) { offset++; continue }
      const attributeStart = offset
      const name = attribute[0]
      offset += name.length
      while (/\s/.test(text[offset] ?? '') && offset < text.length) offset++
      let valueStart = offset
      let valueEnd = offset
      if (text[offset] === '=') {
        offset++
        while (/\s/.test(text[offset] ?? '') && offset < text.length) offset++
        const quote = text[offset]
        if (quote === '"' || quote === "'") {
          valueStart = ++offset
          while (offset < text.length && text[offset] !== quote) offset++
          valueEnd = offset
          if (offset < text.length) offset++
        } else {
          valueStart = offset
          while (offset < text.length && !/[\s>]/.test(text[offset])) offset++
          valueEnd = offset
        }
      }
      attributes.push({ name, start: attributeStart, valueStart, valueEnd, value: text.slice(valueStart, valueEnd) })
    }
    const selfClosing = text.slice(offset, offset + 2) === '/>'
    result.push({ name: match[1], start, nameStart: start + (text[start + 1] === '/' ? 2 : 1), end: offset + (selfClosing ? 2 : text[offset] === '>' ? 1 : 0), closing: text[start + 1] === '/', selfClosing, attributes })
    pattern.lastIndex = Math.max(offset, pattern.lastIndex)
  }
  return result
}

/** 读取当前位置的变量访问链，只保留点击位置之前的属性层级。 */
export function expressionAt(text: string, offset: number): { name: string; path: string[]; start: number; end: number } | undefined {
  let start = offset
  let end = offset
  while (start > 0 && /[\w$]/.test(text[start - 1])) start--
  while (end < text.length && /[\w$]/.test(text[end])) end++
  const name = text.slice(start, end)
  if (!name) return undefined
  const prefix = /(?:[\w$]+(?:\[[^\]\n]*\])?\s*\??\.\s*)*$/.exec(text.slice(0, start))?.[0] ?? ''
  const chain = (prefix + name).replace(/\[[^\]]*\]/g, '').split(/\s*\??\.\s*/)
  return { name, path: chain, start, end }
}

/** 将 wx:for 的局部 item 映射回数据字段，避免跳到不相关的同名变量。 */
export function loopBinding(text: string, offset: number, name: string): { path?: string[]; start: number; length: number } | undefined {
  const stack: Tag[] = []
  for (const tag of tags(text)) {
    if (tag.start > offset) break
    if (tag.closing) {
      const index = stack.map((item) => item.name).lastIndexOf(tag.name)
      if (index >= 0) stack.splice(index)
    } else if (!tag.selfClosing || offset <= tag.end) stack.push(tag)
  }
  for (const tag of stack.reverse()) {
    const each = tag.attributes.find((attribute) => attribute.name === 'wx:for')
    if (!each) continue
    const item = tag.attributes.find((attribute) => attribute.name === 'wx:for-item')
    const index = tag.attributes.find((attribute) => attribute.name === 'wx:for-index')
    if (name === (index?.value || 'index')) return { start: index?.valueStart ?? each.start, length: index?.value.length ?? each.name.length }
    if (name === (item?.value || 'item')) {
      const match = /^\s*{{\s*([\w$.]+)\s*}}\s*$/.exec(each.value)
      return { path: match?.[1].split('.'), start: item?.valueStart ?? each.valueStart, length: item?.value.length ?? each.value.length }
    }
  }
  return undefined
}
