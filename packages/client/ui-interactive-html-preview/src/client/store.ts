/** Interactive-preview store: per-tab consent and grant state shared by the body and its toolbar control. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { InteractivePreviewId } from '@deepseek-ai/dsh-host-interactive-preview/types'

/** One tab's interactive grant state: consent plus the live grant, if any. */
export interface InteractiveHtmlTabState {
  /** The user acknowledged the risk confirmation for this tab's file. */
  readonly consented: boolean
  /** The live grant id while the isolated origin serves this tab. */
  readonly grantId?: InteractivePreviewId | undefined
  /** Displayable start failure; absent while starting or running. */
  readonly failure?: string | undefined
}

/** Interactive-preview state, isolated by tab identity. */
export interface InteractiveHtmlState {
  byTab: Record<TabId, InteractiveHtmlTabState>
}

type InteractiveHtmlActions = {
  consent: (state: InteractiveHtmlState, tab: TabId) => void
  grant: (state: InteractiveHtmlState, tab: TabId, id: InteractivePreviewId) => void
  failed: (state: InteractiveHtmlState, tab: TabId, message: string) => void
  forget: (state: InteractiveHtmlState, tab: TabId) => void
}

/**
 * Retain per-tab interactive-preview consent and grant state within a Session.
 * @returns the tab-state store declaration.
 */
export function createInteractiveHtmlStore(): EngineStoreHandle<InteractiveHtmlState, InteractiveHtmlActions> {
  return defineStore({
    init: (): InteractiveHtmlState => ({ byTab: {} }),
    actions: {
      /** @param state - draft. @param tab - owning tab. */
      consent(state, tab: TabId) {
        state.byTab[tab] = { consented: true }
      },
      /** @param state - draft. @param tab - owning tab. @param id - minted grant. */
      grant(state, tab: TabId, id: InteractivePreviewId) {
        const held = state.byTab[tab]
        if (held !== undefined) state.byTab[tab] = { ...held, grantId: id, failure: undefined }
      },
      /** @param state - draft. @param tab - owning tab. @param message - displayable start failure. */
      failed(state, tab: TabId, message: string) {
        const held = state.byTab[tab]
        if (held !== undefined) state.byTab[tab] = { ...held, grantId: undefined, failure: message }
      },
      /** @param state - draft. @param tab - closed tab. */
      forget(state, tab: TabId) {
        const { [tab]: _closed, ...remaining } = state.byTab
        state.byTab = remaining
      },
    },
  })
}

/** Store declaration used by the body and its toolbar control. */
export type InteractiveHtmlStore = ReturnType<typeof createInteractiveHtmlStore>
