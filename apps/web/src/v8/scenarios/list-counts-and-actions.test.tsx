// @vitest-environment happy-dom
import type { StaffMember } from '@line-crm/shared'
import { rememberStaffIdentity, forgetStaffIdentity } from '@/lib/staff-identity-state'
import { forgetSessionSnapshot, rememberSessionSnapshot } from '@/lib/session-snapshot'
/*
 * V8 シナリオ一覧の件数と操作の動きの試験。
 * - 読了率の母数は「いま途中＋読み終えた人」。登録0でも数は読めているので「登録した 0 人」（棒・割合なし）
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
  role: 'owner' as 'owner' | 'admin' | 'staff' | 'viewer' | null,
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
const remove = vi.hoisted(() => vi.fn())
const reorder = vi.hoisted(() => vi.fn())
const undo = vi.hoisted(() => ({ hold: false, queue: [] as Array<{ commit: () => unknown }> }))
const duplicate = vi.hoisted(() => vi.fn())

vi.mock('@/components/scenarios/duplicate-scenario', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/components/scenarios/duplicate-scenario')>(),
  duplicateScenario: duplicate,
}))

/* 取り消しの5秒を待たずに送る。失敗したら画面を戻し、画面が渡した文で知らせる（本物と同じ順）。 */
vi.mock('@/lib/undoable', async (importOriginal: () => Promise<typeof import('@/lib/undoable')>) => {
  const actual = await importOriginal()
  const { notifyToast } = await import('@/components/shared/toast')
  return {
    ...actual,
    runUndoable: (options: Parameters<typeof actual.runUndoable>[0]) => {
      if (undo.hold) { undo.queue.push(options); return }
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
  return { ...actual, useStaffRole: () => state.role, useStaffIdentity: () => ({ id: 'staff-one' }) }
})

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  const api = (actual as unknown as { api: Record<string, object> }).api
  return {
    ...actual,
    api: {
      ...api,
      scenarios: { ...api.scenarios, listPage, update, create, delete: remove, moveReferrers: vi.fn(async () => ({ success: true, data: { items: [] } })), reorder },
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
  forgetStaffIdentity(); forgetSessionSnapshot()
  rememberStaffIdentity({ id: 'scenario-owner', role: 'owner', permissionKeys: [] } as unknown as StaffMember)
  // 絞り込みは URL に残るので、前の試験の絞り込みを持ち越さない。
  window.history.replaceState(null, '', '/scenarios')
  undo.hold = false; undo.queue = []
  reorder.mockResolvedValue({ success: true })
  remove.mockResolvedValue({ success: true })
  state.account = 'account-a'
  state.role = 'owner'
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
  duplicate.mockResolvedValue('duplicate-result')
})

afterEach(() => {
  forgetStaffIdentity(); forgetSessionSnapshot()
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

  test('登録した人が0でも数は読めているので薄い灰の「登録した 0 人」と出す（割合は決まらないので出さない）', async () => {
    state.stats = { scenarios: { total: 0, active: 0, subscribers: 0, completed: 0, sentThisWeek: 0 } }
    await mount()
    await waitFor(() => expect(kpi('最後まで配信した人').textContent).toContain('登録した 0 人'))
    expect(kpi('最後まで配信した人').textContent).not.toContain('%')
  })

  test('登録0の行は棒と割合を出さず「登録した 0 人」だけ出す', async () => {
    listPage.mockImplementation(async () => ({
      success: true,
      data: { items: [{ ...scenario('s-zero', '誰もいない', null), subscriberCount: 0, completedCount: 0 }], total: 1, limit: 20, sort: [] },
    }))
    const view = render(<><ScenariosListV8 /><ToastHost /></>)
    await view.findByText('誰もいない')
    const row = screen.getByText('誰もいない').closest('tr') as HTMLElement
    expect(row.textContent).toContain('配信中 0 人・最後まで配信 0 人')
    expect(row.textContent).toContain('登録した 0 人')
    expect(row.textContent).not.toContain('%')
    expect(within(row).queryByRole('progressbar')).toBeNull()
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


describe('右詳細の情報と操作', () => {
  async function panel() {
    window.history.replaceState(null, '', '/scenarios?scenario=s-filed')
    render(<><ScenariosListV8 /><ToastHost /></>)
    return screen.findByRole('dialog', { name: '新規登録7日間フォロー', exact: true })
  }

  test('人数は配信の状態として示し、複製と削除はメニューへ置く', async () => {
    const detail = await panel()
    const scoped = within(detail)
    expect(scoped.getByRole('region', { name: '配信状況' }).textContent).toContain('配信中 10 人・最後まで配信 2 人')
    expect(detail.textContent).not.toContain('既読人数ではありません。')
    fireEvent.click(scoped.getByRole('button', { name: '配信状況の説明', exact: true }))
    expect((await scoped.findByRole('note')).textContent).toContain('既読人数ではありません。')
    fireEvent.click(scoped.getByRole('button', { name: '配信状況の説明', exact: true }))
    expect(scoped.getByRole('heading', { name: '名前を変更' })).toBeTruthy()
    expect(scoped.getByRole('button', { name: 'シナリオ名を変更する' })).toBeTruthy()
    fireEvent.click(scoped.getByRole('button', { name: '「新規登録7日間フォロー」のその他操作' }))
    expect(screen.getByRole('menuitem', { name: '複製する', exact: true })).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('menuitem', { name: '複製する', exact: true }), { key: 'Escape' })
    expect(scoped.getByRole('button', { name: '開く', exact: true })).toBeTruthy()
    fireEvent.click(scoped.getByRole('button', { name: '配信結果', exact: true }))
    expect(push).toHaveBeenCalledTimes(1)
    const target = new URL(push.mock.calls[0][0] as string, 'http://admin.test')
    expect(target.pathname).toBe('/scenarios/results')
    expect(target.searchParams.get('id')).toBe('s-filed')
    expect(target.searchParams.get('returnTo')).toBe('/scenarios?scenario=s-filed')
    expect(update).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  test('未取得の人数や方式を0人や前の配信からの間隔へ推測しない', async () => {
    listPage.mockResolvedValue({ success: true, data: { items: [{ ...rows[0], deliveryMode: undefined, stepCount: undefined, subscriberCount: undefined, completedCount: undefined }], total: 1, limit: 20, sort: [] } })
    const detail = await panel()
    expect(detail.textContent).toContain('配信方法は未確認・通数は未確認')
    const facts = within(detail).getByRole('region', { name: '配信状況' })
    expect(facts.textContent).toContain('配信中 —・最後まで配信 —')
    expect(facts.textContent).not.toContain('— 人')
    expect(facts.textContent).not.toContain('0 人')
  })

  test('メニューからの削除は同じ確認窓を経て、取消では削除しない', async () => {
    const detail = await panel()
    fireEvent.click(within(detail).getByRole('button', { name: '「新規登録7日間フォロー」のその他操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '削除する', exact: true }))
    const confirmation = await screen.findByRole('alertdialog', { name: '「新規登録7日間フォロー」を削除しますか？', exact: true })
    fireEvent.click(within(confirmation).getByRole('button', { name: 'キャンセル', exact: true }))
    expect(remove).not.toHaveBeenCalled()
  })

  test('名前の編集失敗でも入力を残し、同じ値で再試行する', async () => {
    update.mockResolvedValueOnce({ success: false, error: 'offline' }).mockResolvedValueOnce({ success: true, data: {} })
    const detail = await panel()
    fireEvent.click(within(detail).getByRole('button', { name: 'シナリオ名を変更する' }))
    const input = within(detail).getByRole('textbox', { name: 'シナリオ名', exact: true }) as HTMLInputElement
    fireEvent.change(input, { target: { value: '変更した名前' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await within(detail).findByRole('alert')).toBeTruthy()
    expect(input.value).toBe('変更した名前')
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2))
    expect(update).toHaveBeenNthCalledWith(1, 's-filed', { name: '変更した名前' })
    expect(update).toHaveBeenNthCalledWith(2, 's-filed', { name: '変更した名前' })
  })

  test.each(['viewer', null] as const)('役割%sでは既存の編集操作を起動しない', async (role) => {
    state.role = role
    forgetStaffIdentity()
    if (role) rememberStaffIdentity({ id: 'scenario-viewer', role, permissionKeys: [] } as unknown as StaffMember)
    const detail = await panel()
    expect(within(detail).queryByRole('button', { name: 'シナリオ名を変更する' })).toBeNull()
    expect(within(detail).queryByRole('button', { name: /その他操作/ })).toBeNull()
    expect(within(detail).getByRole('button', { name: '開く', exact: true })).toBeTruthy()
    expect(update).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    expect(duplicate).not.toHaveBeenCalled()
  })
})


describe('保持した書込操作の実行直前の判定', () => {
  function selectRow(name: string) { const row = screen.getByText(name).closest('tr')!; fireEvent.click(within(row).getByRole('checkbox')) }
  const person = (role: 'owner' | 'admin' | 'staff' | 'viewer', extra: object = {}) => { state.role = role; return { id: 'scenario-person', role, permissionKeys: [], ...extra } as unknown as StaffMember }
  const proxyRead = () => rememberSessionSnapshot({ stepUpMethod: 'totp', unfamiliarAt: null, impersonation: { mode: 'read' } as never })
  function heldClick(button: HTMLElement) {
    const key = Object.keys(button).find(key => key.startsWith('__reactProps$'))!
    const handler = (button as unknown as Record<string, { onClick: (event: unknown) => unknown }>)[key].onClick
    expect(handler).toBeTypeOf('function')
    return () => handler({ defaultPrevented: false, preventDefault() {}, stopPropagation() {}, currentTarget: button, target: button })
  }
  const pending = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
  async function deleteConfirmation() {
    fireEvent.click(screen.getByRole('button', { name: 'シナリオ「新規登録7日間フォロー」の操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '削除する', exact: true }))
    return screen.findByRole('alertdialog', { name: '「新規登録7日間フォロー」を削除しますか？', exact: true })
  }
  test.each(['viewer', 'unknown', 'read-proxy'] as const)('%sへ変わると、保持した削除確定もAPI0で窓と読取を残す', async change => {
    await mount()
    const dialog = await deleteConfirmation()
    const saved = heldClick(within(dialog).getByRole('button', { name: '削除する', exact: true }))
    act(() => { if (change === 'viewer') rememberStaffIdentity(person('viewer')); else if (change === 'unknown') { state.role = null; forgetStaffIdentity() } else proxyRead() })
    await act(async () => { await saved() })
    expect(remove).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: '「新規登録7日間フォロー」を削除しますか？', exact: true })).toBeTruthy()
    expect(await screen.findByText('本人・権限・LINEアカウントを確認できないため、変更を中止しました。')).toBeTruthy()
    expect(listPage).toHaveBeenCalled(); expect(folderList).toHaveBeenCalled(); expect(statsGet).toHaveBeenCalled()
  })
  test('編集キーstaffも配信の開始停止は拒む。管理者の明示操作は保存する', async () => {
    rememberStaffIdentity(person('staff', { permissionKeys: ['/scenarios', 'scenario.definition.edit', 'scenario.definition.publish'] }))
    await mount(); selectRow('新規登録7日間フォロー')
    fireEvent.click(await screen.findByRole('button', { name: '止める', exact: true }))
    let dialog = await screen.findByRole('dialog', { name: '選んだシナリオを停止しますか？' })
    fireEvent.click(within(dialog).getByRole('button', { name: '停止する', exact: true }))
    expect(update).not.toHaveBeenCalled()
    expect(await screen.findByText('本人・権限・LINEアカウントを確認できないため、変更を中止しました。')).toBeTruthy()
    act(() => rememberStaffIdentity(person('admin')))
    fireEvent.click(await screen.findByRole('button', { name: '止める', exact: true }))
    dialog = await screen.findByRole('dialog', { name: '選んだシナリオを停止しますか？' })
    fireEvent.click(within(dialog).getByRole('button', { name: '停止する', exact: true }))
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update).toHaveBeenCalledWith('s-filed', { isActive: false })
  })
  test('取り消し待ちの並べ替えは本人切替後にGETも書込も始めない', async () => {
    undo.hold = true; await mount()
    fireEvent.keyDown(document.querySelector('button[data-reorder-handle]')!, { key: 'ArrowDown' })
    expect(undo.queue).toHaveLength(1)
    const reads = listPage.mock.calls.length
    act(() => rememberStaffIdentity(person('viewer')))
    await expect(undo.queue[0].commit()).rejects.toThrow('本人・権限')
    expect(listPage).toHaveBeenCalledTimes(reads); expect(reorder).not.toHaveBeenCalled()
    expect(await screen.findByText('本人・権限・LINEアカウントを確認できないため、変更を中止しました。')).toBeTruthy()
  })
  test('並べ替えの全件GET中にread代理へ変わると順位を保存しない', async () => {
    undo.hold = true; await mount()
    const response = pending<{ success: boolean; data: { items: typeof rows; total: number; limit: number; sort: never[] } }>()
    listPage.mockImplementation(input => input.limit === 100 ? response.promise : Promise.resolve({ success: true, data: { items: rows, total: rows.length, limit: input.limit, sort: [] } }))
    fireEvent.keyDown(document.querySelector('button[data-reorder-handle]')!, { key: 'ArrowDown' })
    expect(undo.queue).toHaveLength(1)
    const commit = Promise.resolve(undo.queue[0].commit())
    await waitFor(() => expect(listPage).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }), expect.anything()))
    act(proxyRead)
    response.resolve({ success: true, data: { items: rows, total: rows.length, limit: 100, sort: [] } })
    await expect(commit).rejects.toThrow('本人・権限')
    expect(reorder).not.toHaveBeenCalled()
  })
  test('一括停止は1件目の応答中の権限切替で未送信の2件目を止め、実数を出す', async () => {
    const activeRows = rows.map(row => ({ ...row, isActive: true }))
    listPage.mockResolvedValue({ success: true, data: { items: activeRows, total: 2, limit: 20, sort: [] } })
    const first = pending<{ success: boolean; data: object }>()
    update.mockReturnValueOnce(first.promise)
    await mount(); selectRow('新規登録7日間フォロー'); selectRow('会員更新リマインド')
    fireEvent.click(await screen.findByRole('button', { name: '止める', exact: true }))
    const dialog = await screen.findByRole('dialog', { name: '選んだシナリオを停止しますか？' })
    fireEvent.click(within(dialog).getByRole('button', { name: '停止する', exact: true }))
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    act(() => rememberStaffIdentity(person('viewer')))
    await act(async () => first.resolve({ success: true, data: {} }))
    expect(await screen.findByText('2 件中 1 件を保存しました。残りは本人・権限・LINEアカウントが変わったため送っていません。')).toBeTruthy()
    expect(update).toHaveBeenCalledTimes(1)
  })
  test('フォルダ移動の取り消し待ちはread代理への切替で送らず、窓の確定を持ち越さない', async () => {
    undo.hold = true; await mount(); selectRow('新規登録7日間フォロー')
    fireEvent.click(await screen.findByRole('button', { name: 'フォルダへ移す', exact: true }))
    const dialog = await screen.findByRole('dialog', { name: '「新規登録7日間フォロー」のフォルダを移動' })
    fireEvent.click(within(dialog).getByRole('button', { name: '移動する', exact: true }))
    expect(undo.queue).toHaveLength(1)
    act(proxyRead)
    await expect(undo.queue[0].commit()).rejects.toThrow('本人・権限')
    expect(update).not.toHaveBeenCalled()
    expect(await screen.findByText('1 件中 0 件を保存しました。残りは本人・権限・LINEアカウントが変わったため送っていません。')).toBeTruthy()
  })
  test('AからBへ移りAへ戻っても、古い並べ替えは復活せず新しい明示操作だけ通る', async () => {
    undo.hold = true; const view = await mount()
    fireEvent.keyDown(document.querySelector('button[data-reorder-handle]')!, { key: 'ArrowDown' })
    expect(undo.queue).toHaveLength(1)
    state.account = 'account-b'; view.rerender(<><ScenariosListV8 /><ToastHost /></>)
    await waitFor(() => expect(folderList).toHaveBeenCalledWith('scenario', 'account-b'))
    state.account = 'account-a'; view.rerender(<><ScenariosListV8 /><ToastHost /></>)
    await waitFor(() => expect(document.querySelector('button[data-reorder-handle]')).toBeTruthy())
    await undo.queue[0].commit()
    expect(reorder).not.toHaveBeenCalled()
    fireEvent.keyDown(document.querySelector('button[data-reorder-handle]')!, { key: 'ArrowDown' })
    expect(undo.queue).toHaveLength(2)
    await undo.queue[1].commit()
    expect(reorder).toHaveBeenCalledTimes(1)
  })
  test('複製の共通手順へ最新判定を渡し、切替後にコピーを勝手に再開しない', async () => {
    const response = pending<string>(); duplicate.mockReturnValueOnce(response.promise)
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'シナリオ「新規登録7日間フォロー」の操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '複製する', exact: true }))
    await waitFor(() => expect(duplicate).toHaveBeenCalledTimes(1))
    const allowed = duplicate.mock.calls[0][2] as () => boolean
    expect(allowed).toBeTypeOf('function'); expect(allowed()).toBe(true)
    act(proxyRead); expect(allowed()).toBe(false)
    act(() => forgetSessionSnapshot()); expect(allowed()).toBe(false)
    await act(async () => response.resolve('saved-copy'))
    expect(await screen.findByText('本人・権限が変わったため処理を止めました。作成済みのコピーを一覧で確認してください。')).toBeTruthy()
    expect(duplicate).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('複製しました')).toBeNull()
  })
  test('名前の編集中にread代理へ替わると保持したEnterでも更新0、GETは残る', async () => {
    window.history.replaceState(null, '', '/scenarios?scenario=s-filed')
    render(<><ScenariosListV8 /><ToastHost /></>)
    const panel = await screen.findByRole('dialog', { name: '新規登録7日間フォロー', exact: true })
    fireEvent.click(within(panel).getByRole('button', { name: 'シナリオ名を変更する' }))
    const field = within(panel).getByRole('textbox', { name: 'シナリオ名', exact: true })
    fireEvent.change(field, { target: { value: '書きかけ' } })
    const key = Object.keys(field).find(key => key.startsWith('__reactProps$'))!
    const enter = (field as unknown as Record<string, { onKeyDown: (event: unknown) => unknown }>)[key].onKeyDown
    expect(enter).toBeTypeOf('function')
    act(proxyRead)
    await act(async () => enter({ key: 'Enter', defaultPrevented: false, preventDefault() {}, nativeEvent: { isComposing: false }, keyCode: 13 }))
    expect(update).not.toHaveBeenCalled(); expect(listPage).toHaveBeenCalled()
    expect(await screen.findByText('本人・権限・LINEアカウントを確認できないため、変更を中止しました。')).toBeTruthy()
  })

  test('本人未知へ替わると保持した作成入口からも遷移しない', async () => {
    await mount()
    const start = heldClick(screen.getAllByRole('button', { name: 'シナリオを作る', exact: true })[0])
    act(() => { state.role = null; forgetStaffIdentity() })
    await act(async () => { await start() })
    expect(push).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(await screen.findByText('本人・権限・LINEアカウントを確認できないため、変更を中止しました。')).toBeTruthy()
  })
  test('削除窓を閉じて開き直しても、古い確定では保存せず、新しい確定だけ通る', async () => {
    await mount(); let dialog = await deleteConfirmation()
    const saved = heldClick(within(dialog).getByRole('button', { name: '削除する', exact: true }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル', exact: true }))
    dialog = await deleteConfirmation()
    await act(async () => { await saved() })
    expect(remove).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: '「新規登録7日間フォロー」を削除しますか？', exact: true })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '削除する', exact: true }))
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1))
  })
  test('複製の待機中に画面を離れたら保持した許可も失効する', async () => {
    const response = pending<string>(); duplicate.mockReturnValueOnce(response.promise)
    const view = await mount()
    fireEvent.click(screen.getByRole('button', { name: 'シナリオ「新規登録7日間フォロー」の操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '複製する', exact: true }))
    await waitFor(() => expect(duplicate).toHaveBeenCalledTimes(1))
    const allowed = duplicate.mock.calls[0][2] as () => boolean
    expect(allowed()).toBe(true); view.unmount(); expect(allowed()).toBe(false)
    await act(async () => response.resolve('saved-copy'))
    expect(screen.queryByText('複製しました')).toBeNull()
  })
})
