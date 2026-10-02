/*
 * 監査 R246・R247（第55回追加）の回帰試験。
 *
 * R246: 選択肢とアクションを並びの位置ではなく選択肢の鍵で結ぶ。
 * R247: 数値条件の上下限の逆転は落とさず、欄の下で知らせて止める。
 */
import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { findInvalidRangeIssue } from '@/lib/segment-condition'
import {
  clearDeadAnswerSettings,
  deadAnswerSettings,
  emptyQuestion,
  mergeChoice,
  newChoiceKey,
  planChoiceActionRemap,
  withChoiceKeys,
} from './question-editor'

const QUESTION_EDITOR = fs.readFileSync(path.join(__dirname, 'question-editor.tsx'), 'utf8')
const DETAIL_CLIENT = fs.readFileSync(
  path.join(__dirname, '..', '..', 'app', 'scenarios', 'detail', 'scenario-detail-client.tsx'),
  'utf8',
)
const BUILDER = fs.readFileSync(path.join(__dirname, '..', 'shared', 'condition-builder.tsx'), 'utf8')
const DIALOGS = fs.readFileSync(path.join(__dirname, 'scenario-dialogs.tsx'), 'utf8')
const ACTION_EDITOR = fs.readFileSync(path.join(__dirname, 'action-editor.tsx'), 'utf8')

describe('R246 選択肢の鍵', () => {
  it('鍵の無い選択肢に振り、ある鍵は変えない', () => {
    const keyed = withChoiceKeys(emptyQuestion())
    expect(keyed.choices[0].key).toBeTruthy()
    expect(keyed.choices[0].key).not.toBe(keyed.choices[1].key)
    expect(withChoiceKeys(keyed)).toBe(keyed)
  })

  it('重複した鍵は振り直す', () => {
    const question = emptyQuestion()
    question.choices[1].key = question.choices[0].key
    const keyed = withChoiceKeys(question)
    expect(keyed.choices[0].key).not.toBe(keyed.choices[1].key)
  })

  it('新しい鍵は毎回違う', () => {
    expect(newChoiceKey()).not.toBe(newChoiceKey())
  })
})

describe('R246 削除・追加・並べ替えでも対応を維持する', () => {
  const oldChoices = [{ key: 'a' }, { key: 'b' }]
  const rows = [
    { id: 'row-a', choiceIndex: 0 },
    { id: 'row-b', choiceIndex: 1 },
  ]

  it('先頭の削除：残るBはB用動作を保持し、A用だけ消す', () => {
    const plan = planChoiceActionRemap(oldChoices, [{ key: 'b' }], rows)
    expect(plan.removeIds).toEqual(['row-a'])
    expect(plan.moveTo).toEqual([{ id: 'row-b', choiceIndex: 0 }])
  })

  it('末尾の削除：残るAは動かさず、B用だけ消す', () => {
    const plan = planChoiceActionRemap(oldChoices, [{ key: 'a' }], rows)
    expect(plan.removeIds).toEqual(['row-b'])
    expect(plan.moveTo).toEqual([])
  })

  it('新規Cの追加：Cには行が無く、既存は動かさない', () => {
    const plan = planChoiceActionRemap(oldChoices, [...oldChoices, { key: 'c' }], rows)
    expect(plan.removeIds).toEqual([])
    expect(plan.moveTo).toEqual([])
  })

  it('並べ替え：鍵について行を移す', () => {
    const plan = planChoiceActionRemap(oldChoices, [{ key: 'b' }, { key: 'a' }], rows)
    expect(plan.removeIds).toEqual([])
    expect(plan.moveTo).toEqual([
      { id: 'row-a', choiceIndex: 1 },
      { id: 'row-b', choiceIndex: 0 },
    ])
  })

  it('鍵の無い古い行は位置で突き合わせる（移行期の救済）', () => {
    const plan = planChoiceActionRemap([{}, {}], [{}, {}], rows)
    expect(plan.removeIds).toEqual([])
    expect(plan.moveTo).toEqual([])
  })
})

describe('R246 質問と動作の更新を一緒に確定する', () => {
  it('選択肢の追加に鍵を付け、通の保存で付け替える', () => {
    expect(QUESTION_EDITOR).toContain('key: newChoiceKey()')
    expect(QUESTION_EDITOR).toContain('planChoiceActionRemap')
    expect(DETAIL_CLIENT).toContain('withChoiceKeys')
    expect(DETAIL_CLIENT).toContain('remapChoiceActions(editingStepId')
  })
})

describe('R248 実行されない設定を消すが効く', () => {
  const filled = {
    key: 'a',
    label: '案内',
    behavior: 'url' as const,
    url: 'https://example.com',
    reply: '返信文',
    repeatReply: '二度押し文',
    userMessage: '利用者文',
    addTagIds: ['tag-1'],
    removeTagIds: ['tag-2'],
    field: { fieldId: 'field-1', value: '3' },
  }

  it('消去を部分マージにかけても3項目の警告が残らない', () => {
    expect(deadAnswerSettings(filled)).toHaveLength(6)
    /* ボタンの動き：setChoice と同じ mergeChoice にかける */
    const cleared = mergeChoice(filled, clearDeadAnswerSettings(filled))
    expect(deadAnswerSettings(cleared)).toEqual([])
    expect(cleared.reply).toBeUndefined()
    expect(cleared.field).toBeUndefined()
  })

  it('消去後もラベル・挙動・URL・鍵は残る', () => {
    const cleared = mergeChoice(filled, clearDeadAnswerSettings(filled))
    expect(cleared.label).toBe('案内')
    expect(cleared.behavior).toBe('url')
    expect(cleared.url).toBe('https://example.com')
    expect(cleared.key).toBe('a')
  })

  it('ボタンは置き換えではなく差し替えの段取りを使う', () => {
    expect(QUESTION_EDITOR).toContain('choices[index] = mergeChoice(choices[index], patch)')
    expect(QUESTION_EDITOR).toContain('setChoice(index, clearDeadAnswerSettings(choice))')
  })
})

describe('R247 上下限の逆転は落とさず止める', () => {
  it('80〜20は不正、30〜69は保存可、空欄は書きかけ扱い', () => {
    expect(
      findInvalidRangeIssue({ operator: 'AND', rules: [{ type: 'score_range', value: { min: 80, max: 20 } }] }),
    ).toContain('下限')
    expect(
      findInvalidRangeIssue({ operator: 'AND', rules: [{ type: 'score_range', value: { min: 30, max: 69 } }] }),
    ).toBeNull()
    expect(
      findInvalidRangeIssue({ operator: 'AND', rules: [{ type: 'score_range', value: { min: 80, max: null } }] }),
    ).toBeNull()
    expect(findInvalidRangeIssue(null)).toBeNull()
  })

  it('ORの中の逆転も見つける', () => {
    expect(
      findInvalidRangeIssue({
        operator: 'AND',
        rules: [],
        groups: [{ operator: 'OR', rules: [{ type: 'score_range', value: { min: 80, max: 20 } }] }],
      }),
    ).toContain('下限')
  })

  it('共通部品で両欄の近くに理由を示し、保存側で止める', () => {
    expect(BUILDER).toContain('rangeIssue')
    expect(BUILDER).toContain('role="alert"')
    /* 全体の対象条件（ConditionDialog）と1通の条件（通の保存）と動作の条件 */
    expect(DIALOGS).toContain('findInvalidRangeIssue(draft)')
    expect(DETAIL_CLIENT).toContain('findInvalidRangeIssue(stepForm.targetCondition')
    expect(ACTION_EDITOR).toContain('findInvalidRangeIssue(conditionDraft)')
  })
})
