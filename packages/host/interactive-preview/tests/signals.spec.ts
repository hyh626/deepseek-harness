/** Unit coverage for preview request signals and handler failures. */

import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import {
  isActivePreviewGrant,
  previewRequestSignal,
  respondPreviewHandlerFailure,
  wasPreviewRequestAborted,
} from '../src/signals.ts'

describe('wasPreviewRequestAborted', () => {
  it('detects aborted signals and AbortError rejections', () => {
    const controller = new AbortController()
    expect(wasPreviewRequestAborted(controller.signal, new Error('other'))).toBe(false)
    controller.abort()
    expect(wasPreviewRequestAborted(controller.signal, new Error('other'))).toBe(true)
    expect(wasPreviewRequestAborted(new AbortController().signal, new DOMException('aborted', 'AbortError'))).toBe(true)
    const named = new Error('aborted')
    named.name = 'AbortError'
    expect(wasPreviewRequestAborted(new AbortController().signal, named)).toBe(true)
  })
})

describe('isActivePreviewGrant', () => {
  it('accepts live grants and rejects absent or closed ones', () => {
    expect(isActivePreviewGrant(undefined)).toBe(false)
    expect(isActivePreviewGrant({ closed: true })).toBe(false)
    expect(isActivePreviewGrant({ closed: false })).toBe(true)
  })
})

describe('previewRequestSignal', () => {
  it('aborts when the request or response ends', () => {
    const req = new EventEmitter() as IncomingMessage
    const res = new EventEmitter() as ServerResponse
    const grantAbort = new AbortController()
    const disposalAbort = new AbortController()
    const signal = previewRequestSignal(req, res, grantAbort.signal, disposalAbort.signal)
    req.emit('aborted')
    expect(signal.aborted).toBe(true)
    const signal2 = previewRequestSignal(req, res, grantAbort.signal, disposalAbort.signal)
    res.emit('close')
    expect(signal2.aborted).toBe(true)
  })

  it('ignores AbortError thrown while aborting in-flight fs work', async () => {
    const req = new EventEmitter() as IncomingMessage
    const res = new EventEmitter() as ServerResponse
    const grantAbort = new AbortController()
    const signal = previewRequestSignal(req, res, grantAbort.signal, new AbortController().signal)
    const pending = new Promise<void>((_resolve, reject) => {
      signal.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')) })
    })
    expect(() => { res.emit('close') }).not.toThrow()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('respondPreviewHandlerFailure', () => {
  it('destroys responses that already sent headers', () => {
    const log = vi.fn()
    const writeHead = vi.fn()
    const destroy = vi.fn()
    const end = vi.fn()
    const res = {
      headersSent: true,
      destroy,
      writeHead,
      end,
    } as unknown as ServerResponse
    respondPreviewHandlerFailure(log, res, 'http://127.0.0.1:1', new Error('boom'), () => ({}))
    expect(destroy).toHaveBeenCalled()
    expect(writeHead).not.toHaveBeenCalled()
  })

  it('writes a 500 when headers are not sent yet', () => {
    const log = vi.fn()
    const writeHead = vi.fn()
    const end = vi.fn()
    const res = {
      headersSent: false,
      destroy: vi.fn(),
      writeHead,
      end,
    } as unknown as ServerResponse
    respondPreviewHandlerFailure(log, res, 'http://127.0.0.1:1', 'bad', parent => ({ 'x-parent': parent }))
    expect(writeHead).toHaveBeenCalledWith(500, { 'x-parent': 'http://127.0.0.1:1' })
    expect(end).toHaveBeenCalled()
  })
})
