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
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

const identity = vi.hoisted(() => ({ role: 'owner' as string | null }))
const templateGet = vi.hoisted(() => vi.fn())
const assetList = vi.hoisted(() => vi.fn())
const assetFolderCreate = vi.hoisted(() => vi.fn())
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
    staff: { me: async () => ({ success: true, data: { role: identity.role } }) },
    templates: {
      list: () => Promise.resolve({ success: true, data: TEMPLATES }),
      get: templateGet,
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      publish: vi.fn(),
    },
    broadcastMessageAssets: {
      list: assetList,
      folders: { list: async () => ({ success: true, data: [] }), create: assetFolderCreate },
      counts: () => Promise.resolve({ success: true, data: { card_message: 0, rich_message: 0, coupon: 0, research: 0 } }),
    },
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

vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(),
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
  identity.role = role
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
  window.history.replaceState(null, '', '/templates')
  searchParams.value = new URLSearchParams()
  templateGet.mockReset()
  assetList.mockReset()
  assetFolderCreate.mockReset()
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

/*
 * 一覧の行の有無・操作は表側で見る。767px以下のカード（`MobileTableCards`）
 * にも同じ文・操作が出るので、画面全体では1件に定まらない。
 */
const table = () => within(screen.getByRole('table'))

async function renderListAndWait() {
  render(<TemplatesPage />)
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
  await within(await screen.findByRole('table')).findByText('来店お礼')
}

describe('テンプレート一覧のstaffゲート (N-144)', () => {
  test('staffには作成・質問作成・フォルダ追加・削除が出ず、閲覧だけ残る', async () => {
    stubRole('staff')
    await renderListAndWait()

    // 変更系の入口はひとつも出ない
    expect(screen.queryByText('テンプレートを作る')).toBeNull()
    expect(screen.queryByText('質問を作る')).toBeNull()
    expect(screen.queryByRole('button', { name: 'フォルダを追加' })).toBeNull()
    // 行の削除系操作（使用数で分岐する両形）も出ない
    expect(screen.queryByText('使用先を見る')).toBeNull()
    expect(screen.queryByText('テンプレートを削除する')).toBeNull()

    // フォルダ行の操作メニュー（編集・並び替え・削除の入口）も出ない
    expect(screen.queryByLabelText('フォルダ「予約」の操作')).toBeNull()

    // 代わりに「なぜ出ないか」の説明と、閲覧そのものは残る
    expect(screen.getByText('この画面を変える権限がありません。変えたい時はオーナーか管理者に頼んでください。')).toBeTruthy()
    expect(table().getByText('来店お礼').closest('tr')!).toBeTruthy()
    // フォルダ自体は閲覧できる（操作だけが消える）
    expect(screen.getByText('予約')).toBeTruthy()
  })

  test('staffでも行を開いて中身は読めるが、公開・置き場変更・名前編集は出ない', async () => {
    stubRole('staff')
    await renderListAndWait()

    fireEvent.keyDown(table().getByText('来店お礼').closest('tr')!, { key: 'Enter' })
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })
    expect(templateGet).toHaveBeenCalledWith('tpl-1')

    // hasDraft=true でも公開ボタンは出ない
    expect(screen.queryByText('公開する')).toBeNull()
    // 置き場は読み取り表示（選び欄ではない）
    expect(screen.queryByLabelText('置き場')).toBeNull()
    expect(screen.getAllByText('未分類').length).toBeGreaterThan(0)
    // 名前を押しても編集欄は開かない
    fireEvent.click(within(screen.getByRole('dialog')).getByText('来店お礼', { selector: 'h2' }))
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByDisplayValue('来店お礼')).toBeNull()
  })

  test('ownerには作成・フォルダ追加・削除・公開の入口が出る', async () => {
    stubRole('owner')
    await renderListAndWait()

    expect(screen.getAllByRole('link', { name: 'メッセージを作る' })[0].getAttribute('href')).toBe('/templates/edit')
    fireEvent.click(screen.getByRole('button', { name: '見本から作る' }))
    const picker = await screen.findByRole('dialog', { name: 'どの種類を作りますか' })
    expect(within(picker).getByRole('link', { name: '質問' }).getAttribute('href')).toBe('/templates/questions/new')
    fireEvent.click(within(picker).getByRole('button', { name: 'キャンセル' }))
    await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'どの種類を作りますか' })).toBeNull())
    expect(screen.getByRole('button', { name: 'フォルダを追加' })).toBeTruthy()
    // tpl-1 は使用数があるので「…」メニューの中に「使用先を見る」が出る（U043）。
    // メニューは最上層の器（MenuPortal）に出るので表の中には無い。表とカードの
    // 両方に「…」があり、開くと両方の面の分が出る。
    fireEvent.click(table().getByLabelText('テンプレート「来店お礼」の操作'))
    expect(screen.getByRole('menuitem', { name: '使っている所を見る' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '削除する' })).toBeTruthy()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    // フォルダ行の操作メニューも出る
    expect(screen.getByLabelText('フォルダ「予約」の操作')).toBeTruthy()

    fireEvent.keyDown(table().getByText('来店お礼').closest('tr')!, { key: 'Enter' })
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText('公開する')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'フォルダへ移す' }))
    expect(screen.getByLabelText('移動先のフォルダ')).toBeTruthy()
  })

  test('adminにも変更系の入口が出る', async () => {
    stubRole('admin')
    await renderListAndWait()
    expect(screen.getAllByRole('link', { name: 'メッセージを作る' })[0].getAttribute('href')).toBe('/templates/edit')
    expect(screen.getByRole('button', { name: 'フォルダを追加' })).toBeTruthy()
  })
})

describe('種類ごとの作成入口', () => {
  test.each([
    ['メッセージ', '/templates/edit'],
    ['カルーセル', '/templates/carousel'],
    ['リッチメッセージ', '/templates/edit?kind=rich_message'],
    ['リッチビデオ', '/templates/edit?kind=rich_video'],
    ['質問', '/templates/questions/new'],
    ['クーポン', '/templates/edit?kind=coupon'],
    ['リサーチ', '/templates/edit?kind=research'],
  ])('%sはフォルダ上から当該V8の作成画面へ直接進む', async (label, href) => {
    stubRole('owner')
    await renderListAndWait()
    fireEvent.click(screen.getByText(label))
    await act(async () => { await Promise.resolve() })
    const column = document.querySelector('[data-template-region="folders"]')!
    const create = within(column as HTMLElement).getByRole('link', { name: `${label}を作る` })
    expect(create.getAttribute('href')).toBe(href)
    const folderHeading = within(column as HTMLElement).getByText('フォルダ', { selector: 'p' })
    expect(create.compareDocumentPosition(folderHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'どの種類を作りますか' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'テンプレートを作る' })).toBeNull()
    const empty = screen.queryByRole('link', { name: `最初の${label}を作る` })
    if (empty) expect(empty.getAttribute('href')).toBe(href)
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
    expect(screen.getByText('この画面を変える権限がありません。変えたい時はオーナーか管理者に頼んでください。')).toBeTruthy()
    // 変更系の操作は画面上に存在しない
    expect(screen.getAllByRole('button', { name: 'カルーセルを作る' })[0].getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '秋キャンペーンの操作' }))
    expect(screen.getByRole('menuitem', { name: '編集する' }).getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByRole('menuitem', { name: '削除する' }).getAttribute('aria-disabled')).toBe('true')
    // 閲覧系の遷移（一斉配信で使う）は残る
    expect(screen.getByText('一斉配信で使う')).toBeTruthy()
  })

  test('ownerの資産タブは変更系の操作も従来どおり出る', async () => {
    stubRole('owner')
    await renderListAndWait()

    fireEvent.click(screen.getByText('カルーセル'))
    // owner には作成ボタンと各カードの編集・削除が出る
    expect((await screen.findAllByRole('link', { name: 'カルーセルを作る' }))[0].getAttribute('href')).toBe('/templates/carousel')
    // 資産カードは別フェッチで遅れて届く。作成ボタンだけ先に出るため、
    // カード名を待ってから編集・削除を同期確認する（staff側と同じ待ち方）。
    expect(await screen.findByText('秋キャンペーン')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '秋キャンペーンの操作' }))
    expect(screen.getByText('編集する')).toBeTruthy()
    expect(screen.getByText('削除する')).toBeTruthy()
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
    expect(screen.queryByText('テンプレートを削除する')).toBeNull()
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
    expect(screen.getByRole('link', { name: '編集する' })).toBeTruthy()
  })
})

describe('カルーセル編集画面のstaffゲート (N-144)', () => {
  test('staffが正規導線から来てもフォームは出ず案内だけが出る', async () => {
    stubRole('staff')
    render(<CarouselEditorPage />)
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })

    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: '下書きを保存' })).toBeNull()
    expect(screen.queryByRole('button', { name: '保存して公開' })).toBeNull()
    expect(screen.getByText('この画面を変える権限がありません。変えたい時はオーナーか管理者に頼んでください。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'LINEの見え方を確認' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'カルーセルの説明' }))
    expect(screen.getByText('カルーセルの作成・変更はオーナーと管理者だけができます')).toBeTruthy()
    expect(screen.getByText('一覧で中身を確認できます。')).toBeTruthy()
  })
})

describe('テンプレート編集画面のstaffゲート (N-144)', () => {
  test('staffがURL直打ちしてもフォームは出ず、案内だけが出る', async () => {
    stubRole('staff')
    render(<TemplateEditPage />)
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })

    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: '下書きを保存' })).toBeNull()
    expect(screen.queryByRole('button', { name: '保存して公開' })).toBeNull()
    expect(screen.getByText('閲覧のみ：テンプレートの作成・変更はオーナーと管理者だけができます。')).toBeTruthy()
  })
})

describe('質問テンプレート画面のstaffゲート (N-144)', () => {
  test('staffがURL直打ちしてもフォームは出ず、案内だけが出る', async () => {
    stubRole('staff')
    render(<QuestionTemplatePage />)
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })

    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: '下書きを保存' })).toBeNull()
    expect(screen.queryByRole('button', { name: '保存して公開' })).toBeNull()
    expect(screen.getByText('この画面を変える権限がありません。変えたい時はオーナーか管理者に頼んでください。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'LINEの見え方を確認' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '質問テンプレートの説明' }))
    expect(screen.getByText('質問テンプレートの作成・変更はオーナーと管理者だけができます')).toBeTruthy()
    expect(screen.getByText('一覧で中身を確認できます。')).toBeTruthy()
  })
})

describe('資産フォルダ保存の失敗', () => {
  async function openFolder() {
    stubRole('owner')
    await renderListAndWait()
    fireEvent.click(screen.getByText('クーポン'))
    await screen.findByText('秋キャンペーン')
    const column = document.querySelector('[data-template-region="folders"]')!
    fireEvent.click(within(column as HTMLElement).getByRole('button', { name: 'フォルダを追加する' }))
    const dialog = await screen.findByRole('dialog', { name: 'フォルダを追加する' })
    const input = within(dialog).getByRole('textbox', { name: 'フォルダ名' })
    fireEvent.change(input, { target: { value: '予約' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '追加する' }))
    return { dialog, input }
  }
  test('欄の理由を赤枠と先頭焦点へ返し、値と窓を残す', async () => {
    assetFolderCreate.mockRejectedValue({ status: 422, fields: { name: '名前を短くしてください' } })
    const { dialog, input } = await openFolder()
    expect(await within(dialog).findByText('名前を短くしてください')).toBeTruthy()
    expect(input.getAttribute('aria-invalid')).toBe('true')
    await vi.waitFor(() => expect(document.activeElement).toBe(input))
    expect((input as HTMLInputElement).value).toBe('予約')
    expect(assetFolderCreate).toHaveBeenCalledWith('account-a', '予約')
  })
  test('APIの日本語の理由を残し、再試行で成功した時だけ閉じる', async () => {
    assetFolderCreate.mockResolvedValueOnce({ success: false, error: '同じ名前のフォルダがあります' })
    const { dialog } = await openFolder()
    expect(await within(dialog).findByText('同じ名前のフォルダがあります')).toBeTruthy()
    assetFolderCreate.mockResolvedValueOnce({ success: true, data: { id: 'asset-folder-new', name: '予約' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '追加する' }))
    await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'フォルダを追加する' })).toBeNull())
    expect(assetFolderCreate).toHaveBeenCalledTimes(2)
  })
})
