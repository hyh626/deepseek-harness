import { describe, expect, it } from 'vitest'
import { collectHtmlImageSources, collectMarkdownImageSources, isPreviewableDocumentPath, isPreviewableImageSource, previewBasename, previewDocumentFormat, resolvePreviewImagePath, rewriteHtmlImageSources } from '../src/client/resources.ts'

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

  it('infers markdown and html formats from the extension', () => {
    expect(previewDocumentFormat('NOTES.MD')).toBe('markdown')
    expect(previewDocumentFormat('a.markdown')).toBe('markdown')
    expect(previewDocumentFormat('Index.HTML')).toBe('html')
    expect(previewDocumentFormat('page.htm')).toBe('html')
    expect(previewDocumentFormat('src/a.ts')).toBeUndefined()
  })

  it('resolves relative image sources against the document directory', () => {
    expect(resolvePreviewImagePath('/w/page.html', './dot.png')).toBe('/w/dot.png')
    expect(resolvePreviewImagePath('work/notes.md', 'docs/shot.png')).toBe('work/docs/shot.png')
    expect(resolvePreviewImagePath('C:/w/page.html', '../img/a.png')).toBe('C:/img/a.png')
    expect(resolvePreviewImagePath('/w/page.html', '/abs/x.png')).toBe('/abs/x.png')
    expect(resolvePreviewImagePath('/w/page.html', './dot.png?v=1')).toBe('/w/dot.png')
    expect(resolvePreviewImagePath('/w/page.html', './dot.png#frag')).toBe('/w/dot.png')
    expect(resolvePreviewImagePath('notes.md', 'dot.png')).toBe('dot.png')
    expect(resolvePreviewImagePath('/w/page.html', 'C:')).toBe('C:/')
    expect(resolvePreviewImagePath('/w/page.html', 'C:/foo/../..')).toBe('C:/')
  })
})

describe('collectMarkdownImageSources', () => {
  it('collects inline and reference-style raster destinations', () => {
    const markdown = [
      '![Inline](./inline.png)',
      '![Dot][dot]',
      '![Also][DOT]',
      '![Collapsed][]',
      '![Skip][missing]',
      '![Remote][remote]',
      '',
      '[dot]: ./dot.png',
      '[collapsed]: ./collapsed.png',
      '[remote]: https://ex/a.png',
    ].join('\n')
    expect(collectMarkdownImageSources(markdown)).toEqual([
      './inline.png',
      './dot.png',
      './collapsed.png',
    ])
    expect(collectMarkdownImageSources([
      '![Keep][dot]',
      '[   ]: ./ignored.png',
      '[dot]: ./first.png',
      '[dot]: ./second.png',
      '![][]',
    ].join('\n'))).toEqual(['./first.png'])
  })
})
