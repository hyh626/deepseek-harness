# @deepseek-ai/dsh-host-interactive-preview

English | [中文](README.zh.md)

Ephemeral interactive workspace-preview origins for the web-GUI host. The `InteractivePreview` service (`ctx.interactivePreview`) mints one dedicated HTTP server per grant. Each grant receives a cryptographically random lowercase-hex capability label embedded in its hostname (`<capability>.<hostnameSuffix>`), an OS-assigned port, and a complete `http://` origin. Clients connect to the configured bind address while sending the exact minted `Host` authority; capability is carried only in the hostname.

`open({ sessionId, path, parentOrigin })` resolves the entry HTML through `ctx.fs` from the addressed session cwd, requires a regular `.html`/`.htm` file, and confines every served asset to the entry file's directory after symlink follow. `parentOrigin` must be a bare `http:`/`https:` origin; it is embedded in CSP `frame-ancestors` for authorized responses only. Configurable `bindHost` (default `127.0.0.1`), `hostnameSuffix` (default `localhost`), `maxGrants`, `maxAssetBytes`, and `inactivityTimeoutMs` govern deployment and limits. Remote deployments may bind `0.0.0.0` and set `hostnameSuffix` to a wildcard-DNS suffix their infrastructure resolves to the host; binding `0.0.0.0` with `localhost` is rejected at load. Suffix validation applies a strict per-label LDH allowlist and rejects authority injection (`/`, `:`, `@`, `\`, `%`, `?`, `#`, brackets, whitespace, empty labels, leading/trailing hyphens).

Serving semantics: GET/HEAD only; root-relative URLs work at `/`; every request path, including `/` and SPA HTML fallback, is resolved through `ctx.fs` on that request; SPA HTML navigation falls back to the entry basename when `Accept` includes `text/html`; missing non-HTML assets return 404. Authorized responses include CSP (`base-uri 'self'`, `object-src 'none'`, `frame-ancestors <parentOrigin>`, same-origin scripts/styles with inline allowance, no `data:` script sources), `Cache-Control: no-store`, `Vary: Accept`, and standard hardening headers. Wrong `Host` values receive minimal non-grant headers without parent-origin disclosure. Explicit `close(id)`, session disposal, inactivity expiry, and plugin disposal abort in-flight reads, await handlers with `allSettled`, and close servers to quiescence.

## Model Experience

None — the service mints host-local preview origins; nothing here reaches a model request until a consumer exposes a URL through product RPC.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Direct HTTP to a random port** — clients must send the minted `Host` to the configured bind address; a reverse proxy that rewrites `Host`, or TLS termination without a matching wildcard DNS suffix, cannot reach a grant.
- **HTTPS preview origins are out of scope** — grants are plain HTTP; TLS termination belongs to the deploying reverse proxy or wildcard DNS front door.
- **App root is the entry HTML directory** — sibling files load; paths outside that directory after symlink follow do not.
- No runtime invariant companion is published because grant lifecycle, Host validation, and filesystem containment are exercised by package tests; independent observations do not diverge at runtime without a failed request already surfacing the defect.
