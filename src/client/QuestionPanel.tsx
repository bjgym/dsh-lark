/**
 * The question panel this channel's conversations render in the Web composer.
 *
 * It presents the same question the shipped panel does, plus one state that one
 * cannot reach: a request the log shows was already answered by another surface
 * — the Feishu chat, in the deployment this was built for. That request's panel
 * has stopped deciding anything, so this one says so and settles it instead of
 * waiting for a press that would be discarded.
 *
 * The panel is the TEMPORARY half of a two-surface question; see the plugin
 * entry for why the durable fix belongs in the gateway.
 * @module dsh-lark-channel/client/QuestionPanel
 */

import { useEffect, useRef, useState } from 'react'
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AnswerableQuestion, QuestionFace, QuestionTarget } from './question-store.ts'
import { answerBatchOf, asPendingQuestion, retirementForQuestion } from './question-store.ts'
import type { SettledQuestion } from './question-decisions.ts'
import type { SessionStatusSnapshot, UseSessionStatus } from '@deepseek-ai/dsh-client-ui-session/client'
import css from './QuestionPanel.module.css'

/** The framework seats this panel reads. */
export interface LarkQuestionPanelProps {
  /** Selector-matched request, from the chain entry's `select`. */
  readonly matched: QuestionTarget
  /** Live settled-question reads. */
  readonly panel: QuestionFace
  /** The Client's pending-interaction status seat. */
  readonly useSessionStatus: UseSessionStatus
  /** Panel copy. */
  readonly t: PropsLocale<'larkQuestion'>['t']
}

/**
 * The live reads this registration hands its own component.
 *
 * `hooks` is the registrant-private compartment: the renderer binds each bare
 * observable to a `use<Name>` selector hook, so the component subscribes
 * through the framework instead of holding a subscription of its own.
 */
export interface LarkQuestionInjected {
  readonly panel: QuestionFace
  readonly hooks: {
    readonly larkQuestionSettled: HostObservable<readonly SettledQuestion[]>
  }
}

/**
 * Present one question on a conversation this channel drives.
 *
 * The pending request and the settled fold are read through framework seats
 * rather than handed in: `select` must stay a pure function of the owner props,
 * so every live read reaches the component through a hook the slot composes
 * onto it.
 * @param props - matched request, live reads, and the locale seat.
 * @returns the question composer takeover.
 */
export function QuestionPanel(props: LarkQuestionPanelProps & InjectFace<LarkQuestionInjected>) {
  const settled = props.useLarkQuestionSettled((all: readonly SettledQuestion[]) => all)
  const pending = props.useSessionStatus((snapshot: SessionStatusSnapshot) =>
    asPendingQuestion(snapshot.get(props.matched.sessionId)?.pendingInteraction))
  return (
    <PanelFlow
      key={props.matched.key}
      matched={props.matched}
      panel={props.panel}
      pending={pending}
      settled={settled}
      t={props.t}
    />
  )
}

function PanelFlow({ matched, panel, pending, settled, t }: {
  readonly matched: QuestionTarget
  readonly panel: QuestionFace
  readonly pending: AnswerableQuestion | undefined
  readonly settled: readonly SettledQuestion[]
  readonly t: PropsLocale<'larkQuestion'>['t']
}) {
  const [answered, setAnswered] = useState(false)
  const [chosen, setChosen] = useState<readonly (readonly string[])[]>(() => matched.questions.map(() => []))
  const [typed, setTyped] = useState<readonly string[]>(() => matched.questions.map(() => ''))
  const waiting = useRef(false)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])

  const settledElsewhere = settled.length > 0

  /**
   * Retire the request the log shows was already answered, so the panel the
   * chat left behind does not stand waiting for a press that can no longer
   * change anything.
   *
   * The batch submitted here is the one the log recorded, so the panel's own
   * copy closes showing what was actually answered. A request the Client no
   * longer presents needs nothing — the shipped class rejects a second
   * settlement, which is the expected outcome here and not a failure.
   */
  useEffect(() => {
    const retire = retirementForQuestion(settled, pending)
    if (retire.length === 0) return
    for (const requestId of retire) panel.markAnsweredHere(matched.sessionId, requestId)
    void pending?.answer({ answers: settled[0]?.answers ?? [] }).catch(() => {})
  }, [settled, pending, panel, matched.sessionId])

  const inert = answered || settledElsewhere

  /**
   * Submit one batch.
   *
   * The pressed option travels as an argument rather than through state: React
   * is not readable in the tick it is written, so a single-choice press that
   * built its answer from `chosen` would send an empty selection. See
   * {@link answerBatchOf}.
   * @param pressed - the option a press just settled on, when one did.
   */
  const submit = (pressed?: { readonly index: number; readonly label: string }): void => {
    if (waiting.current || pending === undefined || inert) return
    const batch = answerBatchOf(matched.questions, chosen, typed, pressed)
    waiting.current = true
    setAnswered(true)
    void pending.answer(batch).catch(() => {
      if (!active.current) return
      waiting.current = false
      setAnswered(false)
    })
  }

  /**
   * Toggle one option of a multiple choice.
   * @param index - the question the option belongs to.
   * @param label - the option's own label.
   */
  const toggle = (index: number, label: string): void => {
    setChosen(previous => previous.map((entry, at) => {
      if (at !== index) return entry
      return entry.includes(label) ? entry.filter(value => value !== label) : [...entry, label]
    }))
  }

  const setAt = (index: number, value: string): void => {
    setTyped(previous => previous.map((entry, at) => (at === index ? value : entry)))
  }

  return (
    <div className={css.root} data-lark-question-key={matched.key} aria-busy={inert}>
      <div className={css.card}>
        <div className={css.strip}>
          <StateDot state={settledElsewhere ? 'done' : answered ? 'ongoing' : 'warning'} />
          {settledElsewhere ? t('answeredElsewhere') : t('waiting')}
        </div>
        {matched.questions.map((question, index) => (
          <div className={css.question} key={question.id}>
            {question.header !== undefined && <div className={css.header}>{question.header}</div>}
            <div className={css.prompt}>{question.question}</div>
            {question.detail !== undefined && <div className={css.detail}>{question.detail}</div>}
            <div className={css.actionRow}>
              {(question.options ?? []).map((option) => (
                <Button
                  key={option.label}
                  variant={question.multiSelect === true
                    ? (chosen[index] ?? []).includes(option.label) ? 'primary' : 'outline'
                    : 'outline'}
                  disabled={inert}
                  onClick={() => {
                    if (question.multiSelect === true) {
                      toggle(index, option.label)
                      return
                    }
                    submit({ index, label: option.label })
                  }}
                >
                  {option.label}
                </Button>
              ))}
            </div>
            <input
              className={css.freeText}
              value={typed[index] ?? ''}
              disabled={inert}
              placeholder={t('orType')}
              onChange={(event) => { setAt(index, event.target.value) }}
            />
          </div>
        ))}
        <div className={css.actionRow}>
          <Button variant="primary" disabled={inert || pending === undefined} onClick={() => { submit() }}>
            {t('submit')}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Full props of this panel's registration, for tests and the register site. */
export type LarkQuestionPanelFullProps =
  PropsRuntime<'conversation.composer'>
  & { readonly matched: QuestionTarget }
  & PropsLocale<'larkQuestion'>
