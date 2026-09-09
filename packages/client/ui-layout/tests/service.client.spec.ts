/**
 * LayoutController behavior: the cross-plugin panel-action face. Geometry
 * lives in the entry store (layout-store.spec.ts) — here we assert the
 * delegation contract: attachPanels wiring, the three actions forwarding, the
 * unwired fail-loud, and re-attach overwriting a stale action set.
 */
import { describe, expect, it, vi } from 'vitest'
import { LayoutController } from '@deepseek-ai/dsh-client-ui-layout/src/client/service.ts'
import { LayoutPanelId, type PanelActions } from '@deepseek-ai/dsh-client-ui-layout/src/client/service.ts'

const TOOL_DETAILS = LayoutPanelId('tool-details')
const DOCUMENT_PREVIEW = LayoutPanelId('document-preview')

function fakePanels(): PanelActions {
  return {
    setSidebar: vi.fn(),
    setSecondary: vi.fn(),
    toggleSidebar: vi.fn(),
    setNarrow: vi.fn(),
    openPanel: vi.fn(),
    closePanel: vi.fn(),
  }
}

describe('LayoutController', () => {
  it('owns the constructor for secondary-panel ids', () => {
    expect(LayoutPanelId('tool-details')).toBe('tool-details')
  })

  it('opens registered panels exclusively and closes by owner id', () => {
    const service = new LayoutController(id => id === TOOL_DETAILS || id === DOCUMENT_PREVIEW)
    const panels = fakePanels()
    service.attachPanels(panels)

    service.toggleSidebar()
    service.openPanel(TOOL_DETAILS)
    service.openPanel(DOCUMENT_PREVIEW)
    service.closePanel(TOOL_DETAILS)

    expect(panels.toggleSidebar).toHaveBeenCalledTimes(1)
    expect(panels.openPanel).toHaveBeenNthCalledWith(1, TOOL_DETAILS)
    expect(panels.openPanel).toHaveBeenNthCalledWith(2, DOCUMENT_PREVIEW)
    expect(panels.closePanel).toHaveBeenCalledWith(TOOL_DETAILS)
    expect(panels.setSidebar).not.toHaveBeenCalled()
    expect(panels.setSecondary).not.toHaveBeenCalled()
  })

  it('refuses an unregistered panel without changing layout state', () => {
    const service = new LayoutController(id => id === TOOL_DETAILS)
    const panels = fakePanels()
    service.attachPanels(panels)

    expect(() => { service.openPanel(DOCUMENT_PREVIEW) }).toThrow(/not registered/)
    expect(panels.openPanel).not.toHaveBeenCalled()
  })

  it('fails loud before the root entry wired its actions', () => {
    const service = new LayoutController(() => true)
    expect(() => { service.toggleSidebar() }).toThrow(/panel actions not wired/)
    expect(() => { service.openPanel(TOOL_DETAILS) }).toThrow(/panel actions not wired/)
    expect(() => { service.closePanel(TOOL_DETAILS) }).toThrow(/panel actions not wired/)
  })

  it('re-attach overwrites the stale action set (entry re-register)', () => {
    const service = new LayoutController(() => true)
    const stale = fakePanels()
    const fresh = fakePanels()
    service.attachPanels(stale)
    service.attachPanels(fresh)

    service.toggleSidebar()

    expect(stale.toggleSidebar).not.toHaveBeenCalled()
    expect(fresh.toggleSidebar).toHaveBeenCalledTimes(1)
  })
})
