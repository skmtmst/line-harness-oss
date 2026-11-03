// @vitest-environment happy-dom
/*
 * 19: 値が無い所は薄い灰の「—」1つ。追えない流入元を「不明」と書かない。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FriendDetail } from '@/lib/api'
import type { FriendDetailState } from './use-friend-detail'
import type { FriendDetailPermissions } from './permissions'

vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-a' }) }))

import OverviewTab from './overview-tab'

function view(firstTrackedLinkName: string | null, mileage?: { available: number | null; balanceSource: 'ec'; ecRank: string }) {
  const friend = { id: 'f1', displayName: 'f1', tags: [], formSubmissions: [], firstTrackedLinkName } as unknown as FriendDetail
  const data = {
    loadFriend: vi.fn(), loadFields: vi.fn(), fieldsStatus: 'ready', hiddenPersonalCount: 0,
    historyStatus: 'ready', historyItems: [], mileageStatus: 'ready', mileage, richMenuStatus: 'ready',
    upcoming: [], upcomingStatus: 'ready', mileageInsights: null, mileageConnections: [],
  } as unknown as FriendDetailState
  const perms: FriendDetailPermissions = { manage: true, editSupport: true, saveFields: true, canEditField: () => true, viewOnly: false }
  return <OverviewTab friend={friend} friendId="f1" data={data} perms={perms} fields={[]} values={{}} realName="f1" onEditSupport={vi.fn()} onEnrollScenario={vi.fn()} scenarioNotice="" />
}

afterEach(cleanup)

describe('19 流入元が追えなければ「—」', () => {
  it('ECの残高とランクの出所を示す', () => {
    render(view(null, { available: 29, balanceSource: 'ec', ecRank: 'ゴールド' }))
    expect(screen.getByText('29')).toBeTruthy()
    expect(screen.getByText('会員ランク：ゴールド（ECと同期）')).toBeTruthy()
  })
  it('firstTrackedLinkName が無ければ「—」で出し、「不明」と書かない', () => {
    render(view(null))
    fireEvent.click(screen.getByRole('button', { name: '顧客情報をすべて表示' }))
    const row = screen.getByText('流入元').closest('div')
    expect(row?.textContent).toContain('—')
    expect(row?.textContent).not.toContain('不明')
  })

  it('名前があればそのまま出す', () => {
    render(view('広告A'))
    fireEvent.click(screen.getByRole('button', { name: '顧客情報をすべて表示' }))
    const row = screen.getByText('流入元').closest('div')
    expect(row?.textContent).toContain('広告A')
  })
})
