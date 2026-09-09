/**
 * Document preview plugin, browser half. Registers the exclusive
 * `document-preview` secondary panel and provides `ctx.documentPreview`.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  DOCUMENT_PREVIEW_PANEL_ID,
  DocumentPreviewController,
  type IDocumentPreview,
} from './controller.ts'
import { DocumentPreviewPanel } from './DocumentPreviewPanel.tsx'
import { isPreviewableDocumentPath } from './resources.ts'
import { en, zh, type DocumentPreviewKey } from './locales.ts'

export { DOCUMENT_PREVIEW_PANEL_ID, DocumentPreviewController } from './controller.ts'
export type { DocumentPreviewView, IDocumentPreview } from './controller.ts'
export { isPreviewableDocumentPath } from './resources.ts'
export type { DocumentPreviewKey } from './locales.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Session-scoped workspace document preview loader. */
    documentPreview: IDocumentPreview
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Document preview panel copy. */
    documentPreview: DocumentPreviewKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'documentPreview'

/** Required services. */
export const inject = ['slots', 'workspaces', 'layout', 'locale']

/**
 * Provide the preview controller and register the secondary panel occupant.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const preview = new DocumentPreviewController({
    readPreviewDocument: (sessionId, path, signal) =>
      ctx.workspaces.readPreviewDocument(sessionId, path, signal),
    readPreviewImage: (sessionId, documentPath, source, signal) =>
      ctx.workspaces.readPreviewImage(sessionId, documentPath, source, signal),
    openPath: path => ctx.workspaces.openPath(path),
    startInteractivePreview: (sessionId, path, parentOrigin, signal) =>
      ctx.workspaces.startInteractivePreview(sessionId, path, parentOrigin, signal),
    stopInteractivePreview: (id, signal) => ctx.workspaces.stopInteractivePreview(id, signal),
    parentOrigin: window.location.origin,
    openPanel: (id) => { ctx.layout.openPanel(id) },
    closePanel: (id) => { ctx.layout.closePanel(id) },
  })
  ctx.effect(() => {
    const disposeService = ctx.reflect.provide('documentPreview', preview)
    const disposeOpen = ctx.on('conversation/open-file', (request, next) => {
      if (!isPreviewableDocumentPath(request.path)) {
        next()
        return
      }
      preview.open(request.sessionId, request.path)
    })
    return () => {
      disposeOpen()
      preview.dispose()
      void disposeService()
    }
  }, 'ui-document-preview: service')

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-document-preview: dictionaries')

  ctx.slots.inject('secondaryPanel', () => ctx.slots.register({
    name: 'secondaryPanel',
    id: DOCUMENT_PREVIEW_PANEL_ID,
    locale: NS,
    inject: () => ({ preview }),
  }, DocumentPreviewPanel))
}
