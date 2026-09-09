# Agent Note: opt-in interactive HTML preview origin

Status: implemented

[English](2026-09-08-web-interactive-document-preview.md) | 中文

> 范围：在聊天旁以显式同意在隔离的唯一源中运行工作区 HTML 应用、带 capability 的主机名、对该应用目录的受限 Host HTTP 提供、不含脚本的静态 HTML Mermaid，以及 iframe 导航残留风险披露。不在范围：Vite/Next/webpack 开发服务器、入口 HTML 目录之外的外链资源、用 cookie 作为 capability、在产品源上的同源 `/f/` 提供，或打开文件时自动运行脚本。静态 Markdown/HTML 预览仍由[文档预览决策](2026-08-18-web-document-preview.zh.md)拥有。工作区文件的同源 HTTP 提供仍由[工作区文件链接决策](2026-07-31-web-workspace-file-links.zh.md)拒绝。

## Problem

静态 `srcdoc` 预览无法运行构建后的 HTML 应用所需的脚本、模块、样式表、字体、WASM 或同源 `fetch`。在外部浏览器打开同一文件能在本地获得这种对等能力，远程 Web 客户端则完全没有。从与 `/api` 并列的产品源提供这些文件仍然不安全。Cookie 不能承载按端口隔离的 grant：它们不以端口为键，另一个回环监听器可能继承它们。

## Decision

**静态预览仍是默认；打开文件从不运行脚本。** Markdown 与消毒后的 HTML 仍通过 `host.readPreviewDocument` / `host.readPreviewImage` 加载。静态 HTML iframe 保持没有 `allow-scripts` 的 `sandbox="allow-same-origin"`，以及禁止脚本、网络连接与 `http:`/`https:` 图片的 CSP（`img-src blob: data:`）。该消毒 HTML 中的 `pre.mermaid` 与 `div.mermaid` 通过 Markdown 所用的同一严格 Mermaid 适配器替换为 blob `<img>` SVG。

**交互模式是按文档的显式 grant。** 标签页的「启用交互预览」控件打开 `RiskConfirmation`。授权对当前 HTML 路径有效，直到标签页正文卸载或打开其他路径。同一路径的重新加载保留授权，并在上一 grant 停止后替换服务器 grant。客户端在 `stopInteractivePreview` 成功之前保留 grant id，以便稍后的关闭、处置或启动可以重试。启动失败时保留静态预览。`@deepseek-ai/dsh-client-ui-document-preview` 拥有该生命周期；`host.startInteractivePreview` / `host.stopInteractivePreview` 通过 `ctx.interactivePreview` 铸造与撤销 grant。Session 处置与已中止的 RPC `signal` 会中止尚未发布的 open，并关闭在取消之后才完成的 grant。

**Capability 在主机名中，不在 cookie 中。** `@deepseek-ai/dsh-host-interactive-preview` 在配置的 `bindHost`（默认 `127.0.0.1`）上监听操作系统分配的端口，并只应答铸造的 `Host` `<32 位十六进制>.<hostnameSuffix>`（默认后缀 `localhost`）。iframe 以 `sandbox="allow-scripts allow-same-origin"` 和 `referrerPolicy="no-referrer"` 加载该完整源。所有工作区 I/O 经 `ctx.fs` 从会话 cwd 进行；应用根目录是跟随符号链接后常规 `.html`/`.htm` 入口所在目录。仅 GET/HEAD；每个请求路径（含 `/` 与回退到入口文件名的 SPA）都在该次请求中通过 `ctx.fs` 解析；同源 CSS、JS 模块、图片、字体、WASM 与 `fetch` 可用；拒绝目录列表。

**网络保持同源；iframe 导航残留予以披露。** 已授权 CSP 设置 `connect-src 'self'`、精确父源的 `frame-ancestors`，以及不含 `data:` 的 `script-src 'self' 'unsafe-inline'`。浏览器不强制执行 CSP `navigate-to`，因此受信任的应用仍可把自身 frame 导航到外部 URL；确认文案写明这一点。web-app 组合只发布回环（`bindHost: '127.0.0.1'`）。加载时拒绝 `0.0.0.0` 与 `localhost` 的组合；远程浏览器需要把 `bindHost` 设为 `0.0.0.0` 并配置通配 DNS `hostnameSuffix` 的 overlay。

## Alternatives considered

- **用 cookie 作为 grant** — 拒绝，因为 cookie 不以端口为作用域；回环上的另一个进程可以出示同一 cookie。
- **在产品源上的同源 `/f/...`** — 仍然拒绝：预览文档会与 `/api` 共享源。唯一源 HTTP 是例外，且仅在同意之后。
- **在静态 `srcdoc` iframe 上使用 `allow-scripts`** — 会在仍通过 `allow-same-origin` 与父页面共享存储的文档中运行未消毒脚本。交互模式改用不同的源。
- **开发服务器对等（Vite/Next/webpack HMR）** — 不在范围。grant 从入口 HTML 目录提供已构建/静态文件，不代理或拉起打包器。
- **用 CSP `navigate-to` 阻止 iframe 导航** — 当前浏览器不强制执行。产品披露该残留，而不声称无法兑现的保证。

## Consequences

本地或远程 Web 客户端可以在聊天旁运行经显式信任的已构建 HTML 应用，而无需把工作区文件放到产品源上。改写 `Host` 或在没有匹配通配 DNS 后缀的情况下终止 TLS 的反向代理无法到达 grant；那些部署需要 overlay。`apps/web/tests/document-preview.e2e.ts` 钉住静态 HTML 中的 Mermaid、仅在同意后运行脚本、父页面隔离、拦截外部 `fetch`、第二个文档需要重新同意，以及关闭时拆除 grant。
