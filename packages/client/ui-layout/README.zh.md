# @deepseek-ai/dsh-client-ui-layout

[English](README.md) | 中文

外壳插件：三栏 AppFrame（拖动手柄与让步链）加 `ctx.layout` 次级面板服务；它注册到运行时拥有的 `root` slot，并声明 `sidebar`、`conversation`、`secondaryPanel` 和 `shell.overlay`。`secondaryPanel` 是会话作用域的列表，每个条目拥有完整面板 chrome；`openPanel(id)` 只渲染对应的已注册 id，`closePanel(id)` 只能关闭自己占用的活跃条目。侧边栏的缩放边界是不可见命中条带，次级面板边界则保留浮动胶囊；让步期间只有次级面板会收缩并在视觉上自动关闭。关闭的侧边栏仍保留 56px 控制栏，次级栏则关闭到零宽度。该包还提供主题呈现器：它消费解析后的 `ctx.theme` 快照，并将其投影到 document（用 `html { color-scheme }` 驱动原生 UA 控件，依据当前配色方案设置 `body[data-ds-dark-theme]`，并将主题的别名 token 设为 body 上的内联变量，同时拥有一个 `<meta name="theme-color">`，其内容随计算后的 body 背景色更新）。在应用调色板和 token 后进行测量，可确保渲染后的背景成为唯一的颜色依据；呈现器在 dispose（资源释放）时会移除其自有的元数据节点，并一并清除其写入的其他全局状态。

AppFrame 始终挂载会话栏和次级栏；已连接 Session 通过 `SessionProvider` 渲染。布局 store 是瞬时状态，侧边栏以默认宽度启动，次级面板则没有活跃条目，且该 store 从不读写 `localStorage`。首次打开面板使用 360px 默认宽度；关闭会保留不小于 300px 的拖动偏好，而渲染后的面板可以使用保留 640px 会话栏下限后的全部视口宽度。打开另一个已注册 id 会替换活跃条目而不改变该宽度。hero 和其他未选中状态会将次级栏的渲染宽度派生为零，但不会改变活跃 id 或宽度偏好。AppFrame 会跨越这些状态保留最后一个非 blank 会话 id：首个会话保持关闭；返回同一会话时恢复活跃面板；选择不同会话时，面板会在绘制前关闭。会话与次级面板 owner share 均为空，侧边栏 owner share 只包含 `collapsed` 和 `width`；注册方通过标准钩子获取业务数据，并从各自的 inject 接口获取操作。

`/client` 导出表层包含插件主体（`apply`／`inject`）、`LayoutController`、`ILayout`、`LayoutPanelId` 和 owner-share 接口。AppFrame、面板 store 与让步求解器仍属于包内部。

## 模型体验

无。布局外壳管理浏览器查看状态；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **面板几何信息是瞬时状态**：重新加载会恢复侧边栏默认值，并且没有活跃次级面板；在不同会话 id 之间切换会关闭活跃条目，但为下一个面板保留拖动后的宽度，而未选中表面会以零宽度渲染次级栏，但不会修改状态。
- **让步链自动关闭通过推导零宽度实现，不会改动宽度偏好或活跃 id**：窗口变宽时面板会自行恢复；消费方禁止把 store 中的次级宽度当作实际渲染状态。
- **挤压重排期间不提供滚动锚定**：布局变化可能移动读者的 viewport。
