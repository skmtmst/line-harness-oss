// @vitest-environment happy-dom
/*
 * V6R-S3-f: URLのコピーに失敗したら、ブラウザの入力窓（prompt）ではなく、
 * 選んでコピーできる欄を画面の中に出す。
 */
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { EntryRoute } from '@line-crm/shared'

const fixture = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
      readonly code?: string,
    ) {
      super(message)
    }
  }
  return {
    ApiError,
    replace: vi.fn(),
    update: vi.fn(),
    fetchApi: vi.fn(),
    staffMe: vi.fn(),
  }
})

const route: EntryRoute = {
  id: 'route-1', refCode: 'shop-qr', genre: '店頭', name: '店頭QR',
  tagId: null, scenarioId: null, redirectUrl: null, poolId: null,
  introTemplateId: null, runAccountFriendAddScenarios: true, isActive: true,
  createdAt: '2026-09-01T09:00:00.000+09:00',
  updatedAt: '2026-09-01T09:00:00.000+09:00',
}

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: fixture.replace }),
  useSearchParams: () => new URLSearchParams('id=route-1'),
}))

vi.mock('@/lib/api', () => ({
  ApiError: fixture.ApiError,
  fetchApi: fixture.fetchApi,
  api: {
    entryRoutes: {
      list: async () => ({ success: true, data: [route] }),
      get: async () => ({ success: true, data: route }),
      funnel: async () => ({
        success: true,
        data: { click_count: 0, friend_add_count: 0, form_submission_count: 0, cv_count: 0 },
      }),
      update: fixture.update,
    },
    tags: { list: async () => ({ success: true, data: [] }) },
    scenarios: { list: async () => ({ success: true, data: [] }) },
    pools: { list: async () => ({ success: true, data: [] }) },
    templates: { list: async () => ({ success: true, data: [] }) },
    staff: { me: fixture.staffMe },
  },
}))

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { default: InflowLinkDetailPage } = await import('./page')

beforeEach(() => {
  fixture.staffMe.mockReset().mockResolvedValue({ success: true, data: { role: 'owner' } })
  fixture.fetchApi.mockReset().mockImplementation(async () => ({ success: true, data: { friends: [] } }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('流入経路のURLコピーに失敗したとき（V6R-S3-f）', () => {
  it('入力窓は出さず、選んでコピーできる欄と一言を出す', async () => {
    const promptSpy = vi.fn()
    vi.stubGlobal('prompt', promptSpy)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => { throw new Error('denied') }) },
    })
    render(<InflowLinkDetailPage />)
    const button = await screen.findByRole('button', { name: 'URLをコピー' })
    await act(async () => { fireEvent.click(button) })

    const alerts = await screen.findAllByRole('alert')
    const alert = alerts.find((node) => node.textContent?.includes('コピーできませんでした'))
    if (!alert) throw new Error('コピー失敗の知らせが出ていません')
    const field = within(alert).getByLabelText('流入経路のURL') as HTMLInputElement
    expect(field.value).toContain('/r/shop-qr')
    expect(field.readOnly).toBe(true)
    expect(promptSpy).not.toHaveBeenCalled()
  })

  it('コピーできたときは欄を出さない', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => undefined) },
    })
    render(<InflowLinkDetailPage />)
    const button = await screen.findByRole('button', { name: 'URLをコピー' })
    await act(async () => { fireEvent.click(button) })

    expect(await screen.findByRole('button', { name: 'コピーしました' })).toBeTruthy()
    expect(screen.queryByLabelText('流入経路のURL')).toBeNull()
  })
})
