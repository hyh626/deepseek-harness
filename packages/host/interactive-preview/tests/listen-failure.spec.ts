/** Listen-failure coverage via module mock (ESM-safe). */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:http')>()
  return {
    ...actual,
    createServer: (...args: Parameters<typeof actual.createServer>) => {
      const server = actual.createServer(...args)
      server.listen = (() => {
        process.nextTick(() => { server.emit('error', new Error('bind failed')) })
        return server
      }) as typeof server.listen
      return server
    },
  }
})

import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import InteractivePreview from '../src/service.ts'

let context: Context | undefined
let root: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) rmSync(root, { recursive: true, force: true })
  root = undefined
})

describe('listen failure cleanup', () => {
  it('closes the booting server and rethrows bind errors', async () => {
    root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-preview-listen-')))
    mkdirSync(join(root, 'app'))
    writeFileSync(join(root, 'app/index.html'), '<html></html>')
    context = new Context()
    await context.plugin(SessionStore)
    await context.plugin(LocalFileSystem, { cwd: root })
    await context.plugin(InteractivePreview, {
      bindHost: '127.0.0.1',
      hostnameSuffix: 'localhost',
      maxGrants: 4,
      maxAssetBytes: 1024,
      inactivityTimeoutMs: 60_000,
    })
    context.sessions.create(SessionId('listen'), { meta: { cwd: root } })
    await expect(context.interactivePreview.open({
      sessionId: SessionId('listen'),
      path: 'app/index.html',
      parentOrigin: 'http://127.0.0.1:3000',
    })).rejects.toThrow('bind failed')
  })
})
