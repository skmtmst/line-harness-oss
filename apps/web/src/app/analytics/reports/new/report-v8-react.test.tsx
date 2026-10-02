// @vitest-environment happy-dom
/*
 * 分析レポート作成の V8（板 H5UoIu）。
 *
 * V8 テーマ（<html data-theme="v8">）のときだけ V8 の頭・右欄を出し、
 * v7 の画素は変えない。既存の v7 試験はそのまま通す。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined }),
  useSearchParams: () => ({ get: () => null }),
  usePathname: () => '/analytics/reports/new',
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => undefined,
  usePageChrome: () => ({ title: null, fullWidth: false }),
}))

const OPTIONS = {
  timeZone: 'Asia/Tokyo',
  savedAnalyses: [],
  recipients: [{ id: 'u-1', name: '担当1', role: 'owner', email: 'u1@example.com', lineLinked: true }],
}

function installFetch() {
  vi.stubGlobal('fetch', async (input: unknown) => {
    const raw = typeof input === 'string' ? input : String(input)
    const url = new URL(raw.startsWith('http') ? raw : `https://worker.example.com${raw}`)
    if (url.pathname === '/api/staff/me') {
      return new Response(JSON.stringify({ success: true, data: { role: 'owner' } }), { status: 200 })
    }
    if (url.pathname.startsWith('/api/analytics/report-schedules')) {
      return new Response(JSON.stringify({ success: true, data: { items: [], options: OPTIONS } }), { status: 200 })
    }
    return new Response(JSON.stringify({ success: false, error: '未設定' }), { status: 500 })
  })
}

import AnalyticsReportNewPage from './page'

let container: HTMLDivElement
let root: Root

async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<AnalyticsReportNewPage />) })
}

async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {})
  }
}

function buttonByText(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (b) => (b.textContent ?? '').trim() === text,
  )
  if (!found) throw new Error(`「${text}」のボタンが見つかりません`)
  return found as HTMLButtonElement
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  installFetch()
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  delete document.documentElement.dataset.theme
  vi.unstubAllGlobals()
})

describe('V8 レポート作成（H5UoIu）', () => {
  it('板ID・題・必須・右欄の見本を出す', async () => {
    await mount()
    await settle()
    const framed = container.querySelector('[data-design-node="H5UoIu"]')
    expect(framed).toBeTruthy()
    expect(container.textContent).toContain('レポートを作る')
    expect(container.textContent).toContain('見たい数をまとめて')
    // 配信先・頻度は必須
    expect(container.textContent).toContain('必須')
    // 右欄の見本（作り物の数値は入れない）
    expect(container.textContent).toContain('こう届きます')
    expect(container.textContent).toContain('レポートが見ているもの')
    expect(container.textContent).toContain('数は送る時刻の時点で集めます')
    expect(container.textContent).toContain('宛先がブロックしていると、LINEでは届きません')
  })

  it('名前が空のまま押すと欄の下に文が出る', async () => {
    await mount()
    await settle()
    const nameField = container.querySelector('input[placeholder="例: 週次まとめ"]') as HTMLInputElement | null
    if (!nameField) throw new Error('名前の入力が見つかりません')
    await act(async () => { fireEvent.change(nameField, { target: { value: '' } }) })
    // 宛先を選んで保存できる形にする
    const person = [...container.querySelectorAll('input[type="checkbox"]')].find(
      (item) => !(item as HTMLInputElement).disabled && item.closest('label')?.textContent?.includes('担当1'),
    ) as HTMLInputElement | undefined
    if (!person) throw new Error('宛先が見つかりません')
    await act(async () => { fireEvent.click(person) })
    await click(buttonByText('つくって動かす'))
    await settle()
    expect(container.textContent).toContain('レポートの名前を入力してください')
  })
})
