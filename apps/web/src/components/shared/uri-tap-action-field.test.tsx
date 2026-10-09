// @vitest-environment happy-dom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import UriTapActionField from './uri-tap-action-field'

vi.mock('@/lib/use-admin-theme', () => ({ useAdminTheme: () => 'v8' }))
const account = vi.hoisted(() => ({ value: { selectedAccountId: 'a1', selectedAccount: { id: 'a1', liffId: 'L-1' }, accounts: [{ id: 'a1', liffId: 'L-1' }, { id: 'a2', liffId: null }] } }))
vi.mock('@/contexts/account-context', () => ({ useOptionalAccount: () => account.value }))
vi.mock('@/lib/api', () => ({ api: { forms: { list: async () => ({ success: true, data: [] }) } }, bookingApi: { listMenus: async () => ({ menus: [] }) } }))
vi.mock('@/lib/visit-stamps-api', () => ({ visitStampsApi: { cards: async () => ({ success: true, data: [] }) } }))
afterEach(cleanup)

const seen: string[] = []
function Harness({ accountId, initial = '' }: { accountId?: string | null; initial?: string }) {
  const [url, setUrl] = useState(initial)
  seen.push(url)
  return <UriTapActionField name="ボタン" url={url} accountId={accountId} onChange={setUrl} />
}
const pick = (label: string) => {
  fireEvent.click(screen.getByRole('button', { name: 'ボタンを押したら' }))
  fireEvent.click(within(screen.getByRole('listbox')).getByText(label))
}

test('URL だけを保存する所：予約を選ぶとアカウントの LIFF の URL、URL に戻すと空から', () => {
  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: 'ボタンを押したら' }))
  // テキストを送るは URL で持てないので出さない。
  expect(within(screen.getByRole('listbox')).queryByText('テキストを送る')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'ボタンを押したら' }))
  pick('予約')
  expect(seen.at(-1)).toBe('https://liff.line.me/L-1/?page=salon-book')
  pick('URLを開く')
  expect(seen.at(-1)).toBe('')
})

test('保存してある LIFF の URL は種類に戻り、LIFF の無いアカウントでは案内が出る', () => {
  render(<Harness accountId="a2" initial="https://liff.line.me/L-9/?page=salon-book&view=history" />)
  expect(screen.getByRole('button', { name: 'ボタンを押したら' }).textContent).toContain('予約履歴')
  expect(screen.getByText('この動きは LIFF の設定が要ります')).toBeTruthy()
})
