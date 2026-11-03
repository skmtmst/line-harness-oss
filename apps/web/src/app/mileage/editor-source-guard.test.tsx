// @vitest-environment happy-dom
import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const source = vi.hoisted(() => ({ current: 'ec' as 'ec' | 'musubo' }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-a', loading: false }) }))
vi.mock('@/lib/api', () => ({ api: { mileage: { friendsV6: async () => ({ success: true, data: { balanceSource: source.current } }) } } }))
vi.mock('@/v8/mileage/reward-edit', () => ({ default: () => <button>保存する</button> }))
import RewardEditor from './rewards/edit/page'
afterEach(cleanup)
it('ECの店は直接URLでも編集操作を表示しない', async () => {
  render(<RewardEditor />)
  expect(await screen.findByText('マイルはECで管理しています')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '保存する' })).toBeNull()
})
