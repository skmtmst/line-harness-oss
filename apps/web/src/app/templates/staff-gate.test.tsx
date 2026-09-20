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
const assetList = vi.hoisted(() => vi.fn())
const searchParams = vi.hoisted(() => ({ value: new URLSearchParams() }))

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
    broadcastMessageAssets: { list: assetList },
    folders: {
      list: () => Promise.resolve({ success: true, data: FOLDERS }),
      update: vi.fn(),
      delete: vi.fn(),
    },
    friendFields: { list: () => Promise.resolve({ success: true, data: [] }) },
    commonVars: { list: () => Promise.resolve({ success: true, data: [] }) },
    tags: { list: () => Promise.resolve({ success: true, data: [] }) },
    supportMarks: { list: () => Promise.resolve({ success: true, data: [] }) },
    scenarios: { list: () => Promise.resolve({ success: true, data: [] }) },
  },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: () => {}, replace: () => {}, refresh: () => {},
    back: () => {}, forward: () => {}, prefetch: () => {},
  }),
  useSearchParams: () => searchParams.value,
  usePathname: () => '/templates',
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href, ...rest }, children),
}))

import TemplatesPage from './page'
import TemplateEditPage from './edit/page'
import TemplateDetailPage from './detail/page'
import CarouselEditorPage from './carousel/page'
import QuestionTemplatePage from './questions/new/page'

function stubRole(role: string | null) {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'lh_staff_role' ? role : null),
    setItem: () => {},
    removeItem: () => {},
  })
}

const ASSETS = [
  { id: 'asset-1', name: '秋キャンペーン', kind: 'card_message', updatedAt: '2026-09-10T00:00:00.000Z', payload: {} },
]

beforeEach(() => {
  searchParams.value = new URLSearchParams()
  templateGet.mockReset()
  assetList.mockReset()
  assetList.mockImplementation(() => Promise.resolve({ success: true, data: ASSETS }))
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
    // tpl-1 は使用数があるので「…」メニューの中に「使用先を見る」が出る（U043）
    fireEvent.click(screen.getByLabelText('来店お礼のその他操作'))
    expect(screen.getByRole('menuitem', { name: '使用先を見る' })).toBeTruthy()
    fireEvent.keyDown(document.body, { key: 'Escape' })
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

describe('資産タブのstaffゲート (N-144)', () => {
  test('staffは資産の一覧を閲覧できるが、作成・編集・削除の操作は一切表示されない', async () => {
    stubRole('staff')
    await renderListAndWait()

    fireEvent.click(screen.getByText('カルーセル'))
    // 閲覧は残る（一覧が出る）
    expect(await screen.findByText('秋キャンペーン')).toBeTruthy()
    // 案内文が出る
    expect(screen.getByText(/オーナーと管理者だけができます。一覧の閲覧はこのまま使えます/)).toBeTruthy()
    // 変更系の操作は画面上に存在しない
    expect(screen.queryByText('カルーセルを作る')).toBeNull()
    expect(screen.queryByText('編集')).toBeNull()
    expect(screen.queryByText('削除')).toBeNull()
    // 閲覧系の遷移（一斉配信で使う）は残る
    expect(screen.getByText('一斉配信で使う')).toBeTruthy()
  })

  test('ownerの資産タブは変更系の操作も従来どおり出る', async () => {
    stubRole('owner')
    await renderListAndWait()

    fireEvent.click(screen.getByText('カルーセル'))
    // owner には作成ボタンと各カードの編集・削除が出る
    expect(await screen.findByText('カルーセルを作る')).toBeTruthy()
    expect(screen.getByText('編集')).toBeTruthy()
    expect(screen.getByText('削除')).toBeTruthy()
    expect(screen.queryByText(/オーナーと管理者だけができます。一覧の閲覧はこのまま使えます/)).toBeNull()
  })
})

describe('テンプレート詳細画面のstaffゲート (N-144)', () => {
  test('staffには編集・削除ボタンが出ず、中身は読める', async () => {
    stubRole('staff')
    searchParams.value = new URLSearchParams('id=tpl-1')
    render(<TemplateDetailPage />)
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })

    // 閲覧は残る（本文が読める — 本文とプレビューの2箇所に出る）
    expect((await screen.findAllByText('ご来店ありがとうございました。')).length).toBeGreaterThan(0)
    // 編集・削除の口は出ない（セクションの見出し自体も出さない）
    expect(screen.queryByText('テンプレートを編集')).toBeNull()
    expect(screen.queryByText('テンプレートを削除')).toBeNull()
    expect(screen.queryByText('使用中のため削除できません')).toBeNull()
    expect(screen.queryByText('このテンプレートを削除する')).toBeNull()
  })

  test('ownerには編集・削除ボタンが出る', async () => {
    stubRole('owner')
    searchParams.value = new URLSearchParams('id=tpl-1')
    render(<TemplateDetailPage />)
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })

    expect((await screen.findAllByText('ご来店ありがとうございました。')).length).toBeGreaterThan(0)
    expect(screen.getByText('テンプレートを編集')).toBeTruthy()
  })
})

describe('カルーセル編集画面のstaffゲート (N-144)', () => {
  test('staffが正規導線から来てもフォームは出ず案内だけが出る', async () => {
    stubRole('staff')
    render(<CarouselEditorPage />)
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText('カルーセルの作成・変更はオーナーと管理者だけができます')).toBeTruthy()
    expect(screen.getByText('一覧へ戻る')).toBeTruthy()
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
