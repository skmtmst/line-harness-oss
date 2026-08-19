import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')

describe('V3 10-4 運用状態の表示確認', () => {
  it('確定済み画面と同じ小さな文字階層を3タブで共通利用する', () => {
    expect(source).toContain('text-ink text-xl leading-tight font-bold')
    expect(source).toContain('text-base font-bold text-gray-900">チェック結果')
    expect(source).toContain('text-base font-bold text-gray-900">緊急停止')
    expect(source).toContain('text-base font-bold text-blue-900">復旧')
    expect(source).toContain('text-base font-bold text-gray-900">履歴')
    expect(source).toContain('text-[11px] font-bold')
  })

  it('タブごとの説明をPenと同じ内容で表示する', () => {
    expect(source).toContain('問題がないか自動で確認し、エラーがあれば内容と次の行動を表示します。')
    expect(source).toContain('止める配信を選び、理由を入力して緊急停止します。')
    expect(source).toContain('エラー、緊急停止、システム更新、設定変更を時間順に確認できます。')
  })

  it('仮表示を解除し、異常がないときは異常なしと表示する', () => {
    expect(source).toContain("const resultTitle = isNormal ? '異常なし'")
    expect(source).toContain('現在、確認できる異常はありません。')
    expect(source).not.toContain('UI確認モード（仮表示）')
    expect(source).not.toContain('全UI確認（仮表示）')
  })

  it('意味のない固定チェック項目を表示しない', () => {
    expect(source).not.toContain('UI_REVIEW_CHECKS')
    for (const label of ['LINE接続', '外部連携', 'Webhook', '配信処理', '定期処理', '友だちの変化']) {
      expect(source).not.toContain(`label: '${label}'`)
    }
    expect(source).toContain('注意・エラーがあるときだけ内容を表示します')
  })

  it('3つの概要カードと上部の主要操作を表示する', () => {
    for (const label of ['全体の状態', '最後の確認', '緊急停止状態']) {
      expect(source).toContain(`label="${label}"`)
    }
    expect(source).not.toContain('label="今月の配信残数"')
    expect(source).toContain('チェックを今すぐ実行')
    expect(source).toContain('配信をすべて緊急停止')
  })

  it('5分ごとに実データを再確認する', () => {
    expect(source).toContain('window.setInterval')
    expect(source).toContain('5 * 60 * 1000')
  })
})
