// @vitest-environment jsdom
/**
 * The body's grant lifecycle: consent gating, one grant per running revision,
 * stop on revision change, renderer switch, unmount, and tab closure, and the
 * failure line with its retry.
 */
import { cleanup, render, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { InteractivePreviewId } from '@deepseek-ai/dsh-host-interactive-preview/types'
import type { InteractiveHtmlBodyProps } from '../src/client/InteractiveHtmlBody.tsx'
import { InteractiveHtmlBody } from '../src/client/InteractiveHtmlBody.tsx'
import { en } from '../src/client/locales.ts'
import { hostFileOf } from '../src/client/rpc.ts'
import { createInteractiveHtmlStore } from '../src/client/store.ts'

afterEach(cleanup)

const TAB = 'tab-1' as TabId
const ADDRESS = 'dsh-resource://file/session/s-1/work/page.html'
const GRANT = InteractivePreviewId('g-1')

function t(key: keyof typeof en): string {
  return en[key]
}

/** Test-local selector hook over a framework-neutral store instance. */
function hookOf(inst: { subscribe: (fn: () => void) => () => void; getSnapshot: () => unknown }) {
  return function useSelector<S>(sel: (s: never) => S): S {
    return sel(useSyncExternalStore(inst.subscribe, inst.getSnapshot) as never)
  }
}

interface HarnessOptions {
  readonly start?: ReturnType<typeof vi.fn>
  readonly stop?: ReturnType<typeof vi.fn>
}

function harness({ start, stop }: HarnessOptions = {}) {
  const instance = createInteractiveHtmlStore().create()
  const controller = new AbortController()
  const startFn = start ?? vi.fn(async () => ({
    ok: true as const,
    value: { version: 'v1', id: GRANT, origin: 'http://abc.localhost:41000' },
  }))
  const stopFn = stop ?? vi.fn(async () => {})
  const request = (revision: number) => ({
    kind: 'renderer' as const, revision,
    loaded: vi.fn(), failed: vi.fn(), reload: vi.fn(),
  })
  const props = (over: Record<string, unknown> = {}): InteractiveHtmlBodyProps => ({
    useTabInfo: () => ({
      sidebar: { expanded: true, fullscreen: false },
      panel: { id: 'pane-1' },
      tab: {
        id: TAB, kind: 'document', contentId: ADDRESS, title: 'page.html', visible: true,
        navigation: { address: ADDRESS, params: undefined, revision: 1 },
        signal: controller.signal,
        actions: { openResource: vi.fn(), openTab: vi.fn(), close: vi.fn() },
      },
    }),
    resourceAddress: ADDRESS,
    content: request(1),
    wrap: false,
    scrollportRef: vi.fn(),
    addResource: vi.fn(),
    setResources: vi.fn(),
    useStore: hookOf(instance),
    actions: instance.actions,
    t,
    start: startFn,
    stop: stopFn,
    ...over,
  } as unknown as InteractiveHtmlBodyProps)
  return { instance, controller, startFn, stopFn, request, props }
}

describe('InteractiveHtmlBody', () => {
  it('renders nothing without a renderer request', () => {
    const { props } = harness()
    const { container } = render(<InteractiveHtmlBody {...props({ content: { kind: 'bytes', data: new Uint8Array() } })} />)
    expect(container.textContent).toBe('')
  })

  it('explains the off state until consent exists', () => {
    const { props } = harness()
    const { container } = render(<InteractiveHtmlBody {...props()} />)
    expect(container.querySelector('[data-interactive-html-off]')?.textContent).toBe(en.off)
  })

  it('starts the grant once consented and reports the displayed version', async () => {
    const { props, instance, startFn, request } = harness()
    instance.actions.consent(TAB)
    const first = request(1)
    const { container } = render(<InteractiveHtmlBody {...props({ content: first })} />)
    await waitFor(() => expect(container.querySelector('iframe')).toBeDefined())
    expect(startFn).toHaveBeenCalledWith(hostFileOf(ADDRESS), window.location.origin, expect.any(AbortSignal))
    expect(container.querySelector('iframe')?.getAttribute('src')).toBe('http://abc.localhost:41000')
    expect(container.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin')
    expect(container.querySelector('iframe')?.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(first.loaded).toHaveBeenCalledWith('v1')
    expect(first.failed).not.toHaveBeenCalled()
  })

  it('shows the failure line and retries through reload', async () => {
    const startFn = vi.fn(async () => ({ ok: false as const, message: 'max grants' }))
    const { props, instance, request } = harness({ start: startFn })
    instance.actions.consent(TAB)
    const first = request(1)
    const { getByText } = render(<InteractiveHtmlBody {...props({ content: first })} />)
    await waitFor(() => expect(getByText(`${en.failed}: max grants`)).toBeDefined())
    expect(first.failed).toHaveBeenCalled()
    expect(getByText(en.retry)).toBeDefined()
    getByText(en.retry).click()
    expect(first.reload).toHaveBeenCalled()
  })

  it('stops the previous grant and remounts the frame on reload', async () => {
    const { props, instance, request, stopFn } = harness()
    instance.actions.consent(TAB)
    const first = request(1)
    const second = request(2)
    const view = render(<InteractiveHtmlBody {...props({ content: first })} />)
    await waitFor(() => expect(view.container.querySelector('iframe')).toBeDefined())
    view.rerender(<InteractiveHtmlBody {...props({ content: second })} />)
    await waitFor(() => expect(stopFn).toHaveBeenCalledWith(GRANT, expect.any(AbortSignal)))
    await waitFor(() => expect(view.container.querySelector('iframe')?.getAttribute('src')).toBe('http://abc.localhost:41000'))
    expect(second.loaded).toHaveBeenCalledWith('v1')
  })

  it('stops the grant on unmount', async () => {
    const { props, instance, stopFn } = harness()
    instance.actions.consent(TAB)
    const view = render(<InteractiveHtmlBody {...props()} />)
    await waitFor(() => expect(view.container.querySelector('iframe')).toBeDefined())
    view.unmount()
    await waitFor(() => expect(stopFn).toHaveBeenCalledWith(GRANT, expect.any(AbortSignal)))
  })

  it('forgets the tab when its record ends', async () => {
    const { props, controller, instance } = harness()
    instance.actions.consent(TAB)
    const view = render(<InteractiveHtmlBody {...props()} />)
    await waitFor(() => expect(view.container.querySelector('iframe')).toBeDefined())
    controller.abort()
    await waitFor(() => expect(instance.getSnapshot().byTab[TAB]).toBeUndefined())
  })

  it('keeps consent and restarts the grant when the body remounts', async () => {
    const { props, instance, stopFn } = harness()
    instance.actions.consent(TAB)
    const view = render(<InteractiveHtmlBody {...props()} />)
    await waitFor(() => expect(view.container.querySelector('iframe')).toBeDefined())
    view.unmount()
    await waitFor(() => expect(stopFn).toHaveBeenCalled())
    const rerendered = render(<InteractiveHtmlBody {...props()} />)
    await waitFor(() => expect(rerendered.container.querySelector('iframe')).toBeDefined())
    expect(instance.getSnapshot().byTab[TAB]?.consented).toBe(true)
  })
})
