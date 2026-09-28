/** Per-tab consent and grant state transitions. */
import { describe, expect, it } from 'vitest'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { InteractivePreviewId } from '@deepseek-ai/dsh-host-interactive-preview/types'
import { createInteractiveHtmlStore } from '../src/client/store.ts'

const TAB = 'tab-1' as TabId

describe('interactive html store', () => {
  it('starts empty and records consent', () => {
    const instance = createInteractiveHtmlStore().create()
    expect(instance.getSnapshot().byTab[TAB]).toBeUndefined()
    instance.actions.consent(TAB)
    expect(instance.getSnapshot().byTab[TAB]).toEqual({ consented: true })
  })

  it('records a live grant over consent and clears the failure', () => {
    const instance = createInteractiveHtmlStore().create()
    instance.actions.consent(TAB)
    instance.actions.failed(TAB, 'boom')
    expect(instance.getSnapshot().byTab[TAB]?.failure).toBe('boom')
    instance.actions.grant(TAB, InteractivePreviewId('g-1'))
    expect(instance.getSnapshot().byTab[TAB]).toEqual({ consented: true, grantId: InteractivePreviewId('g-1'), failure: undefined })
  })

  it('records a failure without losing consent', () => {
    const instance = createInteractiveHtmlStore().create()
    instance.actions.consent(TAB)
    instance.actions.failed(TAB, 'boom')
    expect(instance.getSnapshot().byTab[TAB]).toEqual({ consented: true, grantId: undefined, failure: 'boom' })
  })

  it('forgets a closed tab without touching others', () => {
    const instance = createInteractiveHtmlStore().create()
    instance.actions.consent(TAB)
    instance.actions.consent('tab-2' as TabId)
    instance.actions.forget(TAB)
    expect(instance.getSnapshot().byTab[TAB]).toBeUndefined()
    expect(instance.getSnapshot().byTab['tab-2' as TabId]).toEqual({ consented: true })
  })
})
