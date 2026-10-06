// @vitest-environment happy-dom
/*
 * V8 テンプレートの一覧（src/v8）の動きの試験。BEHAVIOR.md の主な動きを守る。
 * 行が出る・公開の札・閲覧のみの帯（サーバの役割で決まる）・
 * 使っていないものは削除の確認（V6JFnd）、使っているものは削除できない窓（Z0g3si）。
 */
import React, { act } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const listTemplates = vi.hoisted(() => vi.fn())
const usages = vi.hoisted(() => vi.fn())
const removeTemplate = vi.hoisted(() => vi.fn())
const role = vi.hoisted(() => ({ value: 'owner' as string | null }))

vi.mock('next/link', () => ({
  default: ({ children, href, className, title }: { children: React.ReactNode; href: string; className?: string; title?: string }) => (
    <a href={typeof href === 'string' ? href : '#'} className={className} title={title}>{children}</a>
  ),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/templates',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ accounts: [{ id: 'account-1', name: '本店' }], selectedAccountId: 'account-1', loading: false }),
}))
vi.mock('@/lib/staff-capability', () => ({ isOwnerOrAdmin: () => true }))
vi.mock('@/lib/staff-role', () => ({
  useStaffRole: () => role.value,
  canManageRole: (r: string | null | undefined) => r === 'owner' || r === 'admin',
}))
vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
}))
vi.mock('@/lib/use-narrow-viewport', () => ({ useNarrowViewport: () => false }))
vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    status = 0
  },
  api: {
    templates: { list: listTemplates, usages, delete: removeTemplate },
    broadcastMessageAssets: { counts: () => Promise.resolve({ success: true, data: { card_message: 4 } }) },
    folders: { list: () => Promise.resolve({ success: true, data: [], unfiledCount: 2 }) },
  },
}))

import TemplatesListV8 from './list'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const base = {
  category: '',
  messageType: 'text',
  folderId: null,
  question: null,
  questionStatus: 'published',
  tapCount: 0,
  monthlySendCount: 10,
  totalSendCount: 20,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-22T00:00:00.000Z',
}
const used = { ...base, id: 't-used', name: '予約前日のご案内', messageContent: '明日のご予約です', usageCount: 11, publishedAt: '2026-08-01T00:00:00.000Z', hasDraft: true }
const unused = { ...base, id: 't-unused', name: '秋の新商品（画像）', messageType: 'image', messageContent: '画像 1枚', usageCount: 0, publishedAt: null, hasDraft: true }

async function renderList() {
  await act(async () => {
    render(<TemplatesListV8 />)
  })
  await act(async () => {
    await Promise.resolve()
  })
}

function openMenuAndDelete(name: string) {
  fireEvent.click(screen.getByRole('button', { name: `テンプレート「${name}」の操作` }))
  fireEvent.click(screen.getByText('削除する'))
}

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  role.value = 'owner'
  listTemplates.mockResolvedValue({ success: true, data: [used, unused] })
  usages.mockResolvedValue({
    success: true,
    data: {
      broadcasts: [{ broadcastId: 'b1', title: '9月の予約リマインド', status: 'scheduled', scheduledAt: null, templateVersionNumber: 2, referenceMode: 'fixed' }],
      autoReplies: [{ id: 'a1', keyword: '予約変更のお問い合わせ', lineAccountId: null, templateVersion: null }],
      scenarioSteps: [{ scenarioId: 's1', scenarioName: '予約フォロー', stepId: 'st1', stepOrder: 1, templateVersion: null }],
    },
  })
  removeTemplate.mockResolvedValue({ success: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('V8 テンプレートの一覧', () => {
  it('行と公開の札（未公開の変更・下書きだけ）が出る', async () => {
    await renderList()
    expect(screen.getByText('予約前日のご案内')).toBeTruthy()
    expect(screen.getByText('未公開の変更')).toBeTruthy()
    expect(screen.getByText('下書きだけ')).toBeTruthy()
    expect(screen.getByText('11か所')).toBeTruthy()
  })

  it('サーバの役割が staff なら閲覧のみの帯が出て、作るボタンは押せない', async () => {
    role.value = 'staff'
    await renderList()
    expect(screen.getByText('閲覧のみで見ています。変える操作は管理者に頼んでください。')).toBeTruthy()
    const create = screen.getAllByRole('button', { name: /テンプレートを作る/ })[0] as HTMLButtonElement
    expect(create.disabled).toBe(true)
  })

  it('オーナーには閲覧のみの帯を出さない', async () => {
    await renderList()
    expect(screen.queryByText('閲覧のみで見ています。変える操作は管理者に頼んでください。')).toBeNull()
  })

  it('使っていないものは削除の確認を開き、押すと消す', async () => {
    await renderList()
    openMenuAndDelete('秋の新商品（画像）')
    expect(screen.getByText('「秋の新商品（画像）」を削除する')).toBeTruthy()
    expect(screen.getByText('削除は元に戻せません。')).toBeTruthy()
    const dialog = screen.getByRole('dialog')
    const confirm = [...dialog.querySelectorAll('button')].find((b) => b.textContent === '削除する') as HTMLButtonElement
    await act(async () => {
      fireEvent.click(confirm)
    })
    expect(removeTemplate).toHaveBeenCalledWith('t-unused')
  })

  it('使っているものは消させず、使っている所を2行と残りの数で見せる', async () => {
    await renderList()
    openMenuAndDelete('予約前日のご案内')
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByText('「予約前日のご案内」はまだ消せません')).toBeTruthy()
    expect(screen.getByText('9月の予約リマインド')).toBeTruthy()
    expect(screen.getByText('予約変更のお問い合わせ')).toBeTruthy()
    expect(screen.queryByText('予約フォロー・1通目')).toBeNull()
    expect(screen.getByText('ほか 9 か所')).toBeTruthy()
    expect(screen.getAllByText('開いて差し替える')).toHaveLength(2)
    expect(removeTemplate).not.toHaveBeenCalled()
  })
})
