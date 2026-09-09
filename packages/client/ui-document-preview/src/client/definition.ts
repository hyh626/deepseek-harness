/**
 * Stage one of this package's registration: what the `document` tab type IS.
 *
 * The type claims Markdown and HTML `dsh-resource://file/` addresses at the
 * `builtin` band so it beats the text preview's `fallback` claim for the same
 * address. `canOpen` refuses an address `parseFileAddress` rejects, or whose
 * path is not a previewable document extension.
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { isPreviewableDocumentPath } from './resources.ts'

/** The tab kind this package owns. */
export const DOCUMENT_PREVIEW_KIND = 'document'

/** This implementation's identity in the tab system: the key its body registers under. */
export const DOCUMENT_PREVIEW_ID = '@deepseek-ai/dsh-client-ui-document-preview'

/**
 * The tab title for one `file:` address: its decoded basename.
 *
 * The whole address stays the content identity, so two files with one name in
 * different directories are two tabs; only the chip text is shortened. Decoding
 * is per segment, matching how the address was built, so a name carrying `#`,
 * `?`, or a space reads as itself.
 * @param address - a `file:`-shaped address.
 * @returns the decoded last path segment, or the address itself when it has none.
 */
export function basenameOf(address: string): string {
  const name = address.slice(address.lastIndexOf('/') + 1)
  if (name === '') return address
  try {
    return decodeURIComponent(name)
  } catch {
    // A malformed percent sequence is still a name; showing it raw beats refusing the address.
    return name
  }
}

/**
 * The document type's registry definition.
 * @returns the definition to register.
 */
export function documentDefinition(): SidebarRightTabDefinition {
  return {
    id: DOCUMENT_PREVIEW_ID,
    kind: DOCUMENT_PREVIEW_KIND,
    patterns: ['*.md', '*.markdown', '*.html', '*.htm'],
    priority: 'builtin',
    canOpen: (address: string) => {
      const parsed = parseFileAddress(address)
      return parsed !== undefined && isPreviewableDocumentPath(parsed.path)
    },
    title: basenameOf,
  }
}
