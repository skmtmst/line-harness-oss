import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

/**
 * 点検 #495 中4・中6 の再発防止。
 *
 * 中4: 開始は戻せない操作なのに、確認のチェックが defaultChecked の
 * 非制御で、未チェックでも「配信を開始」を押せた。
 * 中6: 削除の戻りの success を見ていなかった。fetchApi は口の失敗時も
 * 例外でなく {success:false} を返すため、消えていないのに再読込だけ
 * されて気づけなかった。
 */
describe('シナリオ一覧の開始確認と削除（点検 #495 中4・中6）', () => {
  it('確認チェックは制御化し、未チェックの間は開始ボタンを押せない', () => {
    expect(PAGE).toContain('checked={confirmed}')
    expect(PAGE).toContain('setConfirmed(event.target.checked)')
    /*
     * SCENARIO-07: 試算の取得待ち・取得失敗のあいだも開始できない。
     * チェック済みでも preflight が ready でなければ押せない。
     */
    expect(PAGE).toContain("disabled={busy || !confirmed || preflightState !== 'ready'}")
  })

  it('SCENARIO-07: 対象やアカウントが変わったら確認済みを外して取り直す', () => {
    expect(PAGE).toContain('setConfirmed(false)')
    expect(PAGE).toContain('preflightSeqRef.current')
    expect(PAGE).toContain('void loadPreflight()')
  })

  it('SCENARIO-06: 終了後の処理は実設定（onCompleteMode）から組み立てる', () => {
    expect(PAGE).toContain('ON_COMPLETE_LABEL[completeMode]')
    expect(PAGE).toContain('scenario.onCompleteScenarioId')
    expect(PAGE).not.toContain('完了タグ＋担当者通知')
    expect(PAGE).not.toContain('>保存後すぐ<')
    /*
     * 実装していない仕組み（監査履歴への記録）を開始前に約束しない。
     */
    expect(PAGE).not.toContain('監査履歴とSlackのPRスレッドへ記録します')
  })

  it('SCENARIO-18: 削除失敗は確認窓へ返し、窓を閉じない', () => {
    expect(PAGE).toContain("throw new Error('scenario delete failed')")
  })

  it('確認チェックを非制御（defaultChecked）に戻さない', () => {
    expect(PAGE).not.toMatch(/<input[^>]*defaultChecked/)
  })

  it('削除は戻りの success を見て、失敗時は帯に出す', () => {
    expect(PAGE).toContain('const res = await api.scenarios.delete(id)')
    expect(PAGE).toContain('if (!res.success) throw new Error(res.error)')
    expect(PAGE).toContain('シナリオを削除できませんでした。')
  })
})
