// @vitest-environment happy-dom
/*
 * V8 流入リンクを作る（src/v8/inflow-links/new/create.tsx）の動きの試験。BEHAVIOR.md の主な動きを守る。
 * ?name=・?ref= で入れて開ける・発行が 409 で返ると競合の帯（vWJEm）・「違いを比べる」は違う項目だけの窓（E14GFm）・
 * 「最新を取り込んで直す」で保存されている値を入力へ写す・発行の送る形。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const query = vi.hoisted(() => ({ value: '' }))
const push = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => '/inflow-links/new',
  useSearchParams: () => new URLSearchParams(query.value),
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

vi.mock('@/lib/pools-availability', () => ({ isPoolsFeatureAvailable: async () => false }))

import InflowCreateV8 from './create'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const posted: Array<Record<string, unknown>> = []
let createStatus = 200

const saved = {
  id: 'er-1', refCode: 'summer-ig', genre: 'SNS', name: '夏のInstagram投稿', tagId: 'tag-vip', scenarioId: null, redirectUrl: null, poolId: null,
  introTemplateId: null, runAccountFriendAddScenarios: true, isActive: true, stoppedAt: null, stoppedReason: null,
  createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-25T00:12:00.000Z',
}

let root: Root
let host: HTMLDivElement

async function flush() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => { await Promise.resolve() })
  }
}

async function mount() {
  await act(async () => { root.render(<InflowCreateV8 />) })
  await flush()
}

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  query.value = ''
  push.mockReset()
  posted.length = 0
  createStatus = 200
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    if (method === 'POST' && url.pathname === '/api/entry-routes') {
      posted.push(JSON.parse(String(init?.body ?? '{}')))
      if (createStatus === 409) return json({ success: false, error: 'このrefコードは既に使われています' }, 409)
      return json({ success: true, data: { ...saved, id: 'er-new' } })
    }
    if (url.pathname === '/api/entry-routes') return json({ success: true, data: [saved] })
    if (url.pathname === '/api/tags') return json({ success: true, data: [{ id: 'tag-vip', name: 'VIP', color: '#000', groupId: null }] })
    if (url.pathname === '/api/scenarios') return json({ success: true, data: { items: [], total: 0, limit: 200, sort: [] } })
    if (url.pathname === '/api/entry-route-genres') return json({ success: true, data: [{ name: 'SNS' }] })
    return json({ success: true, data: [] })
  })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  delete document.documentElement.dataset.theme
})

describe('V8 流入リンクを作る', () => {
  it('入力が不足すると最初の欄へ移り、欄ごとの理由を出し、発行しない', async () => {
    await mount()
    const scroll = vi.fn()
    const name = document.getElementById('ir-name') as HTMLInputElement
    name.scrollIntoView = scroll
    fireEvent.click(screen.getByRole('button', { name: /発行して URL を受け取る/ }))
    await flush()
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(name)
    expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
    expect(screen.getByText('リンク名を入力してください').id).toBe(name.getAttribute('aria-describedby'))
    expect(screen.getAllByRole('alert')).toHaveLength(2)
    expect(posted).toHaveLength(0)
    fireEvent.change(name, { target: { value: 'autumn' } })
    await flush()
    expect(name.getAttribute('aria-invalid')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: /発行して URL を受け取る/ }))
    await flush()
    expect(posted).toHaveLength(1)
  })

  it('?name=・?ref= で名前と見分けるための文字を入れて開き、見本の URL を出す', async () => {
    query.value = 'name=夏のInstagram投稿&ref=summer-ig'
    await mount()
    expect((document.getElementById('ir-name') as HTMLInputElement).value).toBe('夏のInstagram投稿')
    expect((document.getElementById('ir-ref') as HTMLInputElement).value).toBe('summer-ig')
    expect(screen.getByText(/\/r\/summer-ig$/)).toBeTruthy()
    expect(screen.getByText('発行するとできます')).toBeTruthy()
  })

  it('発行すると口へ送り、詳細へ進む', async () => {
    query.value = 'name=秋の店頭POP&ref=autumn-pop'
    await mount()
    fireEvent.click(screen.getByRole('button', { name: /発行して URL を受け取る/ }))
    await flush()
    expect(posted[0]).toMatchObject({ name: '秋の店頭POP', refCode: 'autumn-pop', lineAccountId: 'account-a', isActive: true, tagId: null })
    expect(push).toHaveBeenCalledWith('/inflow-links/detail?id=er-new')
  })

  it('409 で返ると競合の帯を出し、違いを比べる窓は違う項目だけを並べ、最新を取り込んで直すで入力へ写す', async () => {
    createStatus = 409
    query.value = 'name=夏のInstagram投稿&ref=summer-ig'
    await mount()
    fireEvent.click(screen.getByRole('button', { name: /発行して URL を受け取る/ }))
    await flush()
    expect(push).not.toHaveBeenCalled()
    const band = screen.getByRole('alert', { name: '文字が重複しています' })
    expect(band.textContent).toContain('「summer-ig」は')
    expect(screen.getByRole('button', { name: /比べてから保存/ })).toBeTruthy()
    fireEvent.click(within(band).getByRole('button', { name: /違いを比べる/ }))
    await flush()
    const dialog = screen.getByRole('dialog', { name: '違いを比べる' })
    const rows = Array.from(dialog.querySelectorAll('tbody th')).map((cell) => cell.textContent)
    expect(rows).toEqual(['フォルダ', '友だちになったら'])
    expect(dialog.textContent).toContain('タグ「VIP」')
    fireEvent.click(within(dialog).getByRole('button', { name: /最新を取り込んで直す/ }))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)) })
    await flush()
    expect(screen.queryByRole('dialog', { name: '違いを比べる' })).toBeNull()
    expect(screen.getByText('VIP')).toBeTruthy()
  })
})
