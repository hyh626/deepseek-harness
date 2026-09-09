/**
 * Secondary-panel occupant for workspace Markdown and static HTML preview.
 */

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import { Button, MarkdownText, RiskConfirmation } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { IDocumentPreview } from './controller.ts'
import { previewBasename } from './resources.ts'
import { previewMermaidRenderer } from './mermaid.ts'
import css from './DocumentPreviewPanel.module.css'

/** Injected preview controller. */
export interface DocumentPreviewInjected {
  /** Session-scoped preview loader. */
  preview: IDocumentPreview
}

/** Full panel props: session runtime share, injected controller, locale. */
export type DocumentPreviewSlotProps =
  PropsRuntime<'secondaryPanel'> & DocumentPreviewInjected & PropsLocale<'documentPreview'>

/**
 * Render the exclusive document-preview secondary panel.
 * @param props - Session id, preview controller, and localized copy.
 */
export function DocumentPreviewPanel({
  sessionId, preview, t,
}: DocumentPreviewSlotProps) {
  const store = preview.state(sessionId)
  const view = useSyncExternalStore(
    listener => store.subscribe(listener),
    () => store.getSnapshot(),
  )
  const resolveImageSrc = useCallback((url: string) => view.imageUrls[url], [view.imageUrls])
  const mermaid = useMemo(() => previewMermaidRenderer, [])
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
            onClick={() => { preview.reload(sessionId) }}
          >
            {t('reload')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={view.path === null}
            onClick={() => { preview.openExternal(sessionId) }}
          >
            {t('openExternal')}
          </Button>
          <button
            type="button"
            className={css.close}
            aria-label={t('close')}
            onClick={() => { preview.close(sessionId) }}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
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
          preview.enableInteractive(sessionId)
        }}
      />
    </div>
  )
}
