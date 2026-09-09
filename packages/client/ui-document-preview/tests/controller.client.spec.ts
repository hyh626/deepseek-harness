// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InteractivePreviewId } from '@deepseek-ai/dsh-host-interactive-preview/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  DocumentPreviewController,
  type DocumentPreviewHost,
} from '../src/client/controller.ts'
import { previewMermaidRenderer } from '../src/client/mermaid.ts'

vi.mock('../src/client/mermaid.ts', () => ({
  previewMermaidRenderer: {
    render: vi.fn(async (source: string) => `<svg>${source}</svg>`),
  },
}))

afterEach(() => {
  vi.mocked(previewMermaidRenderer.render).mockReset()
  vi.mocked(previewMermaidRenderer.render).mockImplementation(async (source: string) => `<svg>${source}</svg>`)
})

const sid = (id: string): SessionId => id as SessionId

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function host() {
  const opened: string[] = []
  const readPreviewDocument = vi.fn<DocumentPreviewHost['readPreviewDocument']>(
    async () => ({ path: '/w/notes.md', format: 'markdown', content: '# Hi' }),
  )
  const readPreviewImage = vi.fn<DocumentPreviewHost['readPreviewImage']>(
    async () => ({ mediaType: 'image/png', data: 'AA==' }),
  )
  const startInteractivePreview = vi.fn<DocumentPreviewHost['startInteractivePreview']>(
    async () => ({ id: 'grant-1' as InteractivePreviewId, origin: 'http://abc.localhost:1' }),
  )
  const stopInteractivePreview = vi.fn<DocumentPreviewHost['stopInteractivePreview']>(
    async () => undefined,
  )
  return {
    opened,
    readPreviewDocument,
    readPreviewImage,
    startInteractivePreview,
    stopInteractivePreview,
    parentOrigin: 'http://127.0.0.1:3000',
    openPath: vi.fn(async (path: string) => { opened.push(path) }),
  }
}

describe('DocumentPreviewController', () => {
  it('loads a document and records ready state', async () => {
    const deps = host()
    const preview = new DocumentPreviewController(deps)
    preview.open(sid('s1'), 'notes.md')
    expect(preview.state(sid('s1')).getSnapshot().status).toBe('loading')
    await vi.waitFor(() => {
      expect(preview.state(sid('s1')).getSnapshot()).toMatchObject({
        status: 'ready',
        path: '/w/notes.md',
        format: 'markdown',
        content: '# Hi',
      })
    })
    preview.enableInteractive(sid('s1'))
    expect(deps.startInteractivePreview).not.toHaveBeenCalled()
  })

  it('cancels a superseded load and ignores its completion', async () => {
    const first = deferred<{ path: string; format: 'markdown'; content: string }>()
    const deps = host()
    deps.readPreviewDocument = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(async () => ({ path: '/w/two.md', format: 'markdown', content: '# Two' }))
    const preview = new DocumentPreviewController(deps)
    preview.open(sid('s1'), 'one.md')
    preview.open(sid('s1'), 'two.md')
    first.resolve({ path: '/w/one.md', format: 'markdown', content: '# One' })
    await Promise.resolve()
    await vi.waitFor(() => {
      expect(preview.state(sid('s1')).getSnapshot()).toMatchObject({
        status: 'ready',
        content: '# Two',
      })
    })
    expect(preview.state(sid('s1')).getSnapshot().content).not.toBe('# One')
  })

  it('records a host business error without throwing', async () => {
    const deps = host()
    deps.readPreviewDocument = vi.fn(async () => {
      const error = new Error('outside')
      Object.assign(error, { code: 'workspace-file/outside-workspace' })
      throw error
    })
    const preview = new DocumentPreviewController(deps)
    preview.open(sid('s1'), '../x.md')
    await vi.waitFor(() => {
      expect(preview.state(sid('s1')).getSnapshot()).toMatchObject({
        status: 'error',
        error: 'outside',
      })
    })
  })

  it('reloads the current path and closes into idle', async () => {
    const deps = host()
    const preview = new DocumentPreviewController(deps)
    preview.open(sid('s1'), 'notes.md')
    await vi.waitFor(() => {
      expect(preview.state(sid('s1')).getSnapshot().status).toBe('ready')
    })
    preview.reload(sid('s1'))
    expect(deps.readPreviewDocument).toHaveBeenLastCalledWith(sid('s1'), '/w/notes.md', expect.any(AbortSignal))
    await vi.waitFor(() => {
      expect(preview.state(sid('s1')).getSnapshot().status).toBe('ready')
    })
    preview.close(sid('s1'))
    expect(preview.state(sid('s1')).getSnapshot().status).toBe('idle')
  })

  it('disposes inflight work without publishing later', async () => {
    const pending = deferred<{ path: string; format: 'markdown'; content: string }>()
    const deps = host()
    deps.readPreviewDocument = vi.fn(() => pending.promise)
    const preview = new DocumentPreviewController(deps)
    preview.open(sid('s1'), 'notes.md')
    preview.dispose()
    pending.resolve({ path: '/w/notes.md', format: 'markdown', content: '# Hi' })
    await Promise.resolve()
    expect(preview.state(sid('s1')).getSnapshot().status).toBe('idle')
  })

  it('loads html with rewritten images and opens the path externally', async () => {
    const deps = host()
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    deps.readPreviewDocument = vi.fn(async () => ({
      path: '/w/page.html',
      format: 'html' as const,
      content: '<img src="./dot.png"><img src="./dot.png">',
    }))
    const preview = new DocumentPreviewController(deps)
    preview.open(sid('s1'), 'page.html')
    await vi.waitFor(() => {
      expect(preview.state(sid('s1')).getSnapshot().status).toBe('ready')
    })
    const view = preview.state(sid('s1')).getSnapshot()
    expect(view.format).toBe('html')
    expect(view.content).toContain('blob:')
    expect(view.content).toContain("script-src 'none'")
    preview.openExternal(sid('s1'))
    expect(deps.openPath).toHaveBeenCalledWith('/w/page.html')
    preview.openExternal(sid('missing'))
    expect(deps.openPath).toHaveBeenCalledTimes(1)
    preview.close(sid('s1'))
    expect(revoke).toHaveBeenCalled()
    preview.close(sid('missing'))
  })

  it('keeps the document when a relative image read fails', async () => {
    const deps = host()
    deps.readPreviewDocument = vi.fn(async () => ({
      path: '/w/notes.md',
      format: 'markdown' as const,
      content: '![x](./missing.png)',
    }))
    deps.readPreviewImage = vi.fn(async () => { throw new Error('nope') })
    const preview = new DocumentPreviewController(deps)
    preview.open(sid('s1'), 'notes.md')
    await vi.waitFor(() => {
      expect(preview.state(sid('s1')).getSnapshot().status).toBe('ready')
    })
    expect(preview.state(sid('s1')).getSnapshot().imageUrls).toEqual({})
  })

  it('revokes stale images when a load is superseded during image fetch', async () => {
    const secondDoc = deferred<{ path: string; format: 'markdown'; content: string }>()
    const image = deferred<{ mediaType: string; data: string }>()
    const deps = host()
    deps.readPreviewDocument = vi.fn()
      .mockImplementationOnce(async () => ({
        path: '/w/one.md', format: 'markdown' as const, content: '![x](./a.png)',
      }))
      .mockImplementationOnce(() => secondDoc.promise)
    deps.readPreviewImage = vi.fn(() => image.promise)
    const preview = new DocumentPreviewController(deps)
    preview.open(sid('s1'), 'one.md')
    await vi.waitFor(() => {
      expect(deps.readPreviewImage).toHaveBeenCalled()
    })
    preview.open(sid('s1'), 'two.md')
    image.resolve({ mediaType: 'image/png', data: 'AA==' })
    secondDoc.resolve({ path: '/w/two.md', format: 'markdown', content: '# Two' })
    await vi.waitFor(() => {
      expect(preview.state(sid('s1')).getSnapshot().content).toBe('# Two')
    })
  })

  it('ignores reload and maps non-rpc errors', async () => {
    const deps = host()
    const preview = new DocumentPreviewController(deps)
    preview.reload(sid('s1'))
    expect(deps.readPreviewDocument).not.toHaveBeenCalled()
    deps.readPreviewDocument = vi.fn(async () => { throw new Error('boom') })
    preview.open(sid('s1'), 'notes.md')
    await vi.waitFor(() => {
      expect(preview.state(sid('s1')).getSnapshot().error).toBe('boom')
    })
    deps.readPreviewDocument = vi.fn(async () => { throw 'plain' })
    preview.open(sid('s1'), 'notes.md')
    await vi.waitFor(() => {
      expect(preview.state(sid('s1')).getSnapshot().error).toBe('plain')
    })
  })

  it('ignores an error from a superseded load', async () => {
    const first = deferred<{ path: string; format: 'markdown'; content: string }>()
    const deps = host()
    deps.readPreviewDocument = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(async () => ({ path: '/w/two.md', format: 'markdown', content: '# Two' }))
    const preview = new DocumentPreviewController(deps)
    preview.open(sid('s1'), 'one.md')
    preview.open(sid('s1'), 'two.md')
    first.reject(new Error('stale'))
    await vi.waitFor(() => {
      expect(preview.state(sid('s1')).getSnapshot().content).toBe('# Two')
    })
    expect(preview.state(sid('s1')).getSnapshot().error).toBeNull()
  })

  it('mints an interactive grant after consent and keeps static HTML on failure', async () => {
    const deps = host()
    deps.readPreviewDocument = vi.fn(async () => ({
      path: '/w/page.html', format: 'html' as const, content: '<h1>App</h1>',
    }))
    const preview = new DocumentPreviewController(deps)
    preview.enableInteractive(sid('s1'))
    expect(deps.startInteractivePreview).not.toHaveBeenCalled()
    preview.open(sid('s1'), 'page.html')
    await vi.waitFor(() => {
      expect(preview.state(sid('s1')).getSnapshot().status).toBe('ready')
    })
    preview.enableInteractive(sid('s1'))
    preview.enableInteractive(sid('s1'))
    await vi.waitFor(() => {
      expect(preview.state(sid('s1')).getSnapshot()).toMatchObject({
        htmlMode: 'interactive',
        interactiveOrigin: 'http://abc.localhost:1',
        grantId: 'grant-1',
        startingInteractive: false,
      })
    })
    expect(deps.startInteractivePreview).toHaveBeenCalledTimes(1)
    expect(deps.startInteractivePreview).toHaveBeenCalledWith(
      sid('s1'), '/w/page.html', 'http://127.0.0.1:3000', expect.any(AbortSignal),
    )
    preview.enableInteractive(sid('s1'))
    expect(deps.startInteractivePreview).toHaveBeenCalledTimes(1)

    deps.stopInteractivePreview = vi.fn(async () => { throw new Error('stop failed') })
    preview.close(sid('s1'))
    preview.open(sid('s1'), 'page.html')
    await vi.waitFor(() => {
      expect(preview.state(sid('s1')).getSnapshot().status).toBe('ready')
    })
    preview.enableInteractive(sid('s1'))
    await vi.waitFor(() => {
      expect(preview.state(sid('s1')).getSnapshot()).toMatchObject({
        startingInteractive: false,
        interactiveError: 'stop failed',
      })
    })
    expect(deps.startInteractivePreview).toHaveBeenCalledTimes(1)

    deps.stopInteractivePreview = vi.fn(async () => undefined)
    deps.startInteractivePreview = vi.fn(async () => {
      const error = new Error('no provider')
      Object.assign(error, { code: 'interactive-preview/entry-not-html' })
      throw error
    })
    preview.enableInteractive(sid('s1'))
    await vi.waitFor(() => {
      expect(preview.state(sid('s1')).getSnapshot()).toMatchObject({
        htmlMode: 'static',
        grantId: null,
        interactiveOrigin: null,
        interactiveError: 'no provider',
        content: expect.stringContaining('<h1>App</h1>'),
      })
    })
  })

  it('replaces the grant on same-path reload and revokes consent on a different path', async () => {
    const deps = host()
    let grants = 0
    deps.readPreviewDocument = vi.fn(async (_sessionId, path) => ({
      path: path.endsWith('other.html') ? '/w/other.html' : '/w/page.html',
      format: 'html' as const,
      content: '<p>app</p>',
    }))
    deps.startInteractivePreview = vi.fn(async () => {
      grants += 1
      return { id: `grant-${grants}` as InteractivePreviewId, origin: `http://abc.localhost:${grants}` }
    })
    const preview = new DocumentPreviewController(deps)
    preview.open(sid('s1'), 'page.html')
    await vi.waitFor(() => {
      expect(preview.state(sid('s1')).getSnapshot().status).toBe('ready')
    })
    preview.enableInteractive(sid('s1'))
    await vi.waitFor(() => {
      expect(preview.state(sid('s1')).getSnapshot().grantId).toBe('grant-1')
    })
    preview.reload(sid('s1'))
    await vi.waitFor(() => {
      expect(preview.state(sid('s1')).getSnapshot()).toMatchObject({
        htmlMode: 'interactive',
        grantId: 'grant-2',
        interactiveOrigin: 'http://abc.localhost:2',
      })
    })
    expect(deps.stopInteractivePreview).toHaveBeenCalledWith('grant-1')
    preview.open(sid('s1'), 'other.html')
    await vi.waitFor(() => {
      expect(preview.state(sid('s1')).getSnapshot()).toMatchObject({
        path: '/w/other.html',
        htmlMode: 'static',
        grantId: null,
      })
    })
    expect(deps.stopInteractivePreview).toHaveBeenCalledWith('grant-2')
    expect(deps.startInteractivePreview).toHaveBeenCalledTimes(2)
  })

  it('stops a superseded grant start and maps non-rpc interactive errors', async () => {
    const start = deferred<{ id: InteractivePreviewId; origin: string }>()
    const deps = host()
    deps.readPreviewDocument = vi.fn(async (_sessionId, path) => ({
      path: path.endsWith('two.html') ? '/w/two.html' : '/w/one.html',
      format: 'html' as const,
      content: '<p>x</p>',
    }))
    deps.startInteractivePreview = vi.fn()
      .mockImplementationOnce(() => start.promise)
      .mockImplementationOnce(async () => {
        throw new Error('boom')
      })
    deps.stopInteractivePreview = vi.fn(async () => { throw new Error('already closed') })
    const preview = new DocumentPreviewController(deps)
    preview.open(sid('s1'), 'one.html')
    await vi.waitFor(() => {
      expect(preview.state(sid('s1')).getSnapshot().status).toBe('ready')
    })
    preview.enableInteractive(sid('s1'))
    preview.open(sid('s1'), 'two.html')
    start.resolve({ id: 'stale' as InteractivePreviewId, origin: 'http://stale.localhost:1' })
    await vi.waitFor(() => {
      expect(preview.state(sid('s1')).getSnapshot().path).toBe('/w/two.html')
    })
    await vi.waitFor(() => {
      expect(deps.stopInteractivePreview).toHaveBeenCalledWith('stale', expect.any(AbortSignal))
    })
    expect(preview.state(sid('s1')).getSnapshot().htmlMode).toBe('static')
    preview.enableInteractive(sid('s1'))
    await vi.waitFor(() => {
      expect(preview.state(sid('s1')).getSnapshot().interactiveError).toBe('boom')
    })
    deps.startInteractivePreview = vi.fn(async () => { throw 'plain' })
    preview.enableInteractive(sid('s1'))
    await vi.waitFor(() => {
      expect(preview.state(sid('s1')).getSnapshot().interactiveError).toBe('plain')
    })
    deps.startInteractivePreview = vi.fn(async () => { throw { code: 'x' } })
    preview.enableInteractive(sid('s1'))
    await vi.waitFor(() => {
      expect(preview.state(sid('s1')).getSnapshot().interactiveError).toBe('[object Object]')
    })
    const bare = new Error('hidden')
    Object.defineProperty(bare, 'message', { value: 1 })
    deps.startInteractivePreview = vi.fn(async () => { throw bare })
    preview.enableInteractive(sid('s1'))
    await vi.waitFor(() => {
      expect(preview.state(sid('s1')).getSnapshot().interactiveError).toBe(1)
    })
    deps.stopInteractivePreview = vi.fn(async () => undefined)
    preview.dispose()
  })

  it('replaces sanitized HTML mermaid with blob images', async () => {
    const deps = host()
    deps.readPreviewDocument = vi.fn(async () => ({
      path: '/w/page.html',
      format: 'html' as const,
      content: '<pre class="mermaid">graph TD; A-->B</pre><div class="mermaid">graph TD; C-->D</div>',
    }))
    const preview = new DocumentPreviewController(deps)
    preview.open(sid('s1'), 'page.html')
    await vi.waitFor(() => {
      expect(preview.state(sid('s1')).getSnapshot().status).toBe('ready')
    })
    const content = preview.state(sid('s1')).getSnapshot().content ?? ''
    expect(content).toContain('blob:')
    expect(content).not.toContain('class="mermaid"')
  })

  it('revokes mermaid images from a superseded html load and ignores a late grant failure', async () => {
    const mermaid = deferred<string>()
    const lateGrant = deferred<{ id: InteractivePreviewId; origin: string }>()
    vi.mocked(previewMermaidRenderer.render).mockImplementationOnce(() => mermaid.promise)
    const deps = host()
    deps.readPreviewDocument = vi.fn()
      .mockImplementationOnce(async () => ({
        path: '/w/one.html',
        format: 'html' as const,
        content: '<img src="./dot.png"><pre class="mermaid">graph TD; A-->B</pre>',
      }))
      .mockImplementationOnce(async () => ({
        path: '/w/two.html', format: 'html' as const, content: '<p>two</p>',
      }))
    const preview = new DocumentPreviewController(deps)
    preview.open(sid('s1'), 'one.html')
    await vi.waitFor(() => {
      expect(previewMermaidRenderer.render).toHaveBeenCalled()
    })
    preview.open(sid('s1'), 'two.html')
    mermaid.resolve('<svg></svg>')
    await vi.waitFor(() => {
      expect(preview.state(sid('s1')).getSnapshot().content).toContain('<p>two</p>')
    })

    deps.startInteractivePreview = vi.fn(() => lateGrant.promise)
    preview.enableInteractive(sid('s1'))
    preview.dispose()
    lateGrant.reject(new Error('late'))
    await Promise.resolve()
    expect(preview.state(sid('s1')).getSnapshot().status).toBe('idle')
  })

  it('aborts while replacing or closing a grant without publishing later', async () => {
    const stop = deferred<undefined>()
    const deps = host()
    deps.readPreviewDocument = vi.fn(async (_sessionId, path) => ({
      path: path.endsWith('two.html') ? '/w/two.html' : '/w/one.html',
      format: 'html' as const,
      content: '<p>x</p>',
    }))
    const preview = new DocumentPreviewController(deps)
    preview.open(sid('s1'), 'one.html')
    await vi.waitFor(() => {
      expect(preview.state(sid('s1')).getSnapshot().status).toBe('ready')
    })
    preview.enableInteractive(sid('s1'))
    await vi.waitFor(() => {
      expect(preview.state(sid('s1')).getSnapshot().grantId).toBe('grant-1')
    })
    deps.stopInteractivePreview = vi.fn(() => stop.promise)
    preview.reload(sid('s1'))
    await vi.waitFor(() => {
      expect(deps.stopInteractivePreview).toHaveBeenCalledWith('grant-1')
    })
    preview.dispose()
    stop.resolve(undefined)
    await Promise.resolve()
    expect(preview.state(sid('s1')).getSnapshot().status).toBe('idle')

    const stopChange = deferred<undefined>()
    const second = new DocumentPreviewController(deps)
    deps.stopInteractivePreview = vi.fn(async () => undefined)
    deps.startInteractivePreview = vi.fn(async () => ({
      id: 'grant-a' as InteractivePreviewId, origin: 'http://abc.localhost:3',
    }))
    second.open(sid('s1'), 'one.html')
    await vi.waitFor(() => {
      expect(second.state(sid('s1')).getSnapshot().status).toBe('ready')
    })
    second.enableInteractive(sid('s1'))
    await vi.waitFor(() => {
      expect(second.state(sid('s1')).getSnapshot().htmlMode).toBe('interactive')
    })
    deps.stopInteractivePreview = vi.fn(() => stopChange.promise)
    second.open(sid('s1'), 'two.html')
    await vi.waitFor(() => {
      expect(deps.stopInteractivePreview).toHaveBeenCalled()
    })
    second.dispose()
    stopChange.resolve(undefined)
    await Promise.resolve()
    expect(second.state(sid('s1')).getSnapshot().status).toBe('idle')
  })

  it('ignores a late stop failure after the start was superseded', async () => {
    const stop = deferred<undefined>()
    const deps = host()
    deps.readPreviewDocument = vi.fn(async () => ({
      path: '/w/page.html', format: 'html' as const, content: '<p>app</p>',
    }))
    const preview = new DocumentPreviewController(deps)
    preview.open(sid('s1'), 'page.html')
    await vi.waitFor(() => {
      expect(preview.state(sid('s1')).getSnapshot().status).toBe('ready')
    })
    preview.enableInteractive(sid('s1'))
    await vi.waitFor(() => {
      expect(preview.state(sid('s1')).getSnapshot().grantId).toBe('grant-1')
    })
    deps.stopInteractivePreview = vi.fn(() => stop.promise)
    preview.reload(sid('s1'))
    await vi.waitFor(() => {
      expect(deps.stopInteractivePreview).toHaveBeenCalled()
    })
    preview.dispose()
    stop.reject(new Error('late stop'))
    await Promise.resolve()
    expect(preview.state(sid('s1')).getSnapshot().status).toBe('idle')
  })
})
