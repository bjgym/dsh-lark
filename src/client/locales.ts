/**
 * Approval panel copy, owned by this plugin.
 *
 * The panel appears where the shipped approval presentation would, so its
 * wording stays deliberately close to that one: a reader who meets this surface
 * after the ordinary one should recognize it immediately.
 *
 * `decidedElsewhere` names the state the shipped panel cannot reach — a request
 * the log shows another surface already settled. It is deliberately NOT tied to
 * the Lark chat: the same state appears whenever any other surface answered
 * first, including a second browser tab.
 */

/**
 * Question panel copy, owned by this plugin.
 *
 * The panel appears where the shipped question composer would, so its wording
 * stays deliberately close to that one: a reader who meets this surface after
 * the ordinary one should recognize it immediately.
 *
 * `answeredElsewhere` names the state the shipped panel cannot reach — a request
 * the log shows another surface already answered. It is deliberately NOT tied to
 * the Lark chat: the same state appears whenever any other surface answered
 * first, including a second browser tab.
 */

/** Simplified Chinese question dictionary and key-set source of truth. */
export const zhQuestion = {
  waiting: '等待你的回答',
  answeredElsewhere: '已在别处作答',
  orType: '也可以直接输入答案',
  submit: '提交',
} satisfies Record<string, string>

/** Lark question panel dictionary key union. */
export type QuestionKey = keyof typeof zhQuestion

/** English question dictionary, checked against the Chinese key set. */
export const enQuestion = {
  waiting: 'Waiting for your answer',
  answeredElsewhere: 'Answered elsewhere',
  orType: 'Or type an answer',
  submit: 'Submit',
} satisfies Record<QuestionKey, string>

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  waiting: '等待审批',
  decidedElsewhere: '已在别处决定',
  'detail.aria': '审批详情',
  escalation: '工具 {toolName} 请求越权执行',
  reject: '拒绝',
  allowOnce: '允许一次',
} satisfies Record<string, string>

/** Lark approval panel dictionary key union. */
export type ApprovalKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en = {
  waiting: 'Waiting for approval',
  decidedElsewhere: 'Decided elsewhere',
  'detail.aria': 'Approval details',
  escalation: 'Tool {toolName} requests privileged execution',
  reject: 'Reject',
  allowOnce: 'Allow once',
} satisfies Record<ApprovalKey, string>
