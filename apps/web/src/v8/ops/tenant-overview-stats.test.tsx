// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { OpsTenantDetail } from '@/lib/api'
import TenantOverviewStats from './tenant-overview-stats'

afterEach(cleanup)
const account = (friend_count: number, archived_at: string | null = null): OpsTenantDetail['accounts'][number] => ({
  id: 'a1', name: '店舗', is_active: 1, archived_at, updated_at: '2026-10-15', friend_count,
})
const detail = (accounts: OpsTenantDetail['accounts']): OpsTenantDetail => ({
  tenant: {
    id: 't1', name: '契約先', status: 'active', featurePacks: [], plan_key: 'standard', plan_status: 'active',
    trial_ends_at: null, current_period_ends_at: null, created_at: '', updated_at: '',
    account_count: accounts.filter(item => !item.archived_at).length, staff_count: 1, last_login_at: null,
  },
  accounts, members: [], audit: [],
})
const value = (label: string) => screen.getByText(label).closest('[data-kpi-presentation]')?.querySelector('[data-kpi-number]')?.textContent

it('利用中の店舗の友だちを合計し、料金や問い合わせを他の数字で代用しない', () => {
  render(<TenantOverviewStats detail={detail([account(1284), account(612), account(99, '2026-10-01')])} />)
  expect(value('アカウント')).toBe('2')
  expect(value('友だち')).toBe('1,896')
  expect(value('月額')).toBe('—')
  expect(value('お問い合わせ')).toBe('—')
})

it.each([undefined, null, NaN, -1])('店舗の友だち数に不明な値 %s があれば部分合計を出さない', missing => {
  render(<TenantOverviewStats detail={detail([account(1284), account(missing as number)])} />)
  expect(value('友だち')).toBe('—')
})

it('店舗がない契約先は人数0とし、未取得の料金と問い合わせの—を保つ', () => {
  render(<TenantOverviewStats detail={detail([])} />)
  expect(value('アカウント')).toBe('0')
  expect(value('友だち')).toBe('0')
  expect(value('月額')).toBe('—')
  expect(value('お問い合わせ')).toBe('—')
})
