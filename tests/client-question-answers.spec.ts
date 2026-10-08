import { describe, expect, it } from 'vitest'
import {
  answerBatchOf, createSubmissionGuard, parseRecommendedLabel, recommendedFirstOption, retirementForQuestion,
} from '../src/client/question-store.ts'
import type { AnswerableQuestion, QuestionSpec } from '../src/client/question-store.ts'
import { createQuestionDrafts } from '../src/client/question-drafts.ts'
import { foldSettledQuestions } from '../src/client/question-decisions.ts'
import type { SessionEventWindow } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Two questions, as a model would ask them in one call. */
const asked: readonly QuestionSpec[] = [
  { id: 'q1', question: '部署到生产？', options: [{ label: '部署' }, { label: '取消' }] },
  { id: 'q2', question: '要不要通知？', options: [{ label: '通知' }, { label: '不通知' }] },
]

const unanswered = { selected: [] as string[], custom: '', skipped: false }

describe('the batch one submission sends', () => {
  it('carries one selected label per single-select question', () => {
    const batch = answerBatchOf(asked, [
      { selected: ['部署'], custom: '', skipped: false },
      unanswered,
    ])

    expect(batch.answers).toEqual([
      { id: 'q1', selected: ['部署'] },
      { id: 'q2', selected: [] },
    ])
  })

  it('carries every label of a multiple choice', () => {
    const batch = answerBatchOf(asked, [
      { selected: ['部署', '取消'], custom: '', skipped: false },
      unanswered,
    ])

    expect(batch.answers[0]).toEqual({ id: 'q1', selected: ['部署', '取消'] })
  })

  it('carries typed text as the free-form answer, trimmed', () => {
    const batch = answerBatchOf(asked, [
      { selected: [], custom: '  等周五再上  ', skipped: false },
      unanswered,
    ])

    expect(batch.answers[0]).toEqual({ id: 'q1', selected: [], custom: '等周五再上' })
  })

  it('lets a single-select typed answer replace its selection', () => {
    // On the shipped composer's terms a typed answer means "no option fits",
    // so the selection travels empty — an option plus typed text together is
    // one answer only on a multi-select.
    const batch = answerBatchOf(asked, [
      { selected: ['部署'], custom: '但要灰度', skipped: false },
      unanswered,
    ])

    expect(batch.answers[0]).toEqual({ id: 'q1', selected: [], custom: '但要灰度' })
  })

  it('sends an option and typed text together on a multi-select', () => {
    const multi: readonly QuestionSpec[] = [
      { id: 'q1', question: '哪些环境？', multiSelect: true, options: [{ label: '预发' }, { label: '生产' }] },
    ]
    const batch = answerBatchOf(multi, [
      { selected: ['预发'], custom: '再加一个灰度环境', skipped: false },
    ])

    expect(batch.answers[0]).toEqual({ id: 'q1', selected: ['预发'], custom: '再加一个灰度环境' })
  })

  it('answers a skipped question with an empty selection', () => {
    const batch = answerBatchOf(asked, [
      { selected: ['部署'], custom: '', skipped: true },
      unanswered,
    ])

    expect(batch.answers[0]).toEqual({ id: 'q1', selected: [] })
  })

  it('reports an empty selection only when the user really chose nothing', () => {
    // Submitting with nothing picked is a real answer — the Host reads it as
    // the user skipping the question.
    const batch = answerBatchOf(asked, [unanswered, unanswered])

    expect(batch.answers).toEqual([
      { id: 'q1', selected: [] },
      { id: 'q2', selected: [] },
    ])
  })

  it('answers a question the drafts have no entry for', () => {
    // Drafts are seeded per question, but a request whose list grew must not
    // throw or silently drop the question: an unanswered id is still an answer.
    const batch = answerBatchOf(asked, [])

    expect(batch.answers.map(answer => answer.id)).toEqual(['q1', 'q2'])
  })
})

describe('the recommendation suffix on an option label', () => {
  it('splits the suffix for display without changing the answer value', () => {
    expect(parseRecommendedLabel('直接合并 (recommended)')).toEqual({ label: '直接合并', recommended: true })
    expect(parseRecommendedLabel('先跑测试（推荐）')).toEqual({ label: '先跑测试', recommended: true })
    expect(parseRecommendedLabel('再想想')).toEqual({ label: '再想想', recommended: false })
  })

  it('seeds the draft only from a marked first choice', () => {
    // The marked choice is an implicit draft, not an answer: the panel still
    // waits for the user's own submission.
    expect(recommendedFirstOption({ id: 'q1', question: '?', options: [{ label: '先跑测试（推荐）' }, { label: '直接合并' }] }))
      .toBe('先跑测试（推荐）')
    expect(recommendedFirstOption({ id: 'q1', question: '?', options: [{ label: '直接合并' }, { label: '先跑测试（推荐）' }] }))
      .toBeUndefined()
    expect(recommendedFirstOption({ id: 'q1', question: '?', options: [] })).toBeUndefined()
    expect(recommendedFirstOption({ id: 'q1', question: '?' })).toBeUndefined()
  })
})

describe('the draft registry a remount restores from', () => {
  const SESSION = 'lark-oc_1' as SessionId
  const OTHER = 'web-session' as SessionId
  const progress = {
    index: 1,
    drafts: [
      { selected: ['部署'], custom: '', skipped: false },
      { selected: [], custom: '周五再说', skipped: false },
    ],
  }

  it('restores a stored progress that matches the request', () => {
    const drafts = createQuestionDrafts()
    drafts.replace(SESSION, 'question:1', progress)

    expect(drafts.read(SESSION, 'question:1', 2)).toEqual(progress)
  })

  it('returns a copy, so component state never aliases the registry', () => {
    const drafts = createQuestionDrafts()
    drafts.replace(SESSION, 'question:1', progress)
    const read = drafts.read(SESSION, 'question:1', 2)!
    read.drafts[0]!.selected.push('篡改')

    expect(drafts.read(SESSION, 'question:1', 2)!.drafts[0]!.selected).toEqual(['部署'])
  })

  it('restores nothing when the question count no longer matches', () => {
    const drafts = createQuestionDrafts()
    drafts.replace(SESSION, 'question:1', progress)

    expect(drafts.read(SESSION, 'question:1', 3)).toBeUndefined()
  })

  it('clamps a stored index the asker shrank past', () => {
    const drafts = createQuestionDrafts()
    drafts.replace(SESSION, 'question:1', { index: 5, drafts: progress.drafts })

    expect(drafts.read(SESSION, 'question:1', 2)!.index).toBe(1)
  })

  it('drops a cleared or disposed request', () => {
    const drafts = createQuestionDrafts()
    drafts.replace(SESSION, 'question:1', progress)
    drafts.clear(SESSION, 'question:1')
    expect(drafts.read(SESSION, 'question:1', 2)).toBeUndefined()

    drafts.replace(SESSION, 'question:2', progress)
    drafts.dispose()
    expect(drafts.read(SESSION, 'question:2', 2)).toBeUndefined()
  })

  it('restores the user\'s wait decision with the draft', () => {
    const drafts = createQuestionDrafts()
    drafts.replace(SESSION, 'question:1', { ...progress, wait: 'waiting' })

    expect(drafts.read(SESSION, 'question:1', 2)?.wait).toBe('waiting')
  })

  it('prunes every request a Session no longer presents', () => {
    // The live keys come from the request object, which is the only party that
    // knows which sibling cards its Session still holds.
    const drafts = createQuestionDrafts()
    drafts.replace(SESSION, 'question:1', progress)
    drafts.replace(SESSION, 'question:2', progress)
    drafts.prune(SESSION, ['question:2'])

    expect(drafts.read(SESSION, 'question:1', 2)).toBeUndefined()
    expect(drafts.read(SESSION, 'question:2', 2)).toEqual(progress)
  })

  it('keeps another Session\'s drafts when one Session prunes', () => {
    // One registry serves every conversation the Client renders, while the keep
    // set names one Session's live cards: pruning must not reach across.
    const drafts = createQuestionDrafts()
    drafts.replace(SESSION, 'question:1', progress)
    drafts.replace(OTHER, 'question:1', progress)
    drafts.prune(SESSION, [])

    expect(drafts.read(SESSION, 'question:1', 2)).toBeUndefined()
    expect(drafts.read(OTHER, 'question:1', 2)).toEqual(progress)
  })

  it('keeps one Session\'s draft when another Session clears the same key', () => {
    // Request keys are the carrier's own, and nothing promises they are unique
    // across conversations.
    const drafts = createQuestionDrafts()
    drafts.replace(SESSION, 'question:1', progress)
    drafts.replace(OTHER, 'question:1', progress)
    drafts.clear(SESSION, 'question:1')

    expect(drafts.read(SESSION, 'question:1', 2)).toBeUndefined()
    expect(drafts.read(OTHER, 'question:1', 2)).toEqual(progress)
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

  it('retires nothing for a review card, whose own record is the settlement', () => {
    const review = { answer: async () => {}, review: [] } satisfies AnswerableQuestion

    expect(retirementForQuestion([{ callId: 'call-1', answers: [] }], review)).toEqual([])
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

describe('the guard one panel mount submits through', () => {
  it('admits one submission at a time', () => {
    const guard = createSubmissionGuard()
    const first = guard.begin()

    expect(first).toBeDefined()
    expect(guard.begin()).toBeUndefined()
  })

  it('admits the retry a re-armed panel asks for', () => {
    // A waterfall answer the gateway dropped leaves the card open with its draft
    // intact, and the panel re-arms its controls so the same draft can go again.
    const guard = createSubmissionGuard()
    const dropped = guard.begin()
    guard.rearm()

    const retried = guard.begin()

    expect(retried).toBeDefined()
    expect(retried).not.toBe(dropped)
  })

  it('retires the dropped submission, so its outcome cannot touch the retry', () => {
    const guard = createSubmissionGuard()
    const dropped = guard.begin()!
    guard.rearm()
    const retried = guard.begin()!

    expect(guard.owns(dropped)).toBe(false)
    // The dropped answer rejecting later must not be reported as the retry's
    // failure, and must not release the retry's guard either.
    expect(guard.finish(dropped)).toBe(false)
    expect(guard.owns(retried)).toBe(true)
  })

  it('releases the guard for the submission that finished', () => {
    const guard = createSubmissionGuard()
    const token = guard.begin()!

    expect(guard.finish(token)).toBe(true)
    expect(guard.finish(token)).toBe(false)
    expect(guard.begin()).toBeDefined()
  })
})
