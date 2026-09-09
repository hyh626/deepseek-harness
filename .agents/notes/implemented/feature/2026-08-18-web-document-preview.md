# Agent Note: in-app workspace Markdown and HTML preview

Status: implemented

English | [中文](2026-08-18-web-document-preview.zh.md)

> Scope: opening workspace `.md` / `.markdown` / `.html` / `.htm` from chat file clicks into a resizable secondary panel, confined Host preview-read RPCs, opt-in Mermaid in that panel, and static HTML with scripts disabled by default. Not in scope: HTTP serving of workspace files on the product origin, linked stylesheets, CSS `url()` resources, a file picker, an editor, or a fourth layout column. Opt-in unique-origin interactive HTML is owned by [the interactive preview decision](2026-09-08-web-interactive-document-preview.md).

## Problem

Chat file clicks for documents the user just produced still left the Web UI. Markdown opened in whatever the OS bound to `.md`, and HTML left the product for a `file://` tab. That answered native handoff, but it could not show a diagram, a relative image, or a static page beside the conversation that produced it, and a remote browser could not use `host.openPath` at all.

## Decision

**File opens stay conversation-owned; preview is an optional claim.** `openFile` resolves against the session cwd and runs the `conversation/open-file` waterfall. The terminal `next()` remains `workspaces.openPath`. `@deepseek-ai/dsh-client-ui-document-preview` claims only Markdown and HTML extensions and opens `LayoutPanelId('document-preview')`. Removing the plugin restores native open for every click. Preview state is UI-only and never a session event.

**The right column is an exclusive secondary-panel host, not a fourth column.** `secondaryPanel` is a session-scoped list; `openPanel(id)` renders one registered occupant and `closePanel(id)` closes only that id. Tool details occupy `tool-details`. A dedicated fourth column would split resize, concession, and session ownership a second time for one exclusive occupant.

**Reads are bounded Host RPCs, not an HTTP file route.** `host.readPreviewDocument` and `host.readPreviewImage` resolve through `ctx.fs` from the addressed session cwd, require a regular file, reject canonical targets outside that root after symlink follow, and enforce Cordis-configured complete-result limits (`previewDocumentMaxBytes` default 2 MiB, `previewImageMaxBytes` default 5 MiB). JSON bytes reach the page without giving workspace files a URL origin beside `/api`. Relative PNG, JPEG, WebP, and GIF sources are rewritten to revocable blob URLs; other image kinds stay unloaded.

**Markdown Mermaid is opt-in and never enters chat DOM.** `MarkdownText` keeps generic `language-mermaid` fences unless a `MermaidRenderer` is supplied. The preview adapter uses `startOnLoad: false` and `securityLevel: 'strict'`, then publishes SVG as a blob `<img>`.

**HTML is static by default.** DOMPurify strips scripts, handlers, forms, embedded documents, `base`, refresh metadata, and linked stylesheets. The iframe `srcdoc` carries a CSP that denies scripts, connections, forms, and parent navigation, and the iframe sandbox is `allow-same-origin` without `allow-scripts`. Inline CSS may remain; linked CSS files do not load. Explicit interactive HTML is owned by [the interactive preview decision](2026-09-08-web-interactive-document-preview.md).

## Alternatives considered

- **A fourth layout column** — duplicates concession and session-owned width for an exclusive occupant the secondary host already models.
- **HTTP `/f/...` serving** — rejected in the [workspace file links decision](2026-07-31-web-workspace-file-links.md): same-origin serving reached `/api`, and CSP sandbox broke the pages people needed to see. Bounded RPC JSON does not mint a document origin. Unique-origin HTTP after explicit consent is a later exception owned by [the interactive preview decision](2026-09-08-web-interactive-document-preview.md).
- **Inserting Mermaid SVG into the application DOM** — would mix untrusted diagram markup with product chrome. Blob `<img>` keeps the SVG out of the app tree.
- **`allow-scripts` on the static preview iframe** — would re-enable the script surface static preview exists to disable. Interactive mode uses a different origin after confirmation instead.
- **Previewing from a file picker or artifacts rail** — v1 entry is the same chat and tool-result clicks that already called `openFile`.

## Consequences

Markdown and HTML chips, mentions, and tool path links open beside chat for local and remote Web clients. Other extensions still call `host.openPath`. Open externally on the panel uses that same native path. Opening tool details replaces the preview through the exclusive host. `apps/web/tests/document-preview.e2e.ts` pins assembled Markdown/Mermaid/image rendering, inert HTML script, and text-file native delegation.
