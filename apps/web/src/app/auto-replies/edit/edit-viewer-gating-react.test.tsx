// @vitest-environment happy-dom
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1', selectedAccount: null, loading: false, accounts: [{ id: 'account-1' }] }) }))
/*
 * R527: 作成・編集のURLを直接開いた見るだけ（staff）にも保存の入口を出さない。
 * owner には出す。実マウントで固定する。
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AutoReplyEditPage from './page'

const staffMe = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {} }))
vi.mock('@/lib/api', () => ({
  api: {
    templates: { list: vi.fn(async () => ({ success: true, data: [] })) },
    folders: { list: vi.fn(async () => ({ success: true, data: [] })) },
    staff: { me: staffMe },
    autoReplies: {
      create: vi.fn(),
      update: vi.fn(),
      saveDraft: vi.fn(),
      getDraft: vi.fn(),
      get: vi.fn(),
      conflicts: vi.fn(),
      summary: vi.fn(),
    },
  },
}))
vi.mock('@/components/auto-replies/inline-action-list', () => ({
  default: () => null,
  useActionOptions: () => ({ tags: [], fields: [], marks: [], scenarios: [], vars: [] }),
}))
vi.mock('@/components/shared/condition-builder', () => ({ default: () => null }))
vi.mock('@/components/shared/image-uploader', () => ({ default: () => null }))
vi.mock('@/components/shared/sticky-bar', () => ({
  default: ({ actions }: { actions: ReactNode }) => <div>{actions}</div>,
}))

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.restoreAllMocks()
})

const flush = () =>
  act(async () => {
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

describe('R527 編集URLの出し分け（役割×操作）', () => {
  it('staff には作成の手順と保存の入口が出ず、理由が出る', async () => {
    staffMe.mockResolvedValue({ success: true, data: { role: 'staff' } })
    await act(async () => { root.render(<AutoReplyEditPage />) })
    await flush()
    expect(host.querySelector('[data-design="Steps"]')).toBeNull()
    expect(host.textContent).toContain(
      'オーナーか管理者に頼んでください',
    )
  })

  it('owner には作成の手順が出る', async () => {
    staffMe.mockResolvedValue({ success: true, data: { role: 'owner' } })
    await act(async () => { root.render(<AutoReplyEditPage />) })
    await flush()
    expect(host.querySelector('[data-design="Steps"]')).not.toBeNull()
    expect(host.textContent).not.toContain(
      'オーナーか管理者に頼んでください',
    )
  })
})
