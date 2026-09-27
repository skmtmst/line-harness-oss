import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/*
 * R129〜R131（行動スコアの共同編集・反映・試算）の約束だけを見る。
 * 口の振る舞いは `packages/db` の同時保存試験と worker の試験が見ている。
 */
describe('R129：編集窓の入力は「設定を反映」まで一覧に残さない', () => {
  it('窓の中の入力は仮状態へだけ書き、親の一覧を直接変えない', () => {
    expect(PAGE).toContain('updateEditDraft')
    // 窓の中の入力欄が親直書き（updateRule）を使っていない。
    const dialogStart = PAGE.indexOf('title="できごとの設定を直す"')
    expect(dialogStart).toBeGreaterThan(-1)
    const dialogBody = PAGE.slice(dialogStart, dialogStart + 4500)
    expect(dialogBody).not.toContain('updateRule(')
    expect(dialogBody).toContain('updateEditDraft(')
  })

  it('「設定を反映」でだけ親へ渡し、閉じる・Escapeは仮状態を捨てる', () => {
    expect(PAGE).toContain('applyEditor')
    expect(PAGE).toContain('closeEditor')
    expect(PAGE).toContain('onCancel={() => closeEditor()}')
    expect(PAGE).toContain('onClick={() => applyEditor()}')
  })

  it('閉じただけでは残らないことが窓の説明で分かる', () => {
    expect(PAGE).toContain('「設定を反映」を押すまで、一覧の内容は変わりません')
  })
})

describe('R130：試算の入力ミスは窓の中・欄の下で直せる', () => {
  it('試算の失敗は窓の外の帯ではなく窓の中に出す', () => {
    // 試算の窓が共通ダイアログの error 口を持ち、失敗時に窓を開いたままにする。
    expect(PAGE).toContain('title="1人でスコアのルールを試す"')
    expect(PAGE).toContain('error={testError || undefined}')
    expect(PAGE).toContain('setTestError(fieldError(error))')
  })

  it('点数の範囲ミスは点数欄の下で上限とともに説明する', () => {
    expect(PAGE).toContain('testScoreError')
    expect(PAGE).toContain('error={testScoreError || undefined}')
    // 範囲は動く上限（bands）から作り、欄の下にいつも出す。
    expect(PAGE).toContain('の整数で入力')
    expect(PAGE).toContain('bands.min')
    expect(PAGE).toContain('bands.max')
  })

  it('422の検証文を一般エラーに化けさせない', () => {
    expect(PAGE).toMatch(/error\.status === 400 \|\| error\.status === 422/)
  })

  it('直したら欄の文言が消える', () => {
    expect(PAGE).toContain("setTestScoreError('')")
  })
})

describe('R131：古い下書きでの保存は競合になり先の変更が残る', () => {
  it('保存時に読んだ版を送り、競合は読み直しを促す', () => {
    expect(PAGE).toContain('expectedDraftVersionId')
    expect(PAGE).toContain('ほかの人が先に保存しています')
  })
})
