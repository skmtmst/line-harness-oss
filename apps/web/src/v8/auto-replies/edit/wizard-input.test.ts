import { readLineImageContent } from '@/lib/line-image-content'
import { describe, expect, it } from 'vitest'
import type { AutoReplyDraftInput } from '@line-crm/shared'
import { applyMatchType } from '@/components/auto-replies/draft-fields'
import { buildWizardInput } from './wizard-input'
import { EMPTY_FORM, formFromSettings, type WizardForm } from './wizard-model'

const rule = (keyword: string, matchType: 'exact' | 'contains' = 'contains') => ({ keyword, matchType, minLength: '', caseSensitive: true })
const form = (patch: Partial<WizardForm> = {}): WizardForm => ({ ...EMPTY_FORM, ruleName: '予約返信', keywordRules: [rule('予約')], responseContent: '承りました', ...patch })
const templates = [{ id: 't1', name: 'カードのひな形', messageType: 'flex', messageContent: '{"type":"bubble","body":{"type":"box","layout":"vertical","contents":[]}}' }]
function input(value: WizardForm) {
  return buildWizardInput({ accounts: [], form: value, matchedAccountId: 'account-a', selectedAccountId: 'account-b', templates })
}
function payload(value: WizardForm): AutoReplyDraftInput {
  const result = input(value)
  if ('error' in result) throw new Error(result.error)
  return result
}
const completeCondition: NonNullable<WizardForm['friendConditions']> = { operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag-1' }], groups: [] }

describe('自動応答ウィザードの入力と復元', () => {
  it('所属・フォルダ・メモ・曜日・条件・キーワード・後続処理を開いて保存しても落とさない', () => {
    const original = payload(form({
      folderId: 'folder-1', internalMemo: '一次対応', weekdays: [5], holidayRule: 'exclude', oncePerFriend: true,
      timeMode: 'custom', activeFrom: '21:00', activeUntil: '09:00', cooldownOn: true, cooldownMinutes: '60',
      skipWhenOperatorActive: true, priority: 12, receiveSources: ['line', 'email'], messageKinds: ['text', 'image'],
      replyDelaySeconds: '30', unmatchedMode: 'notify_operator', keywordRules: [rule('予約'), rule('変更')], keywordMatchMode: 'all',
      friendTarget: 'filtered', friendConditions: structuredClone(completeCondition),
      actions: [{ key: 'action', actionType: 'tag', config: { op: 'add', tagIds: ['tag-1'] }, onFailure: 'continue' }],
    }))
    const reopened = formFromSettings(original)
    expect(payload(reopened)).toEqual(original)
    expect(original.lineAccountId).toBe('account-a')
    expect(original.folderId).toBe('folder-1')
  })

  it('旧1語形式を復元し、部分一致の行を保存する', () => {
    const original = { ...payload(form()), keywords: null, matchType: 'contains' as const }
    const reopened = formFromSettings(original)
    expect(reopened.matchType).toBe('contains')
    expect(payload(reopened).keywords).toEqual([expect.objectContaining({ keyword: '予約', matchType: 'contains' })])
  })

  it('一致方法を変えると全行へ反映し、空の追加行は送らない', () => {
    const initial = [rule('予約', 'exact'), rule('変更', 'exact'), rule('', 'exact')]
    const next = form({ matchType: 'contains', keywordRules: applyMatchType(initial, 'contains') })
    expect(payload(next).keywords).toEqual([expect.objectContaining({ keyword: '予約', matchType: 'contains' }), expect.objectContaining({ keyword: '変更', matchType: 'contains' })])
    expect(initial[0].matchType).toBe('exact')
  })

  it('異なる完全一致allは拒否し、部分一致・any・同一語では保存できる', () => {
    const initial = form({ keywordRules: [rule('予約', 'exact'), rule('変更', 'exact')], keywordMatchMode: 'all' })
    expect(input(initial)).toMatchObject({ field: 'wiz-keywords', step: 'trigger' })
    expect(input({ ...initial, keywordMatchMode: 'any' })).not.toHaveProperty('error')
    expect(input({ ...initial, keywordRules: applyMatchType(initial.keywordRules, 'contains') })).not.toHaveProperty('error')
    expect(input({ ...initial, keywordRules: [rule('予約', 'exact'), rule('予約', 'exact')] })).not.toHaveProperty('error')
  })

  it.each([
    { operator: 'AND', rules: [], groups: [{ operator: 'OR', rules: [], groups: [] }] },
    { operator: 'AND', rules: [{ type: 'name', value: {} }], groups: [] },
  ])('未完成の友だち条件を送信本文にしない: %j', condition => {
    expect(input(form({ friendTarget: 'filtered', friendConditions: condition as WizardForm['friendConditions'] }))).toMatchObject({ field: 'wiz-conditions', step: 'trigger' })
  })

  it('絞り込みなしと完成した条件は保存できる', () => {
    expect(payload(form()).friendConditions).toBeNull()
    expect(payload(form({ friendTarget: 'filtered', friendConditions: structuredClone(completeCondition) })).friendConditions).toEqual(completeCondition)
  })

  it('テンプレートを選ぶとID・種類・本文を同じものへ揃える', () => {
    const result = payload(form({ mode: 'template', templateId: 't1' }))
    expect(result).toMatchObject({ templateId: 't1', responseType: 'flex', responseContent: templates[0].messageContent })
    expect(formFromSettings(result).templateId).toBe('t1')
    expect(input(form({ mode: 'template', templateId: null }))).toMatchObject({ field: 'wiz-template' })
  })

  it('画像JSONを保存・復元し、テキストを画像として保存しない', () => {
    const image = { originalContentUrl: 'https://example.test/full.png', previewImageUrl: 'https://example.test/thumb.png' }
    const result = payload(form({ mode: 'inline-image', responseContent: JSON.stringify(image) }))
    expect(result.responseType).toBe('image')
    expect(readLineImageContent(formFromSettings(result).responseContent)).toEqual(image)
    expect(input(form({ mode: 'inline-image', responseContent: '画像ではない' }))).toMatchObject({ field: 'wiz-image' })
  })

  it.each(['{}', '[]', 'null', 'JSONではない'])('不正なカード %s は送信本文にしない', responseContent => {
    expect(input(form({ mode: 'inline-flex', responseContent }))).toMatchObject({ field: 'wiz-flex' })
  })

  it('正しいバブルは保存し、返信なしでは本文とtemplate IDを残さない', () => {
    expect(payload(form({ mode: 'inline-flex', responseContent: templates[0].messageContent })).responseType).toBe('flex')
    expect(payload(form({ mode: 'silent', templateId: 't1' }))).toMatchObject({ responseType: 'silent', responseContent: '', templateId: null })
  })

  it.each(['-1', '1.5', '10081', 'abc', '0', ''])('有効な待ち時間にできない値 %s は保存しない', cooldownMinutes => {
    expect(input(form({ cooldownOn: true, cooldownMinutes }))).toMatchObject({ field: 'wiz-cooldown' })
  })

  it.each(['1', '60', '10080'])('待ち時間 %s 分を保存する', cooldownMinutes => {
    expect(payload(form({ cooldownOn: true, cooldownMinutes })).cooldownMinutes).toBe(Number(cooldownMinutes))
  })

  it('連投抑止を切ったら以前の入力があっても時間を送らない', () => {
    expect(payload(form({ cooldownOn: false, cooldownMinutes: '0' })).cooldownMinutes).toBeNull()
  })

  it('金曜だけの曜日を保持し、毎日指定はnullに正規化する', () => {
    expect(payload(form({ weekdays: [5] })).responseWeekdays).toEqual([5])
    expect(payload(form()).responseWeekdays).toBeNull()
  })
})
