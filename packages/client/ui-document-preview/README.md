# @deepseek-ai/dsh-client-ui-document-preview

English | [中文](README.zh.md)

Right-Sidebar tab type that previews workspace Markdown and HTML. The plugin registers kind `document` at the `builtin` band for `*.md`, `*.markdown`, `*.html`, and `*.htm`, so it beats the text preview's `fallback` claim for those `dsh-resource://file/` addresses. Chat already opens files with `ctx.sidebarRight.openResource(fileAddressFor(...))`. Static content is read through `remote.workspaceFiles.stat` and `readBytes` (2 MiB document cap, 5 MiB relative raster cap). Interactive HTML mints a unique origin through `remote.interactivePreview.start` / `stop`. Preview state is UI-only and never a session event.

Markdown renders through `MarkdownText` with this package's Mermaid adapter (`securityLevel: 'strict'`; SVG published as a blob `<img>`). Static HTML is sanitized with DOMPurify, then shown in a `srcdoc` iframe without `allow-scripts` and with a CSP that denies scripts, connections, forms, and parent navigation. Relative PNG, JPEG, WebP, and GIF images resolve against the document directory, then `readBytes`. Sanitized `pre.mermaid` / `div.mermaid` nodes become blob images the same way.

Enable interactive preview is off until the user confirms `RiskConfirmation` for the current HTML path. Consent lasts until the tab closes or another path opens; same-path Reload keeps consent and replaces the grant. The interactive iframe loads the minted origin with `sandbox="allow-scripts allow-same-origin"` and `referrerPolicy="no-referrer"`. Failed starts keep the static preview. The confirmation copy discloses that browsers cannot stop the app from navigating its own frame to an external URL.

The tab body header shows the basename (full path as `title`), Enable interactive preview (HTML only), Reload, and Open externally. The Sidebar tab strip owns close.

Removing this plugin from the Web composition leaves Markdown and HTML files with the text preview fallback.

## Model Experience

None, as the tab is browser chrome and does not reach a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No file watcher or editor** — reload is explicit; the tab does not write files.
- **Linked stylesheets and CSS `url()` resources are omitted in static mode** — only inline CSS and raster `<img>` sources are rewritten. Interactive mode serves those files from the entry HTML directory on the isolated origin.
- **Shipped grants are loopback unique hostnames** — a reverse proxy that rewrites `Host`, or TLS termination without a matching wildcard DNS suffix, cannot reach them. Remote browsers need a composition overlay (`bindHost: 0.0.0.0` plus a wildcard `hostnameSuffix`).

**Runtime invariant:** No companion is published. The type registers one Sidebar tab definition and one keyed body; preview snapshots are UI-only and forgotten when the tab's abort signal fires, so there is no second observation to compare against.
