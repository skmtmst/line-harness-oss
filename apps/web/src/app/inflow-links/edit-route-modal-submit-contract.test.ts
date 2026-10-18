// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { EntryRoute } from '@line-crm/shared'
import { ApiError } from '@/lib/api'
import EditRouteModal from '@/v8/inflow-links/edit-route-dialog'

const net = vi.hoisted(() => ({ update: vi.fn(), create: vi.fn(), saved: vi.fn() }))
vi.mock('@/lib/api', async original => {
  const real = await original<typeof import('@/lib/api')>()
  return { ...real, api: { ...real.api, entryRoutes: { ...real.api.entryRoutes, update: net.update, create: net.create } } }
})
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
const route = { id: 'route-1', refCode: 'route1', name: '経路の名前', runAccountFriendAddScenarios: true, updatedAt: '2026-10-18T00:00:00Z' } as EntryRoute
let root: Root
let host: HTMLDivElement
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  net.update.mockReset(); net.create.mockReset(); net.saved.mockReset()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
async function mount(editing: EntryRoute | null) {
  await act(async () => { root.render(React.createElement(EditRouteModal, { surface: 'inline', route: editing, pools: [], scenarios: [], templates: [], tags: [], existingGenres: [], poolMemberNames: {}, accountId: 'account-a', onClose: () => {}, onSaved: net.saved })) })
}
it.each([400, 403, 503])('編集のHTTP %sで入力を残し、保存中を解除して再試行できる', async status => {
  net.update.mockRejectedValueOnce(new ApiError(status, status === 400 ? '紹介コードを確認してください' : undefined))
  await mount(route)
  await act(async () => { screen.getByRole('button', { name: '保存する' }).click() })
  expect(net.saved).not.toHaveBeenCalled()
  expect((document.getElementById('route-name') as HTMLInputElement).value).toBe('経路の名前')
  expect((screen.getByRole('button', { name: '保存する' }) as HTMLButtonElement).disabled).toBe(false)
  expect(document.body.textContent).not.toContain('API error:')
  expect(document.body.textContent).toContain(status === 400 ? '紹介コードを確認してください' : status === 403 ? '権限' : '保存できませんでした')
  net.update.mockResolvedValue({ success: true, data: route })
  await act(async () => { screen.getByRole('button', { name: '保存する' }).click() })
  expect(net.saved).toHaveBeenCalledTimes(1)
})
it.each([409, 503])('新規作成のHTTP %sでも同時編集の帯へ閉じ込めず、同じ所属で再試行できる', async status => {
  net.create.mockRejectedValueOnce(new ApiError(status, status === 409 ? 'この識別子は既に使われています' : undefined))
  await mount(null)
  const { fireEvent } = await import('@testing-library/react')
  await act(async () => { fireEvent.change(document.getElementById('route-name')!, { target: { value: '作る経路' } }); fireEvent.change(document.getElementById('route-ref')!, { target: { value: 'route1' } }) })
  await act(async () => { screen.getByRole('button', { name: '作る' }).click() })
  expect(net.create).toHaveBeenCalledWith(expect.objectContaining({ name: '作る経路', lineAccountId: 'account-a' }))
  expect(net.saved).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain(status === 409 ? 'この識別子は既に使われています' : '保存できませんでした')
  expect(screen.queryByRole('button', { name: '違いを比べる' })).toBeNull()
  expect((document.getElementById('route-ref') as HTMLInputElement).disabled).toBe(false)
  expect((screen.getByRole('button', { name: '作る' }) as HTMLButtonElement).disabled).toBe(false)
  net.create.mockResolvedValue({ success: true, data: route })
  await act(async () => { screen.getByRole('button', { name: '作る' }).click() })
  expect(net.saved).toHaveBeenCalledTimes(1)
})
