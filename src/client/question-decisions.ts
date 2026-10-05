/**
 * The settled-question fold this channel's browser half reads off one
 * conversation's own event window.
 *
 * The blocking `ask_user_question` tool writes an ordinary `tool/call` and its
 * `tool/result` into the requesting session's log whatever answers it, and the
 * `userQuestions` projection deliberately tracks neither — it serves the opt-in
 * timed tool, whose calls are the only ones it can key by id. The window is
 * therefore the one channel both surfaces can read without either having to
 * reach the other, which is the same reason the approval half folds the audit
 * pair instead of waiting for a Host event.
 *
 * Only the MOST RECENT call is read. The blocking tool holds the turn until an
 * answer arrives, so at most one `ask_user_question` call is unanswered at a
 * time: the last one in the window is the question this page is presenting, and
 * every earlier one is history that must not retire a live panel. That rule is
 * also why a call id is not the correlation key here — the blocking request
 * carries no `wait`, so the presented card has no call id to match against.
 * @module dsh-lark-channel/client/question-decisions
 */

import type { SessionEventLikeEntry, SessionEventWindow } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'

/** The host tool whose calls and results this fold reads. */
const ASK_USER_QUESTION_TOOL = 'ask_user_question'

/** One answered question. */
export interface SettledQuestionAnswer {
  /** The answered question's own id, as the asker wrote it. */
  readonly id: string
  /** Labels the human chose; empty when they typed instead or skipped it. */
  readonly selected: readonly string[]
  /** Free text the human typed, when they did. */
  readonly custom?: string | undefined
}

/** One settled question call, as the browser half needs to know it. */
export interface SettledQuestion {
  /** The `tool/call` identity this answer closes. */
  readonly callId: string
  /** The answers the call settled with, one entry per question. */
  readonly answers: readonly SettledQuestionAnswer[]
}

/**
 * Fold one session's event window into the question call this page is showing
 * that somebody else already answered.
 * @param window - the conversation's current event window.
 * @param answeredHere - call identities this browser answered itself.
 * @returns the settled call this browser did not decide, or empty.
 */
export function foldSettledQuestions(
  window: SessionEventWindow,
  answeredHere: ReadonlySet<string>,
): readonly SettledQuestion[] {
  const latest = latestCallId(window)
  if (latest === undefined || answeredHere.has(latest)) return []
  for (const entry of window.entries) {
    const event = eventOf(entry)
    if (event?.type !== 'tool/result') continue
    if (event.data.message.toolCallId !== latest) continue
    // A failed call answered nobody: there is no decision to show, and the
    // request it belonged to is the one the Host already gave up on.
    if (event.data.error !== undefined || event.data.message.isError === true) return []
    const answers = answersOf(event.data.message.content)
    return answers === undefined ? [] : [{ callId: latest, answers }]
  }
  return []
}

/**
 * The `tool/call` identity of the newest question this conversation asked.
 * @param window - the conversation's current event window.
 * @returns the call id, or undefined when no question was ever asked.
 */
function latestCallId(window: SessionEventWindow): string | undefined {
  let latest: string | undefined
  for (const entry of window.entries) {
    const event = eventOf(entry)
    if (event?.type !== 'tool/call') continue
    if (event.data.name !== ASK_USER_QUESTION_TOOL) continue
    latest = event.data.callId
  }
  return latest
}

/**
 * The answer batch one result text carries.
 *
 * Read structurally rather than through a schema: this runs in the browser
 * against a value the Host wrote, and a result that does not parse is simply a
 * result that answered nothing.
 * @param content - the result's model-facing content blocks.
 * @returns the answers, or undefined when the text carries none this reader can use.
 */
function answersOf(content: readonly { readonly type: string; readonly text?: string }[]): readonly SettledQuestionAnswer[] | undefined {
  const text = content.find(block => block.type === 'text')?.text
  if (text === undefined) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    // Text that is not an answer JSON carries no batch; the caller shows none.
    void error
    return undefined
  }
  const answers = (parsed as { answers?: unknown } | null | undefined)?.answers
  if (!Array.isArray(answers)) return undefined
  return answers.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return []
    const record = entry as { id?: unknown; selected?: unknown; custom?: unknown }
    if (typeof record.id !== 'string') return []
    return [{
      id: record.id,
      selected: Array.isArray(record.selected) ? record.selected.map(String) : [],
      ...typeof record.custom === 'string' ? { custom: record.custom } : {},
    }]
  })
}

/** The durable Session event behind one window entry, or undefined for a transient frame. */
function eventOf(entry: SessionEventLikeEntry): SessionEvent | undefined {
  return entry.type === 'event' ? entry.event : undefined
}
