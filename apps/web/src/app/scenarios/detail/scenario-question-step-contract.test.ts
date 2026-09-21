import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { deadAnswerSettings, isUriOnlyBehavior } from '../../../components/scenarios/question-editor'

/*
 * SCENARIO-21・SCENARIO-22 の再発防止。
 *
 * SCENARIO-21: 直接作った質問（テンプレートを選ばない質問の通）が、
 * 保存時に「テンプレートを選択してください」で止まっていた。質問・
 * 直接入力・テンプレートの検査は独立した枝でなければならない。
 *
 * SCENARIO-22: URL・電話・メール・友だち追加・回答フォームは LINE 側で
 * 「開く」だけで、押された通知（postback）は届かない。届かないのに
 * 返信・タグ・友だち情報・選択肢アクションを設定できると、実行されると
 * 思って保存する人が出る。
 */

const DETAIL = fs.readFileSync(path.join(__dirname, 'scenario-detail-client.tsx'), 'utf8')
const EDITOR = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'components', 'scenarios', 'question-editor.tsx'),
  'utf8',
)

/** `start` から `end` までの範囲だけを切り出す。見つからなければ失敗する。 */
function slice(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  if (from < 0) throw new Error(`切り出しの始まりが見つかりません: ${start}`)
  const to = source.indexOf(end, from + start.length)
  if (to < 0) throw new Error(`切り出しの終わりが見つかりません: ${end}`)
  return source.slice(from, to + end.length)
}

const saveStep = slice(DETAIL, 'const handleSaveStep = async', 'setStepSaving(true)')

describe('SCENARIO-21: 直接作った質問はテンプレート必須にかからない', () => {
  it('質問・直接入力・テンプレートの検査は独立した枝', () => {
    expect(saveStep).toContain('if (stepForm.question) {')
    expect(saveStep).toContain("} else if (stepForm.inputMode === 'direct') {")
    expect(saveStep).toContain('} else {')
    // テンプレート必須は else 枝（質問なし・直接入力でもないとき）だけ。
    const templateBranch = saveStep.slice(saveStep.indexOf('} else {'))
    expect(templateBranch).toContain('テンプレートを選択してください')
  })

  it('質問の空文・空の選択肢は引き続き止める', () => {
    expect(saveStep).toContain('質問文を入力してください')
    expect(saveStep).toContain('すべての選択肢に文字を入力してください')
  })

  it('直接入力の本文必須と JSON 検査は残る', () => {
    expect(saveStep).toContain('メッセージ内容を入力してください')
    expect(saveStep).toContain('JSON.parse(stepForm.messageContent)')
  })
})

describe('SCENARIO-22: URIだけの挙動に届かない設定をさせない', () => {
  it('URI だけの挙動を判定する', () => {
    for (const b of ['url', 'tel', 'mail', 'add_friend', 'form'] as const) {
      expect(isUriOnlyBehavior(b), b).toBe(true)
    }
    // postback が届く挙動は対象外。回答の処理がそのまま動く。
    for (const b of ['none', 'scenario'] as const) {
      expect(isUriOnlyBehavior(b), b).toBe(false)
    }
  })

  it('実行されない設定を名指しする', () => {
    const dead = deadAnswerSettings({
      label: '詳しく見る',
      behavior: 'url',
      url: 'https://example.com',
      reply: 'ありがとうございます',
      addTagIds: ['t1'],
      field: { fieldId: 'f1', value: 'x' },
    })
    expect(dead).toEqual(['選択時の返信', '追加するタグ', '友だち情報欄'])
  })

  it('未設定なら何も挙げない', () => {
    expect(deadAnswerSettings({ label: '開く', behavior: 'url' })).toEqual([])
  })

  it('編集画面は URI だけの挙動へアクション入口を出さない', () => {
    expect(EDITOR).toContain('onOpenChoiceActions && !uriOnly')
  })

  it('編集画面は残っている実行されない設定を消す導線を出す', () => {
    expect(EDITOR).toContain('clearDeadAnswerSettings(choice)')
    expect(EDITOR).toContain('実行されない設定を消す')
  })

  it('保存時にも URI だけの挙動に残った回答依存の設定を止める', () => {
    expect(saveStep).toContain('isUriOnlyBehavior(choice.behavior)')
    expect(saveStep).toContain('deadAnswerSettings(')
  })
})
