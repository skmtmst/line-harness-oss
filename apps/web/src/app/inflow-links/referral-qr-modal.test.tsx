import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ReferralQrModal from './referral-qr-modal'

/*
 * 停止した流入経路の QR を出さない。
 *
 * 停止中の経路の QR を配ると、読み取っても友だち追加できない（worker の
 * 解決は `is_active = 1` のみ拾う）。印刷物に載ってしまうと回収できない
 * 事故になるため、出す口自体を止めて理由を出す。
 */
describe('停止中の流入経路のQR', () => {
  it('有効な経路は従来どおりQR・コピー・ダウンロードを出す', () => {
    const markup = renderToStaticMarkup(
      <ReferralQrModal
        route={{ refCode: 'shop-a', name: '店頭POP', genre: null, isActive: true }}
        onClose={() => {}}
      />,
    )
    expect(markup).toContain('のQRコード')
    expect(markup).toContain('/api/qr')
    expect(markup).toContain('URLをコピー')
  })

  it('停止中の経路はQR・コピー・ダウンロードを出さず理由を出す', () => {
    const markup = renderToStaticMarkup(
      <ReferralQrModal
        route={{ refCode: 'shop-old', name: '旧チラシ', genre: null, isActive: false }}
        onClose={() => {}}
      />,
    )
    expect(markup, '停止中の経路のQR画像が出ている').not.toContain('<img')
    expect(markup, '停止中の経路のダウンロード口が出ている').not.toContain('/api/qr')
    expect(markup, '停止中の経路のコピー口が出ている').not.toContain('URLをコピー')
    expect(markup, '停止の理由が出ていない').toContain('停止中')
  })

  it('未登録 ref（有効・無効の概念なし）は従来どおり出す', () => {
    const markup = renderToStaticMarkup(
      <ReferralQrModal
        route={{ refCode: 'external-x', name: '(未登録)', genre: null, isActive: null }}
        onClose={() => {}}
      />,
    )
    expect(markup).toContain('/api/qr')
  })
})
