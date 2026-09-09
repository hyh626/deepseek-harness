import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { InteractivePreviewError } from '@deepseek-ai/dsh-host-interactive-preview'
import { interactivePreviewRpcError } from '../src/interactive-preview-rpc.ts'

describe('interactivePreviewRpcError', () => {
  it('maps InteractivePreviewError codes onto RPC business errors', () => {
    expect(interactivePreviewRpcError(
      new InteractivePreviewError('missing session', 'preview-session-not-found'),
      { sessionId: SessionId('s1') },
    )).toMatchObject({ code: 'preview-session-not-found', details: { sessionId: 's1' } })
    expect(interactivePreviewRpcError(
      new InteractivePreviewError('no cwd', 'preview-session-no-cwd'),
      { sessionId: SessionId('s1') },
    )).toMatchObject({ code: 'preview-session-no-cwd', details: { sessionId: 's1' } })
    expect(interactivePreviewRpcError(
      new InteractivePreviewError('missing entry', 'preview-entry-not-found'),
      { path: 'app/index.html' },
    )).toMatchObject({ code: 'preview-entry-not-found', details: { path: 'app/index.html' } })
    expect(interactivePreviewRpcError(
      new InteractivePreviewError('not file', 'preview-entry-not-file'),
      { path: 'app' },
    )).toMatchObject({ code: 'preview-entry-not-file', details: { path: 'app' } })
    expect(interactivePreviewRpcError(
      new InteractivePreviewError('not html', 'preview-entry-not-html'),
      { path: 'notes.md' },
    )).toMatchObject({ code: 'preview-entry-not-html', details: { path: 'notes.md' } })
    expect(interactivePreviewRpcError(
      new InteractivePreviewError('outside', 'preview-outside-workspace'),
      { path: '../x.html' },
    )).toMatchObject({ code: 'preview-outside-workspace', details: { path: '../x.html' } })
    expect(interactivePreviewRpcError(
      new InteractivePreviewError('bad origin', 'preview-invalid-parent-origin'),
      { parentOrigin: 'not-an-origin' },
    )).toMatchObject({ code: 'preview-invalid-parent-origin', details: { parentOrigin: 'not-an-origin' } })
    expect(interactivePreviewRpcError(
      new InteractivePreviewError('full', 'preview-max-grants'),
    )).toMatchObject({ code: 'preview-max-grants', details: {} })
    expect(interactivePreviewRpcError(
      new InteractivePreviewError('gone', 'preview-disposed'),
    )).toMatchObject({ code: 'preview-disposed', details: {} })
  })

  it('folds unknown failures into internal errors', () => {
    expect(interactivePreviewRpcError(new Error('boom'))).toMatchObject({
      code: 'internal',
      message: 'boom',
      details: {},
    })
    expect(interactivePreviewRpcError('plain')).toMatchObject({
      code: 'internal',
      message: 'plain',
      details: {},
    })
  })
})
