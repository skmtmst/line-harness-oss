// @vitest-environment happy-dom
/*
 * V8 成果地点を作る（src/v8/conversions/create.tsx）の動きの試験。BEHAVIOR.md の主な動きを守る。
 * 同じ名前の成果地点があると競合の帯（cXqlS）と「比べてから保存」・保存が 409 で返ったときも帯・
 * 送る形（使う場所は種類の行のチェックで全部）・閲覧のみは保存ボタンを置かない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const role = vi.hoisted(() => ({ value: 'owner' as string | null }))
const query = vi.hoisted(() => ({ value: '' }))
const push = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => '/conversions/new',
  useSearchParams: () => new URLSearchParams(query.value),
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href, ...rest }, children),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: { id: 'account-a', name: '本店' }, accounts: [], loading: false }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
}))

vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => role.value }
})

import ConversionCreateV8 from './create'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const posted: Array<Record<string, unknown>> = []
let createStatus = 200

let root: Root
let host: HTMLDivElement

async function flush() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => { await Promise.resolve() })
  }
}

async function mount() {
  await act(async () => { root.render(<ConversionCreateV8 />) })
  await flush()
}

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  role.value = 'owner'
  query.value = ''
  push.mockReset()
  posted.length = 0
  createStatus = 200
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    if (url.pathname === '/api/conversions/points') {
      return json({ success: true, data: [{ id: 'cp-1', name: '商品を買った', eventType: 'ec_order_confirmed', value: null, lineAccountId: null, version: 1, createdAt: '' }] })
    }
    if (method === 'POST' && url.pathname === '/api/conversions/definitions') {
      posted.push(JSON.parse(String(init?.body ?? '{}')))
      if (createStatus === 409) return json({ success: false, error: '同じ名前の成果地点があります' }, 409)
      return json({ success: true, data: { id: 'cp-new' } })
    }
    if (url.pathname.endsWith('/api/automations')) {
      return json({ success: true, data: [{ id: 'auto-1', name: '初回注文をSlackへ知らせる', versionId: 'v1' }, { id: 'auto-2', name: '体験申込のフォロー', versionId: 'v2' }] })
    }
    return json({ success: true, data: [] })
  })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  delete document.documentElement.dataset.theme
})

const nameInput = () => screen.getByLabelText('成果地点の名前') as HTMLInputElement

describe('V8 成果地点を作る', () => {
  it('?name= で同じ名前の成果地点があると、競合の帯と「比べてから保存」を出す（cXqlS）', async () => {
    query.value = 'name=商品を買った'
    await mount()
    expect(nameInput().value).toBe('商品を買った')
    expect(screen.getByRole('alert').textContent).toContain('同じ名前の「商品を買った」がすでにあります')
    expect(screen.getByRole('link', { name: /違いを比べる/ }).getAttribute('href')).toBe('/conversions?tab=points&highlight=cp-1')
    expect(screen.getByRole('link', { name: /比べてから保存/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /保存して数えはじめる/ })).toBeNull()
  })

  it('保存が 409 で返ったら、上書きせずに帯を出す', async () => {
    createStatus = 409
    await mount()
    fireEvent.change(nameInput(), { target: { value: '定期便を始めた' } })
    await flush()
    fireEvent.click(screen.getByRole('button', { name: /保存して数えはじめる/ }))
    await flush()
    expect(posted).toHaveLength(1)
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('ほかの人が「定期便を始めた」を先に保存しました')
  })

  it('種類の行のチェックで、その種類の候補を全部「使う場所」として送り、一覧の作った行へ戻る', async () => {
    await mount()
    fireEvent.change(nameInput(), { target: { value: '定期便を始めた' } })
    fireEvent.click(screen.getByRole('checkbox', { name: '自動化（オートメーション）' }))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: /保存して数えはじめる/ }))
    await flush()
    expect(posted[0].name).toBe('定期便を始めた')
    expect(posted[0].usages).toEqual([
      { refKind: 'automation', refId: 'auto-1', refVersionId: 'v1' },
      { refKind: 'automation', refId: 'auto-2', refVersionId: 'v2' },
    ])
    expect(push).toHaveBeenCalledWith('/conversions?tab=points&highlight=cp-new')
  })

  it('閲覧のみ：帯を出し、保存のボタン・使う場所を足すは置かない', async () => {
    role.value = 'staff'
    await mount()
    expect(screen.getByText('閲覧のみで見ています。作る操作は管理者に頼んでください。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /保存して/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /使う場所を足す/ })).toBeNull()
    expect(screen.getByRole('link', { name: '一覧へ戻る' })).toBeTruthy()
    // 押せない入力の欄も置かない（作る画面なので帯だけ）
    expect(screen.queryByLabelText('成果地点の名前')).toBeNull()
  })
})
