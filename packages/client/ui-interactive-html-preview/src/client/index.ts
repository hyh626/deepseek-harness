/**
 * Browser half: register interactive HTML as an alternative document renderer.
 *
 * The implementation reaches the document preview through its public path
 * only: the metadata into `ctx.documentPreviews`, the body into the keyed
 * `sidebar.right.tab.document` seat, and the consent control into the keyed
 * `sidebar.right.tab.document.action` seat, all under the implementation's
 * `id`. The origin itself is minted by the Host's interactive-preview grants;
 * this plugin never reads document bytes. Every import from another client
 * plugin is a type.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-workspace-files/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type {} from '@deepseek-ai/dsh-host-interactive-preview/remote'
import type { DocumentPreviewDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import { InteractiveHtmlBody, type InteractiveHtmlInjected } from './InteractiveHtmlBody.tsx'
import { EnableInteractiveAction } from './EnableInteractiveAction.tsx'
import { settle } from './rpc.ts'
import { createInteractiveHtmlStore } from './store.ts'
import { en, zh, type InteractiveHtmlKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Interactive-preview consent, status, and failure copy. */
    interactiveHtml: InteractiveHtmlKey
  }
}

/** Interactive implementation identity, shared by metadata and both keyed seats. */
export const INTERACTIVE_HTML_ID = '@deepseek-ai/dsh-client-ui-interactive-html-preview/html'

/** This package's copy namespace. */
const NS = 'interactiveHtml'

/**
 * Describe the interactive renderer's file types and loading mode.
 * @param title - locale-owned implementation name.
 * @returns metadata for complete HTML documents, loaded by the renderer.
 */
export function interactiveHtmlDefinition(title: () => string): DocumentPreviewDefinition {
  return { id: INTERACTIVE_HTML_ID, extensions: ['html', 'htm'], priority: 'builtin', title, loading: 'renderer', wrap: false }
}

/** Required browser services: the slot registry, copy, the renderer registry, and the preview Remotes. */
export const inject = ['slots', 'locale', 'documentPreviews', 'remote', 'remote.interactivePreview', 'remote.workspaceFiles']

/**
 * Client plugin body: register the dictionary, the renderer metadata, and both keyed seats.
 * @param ctx - client root context carrying the slots, copy, and Remotes.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-interactive-html-preview: dictionaries')
  const t = ctx.locale.bind(NS)
  const store = createInteractiveHtmlStore()
  const injected = (): InteractiveHtmlInjected => ({
    start: async (file, parentOrigin, signal) => {
      const stat = settle(await ctx.remote.workspaceFiles.stat(file.sessionId, file.path, signal))
      if (!stat.ok) return stat
      const grant = settle(await ctx.remote.interactivePreview.start(file.sessionId, file.path, parentOrigin, signal))
      if (!grant.ok) return grant
      return { ok: true, value: { version: stat.value.version, id: grant.value.id, origin: grant.value.origin } }
    },
    stop: async (id, signal) => {
      await ctx.remote.interactivePreview.stop(id, signal)
    },
  })
  ctx.effect(() => ctx.documentPreviews.register(interactiveHtmlDefinition(() => t('title'))), 'ui-interactive-html-preview: metadata')
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register(
    { name: 'sidebar.right.tab.document', key: INTERACTIVE_HTML_ID, locale: NS, store, inject: injected },
    InteractiveHtmlBody,
  )), 'ui-interactive-html-preview: body')
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document.action', () => ctx.slots.register(
    { name: 'sidebar.right.tab.document.action', key: INTERACTIVE_HTML_ID, locale: NS, store },
    EnableInteractiveAction,
  )), 'ui-interactive-html-preview: enable control')
}
