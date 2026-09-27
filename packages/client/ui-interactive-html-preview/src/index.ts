/**
 * Interactive HTML preview surface, node half. Pure UI plugin: the empty apply
 * exists so the plugin appears in the host cordis.yml / Loader; the browser
 * half ships via exports["./client"], discovered through the package.json
 * dsh.client declaration. The origins it drives live in
 * `@deepseek-ai/dsh-host-interactive-preview`.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
