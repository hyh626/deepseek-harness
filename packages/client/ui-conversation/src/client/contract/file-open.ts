/**
 * Conversation-owned file-open waterfall. Chat `openFile` resolves against
 * the session cwd, then runs this chain; the terminal `next()` is native
 * `workspaces.openPath`.
 */
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'

/** One chat-originated workspace path open. */
export interface ConversationOpenFileRequest {
  /** Session whose cwd confined the path resolution. */
  sessionId: SessionId
  /** Path after `resolveWorkspacePath` against that session cwd. */
  path: string
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Claim or delegate a chat-originated workspace file open.
     * Listeners that own the path return without `next()`; every other
     * listener must call `next()` so native open remains the default.
     * @param request - Session and resolved workspace path.
     * @param next - Native `workspaces.openPath` terminal.
     * @mode waterfall
     */
    'conversation/open-file'(
      request: ConversationOpenFileRequest,
      next: () => void,
    ): void
  }
}
