// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-document-preview/client'
import { DOCUMENT_PREVIEW_PANEL_ID } from '../src/client/controller.ts'

const SID = 'root-1' as SessionId

async function bench() {
  const runtime = await SlotTestRuntime.create()
  const layoutFake = { openPanel: vi.fn(), closePanel: vi.fn() }
  runtime.provide('layout', layoutFake)
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.provide('locale', locale)
  runtime.slots.installLocale(locale)
  await runtime.root.declare({
    secondaryPanel: { kind: 'list', scope: 'session' },
  }, () => null)
  const feature = await runtime.mount({ inject: [...inject], apply })
  runtime.renderRoot()
  return { runtime, layoutFake, feature }
}

describe('document preview open-file claim', () => {
  it('claims markdown and html, including uppercase extensions, and opens the panel', async () => {
    const b = await bench()
    b.runtime.workspaces.stub('readPreviewDocument', async (_sessionId, path) => ({
      path,
      format: 'markdown',
      content: '![plot](./plot.png)',
    }))
    let native = 0
    b.runtime.ctx.waterfall('conversation/open-file', { sessionId: SID, path: '/proj/NOTES.MD' }, () => { native += 1 })
    b.runtime.ctx.waterfall('conversation/open-file', { sessionId: SID, path: '/proj/site/Index.HTM' }, () => { native += 1 })
    expect(native).toBe(0)
    expect(b.layoutFake.openPanel).toHaveBeenCalledWith(DOCUMENT_PREVIEW_PANEL_ID)
    await vi.waitFor(() => {
      expect(b.runtime.workspaces.calls.some(c => c.method === 'readPreviewDocument')).toBe(true)
      expect(b.runtime.workspaces.calls.some(c => c.method === 'readPreviewImage')).toBe(true)
    })
    expect(b.runtime.workspaces.calls.some(c => c.method === 'openPath')).toBe(false)
    const preview = b.runtime.ctx.get('documentPreview')
    expect(preview).toBeDefined()
    preview?.openExternal(SID)
    await vi.waitFor(() => {
      expect(b.runtime.workspaces.calls.some(c => c.method === 'openPath')).toBe(true)
    })
    preview?.close(SID)
    expect(b.layoutFake.closePanel).toHaveBeenCalledWith(DOCUMENT_PREVIEW_PANEL_ID)
    expect(b.runtime.ctx.slots.entries('secondaryPanel')[0]?.inject?.()).toEqual({ preview })

    b.runtime.workspaces.stub('readPreviewDocument', async (_sessionId, path) => ({
      path,
      format: 'html',
      content: '<h1>App</h1>',
    }))
    b.runtime.ctx.waterfall('conversation/open-file', { sessionId: SID, path: '/proj/app.html' }, () => { native += 1 })
    await vi.waitFor(() => {
      expect(preview?.state(SID).getSnapshot().status).toBe('ready')
    })
    preview?.enableInteractive(SID)
    await vi.waitFor(() => {
      expect(b.runtime.workspaces.calls.some(c => c.method === 'startInteractivePreview')).toBe(true)
    })
    preview?.close(SID)
    expect(b.runtime.workspaces.calls.some(c => c.method === 'stopInteractivePreview')).toBe(true)
    await b.runtime.dispose()
  })

  it('delegates non-preview paths through next()', async () => {
    const b = await bench()
    let native = 0
    b.runtime.ctx.waterfall('conversation/open-file', { sessionId: SID, path: '/proj/src/a.ts' }, () => { native += 1 })
    expect(native).toBe(1)
    expect(b.layoutFake.openPanel).not.toHaveBeenCalled()
    expect(b.runtime.workspaces.calls.some(c => c.method === 'openPath')).toBe(false)
    await b.runtime.dispose()
  })
})
