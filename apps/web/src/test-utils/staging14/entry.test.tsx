// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const writes: Array<{ path: string; options: RequestInit }> = []
let failSubmit = true
let accepting = true
const form = () => ({ success: true, data: { id: 'f', name: '回答フォーム', isActive: true, fields: [{ name: 'choice', type: 'radio', label: '選択', options: ['A', 'B'] }], availability: { accepting, reason: accepting ? null : '締め切りました', deadlineAt: '2099-10-20T01:00:00Z', totalRemaining: 2, oncePerFriend: true, choices: { choice: { A: { remaining: 0, full: true }, B: { remaining: 1, full: false } } } } } })
const sdk = { init: vi.fn(async () => {}), isLoggedIn: () => true, login: vi.fn(), logout: vi.fn(), getProfile: async () => ({ userId: 'fixture', displayName: 'fixture' }), getIDToken: () => `e30.${btoa(JSON.stringify({ exp: 4102444800 }))}.fixture`, getAccessToken: () => 'fixture-access-token', getDecodedIDToken: () => ({ exp: Math.floor(Date.now() / 1000) + 3600 }), getFriendship: async () => ({ friendFlag: true }), isInClient: () => false }

beforeEach(() => {
  vi.resetModules(); writes.length = 0; failSubmit = true; accepting = true
  document.body.innerHTML = '<div id="app"></div>'
  vi.stubGlobal('liff', sdk)
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, options: RequestInit = {}) => {
    const url = new URL(String(input), window.location.origin)
    const path = url.pathname
    if (options.method && options.method !== 'GET') writes.push({ path, options })
    if (path === '/api/liff/config') return reply({ success: true, data: {} })
    if (path === '/api/liff/link') return reply({ success: true, data: { userId: 'fixture-uuid' } })
    if (path === '/api/forms/f') return reply(form())
    if (path === '/api/forms/f/opened') return reply({ success: true })
    if (path === '/api/forms/f/submit') return failSubmit ? reply({ success: false, error: 'offline' }, 500) : reply({ success: true, data: { complete: true } })
    if (path === '/api/liff/booking/menus') return reply({ menus: [{ id: 'm', name: '予約メニュー', intake_question: '事前の質問', base_price: 1000 }] })
    if (path === '/api/liff/booking/menus/m/staff') return reply({ staff: [{ id: 's', display_name: '担当者', price: 1000, duration_minutes: 30 }] })
    if (path === '/api/liff/booking/availability') return reply({ by_staff: [{ staff_id: 's', display_name: '担当者', slots: [{ date: url.searchParams.get('from'), start: '10:00', end: '10:30' }] }] })
    if (path === '/api/liff/booking/requests') return failSubmit ? reply({ error: 'slot_conflict' }, 409) : reply({ booking_id: 'b', status: 'requested' })
    if (path === '/api/liff/booking/me') return reply({ upcoming: [{ id: 'b', menu_name: '予約メニュー', staff_name: '担当者', starts_at: '2099-10-20T01:00:00Z', status: 'confirmed', cancel_deadline_at: '2099-10-19T01:00:00Z' }], past: [] })
    if (path === '/api/liff/affiliate/me') return reply({ affiliate: { id: 'a', name: 'fixture', isActive: true }, links: [] })
    if (path === '/api/liff/affiliate/offers') return reply({ offers: [] })
    if (path === '/api/liff/mileage/me') return reply({ mileage: { programName: 'fixture', available: 150, pending: 0, lifetimeEarned: 150, spent: 0 }, insights: { accountCount: 1, rewardedActions: 0, referralMiles: 0, qualityReferralCount: 0 }, opportunities: [], history: [] })
    if (path === '/api/liff/mileage/rewards') return reply({ rewards: [{ id: 'r', name: '試験の特典', canRedeem: true, currentVersion: { requiredMiles: 100 } }], availableMiles: 150 })
    if (path === '/api/liff/mileage/rewards/r/redeem') return failSubmit ? reply({ error: '試験の交換失敗' }, 500) : reply({ status: 'succeeded', rewardName: '試験の特典' })
    if (path === '/api/liff/affiliate/bank') {
      if (options.method === 'PUT') return failSubmit ? reply({ error: '試験の保存失敗' }, 500) : reply({ data: { bankCode: '9999', bankName: '試験銀行', branchCode: '999', branchName: '試験支店', accountType: 'ordinary', accountLast4: '0000', accountHolderName: 'FIXTURE', version: 2 } })
      return reply({ data: { bankCode: '9999', bankName: '試験銀行', branchCode: '999', branchName: '試験支店', accountType: 'ordinary', accountLast4: '0000', accountHolderName: 'FIXTURE', version: 1 } })
    }
    if (path === '/api/liff/affiliate/statements') return reply({ data: [] })
    throw new Error(`Unexpected request: ${path}`)
  }))
})
afterEach(async () => {
  const { unmountAffiliate } = await import('../../../../worker/src/client/affiliate/main')
  const { unmountSalonBooking } = await import('../../../../worker/src/client/salon-booking/main')
  await act(async () => { unmountAffiliate(); unmountSalonBooking() })
  cleanup(); document.body.innerHTML = ''; vi.unstubAllGlobals()
})
async function open(query: string) {
  window.history.replaceState({}, '', `/?liffId=fixture&${query}`)
  await act(async () => { await import('../../../../worker/src/client/main') })
  await waitFor(() => expect(document.getElementById('app')!.textContent).not.toBe(''), { timeout: 10000 })
}
function operation(path: string) { return writes.filter(w => w.path === path) }
function sameRetry(path: string) {
  const calls = operation(path)
  expect(calls).toHaveLength(2)
  expect(calls[0].options.body).toBe(calls[1].options.body)
  expect(new Headers(calls[0].options.headers).get('Idempotency-Key')).toBeTruthy()
  expect(new Headers(calls[0].options.headers).get('Idempotency-Key')).toBe(new Headers(calls[1].options.headers).get('Idempotency-Key'))
}
it('通常フォーム入口で条件・満杯制御・失敗後の入力と再試行を保つ', async () => {
  await open('page=form&id=f')
  await screen.findByText(/受付上限まで残り2件/)
  expect(screen.getByText(/お一人さま1回/)).toBeTruthy()
  expect((screen.getByRole('radio', { name: /A/ }) as HTMLInputElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('radio', { name: /B/ }))
  fireEvent.click(screen.getByRole('button', { name: '送信する' }))
  await screen.findByText(/送信に失敗|offline/)
  expect((screen.getByRole('radio', { name: /B/ }) as HTMLInputElement).checked).toBe(true)
  failSubmit = false
  fireEvent.click(screen.getByRole('button', { name: /送信する|再送信/ }))
  await waitFor(() => expect(operation('/api/forms/f/submit')).toHaveLength(2))
  sameRetry('/api/forms/f/submit')
  expect(new Headers(operation('/api/forms/f/submit')[0].options.headers).get('Authorization')).toBe(`Bearer ${sdk.getIDToken()}`)
  expect(window.location.search).toContain('liffId=fixture')
})
it('受付終了した通常フォーム入口から送らない', async () => {
  accepting = false; await open('page=form&id=f')
  await screen.findByText('締め切りました')
  expect((screen.getByRole('button', { name: '送信する' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.submit(document.getElementById('liff-form')!)
  expect(operation('/api/forms/f/submit')).toHaveLength(0)
})
it('予約入口から質問・409・同じ入力の再試行まで届く', async () => {
  await open('page=salon-book&menu_id=m')
  fireEvent.click(await screen.findByRole('button', { name: /担当者/ }))
  fireEvent.click(await screen.findByRole('button', { name: /10:00/ }))
  const input = await screen.findByLabelText('事前の質問')
  fireEvent.change(input, { target: { value: '試験の回答' } })
  fireEvent.click(screen.getByRole('button', { name: '予約をリクエスト' }))
  await screen.findByText(/他の方の予約と重なりました/)
  expect((input as HTMLTextAreaElement).value).toBe('試験の回答')
  failSubmit = false; fireEvent.click(screen.getByRole('button', { name: '予約をリクエスト' }))
  await waitFor(() => expect(operation('/api/liff/booking/requests')).toHaveLength(2))
  sameRetry('/api/liff/booking/requests')
  expect(new Headers(operation('/api/liff/booking/requests')[0].options.headers).get('Authorization')).toBe(`Bearer ${sdk.getIDToken()}`)
  expect(window.location.search).toContain('page=salon-book')
})
it('予約履歴の実入口にサーバーの期限が届く', async () => {
  await open('page=salon-book&view=history'); await screen.findByText(/キャンセル期限：/)
  expect(window.location.search).toContain('view=history')
})
it('紹介の実入口から交換の失敗・再試行が同じ本人と操作になる', async () => {
  await open('page=affiliate')
  const choose = await screen.findByRole('button', { name: '使い道を選ぶ' })
  await waitFor(() => expect((choose as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(choose)
  fireEvent.click(await screen.findByRole('button', { name: 'これを選ぶ' }))
  fireEvent.click(screen.getByRole('button', { name: '交換する' }))
  await screen.findByText('試験の交換失敗')
  failSubmit = false; fireEvent.click(screen.getByRole('button', { name: '交換する' }))
  await screen.findByText('試験の特典に交換しました')
  sameRetry('/api/liff/mileage/rewards/r/redeem')
  expect(JSON.parse(operation('/api/liff/mileage/rewards/r/redeem')[0].options.body as string).lineAccessToken).toBe('fixture-access-token')
})
it('紹介の実入口から振込先の保存失敗を入力を失わず再試行する', async () => {
  await open('page=affiliate')
  fireEvent.click(await screen.findByRole('button', { name: '振込先を編集する' }))
  fireEvent.change(screen.getByLabelText('口座番号'), { target: { value: '1230000' } })
  fireEvent.click(screen.getByRole('button', { name: '保存する' }))
  fireEvent.click(within(screen.getByRole('dialog', { name: '振込先を保存しますか？' })).getByRole('button', { name: '保存する' }))
  await screen.findByText('試験の保存失敗')
  expect((screen.getByLabelText('口座番号') as HTMLInputElement).value).toBe('1230000')
  failSubmit = false; fireEvent.click(screen.getByRole('button', { name: '保存する' }))
  fireEvent.click(within(screen.getByRole('dialog', { name: '振込先を保存しますか？' })).getByRole('button', { name: '保存する' }))
  await screen.findByText('振込先を保存しました')
  sameRetry('/api/liff/affiliate/bank')
  expect(JSON.parse(operation('/api/liff/affiliate/bank')[0].options.body as string)).toMatchObject({ expectedVersion: 1, lineAccessToken: 'fixture-access-token' })
})
