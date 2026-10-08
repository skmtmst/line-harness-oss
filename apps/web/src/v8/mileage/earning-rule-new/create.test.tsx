// @vitest-environment happy-dom
/*
 * V8 たまる決めごとを作る（src/v8/mileage/earning-rule-new/create.tsx）の動きの試験。BEHAVIOR.md の主な動きを守る。
 * 足りない入力は保存しない・保存は 作る→下書き の順・下書きが 409 で返ると競合の帯（BnrQp）・保存して動かすで一覧へ戻る。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const push = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => '/mileage/earning-rules/new',
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href, ...rest }, children),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: { id: 'account-a', name: '然-NEN-TEST' }, accounts: [], loading: false }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
}))

import EarningRuleCreateV8 from './create'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const calls: Array<{ method: string; path: string; body: Record<string, unknown> | null }> = []
let draftStatus = 200

let root: Root
let host: HTMLDivElement

async function flush() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => { await Promise.resolve() })
  }
}

async function mount() {
  await act(async () => { root.render(<EarningRuleCreateV8 />) })
  await flush()
}

function type(label: string, value: string) {
  const field = screen.getByLabelText(label) as HTMLInputElement
  fireEvent.change(field, { target: { value } })
}

async function clickButton(name: string) {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name })) })
  await flush()
}

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  push.mockReset()
  calls.length = 0
  draftStatus = 200
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null
    calls.push({ method, path: url.pathname, body })
    if (url.pathname === '/api/tags') return json({ success: true, data: [] })
    if (method === 'POST' && url.pathname === '/api/mileage/rules') return json({ success: true, data: { id: 'rule-new' } })
    if (method === 'PATCH' && url.pathname === '/api/mileage/earning-rules/rule-new/draft') {
      return draftStatus === 409
        ? json({ success: false, error: 'ほかの人が先に保存しました', code: 'VERSION_CONFLICT', data: { updatedByName: '坂本', updatedAt: '2026-10-07T05:02:00.000Z' } }, 409)
        : json({ success: true, data: { ruleId: 'rule-new', lineAccountId: 'account-a', version: 1, draft: {}, updatedAt: '2026-10-07T05:02:00.000Z' } })
    }
    return json({ success: true, data: [] })
  })
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
})

describe('V8 たまる決めごとを作る', () => {
  it('名前が無いときは保存の口を呼ばず、足りない所を知らせる', async () => {
    await mount()
    await clickButton('保存して動かす')
    expect(screen.getByText('ルール名を入力してください')).toBeTruthy()
    const name = screen.getByLabelText('名前')
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getAllByText('ルール名を入力してください')).toHaveLength(1)
    await waitFor(() => expect(document.activeElement).toBe(name))
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
  })

  it('畳まれた有効期限に誤りがあれば、開いてその欄へ移り、保存しない', async () => {
    await mount()
    type('名前', 'リンクをクリック')
    type('マイル', '10')
    type('有効期限の日数', '0')
    await clickButton('保存して動かす')
    const expiry = screen.getByLabelText('有効期限の日数')
    await waitFor(() => expect(document.activeElement).toBe(expiry))
    expect(expiry.closest('details')?.open).toBe(true)
    expect(expiry.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getAllByText('有効期限は1〜3650日で入力してください')).toHaveLength(1)
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
  })

  it('保存して動かすは、作る→下書きの順に送って一覧へ戻る', async () => {
    await mount()
    type('名前', 'リンクをクリック')
    type('マイル', '10')
    await clickButton('保存して動かす')
    const writes = calls.filter((call) => call.method !== 'GET')
    expect(writes.map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST /api/mileage/rules',
      'PATCH /api/mileage/earning-rules/rule-new/draft',
    ])
    expect(writes[0].body).toMatchObject({ name: 'リンクをクリック', amount: 10, lineAccountId: 'account-a', initialStatus: 'available' })
    expect(writes[1].body).toMatchObject({ accountId: 'account-a', expectedVersion: 0 })
    expect(push).toHaveBeenCalledWith('/mileage?tab=earning-rules')
    expect(document.querySelector('[data-design-node="BnrQp"]')).toBeNull()
  })

  it('下書きの保存が 409 で返ると、だれが保存したかを競合の帯（BnrQp）で知らせ、一覧へは戻らない', async () => {
    draftStatus = 409
    await mount()
    type('名前', 'リンクをクリック')
    type('マイル', '10')
    await clickButton('保存して動かす')
    const band = screen.getByRole('alert', { name: 'ほかの人が先に保存しました' })
    expect(band.textContent).toContain('坂本さんが 14:02 にこの決めごとを保存しました')
    expect(band.textContent).toContain('このまま保存すると、坂本さんの変更が消えます')
    expect(document.querySelector('[data-design-node="BnrQp"]')).toBeTruthy()
    expect(push).not.toHaveBeenCalled()
  })
})
