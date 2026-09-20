# Overlay components

[简体中文](README.md)

`overlay`, `popup`, and `action-sheet` belong to `@miniprogramlab/ui`. They share page-scoped stacking, visibility transitions, native animation resources, and background interaction isolation.

Register them through `libraryComponents` or their package paths in the [UI guide](../../README.en.md). Use framework page/component wrappers so ownership and Store connections are available to the internal adapters.

## Choosing a component

| Component | Use |
| --- | --- |
| `overlay` | A full-window mask with custom slot content |
| `popup` | A content panel with optional title, close button, body scrolling, and footer |
| `action-sheet` | A bottom menu with selectable options and an optional cancel action |

Panels and masks use separate native Portals while sharing one overlay record. Only the top active surface receives input. Transparent masks still intercept touches and keep background scrolling locked.

## Example

```ts
definePage({
  data: {
    dialogVisible: false,
    menuVisible: false,
    actions: [
      { label: 'Rename', value: 'rename' },
      { label: 'Delete', value: 'delete', tone: 'danger' },
    ],
  },
  methods: {
    /** 通过绑定的显隐字段打开弹窗。 */
    openDialog() {
      this.setData({ dialogVisible: true })
    },
    /** 使用当前选项列表打开操作菜单。 */
    openMenu() {
      this.setData({ menuVisible: true })
    },
    /** 正常退出后处理选中的业务值。 */
    onSelect(event: WechatMiniprogram.CustomEvent) {
      console.log(event.detail.value)
    },
  },
})
```

```xml
<page title="Overlay examples">
  <button bindtap="openDialog">Open dialog</button>
  <button bindtap="openMenu">Open menu</button>
  <popup
    slot="overlay"
    model:show="{{dialogVisible}}"
    title="Details"
    position="center"
    closable="{{true}}"
  >
    <view>Popup content</view>
  </popup>
  <action-sheet
    slot="overlay"
    model:show="{{menuVisible}}"
    title="Choose an action"
    actions="{{actions}}"
    cancel-text="Cancel"
    bindselect="onSelect"
  />
</page>
```

## Shared properties

Use kebab-case property names in WXML.

| Property | Default | Behavior |
| --- | --- | --- |
| `show` | `false` | Requested visibility; supports `model:show` |
| `position` | `center`; `bottom` for action sheets | Entry direction: center, bottom, top, left, or right; action sheets use the bottom presentation |
| `transparent` | `false` | Hide mask color while retaining interaction isolation |
| `close-on-mask` | `true` | Request closure when tapping the mask |
| `scrollable` | `true` | Use an internal scroll container for long content |
| `destroy-on-close` | `false` | Destroy content after exit instead of retaining its instance |
| `safe-area` | `false` for overlay; `true` for popup/action-sheet | Reserve appropriate navigation and device insets |

Popup adds `title` and `closable` (`false` by default), with a default content slot and a `footer` slot.

Action sheet adds `title`, `actions`, `cancel-text`, and `close-on-select` (`true` by default). An empty cancel label hides that action. Each option has `label`, a serializable `value`, optional `disabled`, and optional `tone: 'default' | 'danger'`.

## Events and closure

| Event | Meaning |
| --- | --- |
| `change` | Visibility synchronization with `{ show, reason }` |
| `opened` | The current entry animation completed |
| `closed` | The current exit completed, with its close reason |
| `error` | Native capability or animation failure, with a message |
| `select` | Action-sheet selection containing `{ value, index, action }` |

Close reasons include `programmatic`, `mask`, `close`, `cancel`, `select`, and `error`. With `model:show`, internal cancellation synchronizes the caller's visibility field. For one-way `show` binding, handle `change` and update that field explicitly.

An action sheet copies the selected option at tap time. By default it emits `select` after `closed`, allowing the application to open a follow-up interface after the menu exits. With `close-on-select="{{false}}"`, it emits immediately and remains open. Disabled options do not close or select.

## Lifecycle behavior

- Reopening invalidates stale exit callbacks and pending selection results.
- Hiding a page pauses native motion while retaining its form content and Store entry.
- Detaching releases the instance's entry, subscriptions, and native style handles.
- Layer changes update background and covered-content scrolling automatically.
- Layout uses actual window, keyboard-adjusted height, capsule position, and safe areas without counting insets twice.

Internal adapters, controllers, and Worklet resources are implementation details. Applications control the components through properties, events, and the exposed `requestClose`/`refreshLayout` instance methods.

Licensed under [Apache-2.0](../../LICENSE). See [NOTICE](../../NOTICE).
