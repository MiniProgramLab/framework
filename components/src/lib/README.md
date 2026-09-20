# 弹层组件

[English](README.en.md)

`overlay`、`popup`、`action-sheet` 属于 `@miniprogramlab/ui`，共享页面级层叠、显示状态转换、原生动画资源及背景交互隔离能力。

通过 `libraryComponents` 或[组件库文档](../../README.md)中的包路径注册。页面和组件使用框架包装器，以便内部适配器建立页面归属和 Store 连接。

## 选择组件

| 组件 | 用途 |
| --- | --- |
| `overlay` | 全窗口遮罩，可插入自定义内容 |
| `popup` | 带可选标题、关闭按钮、正文滚动及底部插槽的内容面板 |
| `action-sheet` | 带选项及可选取消操作的底部菜单 |

面板与遮罩使用独立的原生 Portal，但共享一条弹层记录。只有最上层活动表面接收输入，透明遮罩仍拦截触摸并锁定背景滚动。

## 示例

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

## 共用属性

WXML 中使用短横线形式的属性名。

| 属性 | 默认值 | 行为 |
| --- | --- | --- |
| `show` | `false` | 期望显示状态，支持 `model:show` |
| `position` | `center`，操作菜单为 `bottom` | 入场方向支持 center、bottom、top、left、right；操作菜单采用底部展示 |
| `transparent` | `false` | 隐藏遮罩颜色，保留交互隔离 |
| `close-on-mask` | `true` | 点击遮罩请求关闭 |
| `scrollable` | `true` | 长内容使用内部滚动容器 |
| `destroy-on-close` | `false` | 退场后销毁内容，否则保留内容实例 |
| `safe-area` | overlay 为 `false`，popup/action-sheet 为 `true` | 预留对应的导航与设备安全距离 |

Popup 增加 `title` 和 `closable`，后者默认 `false`，并提供默认正文插槽与 `footer` 插槽。

Action sheet 增加 `title`、`actions`、`cancel-text`、`close-on-select`，后者默认 `true`。取消文字为空时隐藏取消操作。每个选项包含 `label`、可序列化的 `value`、可选 `disabled` 和可选 `tone: 'default' | 'danger'`。

## 事件与关闭

| 事件 | 含义 |
| --- | --- |
| `change` | 同步显示状态，携带 `{ show, reason }` |
| `opened` | 当前代次入场动画完成 |
| `closed` | 当前代次退场完成，携带关闭原因 |
| `error` | 原生能力或动画异常，携带错误信息 |
| `select` | 操作菜单选择，携带 `{ value, index, action }` |

关闭原因包括 `programmatic`、`mask`、`close`、`cancel`、`select`、`error`。使用 `model:show` 时，内部取消会同步调用方的显示字段；使用单向 `show` 绑定时，需要处理 `change` 并显式更新该字段。

操作菜单在点击时复制选项，默认先发出 `closed`，再发出 `select`，应用可在菜单退场后打开后续界面。设置 `close-on-select="{{false}}"` 后立即发送选择事件并保持打开。禁用项不会触发选择或关闭。

## 生命周期行为

- 重新打开会使过期退场回调和待发送选择失效。
- 页面隐藏时暂停原生动画，保留表单内容和 Store 条目。
- 实例卸载时释放自身条目、订阅和原生样式句柄。
- 层级变化会自动更新背景及被覆盖内容的滚动状态。
- 布局使用真实窗口、键盘影响后的高度、胶囊位置和安全区，不重复计算边距。

内部适配器、控制器和 Worklet 资源属于实现细节。应用通过属性、事件，以及实例公开的 `requestClose`、`refreshLayout` 方法控制组件。

采用 [Apache-2.0](../../LICENSE)，相关声明见 [NOTICE](../../NOTICE)。
