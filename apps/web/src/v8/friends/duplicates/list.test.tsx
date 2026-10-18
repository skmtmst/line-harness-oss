// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const actions = vi.hoisted(() => ({ setStatus: vi.fn(), clearFilters: vi.fn(), loadCandidates: vi.fn(), filtering: false, failure: '' }))

vi.mock('@/components/shell/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())
vi.mock('@/lib/staff-role', () => ({ useStaffIdentity: () => ({ id: 'staff-test' }) }))
vi.mock('@/lib/use-narrow-viewport', () => ({ useNarrowViewport: () => false }))
vi.mock('./use-duplicates-data', () => ({
  CANDIDATE_PAGE_SIZE: 50,
  useDuplicatesData: () => ({
    candidateTotal: 0, unfilteredCandidates: !actions.filtering, statusCounts: null,
    duplicateTotalText: '—', duplicateDetail: '読み込めませんでした', lowConfidenceCount: null,
    candidates: [], data: null, query: '', status: '', page: 1,
    statsFailure: null, error: '', candidateError: actions.failure, candidatesLoading: false,
    setQuery: vi.fn(), setStatus: actions.setStatus, setPage: vi.fn(), clearFilters: actions.clearFilters, loadCandidates: actions.loadCandidates, load: vi.fn(), detect: vi.fn(),
  }),
}))

import DuplicatesList from './list'

beforeEach(() => { actions.filtering = false; actions.failure = '' })

afterEach(() => { cleanup(); vi.clearAllMocks() })

it('題から安全説明を開閉し、用語説明と候補の操作を保つ', () => {
  render(<DuplicatesList />)
  const toggle = screen.getByRole('button', { name: 'この画面の説明' })
  const body = document.getElementById(toggle.getAttribute('aria-controls')!)!
  expect(body.textContent).toContain('同じ人が2人に分かれていないか')
  const safety = screen.getByText(/自動では結び付けません/).closest('[role="note"]')!
  expect(safety.textContent).toContain('元の友だちと履歴は残ります')
  expect(toggle.closest('header')).not.toBeNull()
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(toggle)
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(document.getElementById(body.id)).toBeNull()
  expect(safety.isConnected).toBe(true)
  fireEvent.click(toggle)
  expect(document.getElementById(body.id)?.textContent).toContain('結び付けるか決めます')
  fireEvent.click(screen.getByRole('button', { name: '友だちの説明' }))
  expect(screen.getByText(/同じ人が別のアカウント/)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'もう一度見直す' })).toBeTruthy()
})

it('状態の札は元の絞り込みの値を送る', () => {
  render(<DuplicatesList />)
  for (const [label, value] of [['未確認', 'pending'], ['保留', 'deferred'], ['結び付けた', 'linked'], ['別人', 'different'], ['すべて', '']]) {
    fireEvent.click(screen.getByRole('button', { name: label, exact: true }))
    expect(actions.setStatus).toHaveBeenLastCalledWith(value)
  }
})

it('候補0件を1〜0組と表示せず、検索の0件は条件を外せる', () => {
  actions.filtering = true
  render(<DuplicatesList />)
  expect(screen.getByText('条件に合う候補はありません')).toBeTruthy()
  expect(document.body.textContent).not.toContain('1〜0')
  fireEvent.click(screen.getByRole('button', { name: '条件を外す', exact: true }))
  expect(actions.clearFilters).toHaveBeenCalledOnce()
})
it('候補の取得失敗を0件にせず、候補だけ読み直す', () => {
  actions.failure = 'offline'
  render(<DuplicatesList />)
  expect(screen.queryByText('重複の候補はありません')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
  expect(actions.loadCandidates).toHaveBeenCalledOnce()
})
