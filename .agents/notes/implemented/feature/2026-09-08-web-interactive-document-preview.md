# Agent Note: opt-in interactive HTML preview origin

Status: implemented

English | [中文](2026-09-08-web-interactive-document-preview.zh.md)

> Scope: explicit consent to run a workspace HTML app in an isolated unique origin beside chat, capability-bearing hostnames, confined Host HTTP serving of that app's directory, and residual iframe-navigation disclosure. Not in scope: Vite/Next/webpack dev servers, linked assets outside the entry HTML directory, cookies as capability, same-origin `/f/` serving on the product origin, or auto-running scripts when a file opens. The static document renderers are owned by the shipped document preview (`ui-sidebar-documentpreview`), which this feature extends with an alternative renderer. Same-origin HTTP serving of workspace files remains rejected by [the workspace file links decision](2026-07-31-web-workspace-file-links.md).

## Problem

Static `srcdoc` preview cannot run the scripts, modules, stylesheets, fonts, WASM, or same-origin `fetch` that a built HTML app needs. Opening the same file in an external browser gave that parity locally and gave none of it to a remote Web client. Serving the files from the product origin beside `/api` remains unsafe. Cookies cannot carry a port-scoped grant: they are not port-keyed, so another loopback listener could inherit them.

## Decision

**The shipped renderers stay script-free; the interactive renderer is a separate implementation.** The shipped HTML renderer shows a sanitized, script-free document. Interactive preview registers a second `documentPreviews` implementation (`loading: 'renderer'`) for `html`/`htm`; the toolbar's renderer dropdown chooses between them per file.

**Interactive mode is an explicit per-document grant.** The renderer's toolbar control (keyed `sidebar.right.tab.document.action` seat) opens `RiskConfirmation`. Consent lasts for the tab: it is stored in a session-scoped store, survives renderer switches and same-file reloads, and a new tab asks once for its own file. The grant lives exactly as long as the body mounts a running revision: revision changes, renderer switches, and tab closure each stop it. `@deepseek-ai/dsh-client-ui-interactive-html-preview` owns that lifecycle; `remote.interactivePreview.start` / `remote.interactivePreview.stop` mint and revoke grants through `ctx.interactivePreview`. Session disposal and an aborted RPC `signal` abort unpublished opens and close any grant that finished after cancellation.

**Capability is the hostname, not a cookie.** `@deepseek-ai/dsh-host-interactive-preview` listens on an OS-assigned port bound to configured `bindHost` (default `127.0.0.1`) and answers only the minted `Host` `<32-hex>.<hostnameSuffix>` (default suffix `localhost`). The iframe loads that complete origin with `sandbox="allow-scripts allow-same-origin"` and `referrerPolicy="no-referrer"`. All workspace I/O uses `ctx.fs` from the session cwd; the app root is the directory of the regular `.html`/`.htm` entry after symlink follow. GET/HEAD only; each request path, including `/` and SPA fallback to the entry basename, is resolved through `ctx.fs` on that request; same-origin CSS, JS modules, images, fonts, WASM, and `fetch` work; directory listing is refused.

**Network stays same-origin; iframe navigation residual is disclosed.** Authorized CSP sets `connect-src 'self'`, `frame-ancestors` to the exact parent origin, and `script-src 'self' 'unsafe-inline'` without `data:`. Browsers do not enforce CSP `navigate-to`, so a trusted app can still send its own frame to an external URL; the confirmation copy states that. The web-app composition ships loopback-only (`bindHost: '127.0.0.1'`). Binding `0.0.0.0` with `localhost` is rejected at load; a remote browser needs an overlay that sets `bindHost: 0.0.0.0` and a wildcard-DNS `hostnameSuffix`.

## Alternatives considered

- **Cookies as the grant** — rejected because cookies are not port-scoped; another process on loopback could present the same cookie.
- **Same-origin `/f/...` on the product origin** — remains rejected: a preview document would share origin with `/api`. Unique-origin HTTP is the exception, and only after consent.
- **`allow-scripts` on the static `srcdoc` iframe** — would run unsanitized scripts in a document that still shares storage with the parent via `allow-same-origin`. Interactive mode uses a different origin instead.
- **Dev-server parity (Vite/Next/webpack HMR)** — out of scope. The grant serves built/static files from the entry HTML directory; it does not proxy or spawn a bundler.
- **Blocking iframe navigation with CSP `navigate-to`** — not enforced by current browsers. The product discloses the residual instead of claiming a guarantee it cannot keep.

## Consequences

A local or remote Web client can run an explicitly trusted built HTML app beside chat without placing workspace files on the product origin. Reverse proxies that rewrite `Host` or terminate TLS without a matching wildcard DNS suffix cannot reach a grant; those deployments need an overlay. The renderer's component specs pin consent gating, grant teardown on revision change, renderer switch, unmount, and tab closure, and the failure line with its retry; a browser e2e through the real host server remains deferred work for the composition that ships this renderer.
