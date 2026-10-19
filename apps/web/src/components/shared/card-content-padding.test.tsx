// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import Card from './card'

/*
 * Card の `contentPadding` は「左右別々の余白か」を渡された文字列の見た目で決めている
 * （card.tsx の hasSides：括弧を外して空白が残るかを見る）。左右別々のときだけ
 * `data-card-spacing-sides` が付き、共通の下限 16 を外して指定どおりの余白になる
 * （card.module.css の ）。
 *
 * ここが食い違うと画面が壊れる。`contentPadding="var(--x)"` の 1 語で、その変数の
 * 中身が `8px 10px` のように 2 値だと、hasSides は空白を見つけられず下限側の規則に
 * 当たり `max(16px, 8px 10px)` になる。これは CSS として成り立たないので padding は
 * 初期値 0 に落ちる。枠が文字 1 行ぶんに潰れ、字が枠線に付く。
 *
 * 経緯：②アカウント接続 Step2 の「musubo の Webhook URL」の枠が、承認済み v07 の
 * 高さ 36・左右 12 ではなく細い線になって配備された（原因はこれ）。
 * 直し方は値を空白で分けて渡すこと。変数 1 語にまとめない。
 *
 * 画面ごとの見張りは、その画面を描く関所テストが持つ
 * （②Step2 は v8/account-new/webhook-url-frame-contract.test.tsx、
 *  予約台帳の日の一覧行は v8/booking-bookings/day-list.test.tsx）。
 */

afterEach(cleanup)

function card(contentPadding: string) {
  const { container } = render(<Card surface="bordered" contentPadding={contentPadding}>中身</Card>)
  return container.querySelector<HTMLElement>('[data-design-part="card"]') as HTMLElement
}

describe('Card の contentPadding は左右別々だと見抜けた分だけ下限を外す', () => {
  it('空白で分けて渡した余白は、そのまま効く形で付く', () => {
    const sides = card('var(--space-8) var(--space-12)')
    expect(sides.hasAttribute('data-card-spacing-sides')).toBe(true)
    const style = sides.getAttribute('style') ?? ''
    expect(/--card-content-padding:\s*var\(--space-8\) var\(--space-12\)/.test(style)).toBe(true)
  })

  it('罠そのものは残っている：2値の変数を1語で渡すと左右別々だと見抜けない', () => {
    /*
     * --tpl-htn-endpoint-pad の中身は 2 値（`8px 10px`）。それでも文字列には空白が
     * 見えないので印が付かず、下限 16 の規則に当たって padding が 0 に落ちる。
     * この行が落ちるようになったら、Card 側で中身まで見るようになったということ。
     * そのときは画面側の「空白で分けて渡す」決まりを見直してよい。
     */
    expect(card('var(--tpl-htn-endpoint-pad)').hasAttribute('data-card-spacing-sides')).toBe(false)
  })

  it('1値の余白は下限 16 に任せる（印は付かない）', () => {
    expect(card('var(--tpl-htn-note-pad)').hasAttribute('data-card-spacing-sides')).toBe(false)
  })
})
