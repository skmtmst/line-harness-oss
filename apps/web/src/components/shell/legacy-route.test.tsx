// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import LegacyRoute from './legacy-route'
import { PageChromeProvider } from './page-chrome'

const state = vi.hoisted(() => ({ query: '', replace: vi.fn() }))
const router = { replace: state.replace }
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(state.query) }))
vi.mock('@/components/shared/list-navigation', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/shared/list-navigation')>(), useListNavigationRouter: () => router }))
afterEach(() => { cleanup(); state.replace.mockClear(); window.history.replaceState(null, '', '/') })

it.each([
  ['/conversions', 'tab=offers&q=春', '/affiliates?tab=offers&q=%E6%98%A5', '成果とアフィリエイト'],
  ['/affiliate-offers', 'q=a', '/affiliates?q=a&tab=offers', '成果とアフィリエイト'],
  ['/settings/features', '', '/settings', '機能設定'],
  ['/auto-replies/publish', 'id=ar-1', '/auto-replies/edit?id=ar-1&step=priority', '自動応答'],
] as const)('互換の入口 %s は待機中から移動先の題で1回だけ置き換える', (from, query, target, title) => {
  state.query = query
  window.history.replaceState(null, '', `${from}?${query}#section`)
  render(<PageChromeProvider><LegacyRoute from={from} /></PageChromeProvider>)
  expect(state.replace).toHaveBeenCalledTimes(1)
  expect(state.replace).toHaveBeenCalledWith(target + '#section')
  expect(document.title).toBe(`${title} | musubo`)
  expect(screen.getByLabelText('読み込んでいます')).toBeTruthy()
})
