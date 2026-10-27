// @vitest-environment happy-dom
/*
 * V8 シナリオ一覧の件数と操作の動きの試験。
 * - 読了率の母数は「いま途中＋読み終えた人」。登録0なら0%ではなく「—」
 * - 「すべて」と数の帯のシナリオ数は、絞り込み無しの全体件数（共通のシナリオを含む）
 * - フォルダ・数の帯は一覧と同じアカウントで数え、「未分類」はサーバーの数を出す
 * - 共通のシナリオがフォルダの内訳に入らないことを、差がある時だけ説明する
 * - アカウントを替えたら絞り込みを外し、前のアカウントの遅い応答を採らない
 * - 狭い板の「フォルダ」の選ぶ欄でも、左の列と同じ絞り込みになる
 * - まとめて操作・フォルダ移動の失敗は日本語の知らせにし、表示を元に戻す
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const scenario = (id: string, name: string, folderId: string | null, isActive = true) => ({
  id,
  name,
  description: null,
  triggerType: 'friend_add',
  triggerTagId: null,
  isActive,
  deliveryMode: 'elapsed',
  allowConcurrent: true,
  displayOrder: 0,
  folderId,
  lineAccountId: 'account-a',
  subscriberCount: 10,
  completedCount: 2,
  stepCount: 3,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
})

const state = vi.hoisted(() => ({
  account: 'account-a' as string | null,
  /** 絞り込み無しの全体件数（全アカウント共通のシナリオを含む）。 */
  overall: 7,
  stats: { scenarios: { total: 5, active: 4, subscribers: 30, completed: 10, sentThisWeek: 12 } } as Record<string, unknown>,
}))
const push = vi.hoisted(() => vi.fn())
const listPage = vi.hoisted(() => vi.fn())
const folderList = vi.hoisted(() => vi.fn())
const statsGet = vi.hoisted(() => vi.fn())
const update = vi.hoisted(() => vi.fn())
const create = vi.hoisted(() => vi.fn())

/* 取り消しの5秒を待たずに送る。失敗したら画面を戻し、画面が渡した文で知らせる（本物と同じ順）。 */
vi.mock('@/lib/undoable', async (importOriginal: () => Promise<typeof import('@/lib/undoable')>) => {
  const actual = await importOriginal()
  const { notifyToast } = await import('@/components/shared/toast')
  return {
    ...actual,
    runUndoable: (options: Parameters<typeof actual.runUndoable>[0]) => {
      void Promise.resolve()
        .then(() => options.commit())
        .then((res) => {
          if (res && res.success === false) throw new Error(res.error ?? '')
          options.onCommitted?.()
        })
        .catch(() => {
          ;(options.onCommitError ?? options.undo)()
          notifyToast(options.failureMessage ?? 'できませんでした。もう一度お試しください。', { tone: 'error' })
        })
    },
  }
})

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: state.account, loading: false }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: () => {}, back: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href, ...rest }, children),
}))

vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined, usePageCrumbs: () => undefined }))

vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => 'owner', useStaffIdentity: () => ({ id: 'staff-one' }) }
})

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  const api = (actual as unknown as { api: Record<string, object> }).api
  return {
    ...actual,
    api: {
      ...api,
      scenarios: { ...api.scenarios, listPage, update, create, reorder: vi.fn(async () => ({ success: true })) },
      folders: { ...api.folders, list: folderList },
      listStats: { get: statsGet },
    },
  }
})

import ScenariosListV8 from './list'
import ToastHost, { clearToastsForTest } from '@/components/shared/toast'

const rows = [
  scenario('s-filed', '新規登録7日間フォロー', 'sf-onboarding'),
  scenario('s-unfiled', '会員更新リマインド', null, false),
]

function folderRow(label: string) {
  const row = document.querySelector(`button[data-part="folder-row"][title="${label}"]`)
  expect(row, `フォルダの行「${label}」`).not.toBeNull()
  return row as HTMLElement
}

function kpi(title: string) {
  const card = [...document.querySelectorAll('[data-kpi-presentation]')]
    .find((item) => item.textContent?.startsWith(title))
  expect(card, `数の帯「${title}」`).toBeTruthy()
  return card as HTMLElement
}

async function mount() {
  const view = render(<><ScenariosListV8 /><ToastHost /></>)
  await view.findByText('新規登録7日間フォロー')
  return view
}

beforeEach(() => {
  // 絞り込みは URL に残るので、前の試験の絞り込みを持ち越さない。
  window.history.replaceState(null, '', '/scenarios')
  state.account = 'account-a'
  state.overall = 7
  state.stats = { scenarios: { total: 5, active: 4, subscribers: 30, completed: 10, sentThisWeek: 12 } }
  listPage.mockImplementation(async (input: { limit?: number; folderId?: string }) => ({
    success: true,
    data: input.limit === 1
      ? { items: [], total: state.overall, limit: 1, sort: [] }
      : { items: input.folderId ? rows.filter((r) => r.folderId === input.folderId) : rows, total: input.folderId ? 1 : rows.length, limit: input.limit ?? 20, sort: [] },
  }))
  folderList.mockImplementation(async (_kind: string, accountId?: string) => ({
    success: true,
    data: [{ id: accountId === 'account-b' ? 'sf-b' : 'sf-onboarding', kind: 'scenario', name: accountId === 'account-b' ? 'B店の箱' : '初回案内', parentId: null, displayOrder: 0, itemCount: 3, color: '#2f6fde' }],
    unfiledCount: 2,
  }))
  statsGet.mockImplementation(async () => ({ success: true, data: state.stats }))
  update.mockResolvedValue({ success: true, data: {} })
})

afterEach(() => {
  cleanup()
  clearToastsForTest()
  vi.clearAllMocks()
})

describe('読了率の母数', () => {
  test('いま途中と読み終えた人の合計を母数にし、購読中は重複を含むと書く', async () => {
    await mount()
    await waitFor(() => expect(kpi('最後まで配信した人').textContent).toContain('登録した 40 人の 25%'))
    expect(kpi('配信中').textContent?.replace(/\n/g, '')).toContain('いま途中にいる人（重複を含む）')
    expect(screen.getAllByTitle('配信中 10 人・最後まで配信 2 人')).toHaveLength(2)
  })

  test('登録した人が0なら0%と言わず「—」にする', async () => {
    state.stats = { scenarios: { total: 0, active: 0, subscribers: 0, completed: 0, sentThisWeek: 0 } }
    await mount()
    await waitFor(() => expect(kpi('最後まで配信した人').textContent).toContain('—'))
    expect(kpi('最後まで配信した人').textContent).not.toContain('%')
  })
})

describe('件数の定義', () => {
  test('「すべて」と数の帯は全体件数。フォルダ・数の帯は同じアカウントで数え、未分類はサーバーの数', async () => {
    await mount()
    await waitFor(() => expect(folderRow('すべて').textContent).toBe('すべて7'))
    expect(listPage).toHaveBeenCalledWith({ accountId: 'account-a', page: 1, limit: 1 })
    expect(folderList).toHaveBeenCalledWith('scenario', 'account-a')
    expect(statsGet).toHaveBeenCalledWith('account-a')
    expect(folderRow('未分類').textContent).toBe('未分類2')
    // 数の帯は list-stats の total（共通を含まない 5）ではなく、全体件数 7。
    await waitFor(() => expect(kpi('シナリオ').textContent).toContain('7'))
    expect(kpi('シナリオ').textContent).not.toContain('5件')
  })

  test('絞り込んでも「すべて」は全体件数のまま', async () => {
    await mount()
    fireEvent.click(folderRow('初回案内'))
    await waitFor(() => expect(listPage).toHaveBeenCalledWith(expect.objectContaining({ folderId: 'sf-onboarding' }), expect.anything()))
    await waitFor(() => expect(screen.queryByText('会員更新リマインド')).toBeNull())
    expect(folderRow('すべて').textContent).toBe('すべて7')
  })

  test('全体と内訳の差（共通のシナリオ）がある時だけ、内訳に入らないと説明する', async () => {
    await mount()
    // 全体7 − フォルダ3 − 未分類2 = 共通2
    expect(await screen.findByText(/全アカウントに共通で適用されるシナリオが2 件あります/)).toBeTruthy()
    expect(screen.getByText(/フォルダ別の件数と「未分類」には含まれません/)).toBeTruthy()
    cleanup()
    state.overall = 5
    await mount()
    await waitFor(() => expect(folderRow('すべて').textContent).toBe('すべて5'))
    expect(screen.queryByText(/全アカウントに共通で適用されるシナリオが/)).toBeNull()
  })

  test('アカウントを替えたら絞り込みと前のアカウントのフォルダを外し、新しいアカウントで数え直す', async () => {
    const view = await mount()
    fireEvent.click(folderRow('初回案内'))
    await waitFor(() => expect(listPage).toHaveBeenCalledWith(expect.objectContaining({ folderId: 'sf-onboarding' }), expect.anything()))

    state.account = 'account-b'
    view.rerender(<><ScenariosListV8 /><ToastHost /></>)
    await waitFor(() => expect(folderList).toHaveBeenCalledWith('scenario', 'account-b'))
    await waitFor(() => expect(listPage).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'account-b', folderId: undefined }), expect.anything()))
    expect(listPage).toHaveBeenCalledWith({ accountId: 'account-b', page: 1, limit: 1 })
    await waitFor(() => expect(statsGet).toHaveBeenCalledWith('account-b'))
    await waitFor(() => expect(document.querySelector('button[data-part="folder-row"][title="B店の箱"]')).not.toBeNull())
    expect(document.querySelector('button[data-part="folder-row"][title="初回案内"]')).toBeNull()
    expect(folderRow('すべて').getAttribute('aria-current')).toBe('true')
  })
})

describe('前のアカウントの遅い応答', () => {
  test('切り替えの前に出したフォルダの読み込みが後から返っても、今のアカウントの列を上書きしない', async () => {
    let lateA!: (value: unknown) => void
    folderList.mockImplementationOnce(() => new Promise((resolve) => { lateA = resolve }))
    const view = render(<><ScenariosListV8 /><ToastHost /></>)
    await view.findByText('新規登録7日間フォロー')
    state.account = 'account-b'
    view.rerender(<><ScenariosListV8 /><ToastHost /></>)
    await waitFor(() => expect(document.querySelector('button[data-part="folder-row"][title="B店の箱"]')).not.toBeNull())
    await act(async () => {
      lateA({ success: true, data: [{ id: 'sf-a', kind: 'scenario', name: 'A店の古い箱', parentId: null, displayOrder: 0, itemCount: 9 }], unfiledCount: 99 })
    })
    expect(document.querySelector('button[data-part="folder-row"][title="A店の古い箱"]')).toBeNull()
    expect(folderRow('未分類').textContent).toBe('未分類2')
  })
})

describe('狭い板のフォルダの選ぶ欄', () => {
  test('「フォルダ：すべて」から選ぶと、左の列と同じ絞り込みになる', async () => {
    await mount()
    const select = screen.getByRole('button', { name: 'フォルダ' })
    expect(select.textContent).toContain('フォルダ：すべて')
    fireEvent.click(select)
    fireEvent.click(within(await screen.findByRole('option', { name: '初回案内' })).getByRole('button'))
    await waitFor(() => expect(listPage).toHaveBeenCalledWith(expect.objectContaining({ folderId: 'sf-onboarding' }), expect.anything()))
    expect(folderRow('初回案内').getAttribute('aria-current')).toBe('true')
  })
})

describe('作るボタン', () => {
  test('方式選びへ送るだけで行を作らず、作成中の状態にもしない', async () => {
    await mount()
    const button = screen.getAllByRole('button', { name: 'シナリオを作る' })[0] as HTMLButtonElement
    fireEvent.click(button)
    // 行き先は方式選び（戻り先だけ添える）。id を付けない＝まだ行が無いと方式選びが分かる。
    expect(push).toHaveBeenCalledTimes(1)
    const target = new URL(push.mock.calls[0][0] as string, 'http://admin.test')
    expect(target.pathname).toBe('/scenarios/mode')
    expect(target.searchParams.get('id')).toBeNull()
    expect(create).not.toHaveBeenCalled()
    expect(button.disabled).toBe(false)
    expect(screen.queryByText('作成中…')).toBeNull()
  })
})

describe('操作の失敗', () => {
  function selectRow(name: string) {
    const row = screen.getByText(name).closest('tr') as HTMLElement
    fireEvent.click(within(row).getByRole('checkbox'))
  }

  test('まとめて再開に失敗したら日本語で知らせ、行の状態を元に戻す', async () => {
    update.mockResolvedValue({ success: false, error: 'Internal Server Error' })
    await mount()
    selectRow('会員更新リマインド')
    fireEvent.click(await screen.findByRole('button', { name: '再開' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith('s-unfiled', { isActive: true }))
    expect(await screen.findByText(/配信を始められませんでした。/)).toBeTruthy()
    expect(document.body.textContent).not.toContain('Internal Server Error')
  })

  test('まとめて停止に失敗したら日本語で知らせる', async () => {
    update.mockRejectedValue(new Error('offline'))
    await mount()
    selectRow('新規登録7日間フォロー')
    fireEvent.click(await screen.findByRole('button', { name: '止める' }))
    const dialog = await screen.findByRole('dialog', { name: '選んだシナリオを停止しますか？' })
    fireEvent.click(within(dialog).getByRole('button', { name: '停止する' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith('s-filed', { isActive: false }))
    expect(await screen.findByText(/停止できませんでした。/)).toBeTruthy()
    expect(document.body.textContent).not.toContain('offline')
  })

  test('フォルダ移動に失敗したら日本語で知らせ、行を元のフォルダへ戻す', async () => {
    update.mockResolvedValue({ success: false, error: 'Internal Server Error' })
    await mount()
    selectRow('新規登録7日間フォロー')
    fireEvent.click(await screen.findByRole('button', { name: 'フォルダへ移す' }))
    const dialog = await screen.findByRole('dialog', { name: '「新規登録7日間フォロー」のフォルダを移動' })
    fireEvent.click(within(dialog).getByRole('button', { name: '移動する' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith('s-filed', { folderId: null }))
    expect(await screen.findByText(/フォルダを移動できませんでした。/)).toBeTruthy()
    expect(document.body.textContent).not.toContain('Internal Server Error')
    const row = screen.getByText('新規登録7日間フォロー').closest('tr') as HTMLElement
    await waitFor(() => expect(row.querySelector('[data-folder-dot]')?.getAttribute('aria-label')).toBe('フォルダ：初回案内'))
  })
})
