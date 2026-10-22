// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useDashboard } from './use-dashboard'
import { InboxSection } from './inbox'
import { loadStaffIdentity, useStaffRole } from '@/lib/staff-role'
import { forgetStaffIdentity } from '@/lib/staff-identity-state'
import { SESSION_LOST_EVENT } from '@/lib/session-events'
import { flushListUrlState } from '@/components/shared/list-url-state'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: null, selectedAccount: null, loading: false }),
}))
vi.mock('@/components/shared/list-navigation', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}))
vi.mock('./sections', () => ({ Loading: () => <p>読み込み中</p> }))

const summary = { total: 30, line: 30, email: 0, emailUnread: 0, oldestWaitMinutes: 1 }
const self = (id: string, name: string) => ({ success: true, data: { id, name, role: 'staff' } })
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
let me: ReturnType<typeof vi.fn<() => Promise<Response>>>
let inbox: string[]
const onSummaryChange = vi.fn()

function Shell() { return <output aria-label="役割">{useStaffRole() ?? '未確認'}</output> }
function Greeting() { return <output aria-label="あいさつ">{useDashboard().staffName ?? '未確認'}</output> }
function Display({ shell = false, showDisplay = true }: { shell?: boolean; showDisplay?: boolean }) {
  return <>{shell && <Shell />}{showDisplay && <><Greeting /><InboxSection onSummaryChange={onSummaryChange} /></>}</>
}

beforeEach(() => {
  forgetStaffIdentity()
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
  window.dispatchEvent(new PopStateEvent('popstate'))
  inbox = []
  me = vi.fn(async () => json(self('staff-a', 'Alice')))
  vi.stubGlobal('fetch', (input: string | URL | Request) => {
    const url = new URL(String(input), window.location.origin)
    if (url.pathname === '/api/staff/me') return me()
    if (url.pathname === '/api/support/inbox') {
      inbox.push(url.search)
      return Promise.resolve(json({ success: true, data: { items: [], summary } }))
    }
    throw new Error(`Unexpected request: ${url.pathname}`)
  })
})
afterEach(() => { cleanup(); flushListUrlState(); forgetStaffIdentity(); vi.unstubAllGlobals() })

it('shellで本人確認済みなら名前と個人件数を共有し、追加本人GETを出さない', async () => {
  window.localStorage.setItem('lh_pending_inbox_page_size:staff-a', '10')
  const view = render(<Display shell showDisplay={false} />)
  await waitFor(() => expect(screen.getByLabelText('役割').textContent).toBe('staff'))
  expect(me).toHaveBeenCalledTimes(1)
  view.rerender(<Display shell />)
  await waitFor(() => expect(screen.getByLabelText('あいさつ').textContent).toBe('Alice'))
  await waitFor(() => expect(inbox.at(-1)).toContain('limit=10'))
  expect(me).toHaveBeenCalledTimes(1)
  expect(window.localStorage.getItem('lh_pending_inbox_page_size:staff-a')).toBe('10')
})

it('単独表示の未確認からは本人GETを1回だけ共有し、名前と個人件数を復元する', async () => {
  window.localStorage.setItem('lh_pending_inbox_page_size:staff-a', '10')
  render(<Display />)
  await waitFor(() => expect(screen.getByLabelText('あいさつ').textContent).toBe('Alice'))
  await waitFor(() => expect(inbox.at(-1)).toContain('limit=10'))
  expect(me).toHaveBeenCalledTimes(1)
})

it('明示URLの件数を個人保存値で上書きせず、ページ移動も同じ件数を使う', async () => {
  window.localStorage.setItem('lh_pending_inbox_page_size:staff-a', '10')
  window.history.replaceState(null, '', '/?pageSize=20')
  render(<Display />)
  await waitFor(() => expect(screen.getByLabelText('あいさつ').textContent).toBe('Alice'))
  expect(inbox.every((query) => new URLSearchParams(query).get('limit') === '20')).toBe(true)
  await act(async () => { screen.getByRole('button', { name: '次のページ' }).click() })
  await waitFor(() => expect(inbox.at(-1)).toContain('offset=20'))
  flushListUrlState()
  expect(new URLSearchParams(window.location.search).get('pageSize')).toBe('20')
  expect(window.localStorage.getItem('lh_pending_inbox_page_size:staff-a')).toBe('10')
})

it('失効すると古い名前と個人件数を捨て、再確認した別本人の設定へ切り替える', async () => {
  window.localStorage.setItem('lh_pending_inbox_page_size:staff-a', '10')
  window.localStorage.setItem('lh_pending_inbox_page_size:staff-b', '20')
  render(<Display />)
  await waitFor(() => expect(screen.getByLabelText('あいさつ').textContent).toBe('Alice'))
  await waitFor(() => expect(inbox.at(-1)).toContain('limit=10'))
  await act(async () => { window.dispatchEvent(new Event(SESSION_LOST_EVENT)) })
  expect(screen.getByLabelText('あいさつ').textContent).toBe('未確認')
  await waitFor(() => expect(inbox.at(-1)).toContain('limit=5'))
  const meCount = me.mock.calls.length
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  expect(inbox.at(-1)).toContain('limit=5')
  expect(me).toHaveBeenCalledTimes(meCount)
  me.mockResolvedValue(json(self('staff-b', 'Bob')))
  await act(async () => { await loadStaffIdentity() })
  expect(screen.getByLabelText('あいさつ').textContent).toBe('Bob')
  await waitFor(() => expect(inbox.at(-1)).toContain('limit=20'))
  expect(window.localStorage.getItem('lh_pending_inbox_page_size:staff-a')).toBe('10')
  expect(window.localStorage.getItem('lh_pending_inbox_page_size:staff-b')).toBe('20')
})

it('世代変更前の遅い本人応答が新しい名前や個人件数へ戻さない', async () => {
  let resolveOld!: (response: Response) => void
  me.mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveOld = resolve }))
  window.localStorage.setItem('lh_pending_inbox_page_size:staff-a', '10')
  window.localStorage.setItem('lh_pending_inbox_page_size:staff-b', '20')
  render(<Display shell />)
  await waitFor(() => expect(me).toHaveBeenCalledTimes(1))
  await act(async () => { window.dispatchEvent(new Event(SESSION_LOST_EVENT)) })
  me.mockResolvedValue(json(self('staff-b', 'Bob')))
  await act(async () => { await loadStaffIdentity() })
  await act(async () => { resolveOld(json(self('staff-a', 'Alice'))); await Promise.resolve() })
  expect(screen.getByLabelText('あいさつ').textContent).toBe('Bob')
  expect(inbox.at(-1)).toContain('limit=20')
})

it('本人を読めなければ名前を出さず標準件数を使い、明示再確認で復旧する', async () => {
  me.mockRejectedValueOnce(new Error('offline'))
  window.localStorage.setItem('lh_pending_inbox_page_size:staff-a', '10')
  render(<Display />)
  await waitFor(() => expect(me).toHaveBeenCalledTimes(1))
  await act(async () => { await Promise.resolve() })
  expect(screen.getByLabelText('あいさつ').textContent).toBe('未確認')
  expect(inbox.at(-1)).toContain('limit=5')
  await act(async () => { await loadStaffIdentity() })
  expect(screen.getByLabelText('あいさつ').textContent).toBe('Alice')
  await waitFor(() => expect(inbox.at(-1)).toContain('limit=10'))
})

it.each(['7', '壊れた値'])('個人保存値%sが選択肢でなければ標準件数を使い、保存値は変更しない', async (value) => {
  window.localStorage.setItem('lh_pending_inbox_page_size:staff-a', value)
  render(<Display />)
  await waitFor(() => expect(screen.getByLabelText('あいさつ').textContent).toBe('Alice'))
  expect(inbox.at(-1)).toContain('limit=5')
  expect(window.localStorage.getItem('lh_pending_inbox_page_size:staff-a')).toBe(value)
})
