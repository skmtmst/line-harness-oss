import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const API = readFileSync(new URL('../../lib/api.ts', import.meta.url), 'utf8')

describe('クロス分析の待ち順と処理目安 (Issue #633)', () => {
  it('待ち順・目安・現在状態を日本語で出し、再実行を誘発しない', () => {
    for (const text of [
      '現在の状態:',
      '待ち順は',
      '番目です',
      '目安は約',
      '次回処理は',
      '同じ分析をもう一度押す必要はありません',
    ]) expect(PAGE).toContain(text)
    expect(PAGE).toContain('処理中です')
    expect(PAGE).toContain('待ち順に並んでいます')
  })

  it('完了・失敗・時間切れ後も結果確認と集計し直しの導線を残す', () => {
    expect(PAGE).toContain('結果が出た後はこの画面で確認でき、失敗・時間切れのときも集計し直せます')
    expect(PAGE).toContain('時間切れです。条件をゆるめて集計し直してください')
    expect(PAGE).toContain('もう一度集計できます')
  })

  it('ポーリングは40回上限と段階的な間隔を保つ', () => {
    expect(PAGE).toContain('attempts >= 40')
    expect(PAGE).toContain('attempts < 10 ? 1500 : attempts < 30 ? 3000 : 5000')
  })

  it('API型に待ち順の4項目がある', () => {
    for (const field of ['queuePosition', 'pendingAhead', 'estimatedWaitMs', 'nextTickAt']) {
      expect(API).toContain(field)
    }
  })
})
