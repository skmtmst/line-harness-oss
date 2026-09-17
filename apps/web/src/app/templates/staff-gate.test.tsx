// @vitest-environment happy-dom
/*
 * N-144: staff はテンプレートを「読めるが変えられない」。
 *
 * 作成・編集・公開・削除のAPIは requireRole('owner','admin') で閉じている。
 * staff へ操作を出すと押した先で 403 になるだけなので、画面側でも出さない。
 * この試験は実マウントで、staff に変更系の入口が1つも出ず、閲覧だけは
 * 残ることを固定する。owner/admin では入口が出る対照も入れる。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

const templateGet = vi.hoisted(() => vi.fn())

const TEMPLATES = [
  {
    id: 'tpl-1', name: '来店お礼', category: 'general', messageType: 'text',
    messageContent: 'ご来店ありがとうございました。', folderId: null, question: null,
    usageCount: 3, updatedAt: '2026-09-01T00:00:00.000Z', createdAt: '2026-09-01T00:00:00.000Z',
  },
]

const FOLDERS = [
  { id: 'folder-1', name: '予約', itemCount: 1, color: null, displayOrder: 1 },
]

const EMPTY_USED_BY = {
  autoReplies: [], automations: [], scenarioSteps: [],
  reminderSteps: [], richMenuAreas: [], trackedLinks: [],
}

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', accounts: [], loading: false }),
}))

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    templates: {
      list: () => Promise.resolve({ success: true, data: TEMPLATES }),
      get: templateGet,
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      publish: vi.fn(),
    },
    broadcastMessageAssets: { list: () => Promise.resolve({ success: true, data: [] }) },
    folders: {
      list: () => Promise.resolve({ success: true, data: FOLDERS }),
      update: vi.fn(),
      delete: vi.fn(),
    },
    friendFields: { list: () => Promise.resolve({ success: true, data: [] }) },
    commonVars: { list: () => Promise.resolve({ success: true, data: [] }) },
  },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: () => {}, replace: () => {}, refresh: () => {},
    back: () => {}, forward: () => {}, prefetch: () => {},
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/templates',
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href, ...rest }, children),
}))

import TemplatesPage from './page'
import TemplateEditPage from './edit/page'
import QuestionTemplatePage from './questions/new/page'

function stubRole(role: string | null) {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'lh_staff_role' ? role : null),
    setItem: () => {},
    removeItem: () => {},
  })
}

beforeEach(() => {
  templateGet.mockReset()
  templateGet.mockImplementation((id: string) => Promise.resolve({
    success: true,
    data: {
      ...(TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0]),
      usedBy: EMPTY_USED_BY,
      hasDraft: true, publishedVersion: 1, publishedAt: '2026-09-01T00:00:00.000Z',
      draftVersion: 2, carouselActions: null, carouselTapLimitMode: 'none',
      carouselTapLimitText: null, questionStatus: 'draft',
    },
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function renderListAndWait() {
  render(<TemplatesPage />)
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
  await screen.findByText('来店お礼')
}

describe('テンプレート一覧のstaffゲート (N-144)', () => {
  test('staffには作成・質問作成・フォルダ追加・削除が出ず、閲覧だけ残る', async () => {
    stubRole('staff')
    await renderListAndWait()

    // 変更系の入口はひとつも出ない
    expect(screen.queryByText('テンプレートを作る')).toBeNull()
    expect(screen.queryByText('質問を作る')).toBeNull()
    expect(screen.queryByText('フォルダを追加')).toBeNull()
    // 行の削除系操作（使用数で分岐する両形）も出ない
    expect(screen.queryByText('使用先を見る')).toBeNull()
    expect(screen.queryByText('テンプレートを削除')).toBeNull()

    // フォルダ行の操作メニュー（編集・並び替え・削除の入口）も出ない
    expect(screen.queryByLabelText('フォルダ「予約」の操作')).toBeNull()

    // 代わりに「なぜ出ないか」の説明と、閲覧そのものは残る
    expect(screen.getByText(/オーナーと管理者だけができます/)).toBeTruthy()
    expect(screen.getByRole('link', { name: '来店お礼の詳細を開く' })).toBeTruthy()
    // フォルダ自体は閲覧できる（操作だけが消える）
    expect(screen.getByText('予約')).toBeTruthy()
  })

  test('staffでも行を開いて中身は読めるが、公開・置き場変更・名前編集は出ない', async () => {
    stubRole('staff')
    await renderListAndWait()

    fireEvent.keyDown(screen.getByRole('link', { name: '来店お礼の詳細を開く' }), { key: 'Enter' })
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })
    expect(templateGet).toHaveBeenCalledWith('tpl-1')

    // hasDraft=true でも公開ボタンは出ない
    expect(screen.queryByText('公開する')).toBeNull()
    // 置き場は読み取り表示（SelectField ではない）
    expect(screen.queryByLabelText('置き場')).toBeNull()
    expect(screen.getAllByText('未分類').length).toBeGreaterThan(0)
    // 名前を押しても編集欄は開かない
    fireEvent.click(screen.getByText('来店お礼', { selector: 'h3' }))
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByDisplayValue('来店お礼')).toBeNull()
  })

  test('ownerには作成・フォルダ追加・削除・公開の入口が出る', async () => {
    stubRole('owner')
    await renderListAndWait()

    expect(screen.getByText('テンプレートを作る')).toBeTruthy()
    expect(screen.getByText('質問を作る')).toBeTruthy()
    expect(screen.getByText('フォルダを追加')).toBeTruthy()
    // tpl-1 は使用数があるので「使用先を見る」形で出る
    expect(screen.getByText('使用先を見る')).toBeTruthy()
    // フォルダ行の操作メニューも出る
    expect(screen.getByLabelText('フォルダ「予約」の操作')).toBeTruthy()

    fireEvent.keyDown(screen.getByRole('link', { name: '来店お礼の詳細を開く' }), { key: 'Enter' })
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText('公開する')).toBeTruthy()
    expect(screen.getByLabelText('置き場')).toBeTruthy()
  })

  test('adminにも変更系の入口が出る', async () => {
    stubRole('admin')
    await renderListAndWait()
    expect(screen.getByText('テンプレートを作る')).toBeTruthy()
    expect(screen.getByText('フォルダを追加')).toBeTruthy()
  })
})

describe('テンプレート編集画面のstaffゲート (N-144)', () => {
  test('staffがURL直打ちしてもフォームは出ず、案内だけが出る', async () => {
    stubRole('staff')
    render(<TemplateEditPage />)
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText('テンプレートの作成・変更はオーナーと管理者だけができます')).toBeTruthy()
    expect(screen.getByText('一覧へ戻る')).toBeTruthy()
  })
})

describe('質問テンプレート画面のstaffゲート (N-144)', () => {
  test('staffがURL直打ちしてもフォームは出ず、案内だけが出る', async () => {
    stubRole('staff')
    render(<QuestionTemplatePage />)
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText('質問テンプレートの作成・変更はオーナーと管理者だけができます')).toBeTruthy()
    expect(screen.getByText('一覧へ戻る')).toBeTruthy()
  })
})
