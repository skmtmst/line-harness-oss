import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const API = readFileSync(new URL('../../lib/api.ts', import.meta.url), 'utf8')

describe('クロス分析の待ち順と処理目安 (Issue #633)', () => {
  it('待ち順・目安・現在状態を日本語で出し、再実行を誘発しない', () => {
    for (const text of [
      '現在の状態:',
      'このLINEアカウント内の順番は',
      '番目です',
      '最短で約',
      '他の処理状況により延びることがあります',
      '次回処理は',
      '同じ分析をもう一度押す必要はありません',
    ]) expect(PAGE).toContain(text)
    expect(PAGE).toContain('処理中です')
    expect(PAGE).toContain('このLINEアカウント内で待ち順に並んでいます')
    // 絶対順位と誤認させる古い文言が残っていないこと
    expect(PAGE).not.toContain('待ち順は')
    expect(PAGE).not.toContain('目安は約')
  })

  it('完了・失敗後も結果確認と集計し直しの導線を残す', () => {
    expect(PAGE).toContain('結果が出た後はこの画面で確認でき、失敗・時間切れのときも集計し直せます')
    expect(PAGE).toContain('もう一度集計できます')
  })

  it('時間切れ後もrun IDを保持し、同じ集計へ再接続できる', () => {
    // 打ち切り後も集計は続く。新規の送り直しは促さない。
    expect(PAGE).toContain('自動の確認を止めました')
    expect(PAGE).toContain('集計はこのまま続いています')
    expect(PAGE).toContain('結果をもう一度確認')
    expect(PAGE).toContain('送り直す必要はありません')
    expect(PAGE).toContain('setCrossAutoStopped')
    expect(PAGE).toContain('crossRecheck')
    // 古い時間切れ文言(送り直しを促す)は残さない
    expect(PAGE).not.toContain('時間切れです')
  })

  it('ポーリングは2分で止めず5分cronを待ち、打ち切りと間隔延長がある', () => {
    // 最低6分(5分cronの最初の処理機会をまたぐ)。観測した最短目安+3分まで延ばす(上限15分)。
    expect(PAGE).toContain('CROSS_AUTO_POLL_MIN_MS')
    expect(PAGE).toContain('6 * 60_000')
    expect(PAGE).toContain('CROSS_AUTO_POLL_MARGIN_MS')
    expect(PAGE).toContain('3 * 60_000')
    expect(PAGE).toContain('CROSS_AUTO_POLL_MAX_MS')
    expect(PAGE).toContain('15 * 60_000')
    expect(PAGE).toContain('Date.now() >= deadline')
    expect(PAGE).toContain('waitMs + CROSS_AUTO_POLL_MARGIN_MS')
    // 間隔は後半ほど空ける(点検#508の中2)。40回・約2分の旧上限は残さない。
    expect(PAGE).toContain('attempts < 10 ? 3000 : 10000')
    expect(PAGE).not.toContain('attempts >= 40')
    expect(PAGE).not.toContain('setInterval')
  })

  it('一時的な確認失敗でもrun IDを保持し、間隔を空けて確認を続ける', () => {
    // 失敗でrun IDを消すと実行中の集計へ再接続できない。順番表示を残したまま続ける。
    expect(PAGE).toContain('確認を続けています')
    expect(PAGE).toContain('pollErrors')
    expect(PAGE).toContain('CROSS_POLL_ERROR_BACKOFF_MS')
    expect(PAGE).toContain('Math.min(pollErrors')
  })

  it('実行中は待ち目安を出さず、待機中は実行中分を加算しない', () => {
    // 実行中は「処理中です」のみ。裏は実行中をnull、待機中は次回cronまでの残り+待機件数×5分を返す。
    expect(PAGE).toContain('処理中です')
    expect(PAGE).not.toContain('まもなく終わります')
  })

  it('API型に待ち順の4項目がある', () => {
    for (const field of ['queuePosition', 'pendingAhead', 'estimatedWaitMs', 'nextTickAt']) {
      expect(API).toContain(field)
    }
  })
})
