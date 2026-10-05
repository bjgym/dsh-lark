/**
 * The settled-approval fold this channel's browser half reads off one
 * conversation's own event window.
 *
 * `ApprovalService` appends an `approval/asked` / `approval/decided` pair to
 * the requesting session's log whatever answers it, so the window already
 * carries every decision that ever settled — including the ones the chat
 * answered. That makes the log the one channel both surfaces can read without
 * either having to reach the other, and it is why this plugin needs no new
 * Host-to-Client event: the browser already holds the evidence.
 *
 * The fold answers one question only: which approvals are settled, and which of
 * those this browser did NOT settle itself. An approval this browser answered
 * needs nothing; one it never answered is a request the chat (or another
 * browser) decided while this page was open, and its composer panel is a
 * leftover press that can no longer decide anything.
 * @module dsh-lark-channel/client/decisions
 */

import type { SessionEventLikeEntry, SessionEventWindow } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
// Type-only: declaration-merges the approval/asked + approval/decided audit pair
// into SessionEventMap, which is what makes those events readable here at all.
import type {} from '@deepseek-ai/dsh-user-approval'

/** One approval the log settled, as the browser half needs to know it. */
export interface SettledApproval {
  /** The `approval/asked` request identity this decision closes. */
  readonly id: string
  /** The tool the question was about. */
  readonly toolName: string
  /** The exact tool call, when the asker named one. */
  readonly callId?: string
}

/**
 * Fold one session's event window into the approvals settled by somebody other
 * than this browser.
 *
 * `answeredHere` carries the request identities this browser submitted a
 * decision for; a settled request absent from it was settled elsewhere. The
 * window is scanned in full on every read because it is an in-memory array, and
 * because a partial fold would have to track which page arrivals were already
 * consumed — state that buys nothing for a few hundred entries.
 * @param window - the conversation's current event window.
 * @param answeredHere - request identities this browser answered itself.
 * @returns settled approvals this browser did not decide, in ask order.
 */
export function foldSettledElsewhere(
  window: SessionEventWindow,
  answeredHere: ReadonlySet<string>,
): readonly SettledApproval[] {
  const asked = new Map<string, SettledApproval>()
  const decided = new Set<string>()
  for (const entry of window.entries) {
    const event = eventOf(entry)
    if (event === undefined) continue
    if (event.type === 'approval/asked') {
      const data = event.data
      asked.set(data.id, {
        id: data.id,
        toolName: data.toolName,
        ...(data.callId === undefined ? {} : { callId: data.callId }),
      })
      continue
    }
    // Only a real decision counts. The log writes exactly one `approval/decided`
    // per ask, and every outcome it can carry — including the fail-closed
    // `'unavailable'` — means nobody is going to press that panel again.
    if (event.type === 'approval/decided') decided.add(event.data.id)
  }
  const settled: SettledApproval[] = []
  for (const [id, approval] of asked) {
    if (!decided.has(id)) continue
    if (answeredHere.has(id)) continue
    settled.push(approval)
  }
  return settled
}

/** The durable Session event behind one window entry, or undefined for a transient frame. */
function eventOf(entry: SessionEventLikeEntry): SessionEvent | undefined {
  return entry.type === 'event' ? entry.event : undefined
}
