import { describe, expect, it } from 'vitest'
import { answerBatchOf, retirementForQuestion } from '../src/client/question-store.ts'
import type { AnswerableQuestion, QuestionSpec } from '../src/client/question-store.ts'
import { foldSettledQuestions } from '../src/client/question-decisions.ts'
import type { SessionEventWindow } from '@deepseek-ai/dsh-api-session-controller/client'

/** Two questions, as a model would ask them in one call. */
const asked: readonly QuestionSpec[] = [
  { id: 'q1', question: '部署到生产？', options: [{ label: '部署' }, { label: '取消' }] },
  { id: 'q2', question: '要不要通知？', options: [{ label: '通知' }, { label: '不通知' }] },
]

describe('the batch one submission sends', () => {
  it('carries the option a press just settled on, not the state before it', () => {
    // The regression this exists for: a single-choice press used to build its
    // answer from React state, which is not readable in the tick it is written,
    // so every press sent `selected: []` and the model was told the user chose
    // nothing.
    const batch = answerBatchOf(asked, [[], []], ['', ''], { index: 0, label: '部署' })

    expect(batch.answers).toEqual([
      { id: 'q1', selected: ['部署'] },
      { id: 'q2', selected: [] },
    ])
  })

  it('leaves the other questions of the batch alone', () => {
    const batch = answerBatchOf(asked, [[], ['通知']], ['', ''], { index: 0, label: '取消' })

    expect(batch.answers).toEqual([
      { id: 'q1', selected: ['取消'] },
      { id: 'q2', selected: ['通知'] },
    ])
  })

  it('carries every label of a multiple choice', () => {
    const batch = answerBatchOf(asked, [['部署', '取消'], []], ['', ''])

    expect(batch.answers[0]).toEqual({ id: 'q1', selected: ['部署', '取消'] })
  })

  it('carries typed text as the free-form answer, trimmed', () => {
    const batch = answerBatchOf(asked, [[], []], ['  等周五再上  ', ''])

    expect(batch.answers[0]).toEqual({ id: 'q1', selected: [], custom: '等周五再上' })
  })

  it('sends an option and typed text together, which is how "other, plus a label" reads', () => {
    const batch = answerBatchOf(asked, [['部署'], []], ['但要灰度', ''])

    expect(batch.answers[0]).toEqual({ id: 'q1', selected: ['部署'], custom: '但要灰度' })
  })

  it('reports an empty selection only when the user really chose nothing', () => {
    // Submitting with nothing picked is a real answer — the Host reads it as the
    // user skipping the question — so this must stay distinguishable from a
    // press that lost its own label.
    const batch = answerBatchOf(asked, [[], []], ['', ''])

    expect(batch.answers).toEqual([
      { id: 'q1', selected: [] },
      { id: 'q2', selected: [] },
    ])
  })

  it('answers a question the state has no entry for', () => {
    // State is seeded per question, but a request whose list grew must not throw
    // or silently drop the question: an unanswered id is still an answer.
    const batch = answerBatchOf(asked, [], [])

    expect(batch.answers.map(answer => answer.id)).toEqual(['q1', 'q2'])
  })
})

describe('what a panel retires when the log shows another surface answered', () => {
  const pending = { answer: async () => {} } satisfies AnswerableQuestion

  it('retires the settled call while a request is still presented', () => {
    expect(retirementForQuestion([{ callId: 'call-1', answers: [] }], pending)).toEqual(['call-1'])
  })

  it('retires nothing without a settled call, or without a presented request', () => {
    expect(retirementForQuestion([], pending)).toEqual([])
    expect(retirementForQuestion([{ callId: 'call-1', answers: [] }], undefined)).toEqual([])
  })
})

/** A window over the given raw session events. */
function windowOf(events: readonly { type: string; data: unknown }[]): SessionEventWindow {
  return { entries: events.map(event => ({ type: 'event', event })) } as unknown as SessionEventWindow
}

/** One `tool/call` for the question tool. */
function call(callId: string) {
  return { type: 'tool/call', data: { turn: 1, step: 1, callId, name: 'ask_user_question', arguments: '{}' } }
}

/** One `tool/result` carrying an answer batch. */
function result(callId: string, answers: readonly { id: string; selected: string[] }[]) {
  return {
    type: 'tool/result',
    data: {
      turn: 1,
      step: 1,
      message: { toolCallId: callId, isError: false, content: [{ type: 'text', text: JSON.stringify({ answers }) }] },
    },
  }
}

describe('folding the question the log shows was answered', () => {
  it('reports nothing while the newest question has no result yet', () => {
    expect(foldSettledQuestions(windowOf([call('call-1')]), new Set())).toEqual([])
  })

  it('reports the newest call\'s answers once its result lands', () => {
    const settled = foldSettledQuestions(
      windowOf([call('call-1'), result('call-1', [{ id: 'q1', selected: ['部署'] }])]),
      new Set(),
    )

    expect(settled).toEqual([{ callId: 'call-1', answers: [{ id: 'q1', selected: ['部署'] }] }])
  })

  it('ignores history: only the newest question can retire a live panel', () => {
    // The blocking tool holds the turn, so at most one question is open. An
    // older settled call must not be mistaken for this one's answer.
    const settled = foldSettledQuestions(
      windowOf([
        call('call-old'),
        result('call-old', [{ id: 'q-old', selected: ['旧答案'] }]),
        call('call-new'),
      ]),
      new Set(),
    )

    expect(settled).toEqual([])
  })

  it('reports nothing for a call this browser answered itself', () => {
    const settled = foldSettledQuestions(
      windowOf([call('call-1'), result('call-1', [{ id: 'q1', selected: ['部署'] }])]),
      new Set(['call-1']),
    )

    expect(settled).toEqual([])
  })

  it('reports nothing for a failed call, which answered nobody', () => {
    const failed = {
      type: 'tool/result',
      data: {
        turn: 1,
        step: 1,
        message: { toolCallId: 'call-1', isError: true, content: [{ type: 'text', text: 'boom' }] },
      },
    }

    expect(foldSettledQuestions(windowOf([call('call-1'), failed]), new Set())).toEqual([])
  })

  it('reports nothing when no question was ever asked', () => {
    expect(foldSettledQuestions(windowOf([]), new Set())).toEqual([])
  })

  it('reports nothing for a result whose text carries no answer batch', () => {
    const noise = {
      type: 'tool/result',
      data: {
        turn: 1,
        step: 1,
        message: { toolCallId: 'call-1', isError: false, content: [{ type: 'text', text: 'not json' }] },
      },
    }

    expect(foldSettledQuestions(windowOf([call('call-1'), noise]), new Set())).toEqual([])
  })
})
