import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const DETAIL = fs.readFileSync(path.join(__dirname, 'detail/page.tsx'), 'utf8')
const PANEL = fs.readFileSync(path.join(__dirname, '_components/ref-orders.tsx'), 'utf8')

/**
 * IDEA-18「流入と計測」: 経路→友だち→注文・返金を同じ条件で結び、
 * 集計と明細がつき合わせられること、未計測を0件と見せないことを
 * 画面側の契約として固定する。
 */
describe('IDEA-18: 経路別の購入・返金は集計と明細で同じ口から出す', () => {
  it('一覧の展開行に注文明細パネルを置く', () => {
    expect(PAGE).toContain('import RefOrdersPanel')
    expect(PAGE).toMatch(/<RefOrdersPanel\s+refCode=\{refCode\}/)
  })

  it('経路別集計の購入・返金・取消をAPIの型に持つ', () => {
    expect(PAGE).toContain('orderCount?:')
    expect(PAGE).toContain('refundedOrderCount?:')
    expect(PAGE).toContain('cancelledOrderCount?:')
  })

  it('集計の件数と明細の全件数が同じ母集団だと分かる言い回しがある', () => {
    // 展開行で「集計では購入 N件」と明細を並べて出す
    expect(PAGE).toContain('集計では、この経路からの購入は')
  })

  it('詳細ページにも同じ明細を置き、購入・返金カードは明細の集計と同じ値を使う', () => {
    expect(DETAIL).toContain('import RefOrdersPanel')
    expect(DETAIL).toContain('label="購入"')
    expect(DETAIL).toContain('label="返金・取消"')
    // カードの数はパネルが取った集計(onSummaryChange)と同じ口
    expect(DETAIL).toContain('onSummaryChange={setOrdersSummary}')
    expect(DETAIL).toContain('ordersSummary?.total')
  })
})

describe('IDEA-18: 期間・帰属・計測範囲を画面で説明する', () => {
  it('一覧に集計期間と帰属ルール(first-touch)の断り書きがある', () => {
    expect(PAGE).toContain('集計は累計（全期間）です')
    expect(PAGE).toContain('はじめて来た経路')
    expect(PAGE).toContain('二重に数えません')
  })

  it('一覧に未計測(経路不明・未連携)の件数を別欄で出す', () => {
    expect(PAGE).toContain('summary?.orders')
    expect(PAGE).toContain('経路が分からない')
    expect(PAGE).toContain('友だち未連携')
  })

  it('詳細ページにも同じ断り書きと、計測できない例の明記がある', () => {
    expect(DETAIL).toContain('期間は累計（全期間）です')
    expect(DETAIL).toContain('first-touch')
    expect(DETAIL).toContain('計測できず')
  })

  it('注文パネルも帰属ルールと未計測の範囲を説明する', () => {
    expect(PANEL).toContain('はじめて来た友だち')
    expect(PANEL).toContain('計測できない')
    expect(PANEL).toContain('二重には数えません')
  })
})

describe('IDEA-18: 読めていない注文を0件と見せない', () => {
  it('注文パネルは読込中・失敗・空を言い分ける部品を使う', () => {
    expect(PANEL).toContain("import ListState from '@/components/shared/list-state'")
    expect(PANEL).toContain('kind="loading"')
    expect(PANEL).toContain('kind="error"')
    expect(PANEL).toContain('kind="empty"')
    // 失敗時は再読み込みの口を出す(0件と見せない)
    expect(PANEL).toContain('onRetry=')
    expect(PANEL).toContain('計測できる注文はまだありません')
  })

  it('注文パネルは /api/analytics/ref/:refCode/orders を叩く', () => {
    expect(PANEL).toContain('/api/analytics/ref/')
    expect(PANEL).toContain('/orders?')
  })

  it('詳細の購入カードは集計を取れていないとき数を出さない', () => {
    // ordersSummary が null のままなら value は null(「—」表示)
    expect(DETAIL).toContain('ordersSummary?.total ?? null')
    expect(DETAIL).toContain('注文の集計を取得できていません')
  })
})
