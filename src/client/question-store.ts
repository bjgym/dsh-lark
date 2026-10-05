/**
 * The live face one Lark question panel renders from.
 *
 * A chain entry's `select` is a pure function of the owner props, so it cannot
 * ask whether the request it just matched has already been answered. That
 * question needs a live read of the conversation's settled-question fold, so it
 * belongs behind the registration's `inject` face — the one channel through
 * which a registration hands live data to its own component.
 *
 * The panel this drives is the TEMPORARY half of a two-surface question; see the
 * plugin entry for why the durable fix belongs in the gateway.
 * @module dsh-lark-channel/client/question-store
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettledQuestion } from './question-decisions.ts'
import type { SettledSourceRegistry } from './decisions-source.ts'

/**
 * One choice a question offers, as the asker wrote it.
 *
 * Declared structurally like every other host contract here: the owning package
 * is not one this channel depends on, so the browser half describes the value it
 * reads rather than importing a second published package to name it.
 */
export interface QuestionOption {
  /** User-facing label the answer echoes back. */
  readonly label: string
  /** Optional extra context a capable UI renders beside the label. */
  readonly description?: string | undefined
}

/** One question of a request. */
export interface QuestionSpec {
  /** Stable asker-provided identity, echoed in the answer. */
  readonly id: string
  /** The question to display. */
  readonly question: string
  /** Optional short heading the asker grouped it under. */
  readonly header?: string | undefined
  /** Optional supporting detail kept out of the option labels. */
  readonly detail?: string | undefined
  /** Choices offered, when the asker named any. */
  readonly options?: readonly QuestionOption[] | undefined
  /** Whether more than one option may be selected. Defaults to single-select. */
  readonly multiSelect?: boolean | undefined
}

/** One answered question, in the shape the Host's tool returns. */
export interface QuestionAnswerItem {
  /** The answered question's own id. */
  readonly id: string
  /** Labels chosen; empty when the human typed instead or skipped it. */
  readonly selected: readonly string[]
  /** Free text the human typed, when they did. */
  readonly custom?: string | undefined
}

/** A complete answer batch, one entry per question asked. */
export interface QuestionAnswerBatch {
  /** The answers, in ask order. */
  readonly answers: readonly QuestionAnswerItem[]
}

/** One question request the panel is asked to present. */
export interface QuestionTarget {
  /** Conversation the request belongs to. */
  readonly sessionId: SessionId
  /** The request's own render identity, which a settlement is recorded against. */
  readonly key: string
  /** The questions to present, in ask order. */
  readonly questions: readonly QuestionSpec[]
}

/** The minimal answerable face this panel needs off the shipped pending request. */
export interface AnswerableQuestion {
  /**
   * Resolve the waiting Host request.
   * @param batch - the complete answer batch, one entry per question.
   * @returns completion once the batch was submitted.
   */
  answer(batch: QuestionAnswerBatch): Promise<void>
}

/** Live settled-question reads for one panel. */
export interface QuestionFace {
  /**
   * Record one settled request this browser has retired.
   * @param sessionId - conversation whose fold reported the request.
   * @param requestId - the `tool/call` identity this browser settled.
   */
  markAnsweredHere(sessionId: SessionId, requestId: string): void
  /**
   * The conversation's settled questions as a bare observable.
   *
   * This is what the registration hands the renderer's `hooks` compartment, so
   * the component reads it through a framework-bound `use` hook instead of
   * subscribing itself. Identity is stable per session, which the hook cache
   * requires.
   * @param sessionId - conversation to follow.
   * @returns the observable the renderer binds.
   */
  settledSource(sessionId: SessionId): HostObservable<readonly SettledQuestion[]>
}

/**
 * Build the answer batch one submission sends.
 *
 * `pressed` carries the option a click has just settled on, and it is why this
 * is a function rather than a few lines inside the component: React state is not
 * readable in the tick it is written, so a single-choice press that built its
 * answer from `chosen` would send the selection from BEFORE the press — an empty
 * one, which the Host records as the user having chosen nothing. Passing the
 * pressed label in makes the press the authority on its own answer.
 * @param questions - the questions being answered, in ask order.
 * @param chosen - labels selected so far, by question index.
 * @param typed - free text typed so far, by question index.
 * @param pressed - the option a press just settled on, when one did.
 * @returns the batch to submit, one entry per question.
 */
export function answerBatchOf(
  questions: readonly QuestionSpec[],
  chosen: readonly (readonly string[])[],
  typed: readonly string[],
  pressed?: { readonly index: number; readonly label: string } | undefined,
): QuestionAnswerBatch {
  return {
    answers: questions.map((question, index) => {
      const labels = pressed?.index === index ? [pressed.label] : chosen[index] ?? []
      const text = (typed[index] ?? '').trim()
      // A typed answer is how a person answers when no option fits, so it
      // travels as the free-form field rather than as a chosen label.
      return {
        id: question.id,
        selected: [...labels],
        ...text === '' ? {} : { custom: text },
      }
    }),
  }
}

/**
 * The log identities a panel should retire without waiting for a press.
 *
 * The fold has already narrowed itself to the one call this conversation is
 * presenting, so every settled item it carries is this panel's answer. A
 * request the Client no longer presents needs nothing: the shipped class
 * rejects a second settlement, which is the expected outcome here rather than a
 * failure.
 * @param settled - the settled call matching this panel, if any.
 * @param pending - the request the Client currently presents, if any.
 * @returns the identities to record, empty when there is nothing to retire.
 */
export function retirementForQuestion(
  settled: readonly SettledQuestion[],
  pending: AnswerableQuestion | undefined,
): readonly string[] {
  if (settled.length === 0) return []
  if (pending === undefined) return []
  return settled.map(question => question.callId)
}

/**
 * Build the live face one panel renders from.
 * @param settled - the per-session settled-question reads.
 * @returns the face the panel settles through.
 */
export function createQuestionFace(settled: SettledSourceRegistry<SettledQuestion>): QuestionFace {
  return {
    markAnsweredHere(sessionId, requestId) {
      settled.sourceFor(sessionId).markAnsweredHere(requestId)
    },
    settledSource(sessionId) {
      return settled.sourceFor(sessionId)
    },
  }
}

/**
 * Narrow one Client pending interaction to the answerable question face.
 *
 * The parameter is structural rather than the merged union: the shipped request
 * is a class with private fields, so only its own instances satisfy that type,
 * and a caller reading the status snapshot has an opaque projected value. The
 * discriminator is `kind`, not `instanceof` — the shipped class is a
 * bundle-local value the browser half cannot import, and `kind` is the
 * domain-owned presentation tag the shared projection documents for exactly
 * this purpose. `plan-review` is excluded: this channel still reviews plans
 * through its own shadowed tool, so the shipped panel keeps that one.
 * @param pending - a pending interaction from the Client status snapshot.
 * @returns the answerable request, or undefined when it is not a question.
 */
export function asPendingQuestion(
  pending: { readonly kind: string } | undefined,
): AnswerableQuestion | undefined {
  if (pending === undefined || pending.kind !== 'question') return undefined
  return pending as unknown as AnswerableQuestion
}
