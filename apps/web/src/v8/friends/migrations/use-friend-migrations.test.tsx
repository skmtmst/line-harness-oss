// @vitest-environment happy-dom
import { File as NodeFile } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import { useFriendMigrations } from './use-friend-migrations'
const m = vi.hoisted(() => ({ role: 'owner', jobs: vi.fn(), createExport: vi.fn(), previewImport: vi.fn(), executeImport: vi.fn() }))
vi.mock('@/lib/staff-role', async original => ({ ...await original<typeof import('@/lib/staff-role')>(), useStaffRole: () => m.role }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, lineAccounts: { list: async () => ({ success: true, data: [{ id: 'A' }] }) }, friendMigrations: m } }
})
beforeEach(() => {
  vi.resetAllMocks(); m.role = 'owner'; vi.stubGlobal('crypto', webcrypto)
  m.jobs.mockResolvedValue({ success: true, data: [] })
  m.previewImport.mockResolvedValue({ success: true, data: { id: 'preview', result: { summary: { add: 1, update: 0, unchanged: 0, conflict: 0, error: 0 } } } })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
async function ready() {
  const h = renderHook(useFriendMigrations)
  await waitFor(() => expect(h.result.current.status).toBe('ready'))
  return h
}
it('反映失敗でbusyを戻し履歴を読み直し、確認結果を保持して再試行できる', async () => {
  const h = await ready()
  const file = new NodeFile(['LINEユーザーID,LINE表示名\nU1,花子'], 'friends.csv', { type: 'text/csv' })
  await act(async () => h.result.current.onPickFile(file as unknown as File))
  await act(async () => h.result.current.previewImport())
  expect(m.previewImport).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'A', sourceFilename: 'friends.csv', sourceChecksum: expect.stringMatching(/^[0-9a-f]{64}$/) }))
  expect(m.executeImport).not.toHaveBeenCalled()
  m.executeImport.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await act(async () => h.result.current.executeImport())
  expect(h.result.current.busy).toBe(false)
  expect(h.result.current.importId).toBe('preview')
  expect(h.result.current.message).toBeTruthy()
  expect(h.result.current.message).not.toContain('Failed to fetch')
  expect(m.jobs).toHaveBeenCalledTimes(3)
  m.executeImport.mockResolvedValue({ success: true, data: { applied: 1 } })
  await act(async () => h.result.current.executeImport())
  expect(h.result.current.message).toContain('1 件')
  expect(m.executeImport).toHaveBeenCalledTimes(2)
})
it('読み込み403は空や通信失敗と区別し、閲覧者の管理操作をロックする', async () => {
  m.role = 'staff'; m.jobs.mockRejectedValue(new ApiError(403))
  const { result } = renderHook(useFriendMigrations)
  await waitFor(() => expect(result.current.status).toBe('forbidden'))
  expect(result.current.manageLocked).toBe(true)
  expect(result.current.exportResult).toBeNull()
})
it('書き出しの失敗は生のAPI文を見せず、未取得件数を0へ読み替えない', async () => {
  m.createExport.mockRejectedValue(new ApiError(503))
  const h = await ready()
  expect(h.result.current.columns).toEqual(['basic'])
  expect(h.result.current.encoding).toBe('utf-8')
  await act(async () => h.result.current.createExport())
  expect(h.result.current.busy).toBe(false)
  expect(h.result.current.exportResult).toBeNull()
  expect(h.result.current.message).toBeTruthy()
  expect(h.result.current.message).not.toContain('API error')
  expect(m.createExport).toHaveBeenCalledWith({ accountId: 'A', columns: ['basic'], encoding: 'utf-8' })
})
it('大きすぎるCSVと未確認の反映はAPIへ送らない', async () => {
  const h = await ready()
  await act(async () => h.result.current.onPickFile(new NodeFile([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.csv') as unknown as File))
  expect(h.result.current.file).toBeNull()
  expect(h.result.current.message).toContain('5MB')
  await act(async () => h.result.current.previewImport())
  await act(async () => h.result.current.executeImport())
  expect(m.previewImport).not.toHaveBeenCalled()
  expect(m.executeImport).not.toHaveBeenCalled()
})
