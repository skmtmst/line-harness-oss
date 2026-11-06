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

const tipOf = (toggle: HTMLElement) => document.getElementById(toggle.getAttribute('aria-describedby') ?? '')

it('既定の他タブへ入口を増やさず、指定した説明は題の「？」1つに用語の定義と一緒に入れる', () => {
  const view = render(<Frame tab="offers" />)
  expect(screen.queryByRole('button', { name: 'この画面の説明' })).toBeNull()
  expect(screen.getByRole('button', { name: '成果とアフィリエイトの説明' })).toBeTruthy()
  view.rerender(<Frame explanation="数えるのは認めた成果だけです" />)
  const toggle = screen.getByRole('button', { name: 'この画面の説明' })
  expect(screen.queryByRole('button', { name: '成果とアフィリエイトの説明' })).toBeNull()
  expect(screen.queryByText('数えるのは認めた成果だけです')).toBeNull()
  fireEvent.click(toggle)
  expect(tipOf(toggle)?.textContent).toContain('用語の定義')
  expect(tipOf(toggle)?.textContent).toContain('数えるのは認めた成果だけです')
  expect(screen.getAllByText('数えるのは認めた成果だけです')).toHaveLength(1)
  fireEvent.click(toggle)
  expect(tipOf(toggle)).toBeNull()
})

it('値の更新で開いている説明の本文を新しい値にする', () => {
  const view = render(<Frame tab="approvals" explanation="保留期間は7日です" />)
  const toggle = screen.getByRole('button', { name: 'この画面の説明' })
  fireEvent.click(toggle)
  expect(tipOf(toggle)?.textContent).toContain('保留期間は7日です')
  view.rerender(<Frame tab="approvals" explanation="保留期間は14日です" />)
  expect(tipOf(screen.getByRole('button', { name: 'この画面の説明' }))?.textContent).toContain('保留期間は14日です')
})
