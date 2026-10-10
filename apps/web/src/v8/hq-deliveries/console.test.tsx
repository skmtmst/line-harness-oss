// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => { process.env.NEXT_PUBLIC_API_URL = 'http://worker.test' })
const calls = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), update: vi.fn(), create: vi.fn(), preflight: vi.fn(), distribute: vi.fn(), accounts: vi.fn(), folders: vi.fn() }))
const role = vi.hoisted(() => ({ value: 'owner' as string | null }))
vi.mock('@/components/shared/hq-account-picker', () => ({ useHqAccountFolders: () => ({ folders:[], membership:new Map([['account-1',{folderId:null,folder:null}]]), failed:false }) }))
vi.mock('@/lib/api-hq-deliveries', () => ({ hqDeliveriesApi: calls }))
vi.mock('@/lib/hq-templates-api', () => ({ hqTemplatesApi: { accounts: calls.accounts, folders: { list: calls.folders } } }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => role.value, canManageRole: (value: string) => value === 'owner' || value === 'admin' }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {} }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))
import HqDeliveryConsole from './console'

const detail = {
  template: { id: 'delivery-1', name: '追加のお礼', description: null, template_type: 'friend_add_rule', revision: 2, distributed_account_count: 0, content_summary: '本文', distributed_account_names: [], distributed_account_more: 0 },
  definition: { schemaVersion: 1, references: [], settings: { name: '店での名前', friendKind: 'first_time', priority: 0, definition: { messageText: '最初の本文', routeIds: ['route-1'], actions: [] } } },
}
beforeEach(() => {
  vi.resetAllMocks(); role.value = 'owner'
  calls.list.mockResolvedValue([detail.template]); calls.detail.mockResolvedValue(structuredClone(detail)); calls.update.mockResolvedValue(detail)
  calls.accounts.mockResolvedValue([{ id: 'account-1', name: '本店' }]); calls.folders.mockResolvedValue([])
  calls.preflight.mockResolvedValue({ preflightId: 'run-1', stores: [{ accountId: 'account-1', accountName: '本店', items: [{ sourceId: 'delivery-1', name: '追加のお礼', allowedModes: ['create'] }] }] })
  calls.distribute.mockResolvedValue({ runId: 'run-1', status: 'completed', stores: [{ accountId: 'account-1', status: 'succeeded' }] })
})
afterEach(cleanup)

describe('統括の配信設定を共通の一覧と配布画面で扱う', () => {
  it('友だち追加の本文を入れ子の設定へ保存し、配布先を選べる', async () => {
    render(<HqDeliveryConsole type="friend_add_rule" />)
    fireEvent.click(await screen.findByRole('button', { name: '追加のお礼', exact: true }))
    const message = await screen.findByLabelText('最初に送る内容')
    expect((message as HTMLTextAreaElement).value).toBe('最初の本文')
    fireEvent.change(message, { target: { value: '新しい本文' } })
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存する' }))
    await waitFor(() => expect(calls.update).toHaveBeenCalled())
    const input = calls.update.mock.calls[0][1]
    expect(input.expectedRevision).toBe(2)
    expect(input.definition.settings.definition).toEqual({ messageText: '新しい本文', routeIds: ['route-1'], actions: [] })
    expect(input.definition.settings.messageText).toBeUndefined()
    expect(await screen.findByRole('checkbox', { name: '本店', exact: true })).toBeTruthy()
  })

  it('読込に失敗したひな形では配布先へ進まない', async () => {
    calls.detail.mockRejectedValue(new Error('offline'))
    render(<HqDeliveryConsole type="friend_add_rule" />)
    fireEvent.click(await screen.findByRole('button', { name: 'アカウントへ配る', exact: true }))
    expect(await screen.findByText('ひな形を開けませんでした。一覧を読み直してください。')).toBeTruthy()
    expect(screen.queryByRole('checkbox', { name: '本店', exact: true })).toBeNull()
    expect(calls.preflight).not.toHaveBeenCalled()
  })

  it.each([null, 'staff'])('閲覧のみ（%s）には作成・保存・配布の操作を出さない', async value => {
    role.value = value
    render(<HqDeliveryConsole type="friend_add_rule" />)
    const name = await screen.findByRole('button', { name: '追加のお礼', exact: true })
    expect(screen.queryByRole('button', { name: 'アカウントへ配る', exact: true })).toBeNull()
    expect(screen.queryByRole('button', { name: 'ひな形を作る', exact: true })).toBeNull()
    fireEvent.click(name)
    expect((await screen.findByLabelText('最初に送る内容') as HTMLTextAreaElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: '下書きを保存する' })).toBeNull()
  })

  it('選んだアカウントと確認番号を使って配り、成功を表示する', async () => {
    render(<HqDeliveryConsole type="friend_add_rule" />)
    fireEvent.click(await screen.findByRole('button', { name: 'アカウントへ配る', exact: true }))
    fireEvent.click(await screen.findByRole('checkbox', { name: '本店', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: '選んだ1アカウントを確かめる' }))
    await waitFor(() => expect(calls.preflight).toHaveBeenCalledWith('delivery-1', ['account-1']))
    fireEvent.click(await screen.findByRole('button', { name: '選んだ内容で配る' }))
    await waitFor(() => expect(calls.distribute).toHaveBeenCalledWith('delivery-1', 'run-1', [{ accountId: 'account-1', sourceId: 'delivery-1', mode: 'create' }]))
    expect(await screen.findByText('本店：完了')).toBeTruthy()
  })
})
