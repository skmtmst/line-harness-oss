// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import { IntakeAddressPanel, StoreForm } from '@/v8/restaurant/organization/organization-forms'
import { restaurantTestApi } from '@/lib/restaurant-test-api'
import { ApiError } from '@/lib/api'
import type { RestaurantStore } from '@/lib/restaurant-test-api'
import type { AccountWithStats } from '@/contexts/account-context'
import { describe, expect, test } from 'vitest'

vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
const store = { id: 'store-1', name: '試験店', code: 'S', area: '', capacity: 20, status: 'active', line_account_id: 'used', line_account_name: '使用中公式' } as RestaurantStore
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const consoleSource = readFileSync(resolve(process.cwd(), 'src/v8/restaurant/organization/organization.tsx'), 'utf8')
const copySource = readFileSync(resolve(process.cwd(), 'src/components/shared/copy-text-button.tsx'), 'utf8')
const apiSource = readFileSync(resolve(process.cwd(), 'src/lib/restaurant-test-api.ts'), 'utf8')

describe('飲食店向け予約メール取り込みアドレス画面', () => {
  test('一覧・発行APIを店舗単位で呼び分ける', () => {
    expect(apiSource).toContain('listIntakeAddresses:')
    expect(apiSource).toContain('issueIntakeAddress:')
    expect(apiSource).toContain('encodeURIComponent(storeId)')
  })

  test('未発行・コピー・再発行確認・ドメイン未設定を運用者へ表示する', async () => {
    const address = { id: 'mail-1', address: 'intake@example.test', status: 'active', createdAt: '2026-10-01T00:00:00Z', revokedAt: null }
    const list = vi.spyOn(restaurantTestApi, 'listIntakeAddresses').mockResolvedValue({ data: [] } as never)
    const issue = vi.spyOn(restaurantTestApi, 'issueIntakeAddress').mockResolvedValue({ success: true } as never)
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(writeText)
    const view = render(React.createElement(IntakeAddressPanel, { accountId: 'account-1', store, readOnly: false }))
    await screen.findByText('未設定')
    expect(screen.getByText('予約メール取り込みアドレス')).toBeTruthy()
    list.mockResolvedValue({ data: [address] } as never)
    fireEvent.click(screen.getByRole('button', { name: 'アドレスを発行' }))
    await screen.findByDisplayValue(address.address)
    fireEvent.click(screen.getByRole('button', { name: 'メールアドレスをコピー' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(address.address))
    await screen.findByText('コピーしました')
    issue.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'アドレスを発行' }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog.textContent).toContain('90日後に失効')
    expect(issue).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: '発行する' }))
    await waitFor(() => expect(issue).toHaveBeenCalledWith('account-1', 'store-1'))
    await screen.findByText(/旧アドレスは90日後に失効します/)
    view.unmount()
    list.mockRejectedValue(new ApiError(503, 'unconfigured'))
    render(React.createElement(IntakeAddressPanel, { accountId: 'account-1', store, readOnly: false }))
    await screen.findByText('取り込み用ドメインが未設定です')
    expect(consoleSource).not.toMatch(/console\.(?:log|warn|error)\([^\n]*address/)
    expect(copySource).toContain('navigator.clipboard.writeText(text)')
  })
})

describe('飲食店向け店舗とLINE公式アカウントの紐づけ画面', () => {
  test('店舗作成・編集APIを配線し、削除APIは持たない', () => {
    expect(apiSource).toContain('createStore:')
    expect(apiSource).toContain('updateStore:')
    expect(apiSource).toContain("method: 'PATCH'")
    expect(apiSource).not.toMatch(/deleteStore\s*:/)
  })

  test('LINE公式アカウントを必須選択にして使用中アカウントを選択不可にする', () => {
    const accounts = [{ id: 'used', name: '使用中公式' }, { id: 'free', name: '空いている公式' }] as AccountWithStats[]
    const submit = vi.fn()
    const view = render(React.createElement(StoreForm, { accounts, stores: [store], busy: false, onSubmit: submit, onCancel: () => {} }))
    expect(screen.getByRole('button', { name: 'LINE公式アカウント' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'LINE公式アカウント' }))
    const used = screen.getByRole('option', { name: '使用中公式（他店舗で使用中）' })
    const usedButton = within(used).getByRole('button')
    expect(usedButton.hasAttribute('disabled')).toBe(true)
    fireEvent.click(usedButton)
    expect(view.container.querySelector<HTMLInputElement>('input[name="lineAccountId"]')?.value).toBe('')
    expect(screen.queryByRole('button', { name: /店舗を削除/ })).toBeNull()
    view.unmount()
    render(React.createElement(StoreForm, { store, accounts, stores: [store], busy: false, onSubmit: submit, onCancel: () => {} }))
    expect(screen.getByRole('button', { name: 'LINE公式アカウント' }).textContent).toContain('使用中公式')
    fireEvent.click(screen.getByRole('button', { name: '状態' }))
    expect(screen.getByRole('option', { name: 'アーカイブ' })).toBeTruthy()
    expect(consoleSource).not.toMatch(/店舗を削除|deleteStore/)
  })
})
