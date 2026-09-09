/**
 * Per-session document preview state: loads confined Host reads, cancels
 * superseded requests, revokes image object URLs, and owns interactive grants.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InteractivePreviewGrant, InteractivePreviewId } from '@deepseek-ai/dsh-host-interactive-preview/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { replaceHtmlMermaid, sanitizePreviewHtml, wrapPreviewSrcdoc } from './html.ts'
import { previewMermaidRenderer } from './mermaid.ts'
import {
  collectHtmlImageSources,
  collectMarkdownImageSources,
  rewriteHtmlImageSources,
} from './resources.ts'

/** Per-session preview snapshot the tab body renders. */
export interface DocumentPreviewView {
  status: 'idle' | 'loading' | 'ready' | 'error'
  path: string | null
  format: 'markdown' | 'html' | null
  content: string | null
  imageUrls: Record<string, string>
  error: string | null
  htmlMode: 'static' | 'interactive'
  interactiveOrigin: string | null
  grantId: InteractivePreviewId | null
  startingInteractive: boolean
  interactiveError: string | null
}

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

/** Host remotes the controller calls. */
export interface DocumentPreviewHost {
  readPreviewDocument: (
    sessionId: SessionId,
    path: string,
    signal?: AbortSignal,
  ) => Promise<{ path: string; format: 'markdown' | 'html'; content: string }>
  readPreviewImage: (
    sessionId: SessionId,
    documentPath: string,
    source: string,
    signal?: AbortSignal,
  ) => Promise<{ mediaType: string; data: string }>
  startInteractivePreview: (
    sessionId: SessionId,
    path: string,
    parentOrigin: string,
    signal?: AbortSignal,
  ) => Promise<InteractivePreviewGrant>
  stopInteractivePreview: (id: InteractivePreviewId, signal?: AbortSignal) => Promise<void>
  parentOrigin: string
  openPath: (path: string) => Promise<void>
}

/** Outward preview face the tab body calls to load Markdown or HTML files. */
export interface IDocumentPreview {
  /**
   * Load a previewable document for one session.
   * @param sessionId - Session whose cwd confines the read.
   * @param path - Workspace document path.
   */
  open(sessionId: SessionId, path: string): void
  /**
   * Reload the current document for one session.
   * @param sessionId - Session whose preview should refresh.
   */
  reload(sessionId: SessionId): void
  /**
   * Stop grants and drop preview state for one session.
   * @param sessionId - Session whose preview should close.
   */
  close(sessionId: SessionId): void
  /**
   * Open the current document with the host OS default application.
   * @param sessionId - Session whose current preview path is opened.
   */
  openExternal(sessionId: SessionId): void
  /**
   * Mint an isolated origin for the current HTML document after explicit consent.
   * @param sessionId - Session whose HTML preview should become interactive.
   */
  enableInteractive(sessionId: SessionId): void
  /**
   * Observable preview snapshot for one session.
   * @param sessionId - Session whose tab is rendering.
   * @returns Stable per-session store identity.
   */
  state(sessionId: SessionId): SnapshotStore<DocumentPreviewView>
  /** Abort inflight reads, stop grants, and revoke object URLs. */
  dispose(): void
}

/**
 * Session-scoped preview loader.
 * @param host - Confined reads, native open, and grants.
 */
export class DocumentPreviewController implements IDocumentPreview {
  private readonly stores = new Map<string, SnapshotStore<DocumentPreviewView>>()
  private readonly inflight = new Map<string, AbortController>()
  private readonly blobs = new Map<string, string[]>()
  private readonly generations = new Map<string, number>()
  private readonly grants = new Map<string, InteractivePreviewId>()
  private readonly authorized = new Map<string, boolean>()

  constructor(private readonly host: DocumentPreviewHost) {}

  /**
   * Load a previewable document for one session.
   * @param sessionId - Session whose cwd confines the read.
   * @param path - Workspace document path.
   */
  open(sessionId: SessionId, path: string): void {
    void this.load(sessionId, path)
  }

  /**
   * Reload the current document for one session.
   * @param sessionId - Session whose preview should refresh.
   */
  reload(sessionId: SessionId): void {
    const path = this.state(sessionId).getSnapshot().path
    if (path === null) return
    void this.load(sessionId, path)
  }

  /**
   * Stop grants and drop preview state for one session.
   * @param sessionId - Session whose preview should close.
   */
  close(sessionId: SessionId): void {
    this.abort(sessionId)
    this.revoke(sessionId)
    this.authorized.delete(sessionId as string)
    void this.stopGrant(sessionId)
    this.state(sessionId).set(IDLE)
  }

  /**
   * Open the current document with the host OS default application.
   * @param sessionId - Session whose current preview path is opened.
   */
  openExternal(sessionId: SessionId): void {
    const path = this.state(sessionId).getSnapshot().path
    if (path === null) return
    void this.host.openPath(path)
  }

  /**
   * Mint an isolated origin for the current HTML document after explicit consent.
   * @param sessionId - Session whose HTML preview should become interactive.
   */
  enableInteractive(sessionId: SessionId): void {
    const view = this.state(sessionId).getSnapshot()
    if (view.status !== 'ready' || view.format !== 'html' || view.path === null) return
    if (view.htmlMode === 'interactive' || view.startingInteractive) return
    this.authorized.set(sessionId as string, true)
    this.state(sessionId).set({ ...view, startingInteractive: true, interactiveError: null })
    void this.startGrant(sessionId, view.path)
  }

  /**
   * Observable preview snapshot for one session.
   * @param sessionId - Session whose tab is rendering.
   * @returns Stable per-session store identity.
   */
  state(sessionId: SessionId): SnapshotStore<DocumentPreviewView> {
    const key = sessionId as string
    const existing = this.stores.get(key)
    if (existing !== undefined) return existing
    const store = createSnapshotStore<DocumentPreviewView>(IDLE)
    this.stores.set(key, store)
    return store
  }

  /** Abort inflight reads, stop grants, and revoke object URLs. */
  dispose(): void {
    for (const sessionId of [...this.stores.keys()]) {
      this.abort(sessionId as SessionId)
      this.revoke(sessionId as SessionId)
      this.authorized.delete(sessionId)
      void this.stopGrant(sessionId as SessionId)
    }
    this.stores.clear()
  }

  private abort(sessionId: SessionId): number {
    const key = sessionId as string
    this.inflight.get(key)?.abort()
    this.inflight.delete(key)
    const generation = (this.generations.get(key) ?? 0) + 1
    this.generations.set(key, generation)
    return generation
  }

  private revoke(sessionId: SessionId): void {
    const key = sessionId as string
    for (const url of this.blobs.get(key) ?? []) URL.revokeObjectURL(url)
    this.blobs.delete(key)
  }

  private stopGrant(sessionId: SessionId): Promise<void> | undefined {
    const key = sessionId as string
    const id = this.grants.get(key)
    this.grants.delete(key)
    if (id === undefined) return
    return this.host.stopInteractivePreview(id).catch(() => {
      // Close is idempotent; a failed stop still drops the local grant id.
    })
  }

  private async startGrant(sessionId: SessionId, path: string): Promise<void> {
    const generation = this.abort(sessionId)
    const key = sessionId as string
    const abort = new AbortController()
    this.inflight.set(key, abort)
    const current = this.state(sessionId).getSnapshot()
    this.state(sessionId).set({
      ...current,
      startingInteractive: true,
      interactiveError: null,
    })
    const stopping = this.stopGrant(sessionId)
    if (stopping !== undefined) await stopping
    if (!this.current(key, generation, abort)) return
    try {
      const grant = await this.host.startInteractivePreview(
        sessionId,
        path,
        this.host.parentOrigin,
        abort.signal,
      )
      if (!this.current(key, generation, abort)) {
        await this.host.stopInteractivePreview(grant.id, abort.signal).catch(() => {
          // The superseded grant is closed best-effort; later loads own the session.
        })
        return
      }
      this.grants.set(key, grant.id)
      this.state(sessionId).set({
        ...this.state(sessionId).getSnapshot(),
        htmlMode: 'interactive',
        interactiveOrigin: grant.origin,
        grantId: grant.id,
        startingInteractive: false,
        interactiveError: null,
      })
    } catch (error: unknown) {
      if (!this.current(key, generation, abort)) return
      this.grants.delete(key)
      this.state(sessionId).set({
        ...this.state(sessionId).getSnapshot(),
        htmlMode: 'static',
        interactiveOrigin: null,
        grantId: null,
        startingInteractive: false,
        interactiveError: interactiveMessageOf(error),
      })
    }
  }

  private async load(sessionId: SessionId, path: string): Promise<void> {
    const previous = this.state(sessionId).getSnapshot()
    const retainInteractive = previous.path === path && this.authorized.get(sessionId as string) === true
    if (previous.path !== path) this.authorized.delete(sessionId as string)
    const generation = this.abort(sessionId)
    this.revoke(sessionId)
    const key = sessionId as string
    const abort = new AbortController()
    this.inflight.set(key, abort)
    this.state(sessionId).set({
      status: 'loading',
      path,
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
    if (!retainInteractive) {
      const stopping = this.stopGrant(sessionId)
      if (stopping !== undefined) {
        await stopping
        if (!this.current(key, generation, abort)) return
      }
    }
    let imageUrls: Record<string, string> = {}
    try {
      const document = await this.host.readPreviewDocument(sessionId, path, abort.signal)
      if (!this.current(key, generation, abort)) return
      const sources = document.format === 'html'
        ? collectHtmlImageSources(document.content)
        : collectMarkdownImageSources(document.content)
      imageUrls = await this.loadImages(sessionId, document.path, sources, abort.signal)
      if (!this.current(key, generation, abort)) {
        for (const url of Object.values(imageUrls)) URL.revokeObjectURL(url)
        return
      }
      let content = document.content
      const mermaidUrls: string[] = []
      if (document.format === 'html') {
        const rewritten = rewriteHtmlImageSources(
          sanitizePreviewHtml(document.content),
          new Map(Object.entries(imageUrls)),
        )
        const mermaid = await replaceHtmlMermaid(rewritten, previewMermaidRenderer, abort.signal)
        mermaidUrls.push(...mermaid.urls)
        content = wrapPreviewSrcdoc(mermaid.html)
      }
      this.blobs.set(key, [...Object.values(imageUrls), ...mermaidUrls])
      this.state(sessionId).set({
        status: 'ready',
        path: document.path,
        format: document.format,
        content,
        imageUrls,
        error: null,
        htmlMode: 'static',
        interactiveOrigin: null,
        grantId: null,
        startingInteractive: false,
        interactiveError: null,
      })
      if (retainInteractive && document.format === 'html') {
        this.authorized.set(key, true)
        void this.startGrant(sessionId, document.path)
      }
    } catch (error: unknown) {
      if (!this.current(key, generation, abort)) {
        for (const url of Object.values(imageUrls)) URL.revokeObjectURL(url)
        return
      }
      this.state(sessionId).set({
        status: 'error',
        path,
        format: null,
        content: null,
        imageUrls: {},
        error: messageOf(error),
        htmlMode: 'static',
        interactiveOrigin: null,
        grantId: null,
        startingInteractive: false,
        interactiveError: null,
      })
    }
  }

  private current(key: string, generation: number, abort: AbortController): boolean {
    return !abort.signal.aborted && this.generations.get(key) === generation
  }

  private async loadImages(
    sessionId: SessionId,
    documentPath: string,
    sources: readonly string[],
    signal: AbortSignal,
  ): Promise<Record<string, string>> {
    const imageUrls: Record<string, string> = {}
    for (const source of sources) {
      signal.throwIfAborted()
      try {
        const image = await this.host.readPreviewImage(sessionId, documentPath, source, signal)
        const bytes = Uint8Array.from(atob(image.data), char => char.charCodeAt(0))
        imageUrls[source] = URL.createObjectURL(new Blob([bytes], { type: image.mediaType }))
      } catch {
        // A missing or refused image stays as the authored source; HTML CSP
        // and MarkdownText's allowlist then omit it instead of failing the document.
      }
    }
    return imageUrls
  }
}

function messageOf(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const record = error as { message?: unknown; code?: unknown }
    if (typeof record.message === 'string') return record.message
  }
  return error instanceof Error ? error.message : String(error)
}

function interactiveMessageOf(error: unknown): string {
  return messageOf(error)
}
