import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const FORM = readUiSource(
  join(dirname(fileURLToPath(import.meta.url)), 'broadcast-form.tsx'),
  'utf8',
)

const CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'broadcast-form-v8.module.css'), 'utf8')

/*
 * テスト送信の窓（h0kahp）・配信前チェックの窓（vW4Es）・撮影用の完成状態は
 * broadcast-form-steps-react.test.tsx が、テスト送信の説明と結果は broadcast-form-test-send.test.tsx が、
 * 共通の LINE プレビューを使うことは broadcast-form-preview-length-react.test.tsx が画面を動かして見る。
 * ここに残すのは禁止の見張りと、画面を動かす試験では赤くできない列の組み方だけ。
 */
describe('一斉配信のV8構造（視覚一致は撮影で確認）', () => {
  it('作成画面の列幅を設計にそろえ、画面ごとのプレビュー枠を持たない', () => {
    // 列幅と縮め方は共通の作成型が持つ。見た目の値なので実ブラウザの崩れの見張りに移すまで残す。
    expect(FORM).toContain('<CreateColumns>')
    expect(CSS).toContain('@container broadcast-create (width < 1100px)')
    expect(FORM).not.toContain('className="broadcast-line-preview"')
    expect(FORM).not.toContain('LINE_MOCK')
  })

  it('テスト送信で宛先を選ばせる形・作り値の担当名を置かない', () => {
    expect(FORM).not.toContain('テスト送信先を選択')
    expect(FORM).not.toContain('開発担当')
  })

  it('テスト送信の説明・履歴を実装と食い違わせない', () => {
    // テストも通常の pushMessage を通すので、送信枠を消費しないとは書かない。
    expect(FORM).not.toContain('送信枠を消費しません')
    // 受信者の設定一覧を実行履歴に見せない。固定の日時・成功行は残さない。
    expect(FORM).not.toContain('2026/08/23 23:42')
    expect(FORM).not.toContain('broadcast-test-page')
  })

  it('配信枠不足の確認に、確かめていない「確認しました」や残り通数を置かない', () => {
    const dialog = FORM.slice(
      FORM.indexOf('open={preflightDialogOpen}'),
      FORM.indexOf('<div data-design-node="FpgxH">'),
    )
    expect(dialog).not.toContain('対象人数を確認しました')
    expect(dialog).not.toContain('quota.remaining')
  })

  it('確認窓の位置指定を同じnode名のページ本体へ漏らさない', () => {
    expect(FORM).not.toContain("padding-top: 265px")
    expect(FORM).not.toContain("padding-top: 236px")
    expect(FORM).not.toMatch(/\[data-design-node='vW4Es'\]\s*\{\s*align-items:/)
  })
})
