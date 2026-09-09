/**
 * The address-to-read translation and the Remote unwrap for document and image loads.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  PREVIEW_DOCUMENT_MAX_BYTES,
  PREVIEW_IMAGE_MAX_BYTES,
  bindPreviewRemote,
  hostFileOf,
} from '../src/client/rpc.ts'
import type { DocumentPreviewRemote } from '../src/client/rpc.ts'

const SEAT = 's-seat' as SessionId
const SESSION = 's-1' as SessionId
const ADDRESS = 'dsh-resource://file/session/s-1/work/notes.md'

function ok<T>(value: T) {
  return { ok: true as const, value }
}

function fail(code: string, message: string) {
  return { ok: false as const, error: { code, message, details: {} } as never }
}

describe('hostFileOf', () => {
  it('reads the session and the decoded relative path out of a session file address, whatever the seat\'s session', () => {
    expect(hostFileOf(ADDRESS, SEAT)).toEqual({ sessionId: SESSION, path: 'work/notes.md' })
    expect(hostFileOf('dsh-resource://file/session/s%2F1/work/a%20b%23c.md', SEAT)).toEqual({
      sessionId: 's/1', path: 'work/a b#c.md',
    })
  })

  it('reads an absolute address through the seat\'s session with the decoded absolute path', () => {
    expect(hostFileOf('dsh-resource://file/absolute/etc/hosts', SEAT)).toEqual({
      sessionId: SEAT, path: '/etc/hosts',
    })
    expect(hostFileOf('dsh-resource://file/absolute/C:/w/a%20b.md', SEAT)).toEqual({
      sessionId: SEAT, path: 'C:/w/a b.md',
    })
  })

  it('throws for an address that is not a file address', () => {
    for (const address of [
      'dsh-resource://file/shared/team/notes.md',
      'dsh-resource://file/session',
      'file:///work/notes.md',
      'sidebar://guide',
    ]) {
      expect(() => hostFileOf(address, SEAT)).toThrow('not a file address')
    }
  })
})

describe('bindPreviewRemote', () => {
  function remote(overrides: Partial<{
    stat: DocumentPreviewRemote['workspaceFiles']['stat']
    readBytes: DocumentPreviewRemote['workspaceFiles']['readBytes']
    start: DocumentPreviewRemote['interactivePreview']['start']
    stop: DocumentPreviewRemote['interactivePreview']['stop']
    openWorkspacePath: DocumentPreviewRemote['session']['openWorkspacePath']
  }> = {}): DocumentPreviewRemote {
    return {
      workspaceFiles: {
        stat: overrides.stat ?? vi.fn(async () => ok({
          absolutePath: '/w/notes.md', version: 'v1', bytes: 4,
        })),
        readBytes: overrides.readBytes ?? vi.fn(async () => ok({
          absolutePath: '/w/notes.md', version: 'v1', bytes: 4, offset: 0, data: btoa('# Hi'), eof: true,
        })),
      },
      interactivePreview: {
        start: overrides.start ?? vi.fn(async () => ok({ id: 'g1' as never, origin: 'http://abc.localhost:1' })),
        stop: overrides.stop ?? vi.fn(async () => ok(undefined)),
      },
      session: {
        openWorkspacePath: overrides.openWorkspacePath ?? vi.fn(async () => ok({ opened: true as const })),
      },
    }
  }

  it('reads a markdown document as utf-8 and infers format from the extension', async () => {
    const face = bindPreviewRemote(remote())
    await expect(face.readPreviewDocument(SESSION, 'work/notes.md')).resolves.toEqual({
      path: '/w/notes.md', format: 'markdown', content: '# Hi',
    })
  })

  it('throws a remote failure when stat is not ok', async () => {
    const face = bindPreviewRemote(remote({
      stat: vi.fn(async () => fail('workspace-file/outside-workspace', 'outside')),
    }))
    await expect(face.readPreviewDocument(SESSION, '../x.md')).rejects.toMatchObject({
      code: 'workspace-file/outside-workspace',
      message: 'outside',
    })
  })

  it('refuses a document over the byte cap before reading', async () => {
    const readBytes = vi.fn()
    const face = bindPreviewRemote(remote({
      stat: vi.fn(async () => ok({
        absolutePath: '/w/huge.md', version: 'v1', bytes: PREVIEW_DOCUMENT_MAX_BYTES + 1,
      })),
      readBytes,
    }))
    await expect(face.readPreviewDocument(SESSION, 'huge.md')).rejects.toMatchObject({
      code: 'workspace-file/too-large',
    })
    expect(readBytes).not.toHaveBeenCalled()
  })

  it('resolves a relative image against the document directory', async () => {
    const stat = vi.fn(async (_session: SessionId, path: string) => ok({
      absolutePath: path, version: 'v1', bytes: 2,
    }))
    const readBytes = vi.fn(async () => ok({
      absolutePath: '/w/dot.png', version: 'v1', bytes: 2, offset: 0, data: 'AA==', eof: true,
    }))
    const face = bindPreviewRemote(remote({ stat, readBytes }))
    await expect(face.readPreviewImage(SESSION, '/w/page.html', './dot.png')).resolves.toEqual({
      mediaType: 'image/png', data: 'AA==',
    })
    expect(stat).toHaveBeenCalledWith(SESSION, '/w/dot.png', undefined)
    expect(readBytes).toHaveBeenCalledWith(SESSION, '/w/dot.png', { offset: 0, length: PREVIEW_IMAGE_MAX_BYTES }, undefined)
  })

  it('throws start failures and stops a grant', async () => {
    const face = bindPreviewRemote(remote({
      start: vi.fn(async () => fail('interactive-preview/entry-not-html', 'no provider')),
    }))
    await expect(face.startInteractivePreview(SESSION, 'page.html', 'http://127.0.0.1:3000'))
      .rejects.toMatchObject({ code: 'interactive-preview/entry-not-html', message: 'no provider' })
    const stopping = bindPreviewRemote(remote())
    await expect(stopping.stopInteractivePreview('g1' as never)).resolves.toBeUndefined()
  })
})
