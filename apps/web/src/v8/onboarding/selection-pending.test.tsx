// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useWizard } from './use-wizard'
import type { StyleState } from './model'

const calls = vi.hoisted(() => ({ save: vi.fn(), close: vi.fn() }))
vi.mock('@/lib/api/helpers/styles', () => ({ styleApi: { save: calls.save } }))
vi.mock('@/components/shared/list-navigation', () => ({ useListNavigationRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/components/shared/preparing-dialog', async original => ({ ...await original<typeof import('@/components/shared/preparing-dialog')>(), usePreparingDialog: () => ({ open: vi.fn() }) }))
vi.mock('@/hooks/use-account-style', () => ({ accountStyleUpdated: vi.fn() }))
const state: StyleState = { style: 'standard', styleSelected: false, styleMode: 'later', shouldPromptStyleSelection: true, version: 1, answers: { style: { mode: 'later' } } }
beforeEach(() => {
  vi.clearAllMocks()
  calls.save.mockResolvedValue({ success: true, data: { version: 2 } })
})
afterEach(cleanup)

it('スタイルを選ばず別の質問だけ保存しても、標準を選択済みにしない', async () => {
  const { result } = renderHook(() => useWizard({ accountId: 'new-account', state, initialStep: 1, onClose: calls.close }))
  await act(async () => { await result.current.onNext() })
  await act(async () => { await result.current.close() })
  expect(calls.save).toHaveBeenCalledTimes(1)
  expect(calls.save.mock.calls[0][1]).toMatchObject({ expectedVersion: 1, answers: { image: { mode: 'configured', value: 'keep' } } })
  expect(calls.save.mock.calls[0][1]).not.toHaveProperty('style')
})

it('本人が標準を選んで次へ進んだら、途中で閉じても選択を保存する', async () => {
  const { result } = renderHook(() => useWizard({ accountId: 'new-account', state, onClose: calls.close }))
  await act(async () => { await result.current.onNext() })
  await act(async () => { await result.current.close() })
  expect(calls.save).toHaveBeenCalledWith('new-account', expect.objectContaining({ expectedVersion: 1, style: 'standard' }))
})

it.each(['later', 'manual'])('本人の%sはスタイルを選んだ扱いにせず保存する', async mode => {
  const { result } = renderHook(() => useWizard({ accountId: 'new-account', state, onClose: calls.close }))
  await act(async () => { result.current.setChoice(mode) })
  await act(async () => { await result.current.onNext() })
  expect(calls.save).toHaveBeenCalledWith('new-account', { expectedVersion: 1, styleMode: mode })
  expect(calls.close).toHaveBeenCalledWith(true)
})
