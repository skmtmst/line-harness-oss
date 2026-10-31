// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SetupTasks, SetupTasksUnavailable, SetupWarningBands, setupSummary } from './setup-card'
import type { StyleSetupData } from './use-style-setup'

const data = (): StyleSetupData => ({
  state: { style: 'restaurant', styleSelected: true, version: 1, answers: { image: { mode: 'configured', value: 'simple' } } },
  warnings: [],
  items: [{ key: 'notice', name: 'ご利用後のお知らせ', target_id: 'notice', kind: 'automation', is_sample: 1, status: 'draft', draftRevision: 'draft' }, { key: 'menu', name: '最初のメニュー', target_id: 'menu', kind: 'rich_menu', is_sample: 1, status: 'draft', draftRevision: null }],
})
afterEach(() => { cleanup() })

it.each(['viewer', 'staff'])('%sにも設定の行を見せ、変更と中身を見る操作を理由付きで止める', role => {
  const onOpenStep = vi.fn(), source = data()
  render(<SetupTasks heading summary={setupSummary(source)!} configureAllowed={false} role={role} onOpenStep={onOpenStep} />)
  expect(screen.getByRole('heading', { name: '選んだ機能の設定' })).toBeTruthy()
  for (const name of ['確かめる', '中身を見る']) {
    const button = screen.getByRole('button', { name })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    const reason = document.getElementById(button.getAttribute('aria-describedby')!)?.textContent
    expect(reason).toContain(name === '中身を見る' ? '中身はオーナーか管理者が見られます' : '管理者')
    fireEvent.click(button)
  }
  expect(onOpenStep).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('管理者の中身を見る操作は既存の設定の一覧を開く', () => {
  const onOpenStep = vi.fn(), source = data()
  render(<SetupTasks summary={setupSummary(source)!} role="admin" onOpenStep={onOpenStep} />)
  fireEvent.click(screen.getByRole('button', { name: '中身を見る' }))
  expect(onOpenStep).toHaveBeenCalledWith('summary')
})

it('閲覧だけでは警告の変更操作も灰色と理由にする', () => {
  const source = data(); source.warnings = [{ feature: 'booking', areaId: 'booking', groupId: 'menu', customerState: 'preparing', href: '/booking/menus' }]
  render(<SetupWarningBands data={source} configureAllowed={false} role="viewer" />)
  const button = screen.getByRole('button', { name: '決まりを入れる' })
  expect(button.getAttribute('aria-disabled')).toBe('true')
  expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toContain('閲覧のみ')
})

it('403でも欄の見出しを残し、再試行を促さない', () => {
  render(<SetupTasksUnavailable error={{ status: 403 }} onRetry={vi.fn()} />)
  expect(screen.getByRole('heading', { name: '選んだ機能の設定' })).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
})
it('取得の失敗を未設定にせず、同じ欄から読み直せる', () => {
  const retry = vi.fn()
  render(<SetupTasksUnavailable error={new Error('offline')} onRetry={retry} />)
  expect(screen.getByRole('heading', { name: '選んだ機能の設定' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button'))
  expect(retry).toHaveBeenCalledTimes(1)
})
