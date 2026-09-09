/**
 * LayoutController: the cross-plugin panel-action face behind ctx.layout.
 * Panel geometry itself lives in the root entry's layout store (stores.ts);
 * the current-session selection lives with the runtime sessions service, and
 * the per-session active view dissolved into ui-conversation's session store
 * (its only consumer). What remains here is the contract other plugins'
 * apply worlds reach for panel transitions (sidebar toggle from ui-sidebar,
 * secondary-panel open/close from feature plugins) — writes stay inside the store's
 * declared action set, delivered as the registration's bound actions.
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { createLayoutStore } from './stores.ts'

/** Opaque id of one entry in the layout's exclusive secondary-panel host. */
export type LayoutPanelId = Branded<'LayoutPanelId'>

/**
 * Brand a string as a {@link LayoutPanelId}.
 * @param id - Registered secondary-panel entry id.
 * @returns the same string, branded at compile time.
 */
export function LayoutPanelId(id: string): LayoutPanelId {
  return id as LayoutPanelId
}

/** The layout store's bound action set (framework-baked, draft params peeled). */
export type PanelActions = BoundActions<ReturnType<typeof createLayoutStore>>

/**
 * The outward layout face (`ctx.layout`): the panel transitions other
 * plugins may trigger — and exactly what a test fake must supply. The
 * attachPanels wiring hook stays on the concrete class (root-entry assembly
 * only).
 */
export interface ILayout {
  /** Toggle the sidebar panel (closed ⟷ contract default width). */
  toggleSidebar(): void
  /**
   * Open a registered secondary panel, replacing any active entry.
   * @param id - registered panel id.
   */
  openPanel(id: LayoutPanelId): void
  /**
   * Close the secondary panel only when the caller owns the active id.
   * @param id - caller's panel id.
   */
  closePanel(id: LayoutPanelId): void
}

/** Cross-plugin panel-action face (ctx.layout). */
export class LayoutController implements ILayout {
  #panels: PanelActions | undefined
  #activePanel: LayoutPanelId | null = null

  /**
   * @param isPanelRegistered - live registry query used to reject unknown panel ids.
   */
  constructor(private readonly isPanelRegistered: (id: LayoutPanelId) => boolean) {}

  /**
   * Adopt the root entry's bound store actions. Called from the root
   * registration's inject hook (a sanctioned assembly side effect), so the
   * face is live from the entry's first render; on entry re-register the
   * fresh actions overwrite the stale set.
   * @param actions - bound actions of the entry's layout store instance.
   */
  attachPanels(actions: PanelActions): void {
    this.#panels = actions
  }

  /** Toggle the sidebar panel (closed ⟷ contract default width). */
  toggleSidebar(): void {
    this.#require().toggleSidebar()
  }

  /** Open a registered panel, replacing the active panel. */
  openPanel(id: LayoutPanelId): void {
    const panels = this.#require()
    if (!this.isPanelRegistered(id)) throw new Error(`layout: secondary panel "${id}" is not registered`)
    panels.openPanel(id)
    this.#activePanel = id
  }

  /** Close only when the caller's id is active. */
  closePanel(id: LayoutPanelId): void {
    this.#require().closePanel(id)
    if (this.#activePanel === id) this.#activePanel = null
  }

  /** Close the tracked panel when its slot entry was unloaded or replaced. */
  reconcilePanels(): void {
    const active = this.#activePanel
    if (active === null || this.isPanelRegistered(active)) return
    this.#require().closePanel(active)
    this.#activePanel = null
  }

  #require(): PanelActions {
    // Callers are UI gestures, which cannot fire before the root entry
    // rendered (the inject hook runs in its first render) — reaching this
    // unwired is a boot-order bug, not a race to tolerate.
    if (this.#panels === undefined) throw new Error('layout: panel actions not wired (root entry not mounted)')
    return this.#panels
  }
}
