/** Toolbar control arming one tab's interactive grant after the risk confirmation. */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, RiskConfirmation } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InteractiveHtmlStore } from './store.ts'

/** Toolbar inputs sharing the body's per-tab consent store. */
export type EnableInteractiveActionProps = PropsRuntime<'sidebar.right.tab.document.action'>
  & PropsStore<InteractiveHtmlStore> & PropsLocale<'interactiveHtml'>

/**
 * Offer the interactive mode for the file this toolbar acts on, until consent exists.
 * @param props - toolbar revision, tab reader, per-tab store, and localized copy.
 * @returns the enable control with its confirmation, or nothing once armed.
 */
export function EnableInteractiveAction(props: EnableInteractiveActionProps): ReactNode {
  const { tab } = props.useTabInfo()
  const held = props.useStore(state => state.byTab[tab.id])
  const [confirming, setConfirming] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  if (props.content.kind !== 'renderer' || held?.consented === true) return null
  return <>
    <Button size="sm" onClick={() => setConfirming(true)}>{props.t('enable')}</Button>
    <RiskConfirmation
      open={confirming}
      title={props.t('confirm.title')}
      description={props.t('confirm.description')}
      acknowledgeLabel={props.t('confirm.acknowledge')}
      cancelLabel={props.t('confirm.cancel')}
      closeLabel={props.t('confirm.cancel')}
      confirmLabel={props.t('confirm.enable')}
      acknowledged={acknowledged}
      onAcknowledgedChange={setAcknowledged}
      onCancel={() => setConfirming(false)}
      onConfirm={() => {
        setConfirming(false)
        props.actions.consent(tab.id)
      }}
    />
  </>
}
