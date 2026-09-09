// @vitest-environment jsdom
/**
 * createLayoutStore unit account: init shape, the action write set (clamp
 * inside actions), and the absence of browser persistence. Uses the
 * test-sanctioned path: factory self-call + .create() gives the
 * real engine instance (same create path as production).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { LayoutPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { createLayoutStore } from '@deepseek-ai/dsh-client-ui-layout/src/client/stores.ts'
import {
  SECONDARY_DEFAULT, SECONDARY_MIN,
  SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
} from '@deepseek-ai/dsh-client-ui-layout/src/client/columns.ts'

const PERSIST_KEY = 'dsh.layout.panels'
const PANEL_A = 'panel-a' as LayoutPanelId
const PANEL_B = 'panel-b' as LayoutPanelId

beforeEach(() => { localStorage.clear() })

describe('createLayoutStore', () => {
  it('initializes the sidebar at its default width, secondary panel closed, wide viewport assumed', () => {
    const { store } = createLayoutStore().create()
    expect(store.getSnapshot()).toEqual({
      sidebar: SIDEBAR_DEFAULT,
      secondary: 0,
      activePanel: null,
      narrow: false,
      narrowExpanded: false,
    })
  })

  it('each create() is an independent instance (factory is not a singleton)', () => {
    const a = createLayoutStore().create()
    const b = createLayoutStore().create()
    a.actions.setSidebar(400)
    expect(b.store.getSnapshot().sidebar).toBe(SIDEBAR_DEFAULT)
  })

  it('setSidebar clamps its range while setSecondary keeps widths above its floor', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(1)
    expect(store.getSnapshot().sidebar).toBe(SIDEBAR_MIN)
    actions.setSidebar(9999)
    expect(store.getSnapshot().sidebar).toBe(SIDEBAR_MAX)
    actions.setSecondary(1)
    expect(store.getSnapshot().secondary).toBe(SECONDARY_MIN)
    actions.setSecondary(9999)
    expect(store.getSnapshot().secondary).toBe(9999)
  })

  it('toggleSidebar flips closed <-> contract default (drag width forgotten)', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(400)
    actions.toggleSidebar()
    expect(store.getSnapshot().sidebar).toBe(0)
    actions.toggleSidebar()
    expect(store.getSnapshot().sidebar).toBe(SIDEBAR_DEFAULT)
  })

  it('narrow toggleSidebar flips only the re-expand override; the width preference survives', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(400)
    actions.setNarrow(true)
    actions.toggleSidebar()
    expect(store.getSnapshot()).toEqual({
      sidebar: 400,
      secondary: 0,
      activePanel: null,
      narrow: true,
      narrowExpanded: true,
    })
    actions.toggleSidebar()
    expect(store.getSnapshot().narrowExpanded).toBe(false)
    expect(store.getSnapshot().sidebar).toBe(400)
  })

  it('crossing the breakpoint drops the override; a same-value setNarrow keeps it', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setNarrow(true)
    actions.toggleSidebar()
    expect(store.getSnapshot().narrowExpanded).toBe(true)
    actions.setNarrow(true)
    expect(store.getSnapshot().narrowExpanded).toBe(true)
    actions.setNarrow(false)
    expect(store.getSnapshot()).toMatchObject({ narrow: false, narrowExpanded: false })
    actions.setNarrow(true)
    expect(store.getSnapshot().narrowExpanded).toBe(false)
  })

  it('opens exclusively, retains width, and lets only the active owner close', () => {
    const { store, actions } = createLayoutStore().create()
    actions.openPanel(PANEL_A)
    expect(store.getSnapshot()).toMatchObject({ activePanel: PANEL_A, secondary: SECONDARY_DEFAULT })
    actions.setSecondary(500)
    actions.openPanel(PANEL_B)
    expect(store.getSnapshot()).toMatchObject({ activePanel: PANEL_B, secondary: 500 })
    actions.closePanel(PANEL_A)
    expect(store.getSnapshot().activePanel).toBe(PANEL_B)
    actions.closePanel(PANEL_B)
    expect(store.getSnapshot()).toMatchObject({ activePanel: null, secondary: 500 })
    actions.openPanel(PANEL_A)
    expect(store.getSnapshot()).toMatchObject({ activePanel: PANEL_A, secondary: 500 })
  })

  it('does not persist panel geometry', () => {
    const first = createLayoutStore().create()
    first.actions.setSidebar(400)
    first.actions.openPanel(PANEL_A)
    first.actions.setSecondary(500)
    expect(localStorage.getItem(PERSIST_KEY)).toBeNull()

    const second = createLayoutStore().create()
    expect(second.store.getSnapshot()).toEqual({
      sidebar: SIDEBAR_DEFAULT,
      secondary: 0,
      activePanel: null,
      narrow: false,
      narrowExpanded: false,
    })
  })
})
