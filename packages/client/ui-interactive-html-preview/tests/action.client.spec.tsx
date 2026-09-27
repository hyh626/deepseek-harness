// @vitest-environment jsdom
/** The toolbar consent control: offered per renderer revision, armed through the risk confirmation. */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { EnableInteractiveActionProps } from '../src/client/EnableInteractiveAction.tsx'
import { EnableInteractiveAction } from '../src/client/EnableInteractiveAction.tsx'
import { en } from '../src/client/locales.ts'
import { createInteractiveHtmlStore, type InteractiveHtmlStore } from '../src/client/store.ts'

afterEach(cleanup)

const TAB = 'tab-1' as TabId

function t(key: keyof typeof en): string {
  return en[key]
}

/** Test-local selector hook over a framework-neutral store instance. */
function hookOf(inst: { subscribe: (fn: () => void) => () => void; getSnapshot: () => unknown }) {
  return function useSelector<S>(sel: (s: never) => S): S {
    return sel(useSyncExternalStore(inst.subscribe, inst.getSnapshot) as never)
  }
}

function props(store: ReturnType<InteractiveHtmlStore['create']>, content: unknown): EnableInteractiveActionProps {
  return {
    useTabInfo: () => ({
      sidebar: { expanded: true, fullscreen: false },
      panel: { id: 'pane-1' },
      tab: {
        id: TAB, kind: 'document', contentId: 'dsh-resource://file/session/s-1/work/page.html', title: 'page.html', visible: true,
        navigation: { address: 'dsh-resource://file/session/s-1/work/page.html', params: undefined, revision: 1 },
        signal: new AbortController().signal,
        actions: { openResource: vi.fn(), openTab: vi.fn(), close: vi.fn() },
      },
    }),
    content,
    useStore: hookOf(store),
    actions: store.actions,
    t,
  } as unknown as EnableInteractiveActionProps
}

describe('EnableInteractiveAction', () => {
  it('renders nothing for non-renderer content or an already-consented tab', () => {
    const store = createInteractiveHtmlStore().create()
    const request = { kind: 'renderer', revision: 1, loaded: vi.fn(), failed: vi.fn(), reload: vi.fn() }
    const view = render(<EnableInteractiveAction {...props(store, request)} />)
    expect(view.getByText(en.enable)).toBeDefined()
    view.rerender(<EnableInteractiveAction {...props(store, { kind: 'bytes', data: new Uint8Array() })} />)
    expect(view.container.textContent).toBe('')
    store.actions.consent(TAB)
    view.rerender(<EnableInteractiveAction {...props(store, request)} />)
    expect(view.container.textContent).toBe('')
  })

  it('arms consent through the confirmation and closes without it', () => {
    const store = createInteractiveHtmlStore().create()
    const request = { kind: 'renderer', revision: 1, loaded: vi.fn(), failed: vi.fn(), reload: vi.fn() }
    const view = render(<EnableInteractiveAction {...props(store, request)} />)
    fireEvent.click(view.getByText(en.enable))
    expect(view.getByText(en['confirm.title'])).toBeDefined()
    fireEvent.click(view.getByText(en['confirm.cancel']))
    expect(store.getSnapshot().byTab[TAB]).toBeUndefined()
    fireEvent.click(view.getByText(en.enable))
    fireEvent.click(view.getByText(en['confirm.acknowledge']))
    fireEvent.click(view.getAllByText(en['confirm.enable']).at(-1) as Element)
    expect(store.getSnapshot().byTab[TAB]).toEqual({ consented: true })
    expect(view.container.textContent).toBe('')
  })
})
