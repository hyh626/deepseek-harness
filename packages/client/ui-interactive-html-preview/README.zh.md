---
description: "右侧栏文档预览中经确认的交互式 HTML 预览：文档在宿主铸造的唯一来源中运行于沙箱框架内。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-interactive-html-preview

[English](README.md) | 中文

## 概述

完整 HTML 文件的备选文档渲染器。随附的 HTML 渲染器展示经过净化、无脚本的文档；本实现把文件作为真正的 Web 应用运行。启用按文件进行并经确认门控：工具栏控件打开风险确认，只有确认后才会启动预览。宿主的 [`interactive-preview`](../../host/interactive-preview/README.zh.md) 为每个运行中的修订铸造一个临时唯一来源，把可服务的资源限制在入口文件目录内，并在标签页关闭、文件重载、选择其他渲染器或本组件体卸载时停止该 grant。框架带 `allow-scripts allow-same-origin` 沙箱与 `referrerPolicy="no-referrer"`；`frame-ancestors` 固定为嵌入应用的来源。

渲染器通过 `ctx.documentPreviews.register` 注册元数据（`extensions: html/htm`、`loading: 'renderer'`），并在同 id 的键控 `sidebar.right.tab.document` 与 `sidebar.right.tab.document.action` 席位下注册组件体与确认控件。按标签页的同意保存在会话作用域 store 中：同一标签页内切回本渲染器会直接重启 grant 而不再询问；新标签页对自己的文件询问一次。来自其他客户端插件的导入全部是类型；行为跨包经由注入的 Cordis 服务。

从 Web 组合中移除本插件后，随附的静态 HTML 渲染器保持不变。

## Model Experience

无，该渲染器是浏览器界面，不触及模型请求。

#### KV Cache 效应

无；本包既不组装也不发送提供方请求。

## Known Limitations and Deferred Work

- **宿主必须能从浏览器经铸造来源访问** —— 随附 grant 是环回唯一主机名；重写 `Host` 的反向代理，或没有匹配通配 DNS 后缀的 TLS 终止，都无法到达。远程部署需要组合 overlay（`bindHost: 0.0.0.0` 加通配 `hostnameSuffix`）。
- **没有停用控件** —— 同意持续整个标签页生命周期；关闭标签页即撤销。当有消费者需要时可以加入按标签页的撤销。

**运行时不变量：** 不发布伴随物。该类型注册一个渲染器定义与两个键控席位；grant 状态仅存在于界面、会话作用域，并在标签页结束时被遗忘，因此没有可比较的第二次观察。
