// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import UpdateHistoryV8 from './history'
import { MANUAL_UPDATE_GUIDE_URL } from '@/components/update/use-update-status'

const history = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({ api: { operations: { history } } }))
afterEach(cleanup)

it('失敗した更新は丸の印で示し、取得済みの失敗数を出す', async () => {
  history.mockResolvedValue({ success: true, data: [{ historyKind: 'deployment', deployment: {
    deploymentId: 'failed-update', phase: 'failed', version: '1.2.0', actor: 'github-actions',
    occurredAt: new Date().toISOString(), environment: 'staging', pullRequest: null,
  } }] })
  render(<UpdateHistoryV8 />)
  const label = screen.getByText('失敗した更新')
  expect(label.closest('[data-kpi-label]')?.querySelector('svg.lucide-circle-x')).toBeTruthy()
  await waitFor(() => expect(label.closest('[data-kpi-presentation]')?.querySelector('[data-kpi-number]')?.textContent).toBe('1'))
})

it('手動更新ガイドは本の印と既存の外部リンクを持つ', () => {
  history.mockResolvedValue({ success: true, data: [] })
  render(<UpdateHistoryV8 />)
  const guide = screen.getByRole('link', { name: '手動アップデートガイドを開く' })
  expect(guide.querySelector('svg.lucide-book-open')).toBeTruthy()
  expect(guide.getAttribute('href')).toBe(MANUAL_UPDATE_GUIDE_URL)
  expect(guide.getAttribute('target')).toBe('_blank')
  expect(guide.getAttribute('rel')).toContain('noreferrer')
})
