/**
 * Browser half: register `document` as a right-Sidebar tab type.
 *
 * The type reaches the Sidebar through its public path only: the definition into
 * `ctx.sidebarRightTabs` and the body into the keyed `sidebar.right.pane.tab`
 * seat under the definition's `id`. Nothing here reaches into the Sidebar's store, its
 * panes, or its sequence. Static content is this type's own business, read through
 * `workspaceFiles`; interactive HTML uses `interactivePreview`. Every import from
 * another client plugin is a type.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { DocumentPreviewController } from './controller.ts'
import { DocumentPreviewPanel } from './DocumentPreviewPanel.tsx'
import { DOCUMENT_PREVIEW_ID, documentDefinition } from './definition.ts'
import { bindPreviewRemote, type DocumentPreviewRemote } from './rpc.ts'
import { en, zh } from './locales.ts'

export type { DocumentPreviewKey } from './locales.ts'
export type { DocumentPreviewInjected, DocumentPreviewSlotProps } from './DocumentPreviewPanel.tsx'
export type { DocumentPreviewView, IDocumentPreview } from './controller.ts'
export type { DocumentPreviewRemote, SessionFile } from './rpc.ts'

/** This package's copy namespace. */
const NS = 'documentPreview'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Document preview tab copy. */
    documentPreview: import('./locales.ts').DocumentPreviewKey
  }
}

/**
 * Required browser services: the tab registry, the slot registry, copy, and the
 * Remote carrier with its `workspaceFiles`, `interactivePreview`, and `session`
 * namespaces.
 */
export const inject = [
  'slots',
  'locale',
  'sidebarRightTabs',
  'remote',
  'remote.workspaceFiles',
  'remote.interactivePreview',
  'remote.session',
]

/**
 * Client plugin body: register the type, its dictionaries, and its body.
 * @param ctx - client root context carrying the registry, the slots, copy, and the Remote face.
 */
export function apply(ctx: ClientContext): void {
  const preview = new DocumentPreviewController({
    ...bindPreviewRemote(ctx.remote as unknown as DocumentPreviewRemote),
    parentOrigin: window.location.origin,
  })
  ctx.effect(() => ctx.sidebarRightTabs.register(documentDefinition()), 'ui-document-preview: document type')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-document-preview: dictionaries')
  ctx.effect(() => () => { preview.dispose() }, 'ui-document-preview: controller')

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    {
      name: 'sidebar.right.pane.tab',
      key: DOCUMENT_PREVIEW_ID,
      locale: NS,
      inject: (sessionId: SessionId) => ({
        preview,
        hooks: { previewView: preview.state(sessionId) },
      }),
    },
    DocumentPreviewPanel,
  )), 'ui-document-preview: document body')
}
