# Agent Note: 工作区内 Markdown 与 HTML 的应用内预览

Status: implemented

[English](2026-08-18-web-document-preview.md) | 中文

> 范围：从聊天中的文件点击把工作区 `.md` / `.markdown` / `.html` / `.htm` 打开到可调整宽度的次级面板、受限的 Host 预览读取 RPC、该面板内的按需 Mermaid，以及默认禁用脚本的静态 HTML。不在范围内：在产品源上以 HTTP 提供工作区文件、外链样式表、CSS `url()` 资源、文件选择器、编辑器，或第四列布局。可选的唯一源交互 HTML 由[交互预览决策](2026-09-08-web-interactive-document-preview.md)拥有。

## 问题

用户刚产出的文档，在 Web UI 里点击后仍然会离开产品。Markdown 打开到操作系统绑定 `.md` 的应用，HTML 则以 `file://` 标签页离开产品。这回答了原生交接，但无法在写出它的对话旁边显示图表、相对图片或静态页面；远程浏览器也完全无法使用 `host.openPath`。

## 决策

**文件打开仍由对话拥有；预览是可选认领。** `openFile` 按会话 cwd 解析路径，再运行 `conversation/open-file` waterfall。末端 `next()` 仍是 `workspaces.openPath`。`@deepseek-ai/dsh-client-ui-document-preview` 只认领 Markdown 与 HTML 扩展名，并打开 `LayoutPanelId('document-preview')`。移除该插件后，每一次点击都恢复为原生打开。预览状态只存在于 UI，不会写入会话事件。

**右侧列是独占的次级面板宿主，不是第四列。** `secondaryPanel` 是会话作用域列表；`openPanel(id)` 只渲染一个已注册占用方，`closePanel(id)` 只关闭该 id。工具详情占用 `tool-details`。再增加第四列会为同一个独占占用方再次拆分缩放、让步与会话归属。

**读取是有上限的 Host RPC，不是 HTTP 文件路由。** `host.readPreviewDocument` 与 `host.readPreviewImage` 从被寻址会话的 cwd 经 `ctx.fs` 解析，要求目标为普通文件，在跟随符号链接后拒绝该根目录之外的规范路径，并强制执行 Cordis 配置的完整结果上限（`previewDocumentMaxBytes` 默认 2 MiB，`previewImageMaxBytes` 默认 5 MiB）。JSON 字节到达页面，而不会让工作区文件获得与 `/api` 并列的 URL 源。相对 PNG、JPEG、WebP 与 GIF 来源改写为可撤销的 blob URL；其他图片类型保持不加载。

**Markdown 的 Mermaid 是按需的，且从不进入聊天 DOM。** 除非提供 `MermaidRenderer`，`MarkdownText` 仍把 `language-mermaid` 栅栏当作普通代码块。预览适配器使用 `startOnLoad: false` 与 `securityLevel: 'strict'`，再把 SVG 发布为 blob `<img>`。

**HTML 默认是静态的。** DOMPurify 去掉脚本、事件处理程序、表单、嵌入文档、`base`、刷新元数据与外链样式表。iframe 的 `srcdoc` 带有禁止脚本、网络连接、表单与父页面导航的 CSP，sandbox 为没有 `allow-scripts` 的 `allow-same-origin`。内联 CSS 可以保留；外链 CSS 文件不会加载。显式交互 HTML 由[交互预览决策](2026-09-08-web-interactive-document-preview.md)拥有。

## 考虑过的替代方案

- **第四列布局** — 为次级宿主已经建模的独占占用方，重复让步与会话宽度。
- **HTTP `/f/...` 提供** — 已在 [工作区文件链接决策](2026-07-31-web-workspace-file-links.md) 中否决：同源提供能打到 `/api`，CSP sandbox 又会破坏用户需要看到的页面。有上限的 RPC JSON 不会铸造文档源。经显式同意的唯一源 HTTP 是后来的例外，由[交互预览决策](2026-09-08-web-interactive-document-preview.md)拥有。
- **把 Mermaid SVG 插入应用 DOM** — 会把不受信任的图表标记混入产品界面。blob `<img>` 让 SVG 留在应用树之外。
- **给静态预览 iframe `allow-scripts`** — 会重新打开静态预览正要关掉的脚本面。交互模式改为在确认后使用不同的源。
- **从文件选择器或产物栏预览** — v1 入口就是已经调用 `openFile` 的聊天与工具结果点击。

## 后果

Markdown 与 HTML 的 chip、提及和工具路径链接会在本地与远程 Web 客户端中于聊天旁打开。其他扩展名仍调用 `host.openPath`。面板上的「在外部打开」走同一条原生路径。打开工具详情会通过独占宿主替换预览。`apps/web/tests/document-preview.e2e.ts` 钉住组装后的 Markdown/Mermaid/图片渲染、惰性 HTML 脚本，以及文本文件的原生委托。
