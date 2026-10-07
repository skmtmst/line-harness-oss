// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import NewOperatorNotificationPage from './page'

/*
 * ★V8-B 運用者へのお知らせを作る（板 `gjUz3`、公開前の確認 `sDXNy`）の契約。
 * 新しい作成画面に切り替わり、3枚のカードと届き方の見本が出ること、
 * 公開の前に確認の窓が出て宛先と LINE の届く人数を確かめられること、
 * staff では閲覧のみの帯が出て保存の押し口が押せない形になることを
 * 実DOMで固定する。
 */
// 設定の中のメニュー（共通部品）はこの試験の対象外。localStorage と機能の出し分けを読むので外す。
vi.mock('@/components/layout/settings-inner-nav', () => ({ default: () => null }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
  usePathname: () => '/line-notifications/operator/new',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    selectedAccountId: 'account-a', selectedAccount: null, loading: false,
  }),
}))

const recipientsData = {
  items: [
    { id: 'sato', name: '佐藤直人', lineLinked: true, emailVerified: false, channels: { line: true, email: false, dashboard: true }, canReceive: true },
    { id: 'suzuki', name: '鈴木美咲', lineLinked: true, emailVerified: false, channels: { line: true, email: false, dashboard: true }, canReceive: true },
    { id: 'tanaka', name: '田中明子', lineLinked: false, emailVerified: false, channels: { line: false, email: false, dashboard: true }, canReceive: true },
  ],
  summary: { staff: 3, canReceive: 3, line: 2, email: 0, dashboard: 3, unavailable: 0 },
}

const response = (data: unknown, status = 200) => new Response(
  JSON.stringify(data),
  { status, headers: { 'Content-Type': 'application/json' } },
)

let root: Root | null = null
let host: HTMLDivElement | null = null

/* happy-dom に localStorage が無いときの小さな代替。役割の読み書きだけに使う。 */
function ensureStorage() {
  if (typeof window.localStorage !== 'undefined' && window.localStorage !== null) return
  const store = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => { store.set(key, String(value)) },
      removeItem: (key: string) => { store.delete(key) },
      clear: () => { store.clear() },
    },
  })
}

beforeEach(() => {
  ensureStorage()
  document.documentElement.dataset.theme = 'v8'
  window.localStorage.setItem('lh_staff_role', 'admin')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('recipients-preview')) {
      return response({ success: true, data: recipientsData })
    }
    if (url.includes('/api/line-notifications/operator-rules') && !url.includes('/publish')) {
      return response({ success: true, data: { id: 'rule-1', version: 1 } })
    }
    return response({ success: false, error: 'not mocked' }, 500)
  }))
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  host?.remove()
  root = null
  host = null
  document.documentElement.removeAttribute('data-theme')
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

async function renderPage() {
  await act(async () => {
    root?.render(<NewOperatorNotificationPage />)
  })
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

test('新しい作成画面（gjUz3）が出る', async () => {
  await renderPage()
  expect(host?.querySelector('[data-design-node="gjUz3"]')).not.toBeNull()
  expect(host?.textContent).toContain('どんなときに知らせるか')
  expect(host?.textContent).toContain('だれが受け取るか')
  expect(host?.textContent).toContain('お店の人にはこう届きます')
})

test('公開の前に確認の窓（sDXNy）で宛先と届く人数を確かめる', async () => {
  await renderPage()
  const publishButton = Array.from(host?.querySelectorAll('button') ?? [])
    .find((button) => button.textContent?.includes('運用者へのお知らせを公開'))
  expect(publishButton).toBeDefined()
  await act(async () => {
    ;(publishButton as HTMLButtonElement | undefined)?.click()
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  })
  /* 確認の窓は body 直下に出る（ポータル）。 */
  expect(document.body.textContent).toContain('このお知らせを公開しますか？')
  expect(document.body.textContent).toContain('LINEが届く人')
  const confirmButton = Array.from(document.body.querySelectorAll('button'))
    .find((button) => button.textContent?.includes('人にLINEで送る'))
  expect(confirmButton).toBeDefined()
  expect(confirmButton?.textContent).toContain('2人')
})

test('staff では閲覧のみの帯が出て、保存・公開・テスト送信のボタンは置かない（2026-10-06 オーナー決定）', async () => {
  window.localStorage.setItem('lh_staff_role', 'staff')
  await renderPage()
  expect(host?.textContent).toContain('閲覧のみで見ています')
  const labels = Array.from(host?.querySelectorAll('button') ?? []).map((button) => button.textContent ?? '')
  expect(labels.some((label) => label.includes('運用者へのお知らせを公開'))).toBe(false)
  expect(labels.some((label) => label.includes('下書きを保存'))).toBe(false)
  expect(labels.some((label) => label.includes('テストを送る'))).toBe(false)
  // やめる道は残す。
  expect(Array.from(host?.querySelectorAll('a') ?? []).some((a) => a.textContent === 'キャンセル')).toBe(true)
})


test('選んだスタッフでチームを作り、保存する通知の条件へチームIDを渡す', async () => {
  const saved: Array<{url:string;body:Record<string,unknown>}> = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('recipients-preview')) return response({success:true,data:recipientsData})
    if (url.includes('/api/notifications/teams')) {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)); saved.push({url,body})
        return response({success:true,data:{id:'team-1',lineAccountId:'account-a',name:body.name,staffIds:body.staffIds,version:1,archivedAt:null}})
      }
      return response({success:true,data:[]})
    }
    saved.push({url,body:JSON.parse(String(init?.body))})
    return response({success:true,data:{id:'rule-1',version:1}})
  }))
  await renderPage()
  // チームを作る欄は絵に無いので、受け取るスタッフの箱の右上から開く。
  expect(host!.querySelector('[aria-label="チーム名"]')).toBeNull()
  await act(async () => { Array.from(host!.querySelectorAll('button')).find(button=>button.textContent==='この顔ぶれをチームにする…')!.click() })
  const input = host!.querySelector<HTMLInputElement>('[aria-label="チーム名"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'対応チーム')
    input.dispatchEvent(new Event('input',{bubbles:true}))
  })
  await act(async () => { Array.from(host!.querySelectorAll('button')).find(button=>button.textContent==='チームを作る')!.click() })
  expect(saved[0].body).toMatchObject({name:'対応チーム',staffIds:['sato','suzuki','tanaka']})
  await act(async () => { Array.from(host!.querySelectorAll('button')).find(button=>button.textContent?.includes('下書き'))!.click() })
  expect(saved.at(-1)?.body).toMatchObject({conditions:{teamId:'team-1',recipientType:'team'}})
})
