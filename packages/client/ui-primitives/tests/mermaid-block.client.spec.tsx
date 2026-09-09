// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MermaidRenderer } from '@deepseek-ai/dsh-client-ui-primitives'

afterEach(cleanup)

const MERMAID_SOURCE = [
  '```mermaid',
  'graph TD',
  '  A --> B',
  '```',
].join('\n')

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

describe('MarkdownText mermaid opt-in', () => {
  const created: string[] = []
  const revoked: string[] = []

  beforeEach(() => {
    created.length = 0
    revoked.length = 0
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      const url = `blob:mermaid-${String(created.length)}`
      created.push(url)
      return url
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
      revoked.push(url)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps a mermaid fence as a generic code block when no renderer is supplied', () => {
    const { container } = render(<MarkdownText text={MERMAID_SOURCE} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.md-code-block')).not.toBeNull()
    expect(container.textContent).toContain('graph TD')
    expect(container.textContent).toContain('mermaid')
  })

  it('does not render mermaid diagrams while the message is still streaming', () => {
    const renderMermaid = vi.fn(() => Promise.resolve('<svg></svg>'))
    const renderer: MermaidRenderer = { render: renderMermaid }
    const { container } = render(<MarkdownText text={MERMAID_SOURCE} streaming mermaid={renderer} />)
    expect(renderMermaid).not.toHaveBeenCalled()
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('graph TD')
  })

  it('renders a supplied renderer result as a blob image and never inserts SVG into the document', async () => {
    const renderMermaid = vi.fn((_source, _signal) => Promise.resolve('<svg><text>diagram</text></svg>'))
    const renderer: MermaidRenderer = {
      render: renderMermaid,
    }
    const { container } = render(<MarkdownText text={MERMAID_SOURCE} mermaid={renderer} />)
    expect(renderMermaid).toHaveBeenCalledTimes(1)
    expect(renderMermaid).toHaveBeenCalledWith('graph TD\n  A --> B', expect.any(AbortSignal))
    const image = await waitFor(() => {
      const found = container.querySelector('img')
      if (found === null) throw new Error('mermaid image not published')
      return found
    })
    expect(image.getAttribute('src')).toBe('blob:mermaid-0')
    expect(container.querySelector('svg')).toBeNull()
    expect(container.innerHTML).not.toContain('<svg')
  })

  it('drops a stale async result when the fence source is replaced', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    const pending = [first, second]
    const renderer: MermaidRenderer = {
      render: () => {
        const next = pending.shift()
        if (next === undefined) return Promise.reject(new Error('unexpected mermaid render'))
        return next.promise
      },
    }
    const view = render(<MarkdownText text={MERMAID_SOURCE} mermaid={renderer} />)
    view.rerender(<MarkdownText text={'```mermaid\ngraph LR\n  X --> Y\n```'} mermaid={renderer} />)
    first.resolve('<svg id="stale"></svg>')
    await Promise.resolve()
    expect(view.container.querySelector('img')).toBeNull()
    second.resolve('<svg id="current"></svg>')
    const image = await waitFor(() => {
      const found = view.container.querySelector('img')
      if (found === null) throw new Error('replacement mermaid image not published')
      return found
    })
    expect(image.getAttribute('src')).toBe('blob:mermaid-0')
    expect(created).toEqual(['blob:mermaid-0'])
  })

  it('drops a stale render error after unmount', async () => {
    const pending = deferred<string>()
    const renderer: MermaidRenderer = { render: () => pending.promise }
    const view = render(<MarkdownText text={MERMAID_SOURCE} mermaid={renderer} />)
    view.unmount()
    pending.reject(new Error('stale'))
    await Promise.resolve()
  })

  it('keeps the source fence and an error message when rendering fails', async () => {
    const renderer: MermaidRenderer = {
      render: () => Promise.reject(new Error('parse failed')),
    }
    const { container } = render(
      <MarkdownText text={MERMAID_SOURCE} mermaid={renderer} mermaidErrorLabel="diagram failed" />,
    )
    await waitFor(() => {
      expect(container.textContent).toContain('diagram failed')
    })
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('graph TD')
    expect(container.querySelector('.md-code-block')).not.toBeNull()
  })

  it('revokes the object URL on unmount', async () => {
    const renderer: MermaidRenderer = {
      render: () => Promise.resolve('<svg></svg>'),
    }
    const view = render(<MarkdownText text={MERMAID_SOURCE} mermaid={renderer} />)
    await waitFor(() => {
      expect(view.container.querySelector('img')).not.toBeNull()
    })
    view.unmount()
    expect(revoked).toEqual(['blob:mermaid-0'])
  })

  it('renders a contained relative image when resolveImageSrc returns a URL', () => {
    const { container } = render(
      <MarkdownText
        text={'![shot](docs/shot.png)'}
        resolveImageSrc={url => url === 'docs/shot.png' ? 'blob:preview-shot' : undefined}
      />,
    )
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:preview-shot')
  })
})
