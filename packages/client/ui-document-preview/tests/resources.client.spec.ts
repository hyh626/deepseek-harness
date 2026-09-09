import { describe, expect, it } from 'vitest'
import { collectHtmlImageSources, isPreviewableDocumentPath, isPreviewableImageSource, previewBasename, rewriteHtmlImageSources } from '../src/client/resources.ts'

describe('previewable path gates', () => {
  it('accepts markdown and html extensions without regard to case', () => {
    expect(isPreviewableDocumentPath('NOTES.MD')).toBe(true)
    expect(isPreviewableDocumentPath('a.Markdown')).toBe(true)
    expect(isPreviewableDocumentPath('Index.HTML')).toBe(true)
    expect(isPreviewableDocumentPath('page.HTM')).toBe(true)
    expect(isPreviewableDocumentPath('src/a.ts')).toBe(false)
    expect(isPreviewableDocumentPath('notes')).toBe(false)
  })

  it('accepts only relative raster image sources', () => {
    expect(isPreviewableImageSource('./a.png')).toBe(true)
    expect(isPreviewableImageSource('https://ex/a.png')).toBe(false)
    expect(isPreviewableImageSource('data:image/png,aa')).toBe(false)
    expect(isPreviewableImageSource('a.svg')).toBe(false)
    expect(isPreviewableImageSource('')).toBe(false)
    expect(isPreviewableImageSource('  ')).toBe(false)
  })

  it('returns the last path segment and leaves unmatched html sources', () => {
    expect(previewBasename('a/b/c.md/')).toBe('c.md')
    const html = '<img src="docs/shot.png"><img src="docs/shot.png"><img src="skip.svg">'
    expect(collectHtmlImageSources(html)).toEqual(['docs/shot.png'])
    expect(rewriteHtmlImageSources(html, new Map())).toBe(html)
  })
})
