/**
 * Document preview plugin, node half. Pure UI plugin: the empty apply exists
 * so the plugin appears in the host Loader; the browser half ships via
 * exports["./client"].
 */

/** Host plugin body: the preview contributes nothing to the host tree. */
export function apply(): void {}
