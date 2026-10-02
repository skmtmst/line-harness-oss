// @vitest-environment happy-dom
import React from 'react'
import { describe, expect, it, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

/*
 * R213: 2通目以降の編集プレビューが1通目として案内される。
 * 新規1通目用の説明を使い回すと、いま編集中の通と順序を取り違える。
 * 直しを戻す（stepOrder を無視して 1通目固定に戻す）と、この試験は赤くなる。
 */
import StepPreview from './step-preview'

afterEach(() => {
  cleanup()
})

const base = {
  deliveryMode: 'elapsed' as const,
  offsetDays: 1,
  deliveryTime: '09:00',
  offsetHours: 0,
  offsetMinutes: 0,
  kind: 'text' as const,
  templateName: null,
  body: '本文',
  imageUrl: null,
  question: null,
  audienceLabel: '購読中の全員',
}

describe('R213: 編集プレビューは実際の通番号を出す', () => {
  it('省略時は1通目（新規作成の入口はそのまま）', () => {
    render(<StepPreview {...base} />)
    expect(screen.getByRole('complementary', { name: '1通目の下見' })).toBeTruthy()
    expect(screen.getByText('1日後に届きます（1通目）')).toBeTruthy()
    expect(
      screen.getByText('2通目からは、このあとの編集画面で足せます。足すと、ここと同じ形で届く日時が並びます。'),
    ).toBeTruthy()
  })

  it('2通目の編集では2通目と出し、新規用の案内は出さない', () => {
    render(<StepPreview {...base} stepOrder={2} />)
    expect(screen.getByRole('complementary', { name: '2通目の下見' })).toBeTruthy()
    expect(screen.getByText('1日後に届きます（2通目）')).toBeTruthy()
    expect(screen.getByText('いま編集中の2通目の見本です。前後の通は、一覧の並びで確認できます。')).toBeTruthy()
    expect(
      screen.queryByText('2通目からは、このあとの編集画面で足せます。足すと、ここと同じ形で届く日時が並びます。'),
    ).toBeNull()
  })
})
