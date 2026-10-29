// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import UpdateHistoryV8 from './history'

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

it('更新の案内は管理画面の /updates への内部リンクで、外部の印を持たない', () => {
  history.mockResolvedValue({ success: true, data: [] })
  render(<UpdateHistoryV8 />)
  const guide = screen.getByRole('link', { name: 'アップデート履歴を見る' })
  // lucide-react v1 では History が lucide-rotate-ccw-clock の描画名。
  expect(guide.querySelector('svg.lucide-rotate-ccw-clock')).toBeTruthy()
  expect(guide.getAttribute('href')).toBe('/updates')
  expect(guide.getAttribute('target')).toBeNull()
  expect(guide.querySelector('[data-external-icon]')).toBeNull()
})
