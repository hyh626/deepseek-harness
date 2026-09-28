/** Consent-gated interactive HTML in an iframe served from a Host-minted unique origin. */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InteractivePreviewId } from '@deepseek-ai/dsh-host-interactive-preview/types'
import type { DocumentPreviewProps } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type { RemoteOutcome, SessionFile } from './rpc.ts'
import { hostFileOf } from './rpc.ts'
import type { InteractiveHtmlStore } from './store.ts'
import css from './InteractiveHtmlBody.module.css'

/** Standard document inputs plus this renderer's dictionary and callbacks. */
export type InteractiveHtmlBodyProps = DocumentPreviewProps & PropsStore<InteractiveHtmlStore>
  & PropsLocale<'interactiveHtml'> & InjectFace<InteractiveHtmlInjected>

/** Grant lifecycle callbacks supplied by the plugin. */
export interface InteractiveHtmlInjected {
  /**
   * Stat the entry, then mint one isolated origin for it.
   * @param file - addressed Session and entry path.
   * @param parentOrigin - the embedding application's origin for CSP `frame-ancestors`.
   * @param signal - cancels the calls.
   * @returns the stat's version and the minted grant, or a displayable failure.
   */
  readonly start: (
    file: SessionFile,
    parentOrigin: string,
    signal: AbortSignal,
  ) => Promise<RemoteOutcome<{ readonly version: string; readonly id: InteractivePreviewId; readonly origin: string }>>
  /**
   * Close one preview grant. Missing ids are a no-op on the Host.
   * @param id - grant returned from {@link InteractiveHtmlInjected.start}.
   * @param signal - cancels the call.
   */
  readonly stop: (id: InteractivePreviewId, signal: AbortSignal) => Promise<void>
}

/**
 * Run the consented file on its isolated origin, one grant per body mount.
 *
 * The grant lives exactly as long as this body mounts a running revision:
 * revision changes, renderer switches, and tab closure each stop it. Consent
 * survives in the tab store, so returning to this renderer restarts the grant
 * without asking again, while a new tab asks once for its own file.
 * @param props - renderer loading request, tab state, grant callbacks, and locale.
 * @returns the isolated-origin frame, a status line, or the consent handoff.
 */
export function InteractiveHtmlBody(props: InteractiveHtmlBodyProps): ReactNode {
  const { tab } = props.useTabInfo()
  const request = props.content.kind === 'renderer' ? props.content : undefined
  const revision = request?.revision
  const held = props.useStore(state => state.byTab[tab.id])
  const consented = held?.consented === true
  const [running, setRunning] = useState<{ readonly origin: string } | undefined>()
  const grantRef = useRef<InteractivePreviewId | undefined>(undefined)

  useEffect(() => {
    const onAbort = (): void => { props.actions.forget(tab.id) }
    tab.signal.addEventListener('abort', onAbort)
    return () => { tab.signal.removeEventListener('abort', onAbort) }
  }, [props.actions, tab.id, tab.signal])

  useEffect(() => {
    if (request === undefined || !consented || tab.signal.aborted) return
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, tab.signal])
    const file = hostFileOf(props.resourceAddress)
    const reported = request
    void (async () => {
      const result = await props.start(file, window.location.origin, signal)
      if (signal.aborted) return
      if (!result.ok) {
        props.actions.failed(tab.id, result.message)
        reported.failed()
        return
      }
      grantRef.current = result.value.id
      props.actions.grant(tab.id, result.value.id)
      setRunning({ origin: result.value.origin })
      reported.loaded(result.value.version)
    })()
    return () => {
      controller.abort()
      const id = grantRef.current
      grantRef.current = undefined
      setRunning(undefined)
      if (id !== undefined) void props.stop(id, tab.signal)
    }
    // Metadata may replace the request object without advancing the revision.
  }, [revision, consented, props.resourceAddress, props.actions, props.start, props.stop, tab.id, tab.signal])

  if (request === undefined) return null
  if (!consented) {
    return <p className={css.status} data-interactive-html-off>{props.t('off')}</p>
  }
  if (held?.failure !== undefined) {
    return <div className={css.statusBlock}>
      <p className={css.status} role="alert">{props.t('failed')}: {held.failure}</p>
      <Button size="sm" onClick={request.reload}>{props.t('retry')}</Button>
    </div>
  }
  if (running === undefined) return <p className={css.status}>{props.t('starting')}</p>
  return <iframe
    key={request.revision}
    className={css.frame}
    src={running.origin}
    sandbox="allow-scripts allow-same-origin"
    referrerPolicy="no-referrer"
    title={props.t('frame')}
    data-interactive-html-preview
  />
}
