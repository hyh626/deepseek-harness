// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { DocumentPreviewPanel } from '../src/client/DocumentPreviewPanel.tsx'
import type { DocumentPreviewSlotProps } from '../src/client/DocumentPreviewPanel.tsx'
import type { DocumentPreviewView, IDocumentPreview } from '../src/client/controller.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

vi.mock('../src/client/mermaid.ts', () => ({
  previewMermaidRenderer: { render: () => Promise.resolve('<svg></svg>') },
}))

const sid = 's1' as SessionId

const IDLE: DocumentPreviewView = {
  status: 'idle',
  path: null,
  format: null,
  content: null,
  imageUrls: {},
  error: null,
  htmlMode: 'static',
  interactiveOrigin: null,
  grantId: null,
  startingInteractive: false,
  interactiveError: null,
}

function fakePreview(view: DocumentPreviewView) {
  const store = createSnapshotStore(view)
  return {
    open: vi.fn(),
    reload: vi.fn(),
    close: vi.fn(),
    openExternal: vi.fn(),
    enableInteractive: vi.fn(),
    state: () => store,
    dispose: vi.fn(),
  }
}

function t(key: keyof typeof en): string {
  return en[key]
}

function panelProps(preview: IDocumentPreview): DocumentPreviewSlotProps {
  return { sessionId: sid, preview, t } as DocumentPreviewSlotProps
}

describe('DocumentPreviewPanel', () => {
  it('shows the empty state and wires close', () => {
    const preview = fakePreview(IDLE)
    const { getByLabelText, getByText } = render(
      <DocumentPreviewPanel {...panelProps(preview)} />,
    )
    expect(getByText(en.empty)).toBeTruthy()
    fireEvent.click(getByLabelText(en.close))
    expect(preview.close).toHaveBeenCalledWith(sid)
  })

  it('wires reload and external open for a loaded document', () => {
    const preview = fakePreview({
      status: 'ready',
      path: '/w/notes.md',
      format: 'markdown',
      content: '# Title',
      imageUrls: {},
      error: null,
      htmlMode: 'static',
      interactiveOrigin: null,
      grantId: null,
      startingInteractive: false,
      interactiveError: null,
    })
    const { getByText } = render(
      <DocumentPreviewPanel {...panelProps(preview)} />,
    )
    fireEvent.click(getByText(en.reload))
    fireEvent.click(getByText(en.openExternal))
    expect(vi.mocked(preview.reload)).toHaveBeenCalledWith(sid)
    expect(vi.mocked(preview.openExternal)).toHaveBeenCalledWith(sid)
  })

  it('renders loading and error bodies', () => {
    const loading = fakePreview({
      status: 'loading',
      path: '/w/a.md',
      format: null,
      content: null,
      imageUrls: {},
      error: null,
      htmlMode: 'static',
      interactiveOrigin: null,
      grantId: null,
      startingInteractive: false,
      interactiveError: null,
    })
    const loadingView = render(<DocumentPreviewPanel {...panelProps(loading)} />)
    expect(loadingView.getByText(en.loading)).toBeTruthy()
    loadingView.unmount()

    const errored = fakePreview({
      status: 'error',
      path: '/w/a.md',
      format: null,
      content: null,
      imageUrls: {},
      error: 'denied',
      htmlMode: 'static',
      interactiveOrigin: null,
      grantId: null,
      startingInteractive: false,
      interactiveError: null,
    })
    const errorView = render(<DocumentPreviewPanel {...panelProps(errored)} />)
    expect(errorView.getByText('denied')).toBeTruthy()
    errorView.unmount()

    const generic = fakePreview({
      status: 'error',
      path: '/w/a.md',
      format: null,
      content: null,
      imageUrls: {},
      error: null,
      htmlMode: 'static',
      interactiveOrigin: null,
      grantId: null,
      startingInteractive: false,
      interactiveError: null,
    })
    const genericView = render(<DocumentPreviewPanel {...panelProps(generic)} />)
    expect(genericView.getByText(en['error.generic'])).toBeTruthy()
  })

  it('renders markdown content and html srcdoc', async () => {
    const markdown = fakePreview({
      status: 'ready',
      path: '/w/notes.md',
      format: 'markdown',
      content: '# Title\n\n![plot](./plot.png)',
      imageUrls: { './plot.png': 'blob:plot' },
      error: null,
      htmlMode: 'static',
      interactiveOrigin: null,
      grantId: null,
      startingInteractive: false,
      interactiveError: null,
    })
    const markdownView = render(<DocumentPreviewPanel {...panelProps(markdown)} />)
    expect(markdownView.getByRole('heading', { name: 'Title' })).toBeTruthy()
    expect(markdownView.getByRole('img', { name: 'plot' }).getAttribute('src')).toBe('blob:plot')
    markdownView.unmount()

    const html = fakePreview({
      status: 'ready',
      path: '/w/page.html',
      format: 'html',
      content: '<p>Hello</p>',
      imageUrls: {},
      error: null,
      htmlMode: 'static',
      interactiveOrigin: null,
      grantId: null,
      startingInteractive: false,
      interactiveError: null,
    })
    const htmlView = render(<DocumentPreviewPanel {...panelProps(html)} />)
    await waitFor(() => {
      expect(htmlView.container.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-same-origin')
    })
    expect(htmlView.container.querySelector('iframe')?.getAttribute('srcdoc')).toBe('<p>Hello</p>')
  })

  it('confirms interactive preview and loads an isolated origin iframe', () => {
    const html = fakePreview({
      status: 'ready',
      path: '/w/page.html',
      format: 'html',
      content: '<p>Hello</p>',
      imageUrls: {},
      error: null,
      htmlMode: 'static',
      interactiveOrigin: null,
      grantId: null,
      startingInteractive: false,
      interactiveError: 'grant failed',
    })
    const htmlView = render(<DocumentPreviewPanel {...panelProps(html)} />)
    expect(htmlView.getByText('grant failed')).toBeTruthy()
    fireEvent.click(htmlView.getByText(en['interactive.enable']))
    expect(htmlView.getByText(en['interactive.confirm.title'])).toBeTruthy()
    fireEvent.click(htmlView.getByText(en['interactive.confirm.cancel']))
    expect(html.enableInteractive).not.toHaveBeenCalled()
    fireEvent.click(htmlView.getByText(en['interactive.enable']))
    fireEvent.click(htmlView.getByRole('checkbox'))
    fireEvent.click(within(htmlView.getByRole('dialog')).getByRole('button', {
      name: en['interactive.confirm.enable'],
    }))
    expect(html.enableInteractive).toHaveBeenCalledWith(sid)
    htmlView.unmount()

    const starting = fakePreview({
      status: 'ready',
      path: '/w/page.html',
      format: 'html',
      content: '<p>Hello</p>',
      imageUrls: {},
      error: null,
      htmlMode: 'static',
      interactiveOrigin: null,
      grantId: null,
      startingInteractive: true,
      interactiveError: null,
    })
    const startingView = render(<DocumentPreviewPanel {...panelProps(starting)} />)
    expect((startingView.getByText(en['interactive.enable']) as HTMLButtonElement).disabled).toBe(true)
    startingView.unmount()

    const markdown = fakePreview({
      status: 'ready',
      path: '/w/notes.md',
      format: 'markdown',
      content: '# Title',
      imageUrls: {},
      error: null,
      htmlMode: 'static',
      interactiveOrigin: null,
      grantId: null,
      startingInteractive: false,
      interactiveError: null,
    })
    const markdownView = render(<DocumentPreviewPanel {...panelProps(markdown)} />)
    expect(markdownView.queryByText(en['interactive.enable'])).toBeNull()
    markdownView.unmount()

    const interactive = fakePreview({
      status: 'ready',
      path: '/w/page.html',
      format: 'html',
      content: '<p>Hello</p>',
      imageUrls: {},
      error: null,
      htmlMode: 'interactive',
      interactiveOrigin: 'http://abc.localhost:1',
      grantId: 'grant-1' as DocumentPreviewView['grantId'],
      startingInteractive: false,
      interactiveError: null,
    })
    const interactiveView = render(<DocumentPreviewPanel {...panelProps(interactive)} />)
    const frame = interactiveView.container.querySelector('iframe')
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin')
    expect(frame?.getAttribute('src')).toBe('http://abc.localhost:1')
    expect(frame?.hasAttribute('srcdoc')).toBe(false)
    expect(interactiveView.queryByText(en['interactive.enable'])).toBeNull()
  })
})
