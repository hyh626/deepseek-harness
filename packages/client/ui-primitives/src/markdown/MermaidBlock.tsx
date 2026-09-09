/**
 * Opt-in mermaid fence: a supplied renderer returns SVG, which this block
 * publishes as a blob image so authored SVG never enters the application DOM.
 */

import { useEffect, useState } from 'react'
import { CodeBlock } from './CodeBlock.tsx'
import css from './MarkdownText.module.css'

/** Settled mermaid fence renderer supplied by a MarkdownText owner. */
export interface MermaidRenderer {
  /**
   * Turn mermaid source into SVG markup.
   * @param source - Fence body without the closing fence.
   * @param signal - Aborts when the fence unmounts or its source is replaced.
   * @returns SVG markup; the block wraps it in a blob URL rather than inserting it.
   */
  render(source: string, signal: AbortSignal): Promise<string>
}

export interface MermaidBlockProps {
  /** Fence body passed to the renderer and kept as the error fallback. */
  source: string
  /** Owner-supplied mermaid renderer. */
  renderer: MermaidRenderer
  /** Localized failure copy shown above the retained source fence. */
  errorLabel?: string | undefined
  /** Copy-button idle label forwarded to the fallback CodeBlock. */
  copyLabel?: string | undefined
  /** Copy-button confirmation label forwarded to the fallback CodeBlock. */
  copiedLabel?: string | undefined
}

/**
 * Render one settled mermaid fence through an owner-supplied renderer.
 * @param props - Fence source, renderer, and localized labels.
 * @returns A blob image on success, otherwise the source fence plus an error line.
 */
export function MermaidBlock({
  source,
  renderer,
  errorLabel = '图表渲染失败',
  copyLabel,
  copiedLabel,
}: MermaidBlockProps) {
  const [imageSrc, setImageSrc] = useState<string | undefined>()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const abort = new AbortController()
    let objectUrl: string | undefined
    let cancelled = false
    setImageSrc(undefined)
    setFailed(false)
    void renderer.render(source, abort.signal).then(
      (svg) => {
        if (cancelled || abort.signal.aborted) return
        const nextUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
        objectUrl = nextUrl
        setImageSrc(nextUrl)
      },
      () => {
        if (cancelled || abort.signal.aborted) return
        setFailed(true)
      },
    )
    return () => {
      cancelled = true
      abort.abort()
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl)
    }
  }, [source, renderer])

  if (imageSrc !== undefined) {
    return <img className={css.image} src={imageSrc} alt="" />
  }

  const fallback = (
    <CodeBlock
      code={`${source}\n`}
      lang="mermaid"
      copyLabel={copyLabel}
      copiedLabel={copiedLabel}
    />
  )
  if (!failed) return fallback
  return (
    <>
      <p>{errorLabel}</p>
      {fallback}
    </>
  )
}
