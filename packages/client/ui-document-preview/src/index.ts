/**
 * Document preview plugin, node half. Pure UI plugin: the empty apply exists
 * so the plugin appears in the host Loader; the browser half ships via
 * exports["./client"].
 */

/** Host plugin body — no host-side behavior for the document preview plugin. */
export function apply(): void {}
