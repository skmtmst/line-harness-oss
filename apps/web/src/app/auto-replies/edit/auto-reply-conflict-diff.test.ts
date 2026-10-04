import { describe, expect, it } from 'vitest'
import { describeAutoReplyDiff } from './auto-reply-conflict-diff'
import type { WizardForm } from './wizard-v8'

function form(overrides: Partial<WizardForm> = {}): WizardForm {
  return {
    ruleName: '営業時間外',
    folderId: '',
    internalMemo: '',
    respondToAll: false,
    keywordRules: [{ keyword: '予約', matchType: 'contains', minLength: '', caseSensitive: true }],
    keywordMatchMode: 'any',
    matchType: 'contains',
    messageKinds: ['text'],
    weekdays: [1, 2, 3, 4, 5],
    holidayRule: 'ignore',
    timeMode: 'always',
    activeFrom: '',
    activeUntil: '',
    friendTarget: 'all',
    friendConditions: null,
    mode: 'inline-text',
    templateId: null,
    responseContent: '承りました',
    actions: [],
    replyDelaySeconds: '0',
    cooldownOn: false,
    cooldownMinutes: '60',
    skipWhenOperatorActive: false,
    oncePerFriend: false,
    unmatchedMode: 'none',
    receiveSources: ['line'],
    priority: 0,
    ...overrides,
  }
}

describe('自動応答の競合の違い比べ', () => {
  it('同じ内容なら行が出ない', () => {
    expect(describeAutoReplyDiff(form(), form())).toEqual([])
  })

  it('ルール名・条件・返信・優先順位の違いを拾う', () => {
    const lines = describeAutoReplyDiff(
      form({ ruleName: '新しい名前', weekdays: [6, 0], responseContent: '変わった文', priority: 3 }),
      form(),
    )
    expect(lines.some((line) => line.includes('ルール名'))).toBe(true)
    expect(lines.some((line) => line.includes('どんなときに動くか'))).toBe(true)
    expect(lines.some((line) => line.includes('何を返すか'))).toBe(true)
    expect(lines.some((line) => line.includes('優先順位'))).toBe(true)
  })
})
