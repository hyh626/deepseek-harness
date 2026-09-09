/**
 * Right-Sidebar tab body for workspace Markdown and static HTML preview.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, MarkdownText, RiskConfirmation, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DocumentPreviewView, IDocumentPreview } from './controller.ts'
import { hostFileOf } from './rpc.ts'
import { previewBasename } from './resources.ts'
import { previewMermaidRenderer } from './mermaid.ts'
import css from './DocumentPreviewPanel.module.css'

/** Injected preview controller and its per-session snapshot. */
export interface DocumentPreviewInjected {
  /** Session-scoped preview loader. */
  preview: IDocumentPreview
  /** Renderer-bound snapshot sources. */
  hooks: {
    /** Per-session preview snapshot bound by the renderer as usePreviewView. */
    previewView: SnapshotStore<DocumentPreviewView>
  }
}

/** Full tab props: session runtime share, injected controller, locale. */
export type DocumentPreviewSlotProps =
  PropsRuntime<'sidebar.right.pane.tab'> & InjectFace<DocumentPreviewInjected> & PropsLocale<'documentPreview'>

/**
 * Render the document-preview tab body.
 * @param props - Tab runtime, preview controller, and localized copy.
 */
export function DocumentPreviewPanel({
  sessionId, preview, t, useTabInfo, usePreviewView,
}: DocumentPreviewSlotProps) {
  const { tab } = useTabInfo()
  const file = useMemo(() => hostFileOf(tab.contentId, sessionId), [tab.contentId, sessionId])
  useEffect(() => {
    preview.open(file.sessionId, file.path)
    const { signal } = tab
    const onAbort = (): void => { preview.close(file.sessionId) }
    signal.addEventListener('abort', onAbort)
    return () => {
      signal.removeEventListener('abort', onAbort)
      preview.close(file.sessionId)
    }
  }, [file, preview, tab.signal])

  const view = usePreviewView(snapshot => snapshot)
  const resolveImageSrc = useCallback((url: string) => view.imageUrls[url], [view.imageUrls])
  const mermaid = useMemo(() => previewMermaidRenderer, [])
  const labels = useMemo((): MarkdownLabels => ({
    code: { copyLabel: t('copy'), copiedLabel: t('copied') },
    footnotes: t('markdown.footnotes'),
  }), [t])
  const [confirming, setConfirming] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const htmlReady = view.status === 'ready' && view.format === 'html'
    && view.content !== null && view.path !== null

  return (
    <div className={css.root} data-document-preview>
      <div className={css.header}>
        <div className={css.title} title={view.path ?? undefined}>
          {view.path === null ? t('title.empty') : previewBasename(view.path)}
        </div>
        <div className={css.actions}>
          {htmlReady && view.htmlMode === 'static' && (
            <Button
              variant="ghost"
              size="sm"
              disabled={view.startingInteractive}
              onClick={() => {
                setAcknowledged(false)
                setConfirming(true)
              }}
            >
              {t('interactive.enable')}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={view.path === null || view.status === 'loading'}
            onClick={() => { preview.reload(file.sessionId) }}
          >
            {t('reload')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={view.path === null}
            onClick={() => { preview.openExternal(file.sessionId) }}
          >
            {t('openExternal')}
          </Button>
        </div>
      </div>
      <div className={css.body}>
        {view.status === 'idle' && <div className={css.empty}>{t('empty')}</div>}
        {view.status === 'loading' && <div className={css.empty}>{t('loading')}</div>}
        {view.status === 'error' && <div className={css.error}>{view.error ?? t('error.generic')}</div>}
        {view.interactiveError !== null && <div className={css.error}>{view.interactiveError}</div>}
        {view.status === 'ready' && view.format === 'markdown' && view.content !== null && (
          <MarkdownText
            text={view.content}
            labels={labels}
            mermaid={mermaid}
            mermaidErrorLabel={t('mermaidError')}
            resolveImageSrc={resolveImageSrc}
          />
        )}
        {view.status === 'ready' && view.format === 'html' && view.path !== null
          && view.content !== null && view.htmlMode === 'static' && (
          <iframe
            className={css.frame}
            title={previewBasename(view.path)}
            sandbox="allow-same-origin"
            srcDoc={view.content}
            referrerPolicy="no-referrer"
          />
        )}
        {view.status === 'ready' && view.format === 'html' && view.path !== null
          && view.htmlMode === 'interactive' && view.interactiveOrigin !== null && (
          <iframe
            className={css.frame}
            title={previewBasename(view.path)}
            sandbox="allow-scripts allow-same-origin"
            src={view.interactiveOrigin}
            referrerPolicy="no-referrer"
          />
        )}
      </div>
      <RiskConfirmation
        open={confirming}
        title={t('interactive.confirm.title')}
        description={t('interactive.confirm.description')}
        acknowledgeLabel={t('interactive.confirm.acknowledge')}
        cancelLabel={t('interactive.confirm.cancel')}
        closeLabel={t('close')}
        confirmLabel={t('interactive.confirm.enable')}
        acknowledged={acknowledged}
        onAcknowledgedChange={setAcknowledged}
        onCancel={() => {
          setConfirming(false)
          setAcknowledged(false)
        }}
        onConfirm={() => {
          setConfirming(false)
          setAcknowledged(false)
          preview.enableInteractive(file.sessionId)
        }}
      />
    </div>
  )
}
