// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: { ...actual.api, broadcastMessageAssets: { list: async () => ({ success: true, data: [] }) } },
  }
})
import CouponSettings from './coupon-settings'

afterEach(cleanup)

// 決まり2: 渡す条件の説明は帯にせず、題の横の「？」へ入れる。
it('渡す条件は帯に出さず題の「？」に入れる', async () => {
  render(<CouponSettings accountId="acc-1" value={{ couponEnabled: true, couponAssetId: null, couponAudience: 'new_friends' }} onChange={() => {}} />)
  await screen.findByText('読み取った人にクーポンを渡す')
  expect(screen.queryByText(/1人1回だけ渡します/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'クーポンを渡す条件の説明' }))
  expect(await screen.findByText(/1人1回だけ渡します/)).toBeTruthy()
})
