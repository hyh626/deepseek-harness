# @deepseek-ai/dsh-client-ui-document-preview

English | [中文](README.zh.md)

Web secondary panel that previews workspace Markdown and HTML beside chat. The plugin registers the exclusive `document-preview` entry in `secondaryPanel`, provides `ctx.documentPreview`, and claims `.md`, `.markdown`, `.html`, and `.htm` paths on the `conversation/open-file` waterfall. Static content is read through confined Host RPCs (`host.readPreviewDocument`, `host.readPreviewImage`). Interactive HTML mints a unique origin through `host.startInteractivePreview` / `host.stopInteractivePreview`. Preview state is UI-only and never a session event.

Markdown renders through `MarkdownText` with this package's Mermaid adapter (`securityLevel: 'strict'`; SVG published as a blob `<img>`). Static HTML is sanitized with DOMPurify, then shown in a `srcdoc` iframe without `allow-scripts` and with a CSP that denies scripts, connections, forms, and parent navigation. Relative PNG, JPEG, WebP, and GIF images stay inside the session cwd after symlink resolution. Sanitized `pre.mermaid` / `div.mermaid` nodes become blob images the same way.

Enable interactive preview is off until the user confirms `RiskConfirmation` for the current HTML path. Consent lasts until the panel closes or another path opens; same-path Reload keeps consent and replaces the grant. The interactive iframe loads the minted origin with `sandbox="allow-scripts allow-same-origin"` and `referrerPolicy="no-referrer"`. Failed starts keep the static preview. The confirmation copy discloses that browsers cannot stop the app from navigating its own frame to an external URL.

The panel header shows the basename (full path as `title`), Enable interactive preview (HTML only), Reload, Open externally, and Close.

Removing this plugin from the Web composition restores native `host.openPath` for every file click.

## Model Experience

None, as the panel is browser chrome and does not reach a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No file watcher or editor** — reload is explicit; the panel does not write files.
- **Linked stylesheets and CSS `url()` resources are omitted in static mode** — only inline CSS and raster `<img>` sources are rewritten. Interactive mode serves those files from the entry HTML directory on the isolated origin.
- **Shipped grants are loopback unique hostnames** — a reverse proxy that rewrites `Host`, or TLS termination without a matching wildcard DNS suffix, cannot reach them. Remote browsers need a composition overlay (`bindHost: 0.0.0.0` plus a wildcard `hostnameSuffix`).
