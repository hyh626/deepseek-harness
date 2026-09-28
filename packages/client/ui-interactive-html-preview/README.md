---
description: "Consent-gated interactive HTML previews in the right Sidebar's document preview: the file runs on a Host-minted unique origin inside a sandboxed frame."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-interactive-html-preview

English | [中文](README.zh.md)

## Summary

An alternative document renderer for complete HTML files. The shipped HTML renderer shows a sanitized, script-free document; this implementation runs the file as a real web app. Enabling it is per file and consent-gated: a toolbar control opens a risk confirmation, and only an acknowledged confirmation starts the preview. The Host's [`interactive-preview`](../../host/interactive-preview/README.md) grants mint one ephemeral unique origin per running revision, confine served assets to the entry file's directory, and stop the grant when the tab closes, the file reloads, another renderer is selected, or this body unmounts. The frame is sandboxed with `allow-scripts allow-same-origin` and `referrerPolicy="no-referrer"`; `frame-ancestors` pins the embedding application's origin.

The renderer registers its metadata with `ctx.documentPreviews.register` (`extensions: html/htm`, `loading: 'renderer'`) and its body and consent control under the same id in the keyed `sidebar.right.tab.document` and `sidebar.right.tab.document.action` seats. Per-tab consent lives in a session-scoped store, so returning to this renderer within one tab restarts the grant without asking again, while a new tab asks once for its own file. Every import from another client plugin is a type; behavior crosses packages through injected Cordis services.

Removing this plugin from the Web composition leaves the shipped static HTML renderer in place.

## Model Experience

None, as the renderer is browser chrome and does not reach a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The Host must be reachable from the browser at the minted origin** — shipped grants are loopback unique hostnames; a reverse proxy that rewrites `Host`, or TLS termination without a matching wildcard DNS suffix, cannot reach them. Remote deployments need a composition overlay (`bindHost: 0.0.0.0` plus a wildcard `hostnameSuffix`).
- **No disable control** — consent lasts for the tab's lifetime; closing the tab is the undo. A per-tab revoke can be added when a consumer needs it.

**Runtime invariant:** No companion is published. The type registers one renderer definition and two keyed seats; grant state is UI-only, session-scoped, and forgotten when the tab ends, so there is no second observation to compare against.
