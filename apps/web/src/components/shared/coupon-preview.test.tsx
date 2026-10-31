// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import CouponPreview from './coupon-preview'
const payload = { title: 'お食事の券', description: '案内', couponType: 'discount', discount: { mode: 'price', beforeYen: 1000, afterYen: 500 }, conditions: 'お会計で提示', code: { text: 'SALE500' }, instructions: 'スタッフに提示してください', imageUrl: 'https://example.com/coupon.png', startsAt: '2026-10-01T00:00', endsAt: '2026-11-30T23:59', oncePerFriend: true }
afterEach(cleanup)
describe('受け取った人のクーポン見本', () => {
  it('共通モデルの割引前・割引後・条件・コード・ガイドを表示する', () => {
    render(<CouponPreview payload={payload} name="管理用" />)
    expect(screen.getByText('1,000 円').tagName).toBe('DEL')
    for (const text of ['500 円', 'お会計で提示', 'クーポンコード：SALE500', 'スタッフに提示してください', '1回のみ使用可能']) expect(screen.getByText(text)).toBeTruthy()
    expect(screen.getByAltText('クーポンの写真')).toBeTruthy()
  })
  it.each(['使用済み', '期限切れ'])('%sでは写真とコードそのものを描画しない', state => {
    render(<CouponPreview payload={payload} name="券" />)
    fireEvent.click(screen.getByRole('button', { name: state }))
    expect(screen.queryByAltText('クーポンの写真')).toBeNull()
    expect(screen.queryByText('クーポンコード：SALE500')).toBeNull()
    expect(screen.queryByText('500 円')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '使用前' }))
    expect(screen.getByAltText('クーポンの写真')).toBeTruthy()
  })
  it('何回でも使える券は使用後も写真・コードを残し、回数を誤って1回にしない', () => {
    render(<CouponPreview payload={{ ...payload, oncePerFriend: false, maxUsesPerFriend: null }} name="券" />)
    fireEvent.click(screen.getByRole('button', { name: '使用済み' }))
    expect(screen.getByText('期間中は何回でも')).toBeTruthy()
    expect(screen.getByText('1回使用しました')).toBeTruthy()
    expect(screen.getByAltText('クーポンの写真')).toBeTruthy()
    expect(screen.getByText('クーポンコード：SALE500')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '期限切れ' }))
    expect(screen.queryByAltText('クーポンの写真')).toBeNull()
  })
  it('3回券は1回使った見本でも残り2回を示し、画像とコードを使えるままにする', () => {
    render(<CouponPreview payload={{...payload,maxUsesPerFriend:3}} name="券" />)
    fireEvent.click(screen.getByRole('button',{name:'使用済み'}))
    expect(screen.getByText('1回使用しました（あと2回）')).toBeTruthy()
    expect(screen.getByAltText('クーポンの写真')).toBeTruthy()
    expect(screen.getByText('クーポンコード：SALE500')).toBeTruthy()
    expect(screen.getByRole('button',{name:'クーポンを使用する（見本）'}).getAttribute('aria-disabled')).not.toBe('true')
  })
  it('旧3回券と説明を保持し、不正な編集中の数をNaNにしない', () => {
    const { rerender } = render(<CouponPreview payload={{ description: '昔の説明', maxUsesPerFriend: 3 }} name="昔の券" />)
    expect(screen.getByText('昔の説明')).toBeTruthy(); expect(screen.getByText('3回のみ使用可能')).toBeTruthy()
    rerender(<CouponPreview payload={{ ...payload, discount: { mode: 'amount', amountYen: NaN } }} name="券" />)
    expect(document.body.textContent).not.toContain('NaN')
  })
})
