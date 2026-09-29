// @vitest-environment happy-dom
/*
 * R527: 作成・編集のURLを直接開いた見るだけ（staff）にも保存の入口を出さない。
 * owner には出す。実マウントと文字契約で固定する。
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
      '自動応答の作成・変更はオーナーと管理者だけができます',
    )
  })

  it('owner には作成の手順が出る', async () => {
    staffMe.mockResolvedValue({ success: true, data: { role: 'owner' } })
    await act(async () => { root.render(<AutoReplyEditPage />) })
    await flush()
    expect(host.querySelector('[data-design="Steps"]')).not.toBeNull()
    expect(host.textContent).not.toContain(
      '自動応答の作成・変更はオーナーと管理者だけができます',
    )
  })
})

/*
 * 直しを戻すと赤くなる文字契約。実マウントの試験が本命で、
 * こちらは分岐の削除・無条件表示への戻しを見張る。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

describe('R527 編集URLの出し分け契約', () => {
  it('変更の可否は共通の出し分けで決める', () => {
    expect(PAGE).toContain("from '@/lib/staff-role'")
    expect(PAGE).toContain('useStaffRole')
    expect(PAGE).toContain('canManageRole')
  })

  it('手順と編集窓が canManage で守られている', () => {
    expect(PAGE).toContain(') : draft && canManage ? (')
    expect(PAGE).toContain('{error && canManage && (')
    expect(PAGE).toContain('自動応答の作成・変更はオーナーと管理者だけができます')
  })
})
