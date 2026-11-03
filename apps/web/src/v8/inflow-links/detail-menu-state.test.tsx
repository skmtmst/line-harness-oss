// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { forgetStaffIdentity } from '@/lib/staff-identity-state'

const fixture = vi.hoisted(() => ({ active: true, role: 'owner', update: vi.fn(), requests: [] as Array<{ method: string; path: string }> }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams('id=menu-route'), usePathname: () => '/inflow-links/detail',
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-a', accounts: [{ id: 'account-a', name: '確認用LINE' }] }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/lib/api', async load => {
  const actual = await load<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, entryRoutes: { ...actual.api.entryRoutes, update: fixture.update } } }
})
import Detail from './detail'

const route = () => ({
  id: 'menu-route', refCode: 'menu-fixture', genre: null, name: '確認用リンク', tagId: null, scenarioId: null,
  redirectUrl: null, poolId: null, introTemplateId: null, runAccountFriendAddScenarios: false, isActive: fixture.active,
  stoppedAt: fixture.active ? null : '2026-11-01T00:00:00.000Z', stoppedReason: null, lineAccountId: 'account-a',
  createdAt: '2026-10-31T03:00:00.000Z', updatedAt: '2026-10-31T03:00:00.000Z',
})
const json = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  forgetStaffIdentity()
  fixture.active = true
  fixture.role = 'owner'
  fixture.requests = []
  fixture.update.mockReset().mockResolvedValue({ success: true })
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(input instanceof Request ? input.url : String(input), 'http://worker.test')
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    fixture.requests.push({ method, path: u.pathname })
    if (!['GET', 'HEAD'].includes(method)) throw new Error('Unexpected transport mutation')
    if (u.pathname === '/api/staff/me') return json({
      id: 'operator', role: fixture.role === 'viewer' ? 'staff' : fixture.role,
      readOnly: fixture.role === 'viewer', roleBundle: fixture.role === 'viewer' ? 'view_only' : undefined,
      permissionKeys: fixture.role === 'staff' ? ['/inflow-links'] : [], permissionViewKeys: ['/inflow-links'],
    })
    if (u.pathname === '/api/entry-routes') return json([route()])
    if (u.pathname === '/api/entry-routes/menu-route') return json(route())
    if (u.pathname === '/api/entry-routes/menu-route/funnel') return json({ click_count: 0, friend_add_count: 0, form_submission_count: 0, cv_count: 0 })
    if (u.pathname === '/api/analytics/ref/menu-fixture') return json({ friends: [] })
    if (u.pathname.includes('features/visibility')) return json({ features: {} })
    return json([])
  }))
})
afterEach(() => {
  cleanup()
  forgetStaffIdentity()
  expect(fixture.requests.filter(r => !['GET', 'HEAD'].includes(r.method))).toEqual([])
  vi.unstubAllGlobals()
})

async function openMenu(active: boolean, role: string) {
  const card = screen.getByRole('region', { name: 'その後（この経路から来た人）', exact: true })
  const management = role === 'owner' || role === 'admin'
  const labels = [...(active ? ['受付を止める'] : []), '別リンクへ送る', ...(management ? ['削除する'] : [])]
  const opener = await within(card).findByRole('button', { name: `この経路の操作（${labels.join('・')}）`, exact: true })
  expect(within(card).getByText(`「その後」の「…」から：${labels.join('・')}`, { exact: true })).toBeTruthy()
  if (!active) expect(card.textContent).not.toContain('受付を止める')
  if (!management) expect(card.textContent).not.toContain('削除する')
  fireEvent.click(opener)
  const menu = await screen.findByRole('menu', { name: 'この経路の操作', exact: true })
  const expectedOrder = ['別リンクへ送る', ...(active ? ['受付を止める'] : []), ...(management ? ['削除する'] : [])]
  expect(within(menu).getAllByRole('menuitem').map(item => item.getAttribute('title'))).toEqual(expectedOrder)
  expect(within(menu).queryByRole('menuitem', { name: '受付を再開する', exact: true })).toBeNull()
  return { card, menu }
}

const cases = ['owner', 'admin', 'staff', 'viewer'].flatMap(role => [true, false].map(active => ({ role, active })))
describe('経路の状態と操作の案内', () => {
  it.each(cases)('$role active=$active の実親で項目と案内・読み上げ名が一致する', async ({ role, active }) => {
    fixture.role = role
    fixture.active = active
    render(<Detail />)
    await screen.findByText('この経路から来た友だちは、まだいません')
    if (role === 'viewer') {
      await screen.findByText('閲覧のみで見ています。変えたい時はオーナーか管理者に頼んでください。', { exact: true })
      const card = screen.getByRole('region', { name: 'その後（この経路から来た人）', exact: true })
      expect(within(card).queryByRole('button', { name: /^この経路の操作/ })).toBeNull()
      expect(within(card).getByText('クリックから友だち追加・フォーム・購入までの人数です', { exact: true })).toBeTruthy()
      expect(screen.queryByRole('button', { name: '受付を再開する', exact: true })).toBeNull()
      expect(screen.queryByRole('button', { name: '止める', exact: true })).toBeNull()
    } else {
      expect(!!screen.queryByRole('button', { name: '受付を再開する', exact: true })).toBe(!active)
      const { menu } = await openMenu(active, role)
      expect(within(menu).queryByRole('menuitem', { name: '受付を止める', exact: true }) !== null).toBe(active)
      fireEvent.keyDown(document, { key: 'Escape' })
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    }
    expect(fixture.update).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('既存の帯から再開が成功すると停止項目と案内が戻る', async () => {
    fixture.active = false
    render(<Detail />)
    await screen.findByRole('button', { name: '受付を再開する', exact: true })
    const { menu } = await openMenu(false, 'owner')
    expect(within(menu).queryByRole('menuitem', { name: '受付を止める', exact: true })).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '受付を再開する', exact: true })) })
    await screen.findByRole('button', { name: '止める', exact: true })
    await openMenu(true, 'owner')
    expect(fixture.update).toHaveBeenCalledExactlyOnceWith('menu-route', { isActive: true })
    expect(screen.queryByRole('button', { name: '受付を再開する', exact: true })).toBeNull()
  })

  it('既存の再開が失敗すると停止中の項目と案内を保つ', async () => {
    fixture.active = false
    fixture.update.mockRejectedValue(new Error('再開の確認用失敗'))
    render(<Detail />)
    await screen.findByRole('button', { name: '受付を再開する', exact: true })
    const { menu } = await openMenu(false, 'owner')
    expect(within(menu).queryByRole('menuitem', { name: '受付を止める', exact: true })).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '受付を再開する', exact: true })); await Promise.resolve() })
    await act(async () => { await fixture.update.mock.results[0].value.catch(() => {}) })
    await openMenu(false, 'owner')
    expect(fixture.update).toHaveBeenCalledExactlyOnceWith('menu-route', { isActive: true })
    expect(screen.queryByRole('button', { name: '止める', exact: true })).toBeNull()
    expect(screen.getByRole('button', { name: '受付を再開する', exact: true })).toBeTruthy()
  })
})
