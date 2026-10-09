// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useUrlTab } from '@/lib/use-url-tab'
import { Tabs } from './tabs'
const { replace } = vi.hoisted(() => ({ replace: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }))
vi.mock('next/link', () => ({ default: ({ replace: replaceFlag, children, ...p }: any) => <a {...p} data-replace={String(replaceFlag)}>{children}</a> }))
afterEach(() => { cleanup(); replace.mockClear(); window.history.replaceState(null, '', '/') })
it('B-158 決まり3：クリック・再読込・戻るでタブとURLを保ち、履歴を積む変更を検出する', () => {
  window.history.replaceState(null, '', '/ops/members?tab=info&q=abc#table')
  function Example() { const [tab, select] = useUrlTab(['members', 'info'] as const, 'members'); return <Tabs items={[{ label: 'メンバー', current: tab === 'members', onClick: () => select('members') }, { label: '情報', current: tab === 'info', onClick: () => select('info') }]} /> }
  const historyLength = window.history.length
  render(<Example />)
  expect(screen.getByRole('tab', { name: '情報' }).getAttribute('aria-selected')).toBe('true')
  fireEvent.click(screen.getByRole('tab', { name: 'メンバー' }))
  expect(replace).toHaveBeenCalledWith('/ops/members?tab=members&q=abc#table', { scroll: false })
  expect(window.history.length).toBe(historyLength)
  window.history.replaceState(null, '', '/ops/members?tab=info'); fireEvent.popState(window)
  expect(screen.getByRole('tab', { name: '情報' }).getAttribute('aria-selected')).toBe('true')
})
it('リンクのタブもreplaceを使う', () => { render(<Tabs items={[{ label: '情報', href: '?tab=info' }]} />); expect(screen.getByRole('tab').getAttribute('data-replace')).toBe('true') })
it('入れ子の詳細タブは親の支払いタブと衝突せず、再読込で復元する', async () => {
  const { tabHref, tabFromUrl } = await import('@/lib/use-url-tab')
  const href = tabHref('/affiliates?affiliate=123&q=abc', 'payment', 'affiliates')
  expect(new URL(href, 'http://localhost').searchParams.get('tab')).toBe('affiliates/payment')
  expect(tabFromUrl(href, ['summary', 'payment'], 'summary', 'affiliates')).toBe('payment')
  expect(tabFromUrl('/affiliates?tab=payment', ['summary', 'payment'], 'summary', 'affiliates')).toBe('summary')
})
