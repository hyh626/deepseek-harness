// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { sanitizePreviewHtml, wrapPreviewSrcdoc, replaceHtmlMermaid } from '../src/client/html.ts'
import { collectHtmlImageSources, rewriteHtmlImageSources } from '../src/client/resources.ts'

describe('sanitizePreviewHtml', () => {
  it('removes scripts, handlers, forms, embeds, base, refresh metadata, and linked stylesheets', () => {
    const dirty = [
      '<script>alert(1)</script>',
      '<img src="x.png" onerror="alert(1)">',
      '<form action="https://evil.example"><input></form>',
      '<iframe src="https://evil.example"></iframe>',
      '<object data="x"></object>',
      '<base href="https://evil.example">',
      '<meta http-equiv="refresh" content="0;url=https://evil.example">',
      '<link rel="stylesheet" href="https://evil.example/x.css">',
      '<p style="color:red">ok</p>',
    ].join('')
    const clean = sanitizePreviewHtml(dirty)
    expect(clean).toContain('<p')
    expect(clean).toContain('ok')
    expect(clean.toLowerCase()).not.toContain('script')
    expect(clean.toLowerCase()).not.toContain('onerror')
    expect(clean.toLowerCase()).not.toContain('<form')
    expect(clean.toLowerCase()).not.toContain('<iframe')
    expect(clean.toLowerCase()).not.toContain('<object')
    expect(clean.toLowerCase()).not.toContain('<base')
    expect(clean.toLowerCase()).not.toContain('<meta')
    expect(clean.toLowerCase()).not.toContain('<link')
  })

  it('wraps sanitized HTML with a restrictive CSP and no-referrer', () => {
    const srcdoc = wrapPreviewSrcdoc('<p>Hello</p>')
    expect(srcdoc).toContain("script-src 'none'")
    expect(srcdoc).toContain("connect-src 'none'")
    expect(srcdoc).toContain("form-action 'none'")
    expect(srcdoc).toContain('no-referrer')
    expect(srcdoc).toContain('<p>Hello</p>')
  })

  it('rewrites contained relative image sources', () => {
    const html = '<p><img src="docs/shot.png" alt="shot"></p>'
    expect(collectHtmlImageSources(html)).toEqual(['docs/shot.png'])
    expect(rewriteHtmlImageSources(html, new Map([['docs/shot.png', 'blob:preview']])))
      .toContain('src="blob:preview"')
  })
})

describe('replaceHtmlMermaid', () => {
  it('replaces pre and div mermaid nodes and keeps a failed source element', async () => {
    const renderer = {
      render: async (source: string) => {
        if (source.includes('bad')) throw new Error('boom')
        return `<svg>${source}</svg>`
      },
    }
    const html = [
      '<pre class="mermaid">graph TD; A-->B</pre>',
      '<pre class="mermaid"></pre>',
      '<div class="mermaid">bad</div>',
    ].join('')
    const result = await replaceHtmlMermaid(html, renderer, new AbortController().signal)
    expect(result.html).toContain('blob:')
    expect(result.html).toContain('class="mermaid"')
    expect(result.html).toContain('bad')
    expect(result.urls).toHaveLength(2)
    for (const url of result.urls) URL.revokeObjectURL(url)
  })

  it('rethrows when the load is aborted and returns original html without a parse root', async () => {
    const abort = new AbortController()
    abort.abort()
    await expect(replaceHtmlMermaid(
      '<pre class="mermaid">x</pre>',
      { render: async () => '<svg></svg>' },
      abort.signal,
    )).rejects.toMatchObject({ name: 'AbortError' })

    const during = new AbortController()
    await expect(replaceHtmlMermaid(
      '<pre class="mermaid">x</pre>',
      {
        render: async () => {
          during.abort()
          throw new DOMException('Aborted', 'AbortError')
        },
      },
      during.signal,
    )).rejects.toMatchObject({ name: 'AbortError' })

    const afterFirst = new AbortController()
    let renders = 0
    await expect(replaceHtmlMermaid(
      '<pre class="mermaid">one</pre><pre class="mermaid">two</pre>',
      {
        render: async (source: string) => {
          renders += 1
          if (renders === 2) {
            afterFirst.abort()
            throw new DOMException('Aborted', 'AbortError')
          }
          return `<svg>${source}</svg>`
        },
      },
      afterFirst.signal,
    )).rejects.toMatchObject({ name: 'AbortError' })

    const empty = document.implementation.createHTMLDocument()
    const parser = vi.spyOn(DOMParser.prototype, 'parseFromString').mockReturnValue(empty)
    await expect(replaceHtmlMermaid('<p>x</p>', { render: async () => '<svg></svg>' }, new AbortController().signal))
      .resolves.toEqual({ html: '<p>x</p>', urls: [] })
    parser.mockRestore()
  })
})
