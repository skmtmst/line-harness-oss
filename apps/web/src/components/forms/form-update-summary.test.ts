import { describe, expect, it } from 'vitest'
import { emptyLayout, type FormInputBlock } from '@line-crm/shared'
import {
  describeAction,
  describeFormUpdates,
  describeInputUpdates,
} from './form-update-summary'
import { EMPTY_REFS, type FormRefs } from './form-refs'

const refs: FormRefs = {
  ...EMPTY_REFS,
  tags: [
    { id: 'tag-a', name: '回答済み' },
    { id: 'tag-b', name: '希望あり' },
  ],
  friendFields: [
    { id: 'ff-name', name: '氏名', ecIsMaster: false },
    { id: 'ff-addr', name: '住所', ecIsMaster: false },
    { id: 'ff-ec', name: '会員番号', ecIsMaster: true },
  ],
  scenarios: [{ id: 'sc-1', name: '入会案内' }],
  reminders: [{ id: 'rem-1', name: '誕生日クーポン' }],
  templates: [{ id: 'tpl-1', name: 'お礼', type: 'text' }],
}

function input(patch: Partial<FormInputBlock>): FormInputBlock {
  return { id: 'b1', kind: 'input', type: 'text', name: 'f1', label: '質問1', ...patch }
}

describe('describeInputUpdates', () => {
  it('登録先が無い質問は空（何も更新しない）', () => {
    expect(describeInputUpdates(input({}), refs)).toEqual([])
  })

  it('登録先と「未回答なら更新しない」条件を文にする', () => {
    const lines = describeInputUpdates(
      input({
        destinations: { friendFieldIds: ['ff-name', 'ff-addr'], realName: true, note: true },
      }),
      refs,
    )
    expect(lines).toEqual([
      '回答を 情報欄「氏名」・情報欄「住所」・本名・個別メモ に登録（未回答なら更新しない）',
    ])
  })

  it('ECが正の情報欄は「更新しない」ことを添える', () => {
    const lines = describeInputUpdates(
      input({ destinations: { friendFieldIds: ['ff-ec'] } }),
      refs,
    )
    expect(lines[0]).toContain('ECが正のため更新しない')
  })

  it('選択肢による情報欄登録は「選んだものだけ」という条件つき', () => {
    const lines = describeInputUpdates(
      input({
        type: 'radio',
        choiceMode: 'friendField',
        choiceFriendFieldId: 'ff-addr',
        choices: [
          { id: 'c1', label: '自宅' },
          { id: 'c2', label: '実家' },
        ],
      }),
      refs,
    )
    expect(lines).toEqual(['選んだ選択肢の値を情報欄「住所」に登録（選んだものだけ）'])
  })

  it('選択肢タグは付けるタグ名を列挙する', () => {
    const lines = describeInputUpdates(
      input({
        type: 'checkbox',
        choiceMode: 'tag',
        choices: [
          { id: 'c1', label: 'A', tagId: 'tag-a' },
          { id: 'c2', label: 'B', tagId: 'tag-b' },
          { id: 'c3', label: 'C' },
        ],
      }),
      refs,
    )
    expect(lines[0]).toContain('回答済み')
    expect(lines[0]).toContain('希望あり')
  })

  it('日付リマインダも更新内容として出す', () => {
    const lines = describeInputUpdates(
      input({ type: 'date', reminder: { reminderId: 'rem-1', time: '09:00' } }),
      refs,
    )
    expect(lines).toEqual(['入力した日付を起点にリマインダ「誕生日クーポン」を動かす'])
  })
})

describe('describeAction', () => {
  it('動作の種類ごとに文にする', () => {
    expect(describeAction({ kind: 'tag', op: 'add', tagIds: ['tag-a'] }, refs)).toBe(
      'タグ「回答済み」を付ける',
    )
    expect(describeAction({ kind: 'scenario', op: 'start', scenarioId: 'sc-1' }, refs)).toBe(
      'シナリオ「入会案内」を始める',
    )
    expect(
      describeAction({ kind: 'friend_field', fieldId: 'ff-name', value: '済' }, refs),
    ).toBe('情報欄「氏名」に「済」を登録')
  })
})

describe('describeFormUpdates', () => {
  it('質問ごとの更新とフォーム全体の動きを分けて返す', () => {
    const layout = emptyLayout()
    layout.sections[0].blocks = [
      input({ label: 'お名前', destinations: { realName: true } }),
      input({ label: 'ご意見', name: 'memo' }),
    ]
    layout.options.afterActions = [{ kind: 'tag', op: 'add', tagIds: ['tag-a'] }]

    const overview = describeFormUpdates(layout, refs, 'tag-b')
    expect(overview.questions).toHaveLength(1)
    expect(overview.questions[0].label).toBe('お名前')
    expect(overview.formWide).toEqual([
      '回答した人全員にタグ「希望あり」を付ける',
      '送信後にタグ「回答済み」を付ける',
    ])
  })

  it('更新するものが無いフォームは空の一覧になる', () => {
    const overview = describeFormUpdates(emptyLayout(), refs, '')
    expect(overview.questions).toEqual([])
    expect(overview.formWide).toEqual([])
  })
})
