/**
 * What the `document` type claims, and how it yields to a narrower type.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import {
  DOCUMENT_PREVIEW_ID, DOCUMENT_PREVIEW_KIND, basenameOf, documentDefinition,
} from '../src/client/definition.ts'

describe('basenameOf', () => {
  it('decodes the last segment, so an escaped name reads as itself', () => {
    expect(basenameOf('dsh-resource://file/session/s-1/work/notes/a%20b%23c.md')).toBe('a b#c.md')
  })

  it('falls back to the whole address when there is no last segment', () => {
    expect(basenameOf('dsh-resource://file/session/s-1/')).toBe('dsh-resource://file/session/s-1/')
  })

  it('keeps a malformed percent escape as it is rather than refusing the address', () => {
    expect(basenameOf('dsh-resource://file/session/s-1/work/%E0%A4%A')).toBe('%E0%A4%A')
  })
})

describe('documentDefinition', () => {
  it('claims Markdown and HTML file addresses at the builtin band, titled by basename', () => {
    const definition = documentDefinition()
    expect(definition.id).toBe(DOCUMENT_PREVIEW_ID)
    expect(definition.kind).toBe(DOCUMENT_PREVIEW_KIND)
    expect(definition.patterns).toEqual(['*.md', '*.markdown', '*.html', '*.htm'])
    expect(definition.priority).toBe('builtin')
    expect(definition.title('dsh-resource://file/session/s-1/work/README.md')).toBe('README.md')
    expect(definition.canOpen?.('dsh-resource://file/session/s-1/work/README.md')).toBe(true)
    expect(definition.canOpen?.('dsh-resource://file/session/s-1/work/Index.HTML')).toBe(true)
    expect(definition.canOpen?.('dsh-resource://file/absolute/home/me/notes.markdown')).toBe(true)
    expect(definition.canOpen?.('dsh-resource://file/session/s-1/work/a.ts')).toBe(false)
    expect(definition.canOpen?.('dsh-resource://file/absolute/home/me/notes.md')).toBe(true)
    expect(definition.canOpen?.('dsh-resource://file/shared/team/notes.md')).toBe(false)
    expect(definition.canOpen?.('dsh-resource://file/session')).toBe(false)
  })
})

describe('document type in the registry', () => {
  function registry() {
    const tabs = new SidebarRightTabRegistry(new Context())
    tabs.register(documentDefinition())
    return tabs
  }

  it('claims markdown and html in either scope, including nested paths and uppercase extensions', () => {
    const tabs = registry()
    for (const address of [
      'dsh-resource://file/session/s-1/a.md',
      'dsh-resource://file/session/s-1/deep/er/path/x.markdown',
      'dsh-resource://file/session/s-1/w/Index.HTML',
      'dsh-resource://file/session/s-1/w/page.HTM',
      'dsh-resource://file/absolute/home/me/notes.md',
      'dsh-resource://file/absolute/C:/w/x.html',
    ]) {
      expect(tabs.claim(address)).toEqual({
        kind: DOCUMENT_PREVIEW_KIND, contentId: address, title: basenameOf(address),
      })
    }
  })

  it('refuses a file address in no known scope at claim time', () => {
    const tabs = registry()
    const shared = 'dsh-resource://file/shared/team/notes.md'
    expect(tabs.candidates(shared)).toEqual([])
    expect(() => tabs.claim(shared)).toThrow('no registered tab type claims')
  })

  it('beats a fallback text type for markdown and html, and leaves other files to it', () => {
    const tabs = registry()
    tabs.register({
      id: 'test/text',
      kind: 'text',
      patterns: ['dsh-resource://file/**'],
      priority: 'fallback',
      canOpen: () => true,
      title: () => 'text',
    })
    expect(tabs.claim('dsh-resource://file/session/s-1/w/notes.md').kind).toBe(DOCUMENT_PREVIEW_KIND)
    expect(tabs.claim('dsh-resource://file/session/s-1/w/page.html').kind).toBe(DOCUMENT_PREVIEW_KIND)
    expect(tabs.claim('dsh-resource://file/session/s-1/w/a.ts').kind).toBe('text')
    expect(tabs.candidates('dsh-resource://file/session/s-1/w/notes.md').map(type => type.kind))
      .toEqual([DOCUMENT_PREVIEW_KIND, 'text'])
  })

  it('does not claim addresses of other schemes', () => {
    const tabs = registry()
    expect(() => tabs.claim('sidebar://guide')).toThrow('no registered tab type claims')
    expect(() => tabs.claim('https://example.com/a.md')).toThrow('no registered tab type claims')
  })
})
