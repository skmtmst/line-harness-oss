// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import CatalogUpdate from './catalog-update'

const fetchApi = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({ fetchApi }))
afterEach(() => { cleanup(); vi.resetAllMocks() })

it.each(['booking_menu','mileage_reward'] as const)('%s の新版は確認した版で採用し、閲覧のみでは操作を隠す', async kind => {
  fetchApi.mockResolvedValueOnce({ success: true, data: { id: 'd', name: '本部', version: 2, snapshot: 'a'.repeat(64), definition: { settings: { name: '新版', duration_minutes: 60, base_price: 1000, requiredMiles: 90 } } } }).mockResolvedValueOnce({ success: true, data: { decision: 'adopted' } })
  const changed = vi.fn()
  const { rerender } = render(<CatalogUpdate accountId="a" targetId="r" kind={kind} canEdit={false} onChanged={changed} />)
  expect(await screen.findByText(/統括「本部」の版 2/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: '統括の新版を採用' })).toBeNull()
  rerender(<CatalogUpdate accountId="a" targetId="r" kind={kind} canEdit onChanged={changed} />)
  fireEvent.click(screen.getByRole('button', { name: '統括の新版を採用' }))
  fireEvent.click(screen.getByRole('button', { name: '採用する' }))
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1))
  const [, options] = fetchApi.mock.calls[1]
  expect(JSON.parse(options.body)).toEqual({ decisionId: 'd', snapshot: 'a'.repeat(64), action: 'adopt' })
})
it('壊れた更新情報を受け取っても一覧を壊さず、確認できなかったことを示す', async () => {
  fetchApi.mockResolvedValueOnce({ success: true, data: { id: 'incomplete' } })
  render(<CatalogUpdate accountId="a" targetId="r" kind="booking_menu" canEdit onChanged={() => {}} />)
  expect(await screen.findByText(/統括からの更新を確認できませんでした/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: '統括の新版を採用' })).toBeNull()
})
