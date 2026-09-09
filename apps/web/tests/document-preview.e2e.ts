// Web e2e: workspace Markdown/HTML preview beside chat. Cold-seeds a write
// turn, materializes the files in the session cwd, then clicks produced-file
// chips through the assembled open-file waterfall.
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, vi } from 'vitest'
import { CallId, createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import {
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  seedSession,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/document-preview', import.meta.url))
const UI_EXPECTED = fileURLToPath(new URL('./snapshots/document-preview/ui.expected.md', import.meta.url))
const MODE = webSnapshotMode()
const SEED_ID = 'document-preview-web-e2e'
const DONE = 'DOCUMENT_PREVIEW_DONE'
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

const MARKDOWN = [
  '# Notes',
  '',
  '| Col | Val |',
  '| --- | --- |',
  '| a | 1 |',
  '',
  '![Dot](./dot.png)',
  '',
  '```mermaid',
  'graph TD',
  '  A-->B',
  '```',
  '',
].join('\n')

const HTML = [
  '<!DOCTYPE html><html><head>',
  '<style>h1{color:rgb(255,0,0)}</style>',
  '</head><body>',
  '<h1>Static HTML</h1>',
  '<img alt="Dot" src="./dot.png">',
  '<script>window.top.__previewScriptRan = true</script>',
  '</body></html>',
].join('')

const MERMAID_HTML = '<pre class="mermaid">graph TD;\n  A-->B\n</pre>\n'

const APP_HTML = [
  '<!DOCTYPE html><html><head>',
  '<link rel="stylesheet" href="./app.css">',
  '</head><body>',
  '<h1 id="status">booting</h1>',
  '<script type="module" src="./app.js"></script>',
  '</body></html>',
].join('')

const APP_JS = [
  'try { window.top.__interactiveParentTouched = true } catch {',
  '  /* Cross-origin parent access is expected to throw. */',
  '}',
  'const status = document.getElementById("status")',
  'status.textContent = "script-ran"',
  'try {',
  '  const local = await fetch("./data.json")',
  '  status.textContent = (await local.json()).ok',
  '} catch {',
  '  status.textContent = "local-fetch-failed"',
  '}',
  'try {',
  '  await fetch("https://example.invalid/")',
  '  window.__externalFetch = "reached"',
  '} catch {',
  '  window.__externalFetch = "blocked"',
  '}',
  '',
].join('\n')

const APP_CSS = 'h1 { color: rgb(0, 128, 0); }\n'
const APP_DATA = '{"ok":"local-ok"}\n'
const APP2_HTML = '<!DOCTYPE html><html><body><h1 id="status">static</h1><script>document.getElementById("status").textContent = "app2-ran"</script></body></html>\n'

/** Build one settled turn whose writes include Markdown, HTML, and a text file. */
function previewFixture(): string {
  const session = Session.create(SessionId('document-preview-source'))
  const eventTimeOrigin = new Date().setHours(12, 0, 0, 0)
  const produced = [
    { path: 'notes.md', content: MARKDOWN },
    { path: 'page.html', content: HTML },
    { path: 'mermaid.html', content: MERMAID_HTML },
    { path: 'app.html', content: APP_HTML },
    { path: 'app2.html', content: APP2_HTML },
    { path: 'notes.txt', content: 'plain text\n' },
  ] as const
  session.append('turn/start', { turn: 1 })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Write the preview fixtures.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', {
    title: 'Document preview', messageSeqs: [user.seq], source: { kind: 'fallback' },
  })
  session.append('step/start', { turn: 1, step: 1 })
  const calls = produced.map((file, index) => ({
    ...file,
    callId: CallId(`document-preview-${String(index)}`),
    args: JSON.stringify({ file_path: file.path, content: file.content }),
  }))
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: calls.map(call => ({
        type: 'tool-call' as const,
        id: call.callId,
        name: 'write',
        arguments: call.args,
      })),
      source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    }),
  }, { surfaceOp: 'append' })
  for (const call of calls) {
    const source = session.append('tool/call', {
      turn: 1, step: 1, callId: call.callId, name: 'write', arguments: call.args,
    })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: call.callId,
        content: [{ type: 'text', text: `Created ${call.path}` }],
        isError: false,
      }),
    }, { surfaceOp: 'append', sourceEventSeqs: [source.seq] })
  }
  session.append('step/start', { turn: 1, step: 2 })
  session.append('assistant/message', {
    turn: 1,
    step: 2,
    message: createAssistantMessage({
      content: [{ type: 'text', text: `Wrote the fixtures.\n\n${DONE}` }],
      source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 2 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

  return [
    JSON.stringify({
      type: 'session', version: SESSION_FORMAT_VERSION, id: '{{sessionId}}',
      createdAt: 0, cwd: '{{cwd}}',
    }),
    ...session.events.map(event => JSON.stringify({
      ...event, time: eventTimeOrigin + event.seq * 1_000,
    })),
    '',
  ].join('\n')
}

describe('web e2e: workspace document preview beside chat', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, previewFixture(), SEED_ID)
    await writeFile(join(scaffold.workspaceCwd, 'notes.md'), MARKDOWN)
    await writeFile(join(scaffold.workspaceCwd, 'page.html'), HTML)
    await writeFile(join(scaffold.workspaceCwd, 'mermaid.html'), MERMAID_HTML)
    await writeFile(join(scaffold.workspaceCwd, 'app.html'), APP_HTML)
    await writeFile(join(scaffold.workspaceCwd, 'app.js'), APP_JS)
    await writeFile(join(scaffold.workspaceCwd, 'app.css'), APP_CSS)
    await writeFile(join(scaffold.workspaceCwd, 'data.json'), APP_DATA)
    await writeFile(join(scaffold.workspaceCwd, 'app2.html'), APP2_HTML)
    await writeFile(join(scaffold.workspaceCwd, 'notes.txt'), 'plain text\n')
    await writeFile(join(scaffold.workspaceCwd, 'dot.png'), PNG)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    try {
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    } catch (error: unknown) {
      throw new Error(`web frame did not start: ${JSON.stringify({
        pageErrors: tripwire.pageErrors,
        warnings: tripwire.warnings,
        body: (await page.locator('body').innerText()).slice(0, 1_000),
      })}`, { cause: error })
    }
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it.skipIf(MODE === 'record')('previews markdown and html in the side panel and delegates text files', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-document-preview'))
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    if (await groupRow.getAttribute('aria-expanded') !== 'true') await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()
    await expect.poll(() => page.getByText(DONE, { exact: true }).count(), { timeout: 15_000 }).toBe(1)

    const row = page.locator('[data-produced-files-row]')
    await row.waitFor({ timeout: 15_000 })
    await row.getByText('notes.md', { exact: true }).click()

    const panel = page.locator('[data-document-preview]')
    await panel.waitFor({ timeout: 15_000 })
    await expect.poll(() => panel.getByRole('heading', { name: 'Notes' }).count(), { timeout: 15_000 }).toBe(1)
    await expect.poll(() => panel.locator('img[src^="blob:"]').count(), { timeout: 20_000 }).toBeGreaterThan(0)
    expect(await page.locator('[data-secondary-collapsed]').count()).toBe(0)

    await row.getByText('page.html', { exact: true }).click()
    const frame = panel.locator('iframe')
    await frame.waitFor({ timeout: 15_000 })
    expect(await frame.getAttribute('sandbox')).toBe('allow-same-origin')
    const srcdoc = await frame.getAttribute('srcdoc') ?? ''
    expect(srcdoc).not.toMatch(/<script/i)
    expect(srcdoc).toContain('Static HTML')
    expect(await page.evaluate(() => (window as Window & { __previewScriptRan?: boolean }).__previewScriptRan)).toBeUndefined()
    expect(await panel.getByRole('heading', { name: 'Notes' }).count()).toBe(0)

    const openPath = vi.spyOn(scaffold.ctx.apiProxy.host, 'openPath')
      .mockImplementation(async (request, _signal) => ({
        rpcId: request.rpcId,
        result: { ok: true, value: { opened: true as const } },
      }))
    try {
      const [response] = await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === '/api/host.openPath'),
        row.getByText('notes.txt', { exact: true }).click(),
      ])
      expect(response.status()).toBe(200)
      expect(openPath).toHaveBeenCalledTimes(1)
      expect(openPath.mock.calls[0]![0].payload).toEqual({ path: `${scaffold.workspaceCwd}/notes.txt` })
    } finally {
      openPath.mockRestore()
    }

    expect(await panel.locator('iframe').count()).toBe(1)

    const snapshot = (await captureStableAria(page, '[data-document-preview]', scaffold.workspaceCwd))
      .split(SEED_ID).join('{{seededId}}')
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)

    await row.getByText('mermaid.html', { exact: true }).click()
    await expect.poll(async () => {
      const srcdoc = await panel.locator('iframe').getAttribute('srcdoc') ?? ''
      return srcdoc.includes('blob:') && srcdoc.includes('<img')
    }, { timeout: 20_000 }).toBe(true)
    expect(await panel.locator('iframe').getAttribute('sandbox')).toBe('allow-same-origin')

    await row.getByText('app.html', { exact: true }).click()
    await panel.getByRole('button', { name: 'Enable interactive preview' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('checkbox').check()
    await dialog.getByRole('button', { name: 'Enable interactive preview' }).click()
    await expect.poll(async () => panel.locator('iframe').getAttribute('src'), { timeout: 15_000 })
      .toMatch(/^http:\/\/[0-9a-f]{32}\.localhost:\d+$/)
    expect(await panel.locator('iframe').getAttribute('sandbox')).toBe('allow-scripts allow-same-origin')
    const grantOrigin = await panel.locator('iframe').getAttribute('src')
    expect(grantOrigin).toBeTruthy()
    const previewFrame = page.frameLocator('[data-document-preview] iframe')
    await expect.poll(() => previewFrame.getByText('local-ok').count(), { timeout: 15_000 }).toBe(1)
    expect(await previewFrame.locator('body').evaluate(() => (
      window as Window & { __externalFetch?: string }
    ).__externalFetch)).toBe('blocked')
    expect(await page.evaluate(() => (
      window as Window & { __interactiveParentTouched?: boolean }
    ).__interactiveParentTouched)).toBeUndefined()

    await row.getByText('app2.html', { exact: true }).click()
    await expect.poll(async () => panel.locator('iframe').getAttribute('sandbox'), { timeout: 15_000 })
      .toBe('allow-same-origin')
    const app2Srcdoc = await panel.locator('iframe').getAttribute('srcdoc') ?? ''
    expect(app2Srcdoc).toContain('static')
    expect(app2Srcdoc).not.toMatch(/<script/i)
    expect(await panel.getByRole('button', { name: 'Enable interactive preview' }).count()).toBe(1)

    await panel.getByLabel('Close preview').click()
    await expect.poll(() => page.locator('[data-document-preview]').count(), { timeout: 10_000 }).toBe(0)
    await expect.poll(async () => {
      try {
        await fetch(grantOrigin as string, { signal: AbortSignal.timeout(800) })
        return 'up'
      } catch {
        return 'down'
      }
    }, { timeout: 10_000 }).toBe('down')

    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['ui.expected.md'])
  }, 90_000)
})
