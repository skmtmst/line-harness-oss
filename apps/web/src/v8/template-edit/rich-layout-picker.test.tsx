// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import TemplateRichEditor from './rich'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'acc-1', accounts: [] }) }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner', canManageRole: () => true }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {} }))
vi.mock('@/components/auto-replies/inline-action-list', () => ({ useActionOptions: () => ({ tags: [], fields: [], marks: [], scenarios: [], vars: [], notificationRules: [] }) }))
vi.mock('@/lib/api', () => ({ api: { folders: { list: async () => ({ success: true, data: [] }) } } }))
beforeEach(() => document.documentElement.setAttribute('data-theme', 'v8'))
afterEach(() => { cleanup(); document.documentElement.removeAttribute('data-theme') })

const areaRows = () => screen.getByRole('heading', { name: '押した面ごとの動き' }).parentElement!.parentElement!
it('6形の順を保ち、キーで形を変えると見本と同じA・Bの設定行になる', () => {
  render(<TemplateRichEditor />)
  const group = screen.getByRole('radiogroup', { name: '面の分け方' })
  expect(within(group).getAllByRole('radio').map((input) => input.getAttribute('aria-label'))).toEqual([
    '1面（面 A）', '上下2面（面 A・B）', '左右2面（面 A・B）', '上1・下2（面 A・B・C）', '4面（面 A・B・C・D）', '6面（面 A・B・C・D・E・F）',
  ])
  expect(within(areaRows()).getByText('C 右下')).toBeTruthy()
  const one = within(group).getByRole('radio', { name: '1面（面 A）' })
  fireEvent.click(one)
  expect(within(areaRows()).getByText('A 全体')).toBeTruthy()
  expect(within(areaRows()).queryByText(/^B /)).toBeNull()
  fireEvent.keyDown(one, { key: 'ArrowRight' })
  const two = within(group).getByRole('radio', { name: '上下2面（面 A・B）' }) as HTMLInputElement
  expect(two.checked).toBe(true)
  expect(two.parentElement?.textContent).toBe('AB✓上下2面')
  expect(within(areaRows()).getByText('A 上')).toBeTruthy()
  expect(within(areaRows()).getByText('B 下')).toBeTruthy()
  expect(within(areaRows()).queryByText(/^C /)).toBeNull()
})
it('設定済みのBが消える形は確認してから変え、取り消すと元の形と設定を保つ', async () => {
  render(<TemplateRichEditor visual />)
  fireEvent.click(screen.getByRole('radio', { name: '1面（面 A）' }))
  const dialog = screen.getByRole('dialog')
  expect(dialog.textContent).toContain('B')
  expect((screen.getByRole('radio', { name: '上下2面（面 A・B）' }) as HTMLInputElement).checked).toBe(true)
  fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(within(areaRows()).getByText('B 下')).toBeTruthy()
  fireEvent.click(screen.getByRole('radio', { name: '1面（面 A）' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /変える|変更/ }))
  expect((screen.getByRole('radio', { name: '1面（面 A）' }) as HTMLInputElement).checked).toBe(true)
  expect(within(areaRows()).queryByText(/^B /)).toBeNull()
})
