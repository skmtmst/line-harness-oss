// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { EntryRoute } from '@line-crm/shared'
import { ApiError } from '@/lib/api'
import EditRouteModal from './edit-route-dialog'

const net = vi.hoisted(() => ({ update: vi.fn(), get: vi.fn(), saved: vi.fn() }))
vi.mock('@/lib/api', async original => {
  const real = await original<typeof import('@/lib/api')>()
  return { ...real, api: { ...real.api, entryRoutes: { ...real.api.entryRoutes, update: net.update, get: net.get } } }
})
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
const route = { id: 'route-1', refCode: 'route1', name: '元の名前', genre: null, poolId: null, tagId: null, scenarioId: null, introTemplateId: null, couponEnabled: false, couponAssetId: null, couponAudience: 'new_friends', runAccountFriendAddScenarios: true, redirectUrl: null, isActive: true, updatedAt: '2026-10-18T00:00:00Z' } as EntryRoute
let root: Root
let host: HTMLDivElement
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  net.update.mockReset(); net.get.mockReset(); net.saved.mockReset()
  net.update.mockRejectedValueOnce(new ApiError(409, 'conflict', 'VERSION_CONFLICT'))
  net.get.mockResolvedValue({ success: true, data: { ...route, couponEnabled: undefined, couponAssetId: undefined, couponAudience: undefined, tagId: 'tag-missing', name: 'ほかの人の名前', updatedAt: '2026-10-19T00:00:00Z' } })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
it('流入元の名前は必須で、フォルダを選ばなくても名前を直せば保存できる', async () => {
  net.update.mockReset()
  net.update.mockResolvedValue({ success: true, data: route })
  await act(async () => { root.render(<EditRouteModal surface="inline" route={route} pools={[]} scenarios={[]} templates={[]} tags={[]} existingGenres={[]} poolMemberNames={{}} onClose={() => {}} onSaved={net.saved} />) })
  const name = document.getElementById('route-name') as HTMLInputElement
  await act(async () => { fireEvent.change(name, { target: { value: '   ' } }) })
  await act(async () => { screen.getByRole('button', { name: '保存する' }).click() })
  expect(name.getAttribute('aria-invalid')).toBe('true')
  expect(net.update).not.toHaveBeenCalled()
  await act(async () => { fireEvent.change(name, { target: { value: '新しい流入元' } }) })
  await act(async () => { screen.getByRole('button', { name: '保存する' }).click() })
  expect(net.update).toHaveBeenCalledWith('route-1', expect.objectContaining({ name: '新しい流入元', genre: '', expectedUpdatedAt: route.updatedAt }))
  expect(net.saved).toHaveBeenCalledTimes(1)
})
it('開いた版を送信し、409では入力を残して最新と比較・読込した後に新しい版を送る', async () => {
  await act(async () => { root.render(<EditRouteModal surface="inline" route={route} pools={[]} scenarios={[]} templates={[]} tags={[]} existingGenres={[]} poolMemberNames={{}} onClose={() => {}} onSaved={net.saved} />) })
  const name = document.getElementById('route-name') as HTMLInputElement
  await act(async () => { fireEvent.change(name, { target: { value: '自分の下書き' } }) })
  await act(async () => { screen.getByRole('button', { name: '保存する' }).click() })
  expect(net.update).toHaveBeenCalledWith('route-1', expect.objectContaining({ expectedUpdatedAt: route.updatedAt, name: '自分の下書き' }))
  expect(net.saved).not.toHaveBeenCalled()
  expect(name.value).toBe('自分の下書き')
  const refField = document.getElementById('route-ref')!
  expect(document.getElementById(refField.getAttribute('aria-describedby')!)?.textContent).toContain('変更できません')
  expect((screen.getByRole('button', { name: '保存する' }) as HTMLButtonElement).title).toContain('読み込んでから保存')
  expect((screen.getByRole('button', { name: '保存する' }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => { screen.getByRole('button', { name: '違いを比べる' }).click() })
  expect(document.body.textContent).toContain('下書き 自分の下書き ／ 最新 ほかの人の名前')
  expect(screen.getByRole('dialog').textContent).not.toContain('クーポン')
  expect(screen.getByRole('dialog').textContent).toContain('選択済み（名前を読み込めませんでした）')
  expect(name.value).toBe('自分の下書き')
  await act(async () => { screen.getAllByRole('button', { name: '最新を読み込んで続ける' }).at(-1)!.click() })
  expect(name.value).toBe('ほかの人の名前')
  net.update.mockResolvedValue({ success: true, data: { ...route, couponEnabled: undefined, couponAssetId: undefined, couponAudience: undefined, name: 'ほかの人の名前', updatedAt: '2026-10-20T00:00:00Z' } })
  await act(async () => { screen.getByRole('button', { name: '保存する' }).click() })
  expect(net.update).toHaveBeenLastCalledWith('route-1', expect.objectContaining({ expectedUpdatedAt: '2026-10-19T00:00:00Z' }))
  expect(net.saved).toHaveBeenCalledTimes(1)
})
