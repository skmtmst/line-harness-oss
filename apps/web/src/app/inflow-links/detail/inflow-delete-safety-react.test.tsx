// @vitest-environment happy-dom
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

async function mountAndOpen() {
  render(<InflowLinkDetailPage />)
  const opener = await screen.findByRole('button', { name: '店頭QRの削除を確認' })
  opener.focus()
  await act(async () => { fireEvent.click(opener) })
  const dialog = await screen.findByRole('dialog')
  return { opener, dialog }
}

beforeEach(() => {
  fixture.replace.mockReset()
  fixture.update.mockReset().mockResolvedValue({ success: true, data: { ...route, isActive: false } })
  fixture.fetchApi.mockReset().mockImplementation(async (path: string) => {
    if (path.startsWith('/api/analytics/ref/')) return { success: true, data: { friends: [] } }
    return { success: true }
  })
  fixture.staffMe.mockReset().mockResolvedValue({
    success: true,
    data: { role: 'owner' },
  })
})

afterEach(() => cleanup())

describe('流入経路の削除確認操作 (N-246/N-250 #906)', () => {
  it('既定は受付停止で、Escapeで閉じて起点ボタンへfocusを戻す', async () => {
    const { opener, dialog } = await mountAndOpen()
    expect(within(dialog).getByRole('button', { name: '受けるのをやめる' })).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(opener)
  })

  it('TabとShift+Tabを確認窓の先頭・末尾で循環させる', async () => {
    const { dialog } = await mountAndOpen()
    // UI-25: 右上の×が窓の先頭の操作要素になった。
    const first = within(dialog).getByRole('button', { name: '閉じる' })
    const last = within(dialog).getByRole('button', { name: '受けるのをやめる' })

    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(first)

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('完全削除は現在の経路名が正確に一致するまで実行できない', async () => {
    const { dialog } = await mountAndOpen()
    fireEvent.click(within(dialog).getByRole('button', { name: /このまま削除する/ }))
    const confirm = within(dialog).getByRole('button', { name: 'この経路を削除' }) as HTMLButtonElement
    const input = within(dialog).getByLabelText('完全削除するには「店頭QR」と入力')

    expect(confirm.disabled).toBe(true)
    fireEvent.change(input, { target: { value: '店頭ＱＲ' } })
    expect(confirm.disabled).toBe(true)
    fireEvent.change(input, { target: { value: '店頭QR' } })
    expect(confirm.disabled).toBe(false)

    await act(async () => { fireEvent.click(confirm) })
    expect(fixture.fetchApi).toHaveBeenCalledWith('/api/entry-routes/route-1', {
      method: 'DELETE',
      body: JSON.stringify({ confirmationName: '店頭QR' }),
    })
  })

  it('利用履歴ありの409を受付停止の案内として表示し、確認窓を残す', async () => {
    fixture.fetchApi.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/analytics/ref/')) return { success: true, data: { friends: [] } }
      throw new fixture.ApiError(
        409,
        '利用履歴がある経路は完全削除できません。受付停止を選んでください。',
        'ENTRY_ROUTE_IN_USE',
      )
    })
    const { dialog } = await mountAndOpen()
    fireEvent.click(within(dialog).getByRole('button', { name: /このまま削除する/ }))
    fireEvent.change(within(dialog).getByLabelText('完全削除するには「店頭QR」と入力'), {
      target: { value: '店頭QR' },
    })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'この経路を削除' }))
    })

    expect(await within(dialog).findByText(/利用履歴がある経路は完全削除できません/)).toBeTruthy()
    expect(screen.getByRole('dialog')).toBe(dialog)
    expect(fixture.replace).not.toHaveBeenCalled()
  })

  it('処理中はEscape・キャンセル・二度押しで確認窓を閉じない', async () => {
    let release: (() => void) | undefined
    fixture.update.mockImplementation(() => new Promise((resolve) => {
      release = () => resolve({ success: true, data: { ...route, isActive: false } })
    }))
    const { dialog } = await mountAndOpen()
    const apply = within(dialog).getByRole('button', { name: '受けるのをやめる' })
    await act(async () => { fireEvent.click(apply) })

    expect((within(dialog).getByRole('button', { name: 'キャンセル' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(apply)
    expect(screen.getByRole('dialog')).toBe(dialog)
    expect(fixture.update).toHaveBeenCalledTimes(1)

    await act(async () => { release?.() })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('staffは編集と受付停止を使えるが、完全削除は表示しない', async () => {
    fixture.staffMe.mockResolvedValue({
      success: true,
      data: { role: 'staff', permissionKeys: ['/inflow-links'] },
    })
    render(<InflowLinkDetailPage />)

    expect(await screen.findByRole('button', { name: 'この経路を編集' })).toBeTruthy()
    const opener = await screen.findByRole('button', { name: '店頭QRの受付停止を確認' })
    await act(async () => { fireEvent.click(opener) })
    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).queryByRole('button', { name: /このまま削除する/ })).toBeNull()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '受けるのをやめる' }))
    })
    expect(fixture.update).toHaveBeenCalledWith(route.id, { isActive: false })
    expect(fixture.fetchApi).not.toHaveBeenCalledWith(
      `/api/entry-routes/${route.id}`,
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})
