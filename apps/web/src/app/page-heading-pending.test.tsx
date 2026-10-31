// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ ready: false, pending: null as Promise<void> | null }))
vi.mock('@/v8/style-dashboard/home', () => ({ default: () => {
  if (!fixture.ready) throw fixture.pending
  return <main><h1>ダッシュボード</h1><p>本文を読み終えました</p></main>
} }))
import DashboardPage from './page'

afterEach(cleanup)
it('本文が途中で待ち直しても、入口のSuspenseは同じダッシュボードの題を出す', async () => {
  let done!: () => void
  fixture.ready = false
  fixture.pending = new Promise(resolve => { done = resolve })
  const view = render(<DashboardPage />)
  expect(screen.getAllByRole('heading', { level: 1 }).map(node => node.textContent)).toEqual(['ダッシュボード'])
  expect(view.container.querySelector('[data-page-pending="style"]')).toBeTruthy()
  await act(async () => { fixture.ready = true; done(); await fixture.pending })
  expect(screen.getAllByRole('heading', { level: 1 }).map(node => node.textContent)).toEqual(['ダッシュボード'])
  expect(screen.getByText('本文を読み終えました')).toBeTruthy()
})
