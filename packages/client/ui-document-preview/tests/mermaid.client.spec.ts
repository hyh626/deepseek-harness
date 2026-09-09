import { describe, expect, it, vi } from 'vitest'

const initialize = vi.fn()
const render = vi.fn(async () => ({ svg: '<svg data-mermaid="1"></svg>' }))

vi.mock('mermaid', () => ({
  default: { initialize, render },
}))

describe('previewMermaidRenderer', () => {
  it('initializes once, returns svg, and honors abort after render', async () => {
    const { previewMermaidRenderer } = await import('../src/client/mermaid.ts')
    const first = await previewMermaidRenderer.render('graph TD; A-->B', new AbortController().signal)
    expect(first).toContain('data-mermaid')
    expect(initialize).toHaveBeenCalledTimes(1)
    await previewMermaidRenderer.render('graph TD; C-->D', new AbortController().signal)
    expect(initialize).toHaveBeenCalledTimes(1)
    const abort = new AbortController()
    abort.abort()
    await expect(previewMermaidRenderer.render('graph TD; E-->F', abort.signal)).rejects.toThrow()
  })
})
