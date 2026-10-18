// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { readUiSource } from '../../../scripts/test-ui-source.mjs'
const get = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({ api: { gettingStarted: { get } } }))
import { useFirstRun } from '@/v8/onboarding/use-first-run'
afterEach(cleanup)

it('M017: 取得失敗を未設定にせず、読み直すと保存済み状態に復旧する', async () => {
  get.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ success: true, data: { steps: [{ key: 'featureSet', state: 'done', href: '/settings', reason: null }] } })
  const { result } = renderHook(() => useFirstRun('account-1'))
  await waitFor(() => expect(result.current.status).toBe('error'))
  expect(result.current.steps).toEqual([])
  expect(result.current.error).toBeInstanceOf(Error)
  await act(async () => result.current.reload())
  await waitFor(() => expect(result.current.status).toBe('ready'))
  expect(result.current.steps.find((step) => step.key === 'featureSet')?.state).toBe('done')
})

it('M017: 実画面は同じhookの再取得と捕まえた失敗を共通のエラー表示へ渡す', () => {
  const page = readUiSource(`${process.cwd()}/src/app/getting-started/page.tsx`, 'utf8')
  expect(page).toContain("error={status === 'error' ? loadError : undefined}")
  expect(page).toContain('onRetry={reload}')
  expect(page).toContain('useFirstRun(selectedAccountId, !accountLoading)')
})
