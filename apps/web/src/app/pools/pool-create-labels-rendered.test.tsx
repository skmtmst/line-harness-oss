// @vitest-environment happy-dom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/staff-role', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/staff-role')>()), useStaffRole: () => 'owner' }))

let PoolsPage: typeof import('./new/page').default

beforeAll(async () => {
  process.env.NEXT_PUBLIC_API_URL = 'https://worker.example.com'
  ;({ default: PoolsPage } = await import('./new/page'))
})

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async () => (
    new Response(JSON.stringify({ success: true, data: [] }), { status: 200 })
  )))
}

async function openCreateModal() {
  stubFetch()
  const view = render(<PoolsPage />)
  await waitFor(() => expect(view.getByLabelText('プール名')).toBeTruthy())
  return view
}

describe('新規プール窓のラベルの結び付き (R617)', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('URL名の入力欄は見える項目名ラベルと結び付いている', async () => {
    const view = await openCreateModal()
    const input = view.getByLabelText('URLに使う名前（あとから変えられません）') as HTMLInputElement
    expect(input.tagName).toBe('INPUT')
    // 実ブラウザの input.labels と同じ向き：結び付いたlabelが1つある。
    expect(input.labels?.length ?? 0).toBeGreaterThanOrEqual(1)
    expect(input.id).toBe('pl-slug')
    expect(view.container.querySelector('label[for="pl-slug"]')?.textContent).toBe('URLに使う名前（あとから変えられません）')
  })

  it('URL名の説明はlabelの外にあり、入力欄の名前を汚さない', async () => {
    const view = await openCreateModal()
    const label = view.container.querySelector('label[for="pl-slug"]')
    expect(label, 'slugのlabelがない').toBeTruthy()
    // 実ブラウザではlabelの中の最初のラベル可能要素（button）へ結び付く
    // ため、labelの中にbuttonがあると入力欄の結び付きが外れる。
    expect(label?.querySelector('button'), 'HelpTipがlabelの中にある').toBeNull()
    const tip = view.getByRole('button', { name: 'URLに使う名前（あとから変えられません）の説明' })
    expect(tip).toBeTruthy()
    expect(label?.contains(tip)).toBe(false)
  })

  it('プール名の入力欄は見える項目名ラベルと結び付いている', async () => {
    const view = await openCreateModal()
    const input = view.getByLabelText('プール名') as HTMLInputElement
    expect(input.tagName).toBe('INPUT')
    expect(input.labels?.length ?? 0).toBeGreaterThanOrEqual(1)
    expect(input.id).toBe('pl-name')
  })

  it('入力例のplaceholderは残す', async () => {
    const view = await openCreateModal()
    expect(view.getByPlaceholderText('shibuya')).toBeTruthy()
    expect(view.getByPlaceholderText('例：渋谷エリア')).toBeTruthy()
  })
})

vi.mock('@/components/layout/settings-inner-nav', () => ({ default: () => null }))
vi.mock('@/lib/staff-role', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/staff-role')>()), useStaffRole: () => 'owner' }))
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
vi.mock('@/components/shell/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())
