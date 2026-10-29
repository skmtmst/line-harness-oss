// @vitest-environment happy-dom
/*
 * 10：絞り込み欄の閉じた姿は「頭：すべて」（既定は灰・選択で黒太字＋緑枠）。
 * valuePrefix を外すと、選んだ値に頭が付かなくなるので赤くなる。
 */
import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => '/friends' }))
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'A', loading: false }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner', canManageRole: () => true }))
vi.mock('@/lib/use-feature-visibility', () => ({ useFeatureVisibility: () => ({ enabled: () => false }) }))
vi.mock('@/lib/use-narrow-viewport', () => ({ useNarrowViewport: () => false }))
vi.mock('@/lib/operators-cache', () => ({ loadOperators: async () => [] }))
vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      friends: { list: async () => ({ success: true, data: { items: [], total: 0 } }) },
      friendStats: { get: async () => ({ success: false }) },
      tags: { list: async () => ({ success: true, data: [{ id: 't1', name: 'VIP' }] }) },
      scenarios: { list: async () => ({ success: true, data: [] }) },
    },
  }
})

import List from './list'

afterEach(() => { cleanup(); sessionStorage.clear() })

function fieldOf(buttonName: string): HTMLElement {
  const button = screen.getByRole('button', { name: buttonName })
  const field = button.closest('[data-entity-picker-field]') as HTMLElement | null
  expect(field, `絞り込み欄「${buttonName}」`).toBeTruthy()
  return field!
}

test('タグの絞り込みは既定で「タグ：すべて」を出す', async () => {
  render(<List />)
  const field = fieldOf('タグで絞り込む')
  expect(field.textContent).toContain('タグ：すべて')
  const outer = field.parentElement?.closest('[data-entity-picker-field]') ?? field
  expect(outer.hasAttribute('data-entity-default')).toBe(true)
})

test('タグを選ぶと「タグ：VIP」を選択中（黒太字＋緑枠）で出す', async () => {
  render(<List />)
  fireEvent.click(screen.getByRole('button', { name: 'タグで絞り込む' }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('radio', { name: 'VIP' }))
  fireEvent.click(within(dialog).getByRole('button', { name: '選ぶ' }))
  const field = fieldOf('タグで絞り込む')
  expect(field.querySelector('[data-select-head]')?.textContent).toBe('タグ：')
  expect(field.querySelector('[data-select-current]')?.textContent).toBe('VIP')
  expect(field.querySelector('[data-select-current]')?.getAttribute('data-filter-state')).toBe('active')
})

test('絞り込みパネルの担当者・シナリオも既定は頭付きで出す', async () => {
  render(<List />)
  fireEvent.click(screen.getByRole('button', { name: '絞り込み' }))
  expect(fieldOf('担当で絞り込む').textContent).toContain('担当者：すべて')
  expect(fieldOf('シナリオで絞り込む').textContent).toContain('シナリオ：すべて')
})
