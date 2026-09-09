# @deepseek-ai/dsh-host-interactive-preview

[English](README.md) | 中文

Web GUI 主机的临时交互式工作区预览源。`InteractivePreview` 服务（`ctx.interactivePreview`）为每个 grant 铸造一台独立 HTTP 服务器。每个 grant 获得嵌入主机名的小写十六进制加密随机 capability 标签（`<capability>.<hostnameSuffix>`）、一个由操作系统分配的端口，以及完整的 `http://` 源。客户端连接到配置的绑定地址，并发送精确铸造的 `Host` 权威值；capability 仅通过主机名携带。

`open({ sessionId, path, parentOrigin })` 通过 `ctx.fs` 从被寻址 Session 的 cwd 解析入口 HTML，要求目标为常规 `.html`/`.htm` 文件，并在跟随符号链接后将每个被提供资产限制在入口文件所在目录内。`parentOrigin` 必须是裸 `http:`/`https:` 源；它仅嵌入已授权响应的 CSP `frame-ancestors`。可配置的 `bindHost`（默认 `127.0.0.1`）、`hostnameSuffix`（默认 `localhost`）、`maxGrants`、`maxAssetBytes` 与 `inactivityTimeoutMs` 控制部署与限制。远程部署可绑定 `0.0.0.0` 并将 `hostnameSuffix` 设为基础设施可解析到该主机的通配 DNS 后缀；在加载时拒绝 `0.0.0.0` 与 `localhost` 的组合。后缀校验采用严格的逐标签 LDH 允许列表，并拒绝权威注入（`/`、`:`、`@`、`\`、`%`、`?`、`#`、方括号、空白、空标签、首尾连字符）。

提供语义：仅 GET/HEAD；根相对 URL 在 `/` 可用；每个请求路径（含 `/` 与 SPA HTML 回退）都在该次请求中通过 `ctx.fs` 解析；当 `Accept` 包含 `text/html` 时 SPA HTML 导航回退到入口文件名；缺失的非 HTML 资产返回 404。已授权响应包含 CSP（`base-uri 'self'`、`object-src 'none'`、`frame-ancestors <parentOrigin>`、允许内联的同源脚本/样式、脚本源不含 `data:`）、`Cache-Control: no-store`、`Vary: Accept` 以及标准加固头。错误的 `Host` 值仅收到不含 parent origin 披露的最小非 grant 头。显式 `close(id)`、Session 处置、不活动过期与插件处置会中止进行中的读取、以 `allSettled` 等待处理器，并将服务器关闭至静止。

## Model Experience

无 — 该服务铸造主机本地预览源；在消费者通过产品 RPC 暴露 URL 之前，此处内容不会进入模型请求。

#### KV Cache effect

无；此包既不组装也不发送 provider 请求。

## Known Limitations and Deferred Work

- **直连随机端口的 HTTP** — 客户端必须把铸造的 `Host` 发到配置的绑定地址；改写 `Host` 的反向代理，或没有匹配通配 DNS 后缀的 TLS 终止，无法到达 grant。
- **HTTPS 预览源不在范围内** — grant 为纯 HTTP；TLS 终止属于部署中的反向代理或通配 DNS 前端。
- **应用根目录是入口 HTML 所在目录** — 同级文件可加载；跟随符号链接后位于该目录之外的路径不可。
- 未发布运行时 invariant companion，因为 grant 生命周期、Host 校验与文件系统 containment 由包测试覆盖；运行时没有独立观测会在未已有失败请求的情况下分叉。
