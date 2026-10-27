// @vitest-environment happy-dom
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const get = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/helpers/styles', () => ({ styleApi: { get } }))
import { useAccountStyle } from './use-account-style'

beforeEach(() => { window.localStorage.clear(); get.mockReset() })
afterEach(() => vi.restoreAllMocks())

it('読み直せない時は、同じアカウントで前に読めたスタイルで出し、要確認の印を立てる', async () => {
  get.mockResolvedValueOnce({ success: true, data: { style: 'lesson' } })
  const first = renderHook(() => useAccountStyle('acc-1'))
  await waitFor(() => expect(first.result.current.status).toBe('ready'))
  expect(first.result.current.stale).toBe(false)
  first.unmount()
  get.mockRejectedValueOnce(new Error('network'))
  const second = renderHook(() => useAccountStyle('acc-1'))
  await waitFor(() => expect(second.result.current.status).toBe('ready'))
  expect(second.result.current.data?.style).toBe('lesson')
  expect(second.result.current.stale).toBe(true)
  expect(second.result.current.error).toBeNull()
})

it('初めてで分からない時は前の店のスタイルを使わず、失敗のまま', async () => {
  window.localStorage.setItem('musubo:account-style:acc-other', JSON.stringify({ style: 'restaurant' }))
  get.mockRejectedValueOnce(new Error('network'))
  const view = renderHook(() => useAccountStyle('acc-2'))
  await waitFor(() => expect(view.result.current.status).toBe('error'))
  expect(view.result.current.data).toBeNull()
  expect(view.result.current.stale).toBe(false)
})
