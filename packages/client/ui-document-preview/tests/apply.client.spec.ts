// @vitest-environment jsdom
/**
 * The plugin's registrations, and their removal when the plugin goes.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { DOCUMENT_PREVIEW_ID, DOCUMENT_PREVIEW_KIND } from '../src/client/definition.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import { DocumentPreviewPanel } from '../src/client/DocumentPreviewPanel.tsx'
import { en, zh } from '../src/client/locales.ts'

interface Recorded {
  name: string
  key: string
  locale: string
  inject: unknown
  component: unknown
}

async function boot() {
  const ctx = new Context()
  const tabs = new SidebarRightTabRegistry(ctx)
  const registered: Recorded[] = []
  const slots = {
    inject: vi.fn((_name: string, register: () => () => void) => register()),
    register: vi.fn((options: Omit<Recorded, 'component'>, component: unknown) => {
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
  }
  const workspaceFiles = { stat: vi.fn(), readBytes: vi.fn() }
  const interactivePreview = { start: vi.fn(), stop: vi.fn() }
  const session = { openWorkspacePath: vi.fn() }
  ctx.provide('sidebarRightTabs', tabs as never)
  ctx.provide('slots', slots as never)
  ctx.provide('locale', locale as never)
  ctx.provide('remote', { workspaceFiles, interactivePreview, session } as never)
  ctx.provide('remote.workspaceFiles', workspaceFiles as never)
  ctx.provide('remote.interactivePreview', interactivePreview as never)
  ctx.provide('remote.session', session as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { tabs, registered, dictionaries, fiber }
}

describe('ui-document-preview apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('registers the type, its dictionaries, and the body seat under the type\'s id', async () => {
    const { tabs, registered, dictionaries } = await boot()
    expect(tabs.get(DOCUMENT_PREVIEW_KIND)?.priority).toBe('builtin')
    expect(tabs.get(DOCUMENT_PREVIEW_KIND)?.id).toBe(DOCUMENT_PREVIEW_ID)
    expect(dictionaries.get('documentPreview')).toEqual({ zh, en })
    expect(registered.map(entry => [entry.name, entry.key, entry.locale, entry.component])).toEqual([
      ['sidebar.right.pane.tab', DOCUMENT_PREVIEW_ID, 'documentPreview', DocumentPreviewPanel],
    ])
    expect(typeof registered[0]?.inject).toBe('function')
    const injected = (registered[0]?.inject as (sessionId: string) => {
      preview: { state: (sessionId: string) => unknown }
      hooks: { previewView: unknown }
    })('s-1')
    expect(injected.hooks.previewView).toBe(injected.preview.state('s-1'))
  })

  it('takes every registration back when the plugin is disposed', async () => {
    const { tabs, registered, dictionaries, fiber } = await boot()
    await fiber.dispose()
    expect(tabs.get(DOCUMENT_PREVIEW_KIND)).toBeUndefined()
    expect(registered).toEqual([])
    expect(dictionaries.size).toBe(0)
  })
})
