// @vitest-environment happy-dom
/*
 * V8 流入と計測の一覧（src/v8）の動きの試験。BEHAVIOR.md の主な動きを守る。
 * 行の「…」から QR コードの小窓（GtI4Y）が開く・停止中の行は URL を出さない・
 * 閲覧のみは作る／編集を出さない・未登録 ref は「登録する」・数の帯の未設定の数。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => '/inflow-links',
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: null, accounts: [], loading: false }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
}))

const role = vi.hoisted(() => ({ value: 'owner' as string | null }))
vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => role.value }
})

import InflowListV8 from './list'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const route = (overrides: Record<string, unknown>) => ({
  id: 'er-1', refCode: 'summer-ig', genre: 'SNS', name: '夏のInstagram投稿', tagId: 'tag-1', scenarioId: null,
  redirectUrl: null, poolId: null, introTemplateId: null, runAccountFriendAddScenarios: true, isActive: true,
  stoppedAt: null, stoppedReason: null, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
  ...overrides,
})

const ROUTES = [
  route({}),
  route({ id: 'er-6', refCode: 'flyer-26s', genre: null, name: 'チラシ計測リンク', tagId: null, isActive: false }),
  route({ id: 'er-4', refCode: 'ad-summer', genre: '広告', name: 'Google広告 夏キャンペーン', tagId: null }),
]
const SUMMARY = {
  routes: [
    { refCode: 'summer-ig', name: '夏のInstagram投稿', friendCount: 31, clickCount: 880, latestAt: '2026-09-30T09:40:00+09:00' },
    { refCode: 'mail-sign', name: 'メール署名', friendCount: 3, clickCount: 96, latestAt: '2026-09-26T11:02:00+09:00' },
  ],
  totalFriends: 115,
  friendsWithRef: 289,
  friendsWithoutRef: 23,
}

const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  role.value = 'owner'
  document.documentElement.dataset.theme = 'v8'
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    if (url.pathname === '/api/entry-routes') return json({ success: true, data: ROUTES })
    if (url.pathname === '/api/entry-route-genres') return json({ success: true, data: [{ id: 'g-1', name: 'SNS', createdAt: '', updatedAt: '' }] })
    if (url.pathname === '/api/analytics/ref-summary') return json({ success: true, data: SUMMARY })
    if (url.pathname === '/api/tracked-links') return json({ success: true, data: [] })
    if (url.pathname === '/api/tags') return json({ success: true, data: [{ id: 'tag-1', name: 'Instagram' }] })
    return json({ success: true, data: [] })
  })
})

afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute('data-theme')
})

async function render() {
  await act(async () => { root.render(<InflowListV8 />) })
  for (let i = 0; i < 4; i += 1) await act(async () => {})
}

const buttonByLabel = (label: string) =>
  [...document.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === label) as HTMLButtonElement | undefined
const rowOf = (refCode: string) => host.querySelector(`[data-row-id="${refCode}"]`)

describe('V8 流入と計測の一覧', () => {
  it('行の「…」から「QRコードを見る」を選ぶと、その経路の QR コードの小窓が開く', async () => {
    await render()
    const more = buttonByLabel('「夏のInstagram投稿」の操作')
    expect(more).toBeTruthy()
    await act(async () => { more!.click() })
    const qr = [...document.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent?.includes('QRコードを見る')) as HTMLElement
    expect(qr).toBeTruthy()
    await act(async () => { qr.click() })
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain('夏のInstagram投稿 の QR コード')
    expect(dialog?.textContent).toContain('/r/summer-ig')
    expect(dialog?.textContent).toContain('PNG を保存')
    expect(dialog?.textContent).toContain('印刷用 PDF')
  })

  it('停止中の行は URL をコピーさせず、「…」に QR を出さない（受付の再開は出す）', async () => {
    await render()
    const row = rowOf('flyer-26s')
    expect(row?.textContent).toContain('停止中')
    expect(buttonByLabel('チラシ計測リンクのURLをコピー')).toBeUndefined()
    await act(async () => { buttonByLabel('「チラシ計測リンク」の操作')!.click() })
    const labels = [...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent)
    expect(labels.some((text) => text?.includes('QRコード'))).toBe(false)
    expect(labels.some((text) => text?.includes('受付を再開する'))).toBe(true)
  })

  it('未登録の ref の行は「登録する」、登録済みは「編集」', async () => {
    await render()
    expect(rowOf('mail-sign')?.textContent).toContain('未登録')
    expect(rowOf('mail-sign')?.textContent).toContain('登録する')
    expect(buttonByLabel('夏のInstagram投稿のリンクを編集')).toBeTruthy()
  })

  it('数の帯の「動きが未設定」は、タグもシナリオも無い登録済みの数（停止中も含む）', async () => {
    await render()
    const chips = host.querySelector('[role="group"][aria-label="流入経路の絞り込み"]')
    expect(chips?.textContent).toContain('動きが未設定 2')
  })

  // 2026-10-06 オーナー決定：閲覧のみには押せないボタンを置かずに隠す（帯は出す）。
  it('閲覧のみ（staff）は帯を出し、作る・編集・チェックを出さない', async () => {
    role.value = 'staff'
    await render()
    expect(host.textContent).toContain('閲覧のみで見ています')
    const create = [...host.querySelectorAll('button')].filter((button) => button.textContent?.includes('流入リンクを作る'))
    expect(create).toHaveLength(0)
    expect(buttonByLabel('夏のInstagram投稿のリンクを編集')).toBeFalsy()
    expect(host.querySelector('[aria-label="夏のInstagram投稿をまとめて操作の対象にする"]')).toBeNull()
  })
})
