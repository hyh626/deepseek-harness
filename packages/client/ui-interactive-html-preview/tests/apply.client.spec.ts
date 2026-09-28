/**
 * The plugin's registrations, and their removal when the plugin goes.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { InteractivePreviewId } from '@deepseek-ai/dsh-host-interactive-preview/types'
import { apply as nodeApply } from '../src/index.ts'
import { apply, inject, INTERACTIVE_HTML_ID, interactiveHtmlDefinition } from '../src/client/index.ts'
import { InteractiveHtmlBody } from '../src/client/InteractiveHtmlBody.tsx'
import { EnableInteractiveAction } from '../src/client/EnableInteractiveAction.tsx'
import { createInteractiveHtmlStore } from '../src/client/store.ts'
import { en, zh } from '../src/client/locales.ts'

interface Recorded {
  name: string
  key?: string
  locale?: string
  inject?: unknown
  component?: unknown
}

async function boot() {
  const ctx = new Context()
  const registered: Recorded[] = []
  const disposers = vi.fn()
  const slots = {
    inject: vi.fn((_name: string, register: () => () => void) => register()),
    register: vi.fn((options: Recorded, component: unknown) => {
      const entry: Recorded = { ...options, component }
      registered.push(entry)
      return () => { registered.splice(registered.indexOf(entry), 1) }
    }),
  }
  const dictionaries = new Map<string, unknown>()
  const locale = {
    register: vi.fn((ns: string, dicts: unknown) => {
      dictionaries.set(ns, dicts)
      return () => { dictionaries.delete(ns) }
    }),
    bind: () => (key: string): string => key,
  }
  const definitions: unknown[] = []
  const documentPreviews = {
    register: vi.fn((definition: unknown) => {
      definitions.push(definition)
      disposers()
      return () => { definitions.pop() }
    }),
  }
  ctx.provide('slots', slots as never)
  ctx.provide('locale', locale as never)
  ctx.provide('documentPreviews', documentPreviews as never)
  ctx.provide('remote', {} as never)
  ctx.provide('remote.interactivePreview', {} as never)
  ctx.provide('remote.workspaceFiles', {} as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { registered, dictionaries, definitions, fiber, documentPreviews }
}

describe('ui-interactive-html-preview apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(nodeApply).not.toThrow()
  })

  it('declares the interactive renderer for session-scoped HTML files', async () => {
    const definition = interactiveHtmlDefinition(() => 'Interactive HTML')
    expect(definition).toEqual({
      id: INTERACTIVE_HTML_ID,
      extensions: ['html', 'htm'],
      priority: 'builtin',
      title: expect.any(Function),
      loading: 'renderer',
      wrap: false,
    })
    expect(definition.title()).toBe('Interactive HTML')
  })

  it('registers the dictionary, the metadata, and both keyed seats', async () => {
    const { registered, dictionaries, definitions } = await boot()
    expect(dictionaries.get('interactiveHtml')).toEqual({ zh, en })
    expect(definitions).toHaveLength(1)
    expect(registered.map(entry => [entry.name, entry.key, entry.locale, entry.component])).toEqual([
      ['sidebar.right.tab.document', INTERACTIVE_HTML_ID, 'interactiveHtml', InteractiveHtmlBody],
      ['sidebar.right.tab.document.action', INTERACTIVE_HTML_ID, 'interactiveHtml', EnableInteractiveAction],
    ])
    const body = registered[0]
    expect(typeof body?.inject).toBe('function')
    expect(createInteractiveHtmlStore).toBeDefined()
    const injected = (body?.inject as () => Record<string, unknown>)()
    expect(Object.keys(injected).sort()).toEqual(['start', 'stop'])
  })

  it('binds the injected face to the preview Remotes', async () => {
    const stat = vi.fn(async () => ({ ok: true as const, value: { version: 'v9', absolutePath: '/w/page.html' } }))
    const start = vi.fn(async () => ({ ok: true as const, value: { id: InteractivePreviewId('g-9'), origin: 'http://x.localhost:1' } }))
    const stop = vi.fn(async () => ({ ok: true as const, value: null }))
    const ctx = new Context()
    const slots = {
      inject: vi.fn((_name: string, register: () => () => void) => register()),
      register: vi.fn(() => () => {}),
    }
    ctx.provide('slots', slots as never)
    ctx.provide('locale', { register: () => () => {}, bind: () => (key: string): string => key } as never)
    ctx.provide('documentPreviews', { register: () => () => {} } as never)
    ctx.provide('remote', { interactivePreview: { start, stop }, workspaceFiles: { stat } } as never)
    ctx.provide('remote.interactivePreview', { start, stop } as never)
    ctx.provide('remote.workspaceFiles', { stat } as never)
    const captured: Array<() => unknown> = []
    slots.register.mockImplementation((options?: { inject?: () => unknown }) => {
      captured.push(options?.inject as () => unknown)
      return () => {}
    })
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const injected = captured[0] as () => {
      start: (file: { sessionId: string; path: string }, parent: string, signal: AbortSignal) => Promise<unknown>
    }
    const face = injected()
    const result = await face.start(
      { sessionId: 's-1', path: 'work/page.html' }, 'http://127.0.0.1:3080', new AbortController().signal,
    )
    expect(stat).toHaveBeenCalledWith('s-1', 'work/page.html', expect.any(AbortSignal))
    expect(start).toHaveBeenCalledWith('s-1', 'work/page.html', 'http://127.0.0.1:3080', expect.any(AbortSignal))
    expect(result).toEqual({ ok: true, value: { version: 'v9', id: InteractivePreviewId('g-9'), origin: 'http://x.localhost:1' } })
    await fiber.dispose()
  })

  it('takes every registration back when the plugin is disposed', async () => {
    const { registered, dictionaries, definitions, fiber, documentPreviews } = await boot()
    await fiber.dispose()
    expect(registered).toHaveLength(0)
    expect(definitions).toHaveLength(0)
    expect(dictionaries.size).toBe(0)
    expect(documentPreviews.register).toHaveBeenCalled()
  })
})
