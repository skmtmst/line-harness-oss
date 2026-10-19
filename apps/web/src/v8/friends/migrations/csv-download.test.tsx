// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
const model = vi.hoisted(() => ({ role: 'owner', download: vi.fn() }))
vi.mock('@/lib/staff-role', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/staff-role')>(), useStaffRole: () => model.role }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, downloadApiFile: model.download, api: { ...actual.api,
    lineAccounts: { list: async () => ({ success: true, data: [] }) },
    friendMigrations: { jobs: async () => ({ success: true, data: [] }) },
  } }
})
import { useFriendMigrations } from './use-friend-migrations'
beforeEach(() => { model.role = 'owner'; model.download.mockReset() })
test('認証付きの保存へIDを渡し、終わる前の二重押下は送らない', async () => {
  let finish!: () => void
  model.download.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
  const { result } = renderHook(useFriendMigrations)
  await waitFor(() => expect(result.current.status).toBe('ready'))
  act(() => { void result.current.downloadExport('job/1'); void result.current.downloadExport('job/1') })
  expect(model.download).toHaveBeenCalledTimes(1)
  expect(result.current.downloadId).toBe('job/1')
  expect(model.download).toHaveBeenCalledWith('/api/friends/exports/job%2F1/download', '友だち.csv')
  await act(async () => { finish() })
  expect(result.current.busy).toBe(false)
  expect(result.current.downloadId).toBeNull()
})
test('閲覧者にはダウンロード要求を送らない', async () => {
  model.role = 'staff'
  const { result } = renderHook(useFriendMigrations)
  await waitFor(() => expect(result.current.status).toBe('ready'))
  await act(async () => { await result.current.downloadExport('job1') })
  expect(model.download).not.toHaveBeenCalled()
})
test('保存の失敗は理由を表示し、次の操作をできる状態へ戻す', async () => {
  model.download.mockRejectedValue(new Error('通信が切れました'))
  const { result } = renderHook(useFriendMigrations)
  await waitFor(() => expect(result.current.status).toBe('ready'))
  await act(async () => { await result.current.downloadExport('job1') })
  expect(result.current.message).toBeTruthy()
  expect(result.current.busy).toBe(false)
  model.download.mockResolvedValue({})
  await act(async () => { await result.current.downloadExport('job1') })
  expect(model.download).toHaveBeenCalledTimes(2)
})
