/*
 * 監査 R239〜R245（シナリオの最終ステップ後のアクション設定）の回帰試験。
 *
 * R240: 見出しと要約は行番号ではなく実際の設定から作る。
 * R243: 編集中の未完成行は保持し、保存のときに入力不足を案内する。
 */
import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { api, eventsApi } from '@/lib/api'
import { describeAction, findConditionDraftIssue, type ActionLookups } from './action-editor'
import { scenarioReferenceData } from './scenario-reference-data'

const EDITOR = fs.readFileSync(path.join(__dirname, 'action-editor.tsx'), 'utf8')
const DIALOGS = fs.readFileSync(path.join(__dirname, 'scenario-dialogs.tsx'), 'utf8')

const LOOKUPS: ActionLookups = {
  tags: [{ id: 'tag-1', name: '初回案内済み' }],
  fields: [{ id: 'field-1', name: '来店回数' }],
  marks: [{ id: 'mark-1', name: 'フォロー中' }],
  scenarios: [{ id: 'sc-2', name: '次回案内' }],
  vars: [{ varKey: 'points', name: 'ポイント' }],
  templates: [{ id: 'tpl-1', name: '初回クーポン' }],
  reminders: [{ id: 'rem-1', name: '来店リマインド' }],
  events: [{ id: 'ev-1', name: '試食会' }],
}

const makeAction = (actionType: Parameters<typeof describeAction>[0]['actionType'], config: unknown) =>
  ({
    id: `${actionType}-1`,
    scenarioId: 'sc-1',
    hook: 'scenario_completed',
    stepId: null,
    choiceIndex: null,
    sortOrder: 0,
    actionType,
    config,
    condition: null,
    repeatOnRefire: true,
  }) as Parameters<typeof describeAction>[0]

describe('R240 動作名と要約は実際の設定から作る', () => {
  it('3行目の内容が何であっても行番号で決めた名前にしない', () => {
    expect(describeAction(makeAction('scenario', { op: 'start', scenarioId: 'sc-2' }), LOOKUPS)).toContain(
      '次回案内',
    )
    expect(describeAction(makeAction('friend_field', { fieldId: 'field-1', op: 'set', value: '3' }), LOOKUPS)).toContain(
      '来店回数',
    )
    expect(describeAction(makeAction('event_booking', { eventId: 'ev-1' }), LOOKUPS)).toContain('試食会')
  })

  it('未入力・未選択はその旨を出し、別種別の文言を混ぜない', () => {
    expect(describeAction(makeAction('send_message', { content: '' }), LOOKUPS)).toBe('本文未入力')
    expect(describeAction(makeAction('send_template', { templateId: '' }), LOOKUPS)).toBe(
      'テンプレート未選択',
    )
    expect(describeAction(makeAction('tag', { op: 'add', tagIds: [] }), LOOKUPS)).toBe(
      'タグを追加（タグ未選択）',
    )
    expect(describeAction(makeAction('tag', { op: 'add', tagIds: ['tag-1'] }), LOOKUPS)).toBe(
      'タグを追加「初回案内済み」',
    )
  })

  it('画面に行番号で決める分岐と固定の要約を残さない', () => {
    expect(EDITOR).not.toContain("index === 2 ? 'テキスト送信'")
    expect(EDITOR).not.toContain('タグ「初回案内済み」を追加する')
    expect(EDITOR).not.toContain('担当者へSlackと管理画面通知')
    expect(EDITOR).toContain('未設定')
    expect(EDITOR).toContain('describeAction(action, lookups)')
  })
})

describe('R243 編集中の未完成行は保持し、保存時に入力不足を案内する', () => {
  it('名前・タグ・空のORは未完成として案内する', () => {
    expect(
      findConditionDraftIssue({
        operator: 'AND',
        rules: [{ type: 'name', value: { text: '', targets: ['display'] } }],
      }),
    ).toContain('未完成')
    expect(
      findConditionDraftIssue({ operator: 'AND', rules: [{ type: 'tag_exists', value: '' }] }),
    ).toContain('未完成')
    expect(
      findConditionDraftIssue({
        operator: 'AND',
        rules: [{ type: 'name', value: { text: '田中', targets: ['display'] } }],
        groups: [{ operator: 'OR', rules: [] }],
      }),
    ).toContain('空の')
  })

  it('完成した条件と条件なしは保存できる（案内しない）', () => {
    expect(findConditionDraftIssue(null)).toBeNull()
    expect(findConditionDraftIssue({ operator: 'AND', rules: [] })).toBeNull()
    expect(
      findConditionDraftIssue({
        operator: 'AND',
        rules: [{ type: 'name', value: { text: '田中', targets: ['display'] } }],
      }),
    ).toBeNull()
  })

  it('条件の変更で入力のたびに空値を取り除かない', () => {
    expect(EDITOR).not.toContain('pruneCondition(next)')
    expect(EDITOR).toContain('conditionDraft')
    expect(EDITOR).toContain('条件を保存する')
  })
})

describe('R244 編集欄と入力を保存のたびに作り直さない', () => {
  it('開閉は画面側で持ち、読み込み中の作り直しをしない', () => {
    expect(EDITOR).toContain('expandedId')
    expect(EDITOR).toContain('aria-expanded')
    expect(EDITOR).not.toContain('<details>')
    /* 初回だけ「読み込んでいます」。保存後の読み直しは黙って入れ替える。 */
    expect(EDITOR).toContain('const refresh = useCallback')
  })
})

describe('R239 移動先の未選択は欄の下で案内する', () => {
  it('送らずに「移動先を選んでください」と出す', () => {
    expect(DIALOGS).toContain('移動先を選んでください')
    expect(DIALOGS).toContain('error={targetError')
  })
})

describe('R241 未実装のセット入口を置かない', () => {
  it('呼出し操作と保存名の入力を出さない', () => {
    expect(EDITOR).not.toContain('保存済みセットを呼び出す')
    expect(EDITOR).not.toContain('保存するアクション名')
    expect(EDITOR).not.toContain('初回案内完了処理')
  })
})

describe('R242 キャンセルは開く前の値に戻す', () => {
  it('開いたときの写しを持ち、キャンセルで書き戻して閉じる', () => {
    expect(EDITOR).toContain('initialRef')
    expect(EDITOR).toContain('開いたときの状態に戻します')
    expect(EDITOR).not.toMatch(/<Button onClick=\{onClose\}>キャンセル<\/Button>/)
  })
})

describe('R245 対象は名前で選ぶ', () => {
  it('IDの直入力を置かず、候補選択を使う', () => {
    expect(EDITOR).not.toContain('テンプレートID')
    expect(EDITOR).not.toContain('リマインダID')
    expect(EDITOR).not.toContain('イベント予約ID')
    expect(EDITOR).toContain('TargetSelector')
    expect(EDITOR).toContain('名前で探す')
  })

  it('リマインダ・イベント予約の候補は今のアカウントで絞る', async () => {
    const reminderSpy = vi
      .spyOn(api.reminders, 'list')
      .mockResolvedValue({ success: true as const, data: [] })
    const eventSpy = vi
      .spyOn(eventsApi, 'listEvents')
      .mockResolvedValue({ items: [], total: 0, limit: 200, sort: [] })
    await scenarioReferenceData.reminders('r245-acc-a')
    await scenarioReferenceData.events('r245-acc-a')
    expect(reminderSpy).toHaveBeenCalledWith({ accountId: 'r245-acc-a' })
    expect(eventSpy).toHaveBeenCalledWith('r245-acc-a', { limit: 200 })
    reminderSpy.mockRestore()
    eventSpy.mockRestore()
  })
})
