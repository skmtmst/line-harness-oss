// @vitest-environment happy-dom
/*
 * NEN ペット・健康日記の骨組み（サクサク感 A）。
 * V8 のときだけ、読み始め0.3秒を超えたら見出し付き5行の骨組みを出す。
 * v7 は従来の読み込み表示のまま。「読み込み中」の文言は V8 に出さない。
 */
import React, { act } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ me: vi.fn(), pets: vi.fn(), health: vi.fn() }))

vi.mock('@/lib/api', () => ({
  ApiError: class extends Error {
    status?: number
  },
  api: { staff: { me: (...args: unknown[]) => api.me(...args) } },
}))
vi.mock('@/lib/nen-pets-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/nen-pets-api')>()
  return {
    ...actual,
    nenPetsApi: {
      ...actual.nenPetsApi,
      pets: (...args: unknown[]) => api.pets(...args),
      health: (...args: unknown[]) => api.health(...args),
    },
  }
})
vi.mock('../pets/pet-editor', () => ({ default: () => null }))

import PetsTab from '../pets/pets-tab'
import HealthTab from './health-tab'
import SummaryDrawer from './summary-drawer'
import type { PetsQuery } from '../pets/pets-tab'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })
const query: PetsQuery = { q: '', species: '', product: '', weight: '', sort: 'updated_desc' }

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  api.me.mockResolvedValue({ success: true, data: { role: 'owner' } })
  api.pets.mockReturnValue(new Promise(() => {}))
  api.health.mockReturnValue(new Promise(() => {}))
  document.documentElement.dataset.theme = 'v8'
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  delete document.documentElement.dataset.theme
})

describe('ペット・健康日記V8の骨組み', () => {
  it('ペット一覧は見出し10列・5行の骨組みを出す', async () => {
    render(<PetsTab accountId="acc-1" query={query} onQueryChange={() => {}} onTotal={() => {}} />)
    await flush()
    expect(document.querySelector('[data-skeleton]')).toBeNull()
    await act(async () => { vi.advanceTimersByTime(350) })
    const busy = document.querySelector('[aria-busy="true"][aria-label="ペットを読み込んでいます"]')
    expect(busy, '表の骨組みの入れ物').toBeTruthy()
    const table = busy?.querySelector('table')
    expect(table?.querySelectorAll('thead th').length).toBe(10)
    expect(table?.querySelectorAll('tbody tr').length).toBe(5)
    expect(document.body.textContent).not.toContain('読み込み中')
  })

  it('健康日記は見出し8列・5行の骨組みを出す', async () => {
    render(<HealthTab accountId="acc-1" concernOnly={false} onKpis={() => {}} onOpenSummary={() => {}} />)
    await flush()
    await act(async () => { vi.advanceTimersByTime(350) })
    const busy = document.querySelector('[aria-busy="true"][aria-label="健康日記を読み込んでいます"]')
    expect(busy, '表の骨組みの入れ物').toBeTruthy()
    const table = busy?.querySelector('table')
    expect(table?.querySelectorAll('thead th').length).toBe(8)
    expect(table?.querySelectorAll('tbody tr').length).toBe(5)
    expect(document.body.textContent).not.toContain('読み込み中')
  })

  it('v7 は従来の読み込み表示のまま', async () => {
    delete document.documentElement.dataset.theme
    render(<PetsTab accountId="acc-1" query={query} onQueryChange={() => {}} onTotal={() => {}} />)
    await flush()
    await act(async () => { vi.advanceTimersByTime(350) })
    expect(document.querySelector('[aria-busy="true"][aria-label="ペットを読み込んでいます"]')).toBeNull()
    expect(document.body.textContent).toContain('ペットを読み込んでいます')
  })

  it('まとめの引き出しは数の帯と段の骨組みを出す', async () => {
    render(<SummaryDrawer open status="loading" summary={null} onClose={() => {}} onRetry={() => {}} onPrint={() => {}} />)
    await flush()
    await act(async () => { vi.advanceTimersByTime(350) })
    const busy = document.querySelector('[aria-busy="true"][aria-label="まとめを作っています"]')
    expect(busy, '骨組みの入れ物').toBeTruthy()
    expect(busy?.querySelector('[data-skeleton]'), '骨組みがある').toBeTruthy()
    expect(document.body.textContent).not.toContain('読み込み中')
  })
})
