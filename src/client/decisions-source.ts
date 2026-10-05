/**
 * Live settled-approval reads for the conversations this channel drives.
 *
 * One source per session id, created on first use and kept for the page's
 * lifetime: a conversation the browser has open may settle approvals at any
 * moment, and a source that is torn down between panels would have to replay
 * the window to answer the same question again.
 * @module dsh-lark-channel/client/decisions-source
 */

import type { ISessions, SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { foldSettledElsewhere, type SettledApproval } from './decisions.ts'

/**
 * Read-only source of the approvals one conversation settled elsewhere.
 *
 * `markAnsweredHere` records a request this browser decided itself, so the
 * panel it just closed does not come back described as somebody else's
 * decision. It is deliberately process-local: the fact it records is about
 * this page's own presses, not about the session.
 */
export interface SettledApprovalsSource {
  /**
   * The most recent fold.
   * @returns settled approvals this browser did not decide, in ask order.
   */
  getSnapshot(): readonly SettledApproval[]
  /**
   * Observe fold changes.
   * @param listener - invalidation callback.
   * @returns unsubscribe function.
   */
  subscribe(listener: () => void): () => void
  /**
   * Record one request identity this browser answered, retiring it from the fold.
   * @param requestId - the `approval/asked` identity this browser decided.
   */
  markAnsweredHere(requestId: string): void
  /** Detach from the conversation's window. */
  dispose(): void
}

/**
 * Own the per-session reads for one Client assembly.
 *
 * A session whose binding is not currently materialized reads as empty rather
 * than retaining one: the panel only renders under a conversation the view
 * already holds, so by the time an answer is needed the binding exists. Reading
 * through `binding()` keeps this plugin out of the reference counts that decide
 * whether a conversation stays open.
 */
export class SettledApprovalsRegistry {
  private readonly sources = new Map<string, SettledApprovalsSource>()

  /**
   * @param sessions - the Client Session object layer this registry reads through.
   */
  constructor(private readonly sessions: ISessions) {}

  /**
   * The settled-approval source for one conversation, created on first use.
   * @param sessionId - Session identity whose window supplies the fold.
   * @returns the shared source for that session.
   */
  sourceFor(sessionId: SessionId): SettledApprovalsSource {
    const existing = this.sources.get(sessionId)
    if (existing !== undefined) return existing
    const created = createSource(this.sessions, sessionId)
    this.sources.set(sessionId, created)
    return created
  }

  /** Drop every source and its subscription. */
  dispose(): void {
    for (const source of this.sources.values()) source.dispose()
    this.sources.clear()
  }
}

/** One session's fold, published on every window mutation it observes. */
class SessionSettledApprovals implements SettledApprovalsSource {
  private readonly listeners = new Set<() => void>()
  private readonly answeredHere = new Set<string>()
  private read: readonly SettledApproval[] = []
  private binding: SessionBinding | undefined
  private unsubscribe: (() => void) | undefined
  private released = false

  /**
   * @param sessions - Session object layer supplying the borrowed binding.
   * @param sessionId - conversation this source folds.
   */
  constructor(
    private readonly sessions: ISessions,
    private readonly sessionId: SessionId,
  ) {}

  /** @returns the most recent fold. */
  getSnapshot(): readonly SettledApproval[] { return this.read }

  /**
   * Observe fold changes.
   * @param listener - invalidation callback.
   * @returns unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    this.attach()
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Retire one request this browser answered itself.
   * @param requestId - the `approval/asked` identity this browser decided.
   */
  markAnsweredHere(requestId: string): void {
    if (this.answeredHere.has(requestId)) return
    this.answeredHere.add(requestId)
    this.republish()
  }

  /** Detach from the window. */
  dispose(): void {
    this.released = true
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.listeners.clear()
  }

  /**
   * Borrow the live binding and follow its window once. A binding that is not
   * materialized yet leaves the fold empty; the next subscriber retries, which
   * is exactly when a panel exists and the conversation is therefore held.
   */
  private attach(): void {
    if (this.unsubscribe !== undefined || this.released) return
    const binding = this.sessions.binding(this.sessionId)
    if (binding === undefined) return
    this.binding = binding
    const source = binding.eventSource
    this.republish(source.getSnapshot())
    this.unsubscribe = source.subscribe(() => { this.republish(source.getSnapshot()) })
  }

  /**
   * Recompute the fold and publish only when it moved.
   * @param window - current window, or the borrowed binding's when omitted.
   */
  private republish(window?: ReturnType<SessionBinding['eventSource']['getSnapshot']>): void {
    if (this.released) return
    const current = window ?? this.binding?.eventSource.getSnapshot()
    if (current === undefined) return
    const next = foldSettledElsewhere(current, this.answeredHere)
    if (sameFold(this.read, next)) return
    this.read = next
    for (const listener of [...this.listeners]) listener()
  }
}

/**
 * Create one session's fold source.
 * @param sessions - Session object layer supplying the borrowed binding.
 * @param sessionId - conversation this source folds.
 * @returns the live source.
 */
function createSource(sessions: ISessions, sessionId: SessionId): SettledApprovalsSource {
  return new SessionSettledApprovals(sessions, sessionId)
}

/**
 * Whether two folds carry the same requests in the same order.
 * @param left - previous fold.
 * @param right - current fold.
 * @returns true when nothing a consumer can observe changed.
 */
function sameFold(left: readonly SettledApproval[], right: readonly SettledApproval[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => {
    const other = right[index]
    return other !== undefined && value.id === other.id && value.toolName === other.toolName && value.callId === other.callId
  })
}
