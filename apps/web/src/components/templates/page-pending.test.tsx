// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import AuthPendingShell from '../auth-pending-shell'
import PagePending, { PagePendingLayout } from './page-pending'

afterEach(cleanup)

it('ホームは認証前の書き出しから同じ見出しを持ち、画面の情報は出さない', () => {
  const html = renderToStaticMarkup(<PagePendingLayout variant="dashboard"><AuthPendingShell /></PagePendingLayout>)
  expect(html).toContain('data-page-template="dashboard"')
  expect(html).toContain('<h1')
  expect(html).toContain('ダッシュボード')
  expect(html).toContain('data-page-pending="auth"')
  expect(html).not.toContain('権限')
})

it.each(['identity', 'route', 'root', 'store', 'handover', 'style'] as const)('%s を待つ段階でもホームの見出しを保つ', stage => {
  const view = render(<PagePendingLayout variant="dashboard"><PagePending stage={stage} /></PagePendingLayout>)
  expect(screen.getAllByRole('heading', { level: 1 }).map(node => node.textContent)).toEqual(['ダッシュボード'])
  expect(view.container.querySelector('[data-page-template="dashboard"]')).not.toBeNull()
  expect(view.container.querySelector(`[data-page-pending="${stage}"]`)).not.toBeNull()
  expect(screen.getByLabelText('読み込んでいます').getAttribute('aria-busy')).toBe('true')
  view.rerender(<PagePendingLayout variant="detail"><PagePending stage={stage} /></PagePendingLayout>)
  expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
  expect(view.container.querySelector('[data-page-template="detail"]')).not.toBeNull()
})

it('ホーム以外の認証待機は名前のない骨組みを保つ', () => {
  render(<PagePendingLayout variant="detail"><AuthPendingShell /></PagePendingLayout>)
  expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
})

it('読み込み失敗の理由と再試行を残す', () => {
  const retry = vi.fn()
  render(<PagePending variant="dashboard" stage="style" failed errorTitle="使い方のスタイルを読み込めませんでした" onRetry={retry} />)
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('ダッシュボード')
  expect(screen.getByText('使い方のスタイルを読み込めませんでした')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
  expect(retry).toHaveBeenCalledTimes(1)
})
