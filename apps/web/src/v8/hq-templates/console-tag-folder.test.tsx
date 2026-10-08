// @vitest-environment happy-dom
/*
 * 統括のタグのひな形を作る画面は、上の「フォルダ」を出さない（中の「所属フォルダ」と同じ物が2つに見える・オーナー 10-08）。
 */
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => Object.fromEntries(['context', 'list', 'listByKind', 'kindCounts', 'accounts', 'get', 'create', 'update', 'remove', 'duplicate', 'preflight', 'distribute', 'result', 'messageReferences', 'folderList', 'deleteImage', 'uploadRichMessageImage', 'listStats', 'versions', 'receivedVersions', 'compareVersions', 'restoreVersion'].map((key) => [key, vi.fn()])))
const push = vi.hoisted(() => vi.fn())
const selectAccount = vi.hoisted(() => vi.fn())
vi.mock('@/lib/hq-templates-api', () => ({ TEMPLATE_TYPES: ['tag', 'template', 'rich_menu', 'form', 'scenario'], hqTemplatesApi: { ...calls, folders: { list: calls.folderList } } }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/hq/templates',
}))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner', canManageRole: () => true }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ accounts: [], selectedAccountId: null, selectedAccount: null, setSelectedAccountId: selectAccount, loading: false }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/components/auto-replies/inline-action-list', () => ({ useActionOptions: () => ({ tags: [], scenarios: [], templates: [], forms: [], reminders: [], richMenus: [] }) }))

import HqTemplatesV8 from './console'

const Editor = () => <div data-testid="definition-editor"><label>所属フォルダ<select aria-label="所属フォルダ"><option>未分類</option></select></label></div>

beforeEach(() => {
  calls.context.mockResolvedValue({ tenantId: 'tenant-a', actorId: 'owner' })
  calls.list.mockResolvedValue([])
  calls.listByKind.mockResolvedValue([])
  calls.kindCounts.mockResolvedValue({})
  calls.accounts.mockResolvedValue([])
  calls.folderList.mockResolvedValue([{ id: 'f-1', name: '予約', revision: 1 }])
  calls.messageReferences.mockResolvedValue([])
  calls.listStats.mockResolvedValue({ thisMonthSentCount: 0, outdatedTemplateCount: 0 })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

const openCreate = async (type: 'tag') => {
  render(<HqTemplatesV8 type={type} DefinitionEditor={Editor as never} />)
  const buttons = await screen.findAllByRole('button', { name: /作る|作成/ })
  fireEvent.click(buttons[0])
  await screen.findByTestId('definition-editor')
}

describe('統括のひな形を作る：フォルダの欄が2つにならない', () => {
  it('タグは上の「フォルダ」を出さず、中の「所属フォルダ」だけ', async () => {
    await openCreate('tag')
    expect(screen.queryByRole('combobox', { name: 'フォルダ' })).toBeNull()
    expect(screen.queryByLabelText('フォルダ')).toBeNull()
    expect(screen.getByLabelText('所属フォルダ')).toBeTruthy()
  })
})
