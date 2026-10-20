// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AffiliateFrame, AffiliateShell, type AffiliateTabKey } from './frame'

vi.mock('@/lib/staff-role', () => ({ useStaffIdentity: () => ({ id: 'staff-one' }) }))
const stored = new Map<string, string>()
const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
beforeEach(() => {
  stored.clear()
  Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) } })
})
afterEach(() => { cleanup(); if (descriptor) Object.defineProperty(window, 'localStorage', descriptor); else Reflect.deleteProperty(window, 'localStorage') })

function Frame({ tab = 'report', explanation }: { tab?: AffiliateTabKey; explanation?: string }) {
  return <AffiliateShell.Provider value={{ tab, readonly: false, narrow: false, accountId: 'a', counts: {}, setCount: () => {}, focusAffiliateId: null }}>
    <AffiliateFrame explanation={explanation} help="用語の定義">一覧の中身</AffiliateFrame>
  </AffiliateShell.Provider>
}

it('既定の他タブへ入口を増やさず、指定した説明を題の横から一度だけ開閉する', () => {
  const view = render(<Frame tab="offers" />)
  expect(screen.queryByRole('button', { name: 'この画面の説明' })).toBeNull()
  view.rerender(<Frame explanation="数えるのは認めた成果だけです" />)
  const toggle = screen.getByRole('button', { name: 'この画面の説明' })
  const region = screen.getByRole('region', { name: 'この画面の説明' })
  expect(region.textContent).toBe('数えるのは認めた成果だけです')
  expect(toggle.getAttribute('aria-controls')).toBe(region.id)
  expect(screen.getAllByText('数えるのは認めた成果だけです')).toHaveLength(1)
  const help = screen.getByRole('button', { name: '成果とアフィリエイトの説明' })
  expect(help.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  fireEvent.click(toggle)
  expect(screen.queryByRole('region', { name: 'この画面の説明' })).toBeNull()
  view.unmount()
  render(<Frame explanation="数えるのは認めた成果だけです" />)
  expect(screen.getByRole('button', { name: 'この画面の説明' }).getAttribute('aria-expanded')).toBe('false')
})

it('レポートと成果承認の開閉は別々に覚え、値の更新で説明本文を消さない', () => {
  const view = render(<Frame explanation="過去30日です" />)
  fireEvent.click(screen.getByRole('button', { name: 'この画面の説明' }))
  view.rerender(<Frame tab="approvals" explanation="保留期間は7日です" />)
  expect(screen.getByRole('region', { name: 'この画面の説明' }).textContent).toBe('保留期間は7日です')
  view.rerender(<Frame tab="approvals" explanation="保留期間は14日です" />)
  expect(screen.getByRole('region', { name: 'この画面の説明' }).textContent).toBe('保留期間は14日です')
  view.rerender(<Frame explanation="過去7日です" />)
  expect(screen.queryByRole('region', { name: 'この画面の説明' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'この画面の説明' }))
  expect(screen.getByRole('region', { name: 'この画面の説明' }).textContent).toBe('過去7日です')
})
