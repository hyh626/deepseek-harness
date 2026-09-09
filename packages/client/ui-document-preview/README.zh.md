# @deepseek-ai/dsh-client-ui-document-preview

[English](README.md) | 中文

在聊天旁预览工作区 Markdown 与 HTML 的 Web 次级面板。该插件向 `secondaryPanel` 注册独占的 `document-preview` 条目，提供 `ctx.documentPreview`，并在 `conversation/open-file` waterfall 上认领 `.md`、`.markdown`、`.html` 和 `.htm` 路径。静态内容通过受限的 Host RPC（`host.readPreviewDocument`、`host.readPreviewImage`）读取。交互 HTML 通过 `host.startInteractivePreview` / `host.stopInteractivePreview` 铸造唯一源。预览状态只存在于 UI，不会写入会话事件。

Markdown 通过 `MarkdownText` 渲染，并使用本包的 Mermaid 适配器（`securityLevel: 'strict'`；SVG 作为 blob `<img>` 发布）。静态 HTML 经 DOMPurify 消毒后放入没有 `allow-scripts` 的 `srcdoc` iframe，并带有禁止脚本、网络连接、表单与父页面导航的 CSP。相对 PNG、JPEG、WebP 与 GIF 图片在符号链接解析后仍须位于会话 cwd 内。消毒后的 `pre.mermaid` / `div.mermaid` 节点以同样方式变成 blob 图片。

启用交互预览在用户为当前 HTML 路径确认 `RiskConfirmation` 之前保持关闭。授权持续到面板关闭或打开其他路径；同一路径的重新加载保留授权并替换 grant。交互 iframe 以 `sandbox="allow-scripts allow-same-origin"` 和 `referrerPolicy="no-referrer"` 加载铸造的源。启动失败时保留静态预览。确认文案披露：浏览器无法阻止该应用把自身 frame 导航到外部 URL。

面板标题显示 basename（完整路径作为 `title`），以及启用交互预览（仅 HTML）、重新加载、在外部打开、关闭。

从 Web 组合中移除本插件后，所有文件点击都会恢复为原生 `host.openPath`。

## 模型体验

无；该面板是浏览器界面，不会进入模型请求。

#### KV Cache 效果

无；本包既不组装也不发送 provider 请求。

## 已知限制与延后工作

- **没有文件监视或编辑器** — 重新加载是显式操作；面板不写文件。
- **静态模式不处理外链样式表和 CSS `url()` 资源** — 只改写内联 CSS 与栅格 `<img>` 来源。交互模式从隔离源上的入口 HTML 目录提供这些文件。
- **已发布的 grant 是回环唯一主机名** — 改写 `Host` 的反向代理，或没有匹配通配 DNS 后缀的 TLS 终止，无法到达它们。远程浏览器需要组合 overlay（`bindHost: 0.0.0.0` 加上通配 `hostnameSuffix`）。
