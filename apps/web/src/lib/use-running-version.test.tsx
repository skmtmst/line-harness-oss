// @vitest-environment happy-dom
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { loadAdminVersionDetail, type AdminVersionDetail } from './admin-version-cache'
import { useRunningVersion } from './use-running-version'
vi.mock('./admin-version-cache', () => ({ loadAdminVersionDetail: vi.fn() }))
afterEach(() => { cleanup(); vi.resetAllMocks() })
test('サイドバーと同じ稼働版を使う', async () => {
  vi.mocked(loadAdminVersionDetail).mockResolvedValue({ version: '0.24.0', git_commit: 'running-sha' } as AdminVersionDetail)
  const { result } = renderHook(useRunningVersion)
  await waitFor(() => expect(result.current.detail?.version).toBe('0.24.0'))
  expect(result.current.statusText).toBe('稼働版を確認')
})
test.each(['empty', 'failed'])('稼働版の取得が%sでもリリース履歴で穴埋めしない', async kind => {
  if (kind === 'failed') vi.mocked(loadAdminVersionDetail).mockRejectedValue(new Error('読めない'))
  else vi.mocked(loadAdminVersionDetail).mockResolvedValue({ version: '' } as AdminVersionDetail)
  const { result } = renderHook(useRunningVersion)
  await waitFor(() => expect(result.current.statusText).toBe('確認できませんでした'))
  expect(result.current.detail).toBeNull()
})
