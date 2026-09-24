// @vitest-environment happy-dom
/*
 * 全ルート監査 A2（2026-09-25）: `/nen/pets` が
 * 「ペットを読み込めませんでした」になっていた。原因は一覧の口が
 * 既定の器（`{items,…}`）で返り、`kpis.total` が取れなかったこと。
 * 本物の器（`{items,total,page,pageSize,kpis,…}`）で一覧が出る。
 */
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ me: vi.fn(), pets: vi.fn() }))

vi.mock('@/lib/api', () => ({
  ApiError: class extends Error {
    status?: number
  },
  api: { staff: { me: (...args: unknown[]) => api.me(...args) } },
}))
vi.mock('@/lib/nen-pets-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/nen-pets-api')>()
  return { ...actual, nenPetsApi: { ...actual.nenPetsApi, pets: (...args: unknown[]) => api.pets(...args) } }
})
vi.mock('./pet-editor', () => ({ default: () => null }))

import PetsTab from './pets-tab'
import type { PetsQuery } from './pets-tab'

const query: PetsQuery = { q: '', species: '', product: '', weight: '', sort: 'updated_desc' }
const flush = () => act(async () => { await Promise.resolve() })

beforeEach(() => {
  api.me.mockReset()
  api.pets.mockReset()
  api.me.mockResolvedValue({ success: true, data: { role: 'owner' } })
})
afterEach(cleanup)

const petList = {
  items: [
    {
      id: 'nen-pet-momo', name: 'もも', callName: 'ももちゃん', gender: 'female', animalType: 'dog',
      breed: 'トイ・プードル', birthday: '2022-09-02', ageLabel: '4歳', weightKg: 3.2,
      neutered: 'yes', activityLevel: 'normal', activityLabel: 'ふつう', productName: '鹿肉ミンチ',
      feeding: null, imageUrl: null, updatedAt: '2026-09-06T10:00:00+09:00', weightStale: false,
      owner: { friendId: 'friend-1', name: '高橋 直人', pictureUrl: null, customerId: 'customer-1' },
    },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
  kpis: { total: 1, dogs: 1, cats: 0, newThisMonth: 0, computable: 0, staleWeight: 0 },
  products: [],
  treatLimitPercent: 10,
}

describe('nen/pets の一覧', () => {
  it('本物の器で行が出て件数も出る', async () => {
    api.pets.mockResolvedValue({ success: true, data: petList })
    const onTotal = vi.fn()
    render(<PetsTab accountId="account-a" query={query} onQueryChange={() => undefined} onTotal={onTotal} />)
    await flush()
    expect((await screen.findAllByText('ももちゃん')).length).toBeGreaterThan(0)
    expect(onTotal).toHaveBeenCalledWith(1)
    expect(screen.queryByText('ペットを読み込めませんでした')).toBeNull()
  })

  it('旧偽APIの器では読み込み失敗になる', async () => {
    api.pets.mockResolvedValue({ success: true, data: { items: [], total: 0, page: 1, limit: 20 } })
    render(<PetsTab accountId="account-a" query={query} onQueryChange={() => undefined} onTotal={() => undefined} />)
    await flush()
    expect(await screen.findByText('ペットを読み込めませんでした')).toBeTruthy()
  })
})
