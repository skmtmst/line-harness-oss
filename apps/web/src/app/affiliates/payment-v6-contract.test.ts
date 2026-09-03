import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAYMENT = readFileSync(new URL('./payment-tab.tsx', import.meta.url), 'utf8')
const API = readFileSync(new URL('../../lib/api.ts', import.meta.url), 'utf8')
const WORKER = readFileSync(new URL('../../../../worker/src/routes/affiliates.ts', import.meta.url), 'utf8')

describe('V6 支払いの読み取り専用契約', () => {
  it('既存の承認済み成果を専用の読み口から表示する', () => {
    expect(API).toContain('paymentSummaries:')
    expect(API).toContain('/api/affiliate-payments')
    expect(WORKER).toContain("affiliates.get('/api/affiliate-payments', requireRole('owner', 'admin')")
    /*
      **どのLINEアカウントの支払いかを渡す。** 口（#763）はアカウント単位で返すので、
      渡さないとほかの店の未払いまで混ざった額を見せることになる。
      旧 PR は引数なしで呼んでいた。
    */
    expect(PAYMENT).toContain('api.affiliates.paymentSummaries(accountId)')
    expect(PAYMENT, 'アカウントを渡さずに呼んでいる').not.toContain('paymentSummaries()')
  })

  it('支払済み台帳が無い金額を未払いとは断定しない', () => {
    expect(PAYMENT).toContain('title="承認済み報酬の合計"')
    expect(PAYMENT).toContain('支払済みの記録がまだ無いため')
    expect(PAYMENT).toContain('data-payment-ledger="not-connected"')
    expect(PAYMENT).not.toContain('title="未払い残高"')
  })

  it('振込先・締め日・支払い確定を作り物で補わない', () => {
    expect(WORKER).toContain('bankDestination: false')
    expect(WORKER).toContain('settlementSchedule: false')
    expect(PAYMENT).toContain('振込先と締め処理は未接続です')
    expect(PAYMENT).not.toContain('この人を確定')
    expect(PAYMENT).not.toContain('振込用CSVを書き出す')
  })

  it('読込・空・失敗を言い分け、失敗を0円にしない', () => {
    expect(PAYMENT).toContain('<ListState kind="loading" />')
    expect(PAYMENT).toContain('kind="error"')
    expect(PAYMENT).toContain('kind="empty"')
    expect(PAYMENT).toContain('承認済み報酬を0円とは扱っていません')
    expect(PAYMENT).toContain('const summaryUnavailable = error && !loading')
    expect(PAYMENT).toContain('value={summaryUnavailable ? null : summary.approvedReward}')
    expect(PAYMENT).toContain('value={summaryUnavailable ? null : summary.heldReward}')
    expect(PAYMENT).toContain('value={summaryUnavailable ? null : summary.cycleConfigured}')
    expect(PAYMENT).toContain("summaryUnavailable ? '読み込めませんでした'")
  })

  /*
    **お金の画面が落ちると、いくら払うべきかを確かめる手段が無くなる。**
    口が形の違う返事をしたとき、`items.reduce` で画面ごと落ちていた
    （実際にモックの既定の器で落ちた）。0件ではなく「読めなかった」と出す。
  */
  it('返事が一覧の形でなくても落ちない', () => {
    expect(PAYMENT).toContain('Array.isArray(response.data)')
    const at = PAYMENT.indexOf('Array.isArray(response.data)')
    const set = PAYMENT.indexOf('setItems(response.data)')
    expect(at, '形の検査が無い').toBeGreaterThan(-1)
    expect(set, '入れているところが無い').toBeGreaterThan(at)
  })
})
