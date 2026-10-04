// @vitest-environment happy-dom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

let PoolsPage: typeof import('./page').default

beforeAll(async () => {
  process.env.NEXT_PUBLIC_API_URL = 'https://worker.example.com'
  ;({ default: PoolsPage } = await import('./page'))
})

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async () => (
    new Response(JSON.stringify({ success: true, data: [] }), { status: 200 })
  )))
}

async function openCreateModal() {
  stubFetch()
  const view = render(<PoolsPage />)
  await waitFor(() => expect(view.getByText('まだプールがありません')).toBeTruthy())
  fireEvent.click(view.getByText('新規プール'))
  await waitFor(() => expect(view.getByRole('dialog')).toBeTruthy())
  return view
}

describe('新規プール窓のラベルの結び付き (R617)', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('slugの入力欄は見える「slug」ラベルと結び付いている', async () => {
    const view = await openCreateModal()
    const input = view.getByLabelText('slug') as HTMLInputElement
    expect(input.tagName).toBe('INPUT')
    // 実ブラウザの input.labels と同じ向き：結び付いたlabelが1つある。
    expect(input.labels?.length ?? 0).toBeGreaterThanOrEqual(1)
    expect(input.id).toBe('create-pool-slug')
    expect(view.container.querySelector('label[for="create-pool-slug"]')?.textContent).toBe('slug')
  })

  it('slugのHelpTipはlabelの外にあり、入力欄の名前を汚さない', async () => {
    const view = await openCreateModal()
    const label = view.container.querySelector('label[for="create-pool-slug"]')
    expect(label, 'slugのlabelがない').toBeTruthy()
    // 実ブラウザではlabelの中の最初のラベル可能要素（button）へ結び付く
    // ため、labelの中にbuttonがあると入力欄の結び付きが外れる。
    expect(label?.querySelector('button'), 'HelpTipがlabelの中にある').toBeNull()
    const tip = view.getByRole('button', { name: 'slugの説明' })
    expect(tip).toBeTruthy()
    expect(label?.contains(tip)).toBe(false)
  })

  it('表示名の入力欄は見える「表示名」ラベルと結び付いている', async () => {
    const view = await openCreateModal()
    const input = view.getByLabelText('表示名') as HTMLInputElement
    expect(input.tagName).toBe('INPUT')
    expect(input.labels?.length ?? 0).toBeGreaterThanOrEqual(1)
    expect(input.id).toBe('create-pool-name')
  })

  it('入力例のplaceholderは残す', async () => {
    const view = await openCreateModal()
    expect(view.getByPlaceholderText('例: brand-a')).toBeTruthy()
    expect(view.getByPlaceholderText('例: ブランドA')).toBeTruthy()
  })
})
