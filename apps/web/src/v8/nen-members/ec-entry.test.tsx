// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { verifiedStaffRole } from '@/test-utils/verified-staff-role'
import type { MemberTab } from './parts'

const state = vi.hoisted(() => ({
  get: vi.fn(),
  role: 'owner' as string | null,
  seen: new Map<string, { status: string; stale: boolean }>(),
}))
vi.mock('@/lib/api/helpers/styles', () => ({ styleApi: { get: state.get } }))
vi.mock('@/hooks/use-account-style', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/use-account-style')>()
  return { ...actual, useAccountStyle: (accountId: string | null | undefined) => {
    const result = actual.useAccountStyle(accountId)
    state.seen.set(accountId ?? '', { status: result.status, stale: result.stale })
    return result
  } }
})
vi.mock('next/link', () => ({ default: ({ children, href, prefetch: _prefetch, replace: _replace, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean; replace?: boolean }) => <a href={href} {...rest}>{children}</a> }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/nen/members', useSearchParams: () => new URLSearchParams() }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/lib/staff-role', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/staff-role')>(), useStaffRole: () => state.role }))
vi.mock('./list', () => ({ default: () => <p>会員の一覧</p> }))
vi.mock('./ranks', () => ({ default: () => <p>ランクの設定</p> }))
vi.mock('./lifetime', () => ({ default: () => <p>節目の設定</p> }))
import MembersV8 from './members'

const props = (accountId: string | null = 'account-a', tab: MemberTab = 'members') => ({
  accountId, tab, status: 'ready' as const, settings: null,
  onRetry: vi.fn(), onSaved: vi.fn(), onChangeTab: vi.fn(),
})
const tabs = () => within(screen.getByRole('tablist', { name: '会員の切り替え' }))
const noEc = () => expect(tabs().queryByRole('tab', { name: 'ECとの照合' })).toBeNull()
const ready = (accountId = 'account-a') => waitFor(() => expect(state.seen.get(accountId)?.status).toBe('ready'))

beforeEach(() => {
  window.localStorage.clear()
  state.get.mockReset()
  state.seen.clear()
  state.role = verifiedStaffRole('owner')
})
afterEach(cleanup)

it.each(['standard', 'restaurant', 'salon', 'consult', 'lesson'])('%sの店は会員の3タブを保ち、設定へ飛ばされるECの入口を出さない', async style => {
  state.get.mockResolvedValue({ success: true, data: { style, styleSelected: true } })
  const view = render(<MembersV8 {...props()} />)
  await ready()
  for (const tab of ['members', 'ranks', 'lifetime'] as const) {
    view.rerender(<MembersV8 {...props('account-a', tab)} />)
    noEc()
    expect(tabs().getAllByRole('tab')).toHaveLength(3)
  }
})

it.each(['members', 'ranks', 'lifetime'] as const)('ECを選択済みなら%sでも元の照合先を使い、会員の切り替えを保つ', async tab => {
  state.get.mockResolvedValue({ success: true, data: { style: 'ec', styleSelected: true } })
  const input = props('account-a', tab)
  render(<MembersV8 {...input} />)
  await ready()
  expect(tabs().getByRole('tab', { name: 'ECとの照合' }).getAttribute('href')).toBe('/ec-commerce/identity-candidates')
  fireEvent.click(tabs().getByRole('tab', { name: 'ランク設定' }))
  expect(input.onChangeTab).toHaveBeenCalledWith('ranks')
  expect(input.onSaved).not.toHaveBeenCalled()
})

it.each([false, undefined])('ECの選択を確定していなければ入口を出さない（%s）', async styleSelected => {
  state.get.mockResolvedValue({ success: true, data: { style: 'ec', styleSelected } })
  render(<MembersV8 {...props()} />)
  await ready()
  noEc()
})

it('未選択と読み込み中にはECの入口を出さない', () => {
  state.get.mockReturnValue(new Promise(() => {}))
  const view = render(<MembersV8 {...props(null)} />)
  noEc()
  expect(state.get).not.toHaveBeenCalled()
  view.rerender(<MembersV8 {...props()} />)
  expect(state.seen.get('account-a')?.status).toBe('loading')
  noEc()
})

it.each([false, true])('取得に失敗したら以前のEC設定を入口の根拠にしない（保存済み %s）', async remembered => {
  if (remembered) window.localStorage.setItem('musubo:account-style:account-a', JSON.stringify({ style: 'ec', styleSelected: true }))
  state.get.mockRejectedValue(new Error('network'))
  render(<MembersV8 {...props()} />)
  await waitFor(() => expect(state.seen.get('account-a')?.status).toBe(remembered ? 'ready' : 'error'))
  if (remembered) expect(state.seen.get('account-a')?.stale).toBe(true)
  noEc()
})

it('店を変えた直後から、前のECの入口を残さない', async () => {
  let finish!: (value: unknown) => void
  state.get.mockResolvedValueOnce({ success: true, data: { style: 'ec', styleSelected: true } })
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const view = render(<MembersV8 {...props()} />)
  await ready()
  expect(tabs().getByRole('tab', { name: 'ECとの照合' })).toBeTruthy()
  view.rerender(<MembersV8 {...props('account-b')} />)
  noEc()
  await waitFor(() => expect(state.get).toHaveBeenCalledWith('account-b'))
  await act(async () => { finish({ success: true, data: { style: 'restaurant', styleSelected: true } }) })
  await ready('account-b')
  noEc()
  expect(state.get.mock.calls.map(([accountId]) => accountId)).toEqual(['account-a', 'account-b'])
})

it.each(['viewer', 'staff'])('ECの入口に新しい役割の制限を加えない（%s）', async role => {
  state.role = verifiedStaffRole(role)
  state.get.mockResolvedValue({ success: true, data: { style: 'ec', styleSelected: true } })
  render(<MembersV8 {...props()} />)
  await ready()
  expect(tabs().getByRole('tab', { name: 'ECとの照合' }).getAttribute('href')).toBe('/ec-commerce/identity-candidates')
})
