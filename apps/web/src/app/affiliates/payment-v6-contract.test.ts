import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAYMENT = readFileSync(new URL('./payment-tab.tsx', import.meta.url), 'utf8')
const DIALOGS = readFileSync(new URL('./action-dialogs.tsx', import.meta.url), 'utf8')
const API = readFileSync(new URL('../../lib/api.ts', import.meta.url), 'utf8')
const PAYOUTS = readFileSync(new URL('../../../../worker/src/routes/affiliate-payouts.ts', import.meta.url), 'utf8')

describe('V6 支払いの追記台帳契約', () => {
  it('LINEアカウントと締め期間を渡して締め対象を読む', () => {
    expect(API).toContain('settlementPreview:')
    expect(API).toContain('/api/affiliate-settlements/preview?')
    expect(PAYOUTS).toContain("'/api/affiliate-settlements/preview'")
    expect(PAYMENT).toContain('api.affiliates.settlementPreview(accountId, period)')
    expect(PAYMENT).toContain('currentAffiliateSettlementPeriod()')
  })

  it('締め・明細・振込バッチ・再認証つきCSVを実APIへ接続する', () => {
    for (const word of [
      'api.affiliates.closeSettlement',
      'api.affiliates.createStatement',
      'api.affiliates.createPayoutBatch',
      'api.affiliates.payoutStepUp',
      'api.affiliates.exportPayoutBatch',
      '支払明細をまとめて出す',
      '振込用CSVを書き出す',
    ]) {
      expect(PAYMENT).toContain(word)
    }
    expect(API).toContain("'Idempotency-Key': idempotencyKey")
    expect(API).toContain("'X-Step-Up-Token': stepUpToken")
    expect(API).toContain("purpose: 'affiliate.payout.export'")
    expect(PAYMENT).toContain("process.env.NEXT_PUBLIC_API_URL ?? ''")
    expect(PAYMENT).toContain('statementKeysRef.current.get(item.affiliateId)')
    expect(PAYMENT).toContain('Promise.allSettled(preview.affiliates.map')
    expect(PAYMENT).toContain('}, payoutKey)')
    expect(PAYMENT).toContain('exportKey,')
  })

  it('APIに無い支払日と過去履歴を作り物で補わない', () => {
    expect(PAYMENT).toContain('title="次の支払日"')
    expect(PAYMENT).toContain('支払日の設定APIが接続されると表示します')
    expect(PAYMENT).toContain('title="今年 払った合計"')
    expect(PAYMENT).toContain('支払履歴APIが接続されると表示します')
    expect(PAYMENT).toContain('value={null}')
  })

  it('口座番号を管理画面へ返さず、登録状態だけを表示する', () => {
    expect(API).toContain('bankProfileRegistered: boolean')
    expect(PAYMENT).toContain('口座番号は本人だけに表示')
    expect(DIALOGS).toContain('口座番号は本人だけに表示します')
    expect(PAYMENT).not.toMatch(/1234567|accountNumber/)
    expect(DIALOGS).not.toMatch(/1234567|accountNumber/)
  })

  it('人ごとの内訳は実プレビューを読み、締め期間と登録状態を重ねる', () => {
    expect(DIALOGS).toContain('data-design-node="GqFTV"')
    expect(DIALOGS).toContain('api.affiliates.paymentPreview')
    expect(DIALOGS).toContain('api.affiliates.confirmPayment')
    expect(DIALOGS).toContain('periodTo ?? preview.closeDate')
    expect(DIALOGS).toContain('settlement?.bankProfileRegistered')
    expect(DIALOGS).toContain('api.affiliates.createStatement')
    expect(DIALOGS).toContain('確定したことを、この方のLINEに知らせる')
    expect(DIALOGS).toContain('支払明細のPDFを作る')
    expect(DIALOGS).toContain('支払いは確定しましたが、支払明細とLINE通知を作れませんでした')
  })

  it('読込・通常・空・失敗を分け、失敗を0円にしない', () => {
    expect(PAYMENT).toContain('<ListState kind="loading" />')
    expect(PAYMENT).toContain('kind="error"')
    expect(PAYMENT).toContain('kind="empty"')
    expect(PAYMENT).toContain('締め対象や金額を0とは扱っていません')
    expect(PAYMENT).toContain('const summaryUnavailable = error && !loading')
    expect(PAYMENT).toContain('value={summaryUnavailable ? null : preview?.totalAmount ?? 0}')
  })

  it('一覧と締め対象の返事を形検査してから画面へ入れる', () => {
    const settlementCheck = PAYMENT.indexOf('Array.isArray(settlement.data.affiliates)')
    const setPreview = PAYMENT.indexOf('setPreview(settlement.data)')
    expect(settlementCheck).toBeGreaterThan(-1)
    expect(PAYMENT).toContain('setItems(summaries?.success && Array.isArray(summaries.data) ? summaries.data : [])')
    expect(setPreview).toBeGreaterThan(settlementCheck)
  })

  it('明細発行は1人失敗で全体失敗にせず、人ごとに結果を出す（#554 点検#505中8）', () => {
    expect(PAYMENT).toContain('Promise.allSettled')
    expect(PAYMENT).toContain('failedNames')
    expect(PAYMENT).toContain('もう一度押すと失敗分を試し直せます')
    expect(PAYMENT).not.toContain('await Promise.all(preview.affiliates.map')
  })

  it('振込用CSVは合言葉が空のまま送らない（#554 点検#505中8）', () => {
    expect(PAYMENT).toContain('if (!payoutKey)')
    expect(PAYMENT).toContain('disabled={!closed || operationBusy || !payoutKey}')
  })
})
