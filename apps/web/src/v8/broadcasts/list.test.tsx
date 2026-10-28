// @vitest-environment happy-dom
/*
 * V8 一斉配信一覧（src/v8）の動きの試験。BEHAVIOR.md の主要な動きを守る。
 * 行が出る・言葉で絞れる・札と並びが口へ渡る・閲覧のみは帯が出て作れない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const formImport = vi.hoisted(() => ({ evaluations: 0, props: null as unknown }))
vi.mock('@/components/broadcasts/broadcast-form', () => {
  formImport.evaluations += 1
  return { default: (props: unknown) => { formImport.props = props; return <div data-loaded-broadcast-form /> } }
})
const listBroadcasts = vi.hoisted(() => vi.fn())
const listFolders = vi.hoisted(() => vi.fn())
const createView = vi.hoisted(() => vi.fn(async () => ({ success: true, data: { id: 'new-view', name: '古い配信', filters: {} } })))
const listViews = vi.hoisted(() => vi.fn())
const deleteBroadcast = vi.hoisted(() => vi.fn(async () => ({ success: true, data: null })))
const updateBroadcast = vi.hoisted(() => vi.fn(async () => ({ success: true, data: null })))
const narrow = vi.hoisted(() => ({ value: false }))
vi.mock('@/lib/use-narrow-viewport', () => ({ useNarrowViewport: () => narrow.value }))
const role = vi.hoisted(() => ({ current: 'owner' as string | null }))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      broadcasts: {
        ...actual.api.broadcasts,
        list: listBroadcasts,
        update: updateBroadcast,
        delete: deleteBroadcast,
        getInsight: async () => ({ success: false }),
        savedViews: { ...actual.api.broadcasts.savedViews, list: listViews, create: createView },
      },
      folders: { ...actual.api.folders, list: listFolders },
      tags: { ...actual.api.tags, list: async () => ({ success: true, data: [] }) },
      scenarios: { ...actual.api.scenarios, list: async () => ({ success: true, data: [] }) },
      dashboard: {
        ...actual.api.dashboard,
        overview: async () => ({ success: true, data: { delivery: { quotaLimit: 5000, quotaUsed: 1842 } } }),
      },
    },
  }
})

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}))

const routerPush = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', accounts: [{ id: 'account-a', name: '本店' }], loading: false }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
}))

vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => role.current }
})

import { rememberStaffIdentity, forgetStaffIdentity } from '@/lib/staff-identity-state'
import type { StaffMember } from '@line-crm/shared'
import BroadcastListV8 from './list'
const initialFormEvaluations = formImport.evaluations
import { flushListUrlState } from '@/components/shared/list-url-state'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

/* 試験の環境に localStorage が無いことがあるので、手で置く。 */
const store = new Map<string, string>()
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => store.clear(),
  },
})

const base = {
  id: 'bc-1',
  title: '8月キャンペーンのお知らせ',
  messageType: 'text',
  messageContent: 'セールのご案内',
  targetType: 'all',
  targetTagId: null,
  status: 'scheduled',
  displayStatus: 'scheduled',
  displayStatusLabel: '予約中',
  scheduledAt: '2026-08-24T01:00:00.000Z',
  sentAt: null,
  successCount: 0,
  folderId: null,
}
const rowB = { ...base, id: 'bc-2', title: '未購入者フォロー', messageContent: 'まだお買い物していない方へ', status: 'draft', displayStatus: 'draft', displayStatusLabel: '下書き', scheduledAt: null }

beforeEach(() => {
  updateBroadcast.mockClear()
  forgetStaffIdentity()
  document.documentElement.dataset.theme = 'v8'
  role.current = 'owner'
  store.clear()
  /* 広い板（1440）のふり。happy-dom は狭い板扱いになる。 */
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, media: '', addEventListener: () => {}, removeEventListener: () => {} }),
  })
  listBroadcasts.mockImplementation(async () => ({
    success: true,
    data: [base, rowB],
    kpis: { scheduled: 4, thisMonth: 12, delivered: 1842, openRate: 69.4, drafts: 3 },
    statusCounts: { all: 24, scheduled: 4, draft: 3, pending_approval: 1, sent: 15, failed: 1 },
    pagination: { total: 2, limit: 20, cursor: 0, nextCursor: null },
  }))
  listFolders.mockImplementation(async () => ({ success: true, data: [], unfiledCount: 0 }))
  listViews.mockImplementation(async () => ({ success: true, data: [] }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete document.documentElement.dataset.theme
})

async function flush() {
  for (let i = 0; i < 8; i++) {
    await act(async () => { await Promise.resolve() })
  }
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined
}

describe('V8 一斉配信一覧の結果の列', () => {
  const sentRow = { ...base, id: 'bc-3', title: '新商品発売のお知らせ', status: 'sent', displayStatus: 'sent', displayStatusLabel: '送信済み', scheduledAt: null, sentAt: '2026-08-20T03:00:00.000Z', successCount: 624, insightSummary: { delivered: 624, uniqueImpression: 444, uniqueClick: 96, openRate: 0.712, clickRate: 0.154 } }
  const renderRows = async () => {
    listBroadcasts.mockImplementation(async () => ({
      success: true, data: [base, sentRow, rowB], kpis: { scheduled: 1, thisMonth: 1, delivered: 624, openRate: 71.2, drafts: 1 },
      statusCounts: { all: 3, scheduled: 1, sent: 1, draft: 1 }, pagination: { total: 3, limit: 20, cursor: 0, nextCursor: null },
    }))
    act(() => { root.render(<BroadcastListV8 />) })
    await flush()
    const rowOf = (title: string) => [...host.querySelectorAll('tbody tr')].find((tr) => tr.textContent?.includes(title)) as HTMLTableRowElement
    return { sent: rowOf('新商品発売のお知らせ'), unsent: rowOf('8月キャンペーンのお知らせ'), draft: rowOf('未購入者フォロー'), heads: [...host.querySelectorAll('thead th')].map((th) => th.textContent?.trim()) }
  }

  it('広い幅は届いた・開封・クリックの3列に右そろえで、送っていない行は — で数を作らない', async () => {
    narrow.value = false
    const { sent, unsent, heads } = await renderRows()
    expect(heads).toEqual(expect.arrayContaining(['届いた', '開封', 'クリック']))
    const right = [...sent.querySelectorAll('td[data-align="right"]')].map((td) => td.textContent?.trim())
    expect(right).toEqual(['624 人', '71.2%', '15.4%'])
    const unsentRight = [...unsent.querySelectorAll('td[data-align="right"]')].map((td) => td.textContent?.trim())
    expect(unsentRight).toHaveLength(3)
    for (const text of unsentRight) expect(text).not.toMatch(/\d/)
  })

  it('配信日時は日本時間で、日時の無い下書きは薄い「—」1つ', async () => {
    narrow.value = false
    const { sent, unsent, draft } = await renderRows()
    expect(unsent.querySelector('[data-upcoming]')?.textContent).toContain('10:00')
    expect(sent.textContent).toContain('12:00')
    expect(draft.textContent).not.toContain('未設定')
    expect(draft.querySelector('[data-empty-value]')?.textContent).toBe('—')
  })

  it('配信日時は日時だけの1行で「予約」を重ねず、予約中の日時だけ少し濃くする', async () => {
    narrow.value = false
    const { sent, unsent } = await renderRows()
    const upcoming = unsent.querySelector('[data-upcoming]')
    expect(upcoming?.textContent).toMatch(/\d/)
    expect([...unsent.querySelectorAll('td span')].some((el) => el.textContent?.trim() === '予約')).toBe(false)
    expect(sent.querySelector('[data-upcoming]')).toBeNull()
  })

  it('［この条件を保存する］は［保存した検索］の中にまとめ、絞り込み中だけ横に小さな点を出す', async () => {
    narrow.value = false
    await renderRows()
    expect(buttonByText('この条件を保存する')).toBeUndefined()
    expect(host.querySelector('[data-savable-dot]')).toBeNull()
    act(() => { buttonByText('保存した検索')!.click() })
    await flush()
    const items = [...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent?.trim())
    expect(items.at(-1)).toBe('＋ 今の条件を保存する')
    // 保存した検索は「1つ選ぶ一覧」。操作メニューの鉛筆などの印を付けない。
    expect(document.querySelector('[role="menu"] [role="menuitem"] svg')).toBeNull()
    act(() => { (document.querySelector('[role="menuitem"]') as HTMLElement).click() })
    await flush()
    const chip = [...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith('予約中')) as HTMLButtonElement
    act(() => { chip.click() })
    await flush()
    expect(host.querySelector('[data-savable-dot]')).not.toBeNull()
  })

  it('狭い幅は1列の2段（上に人数・下に開封とクリック）で、送っていない行は — で数を作らない', async () => {
    narrow.value = true
    const { sent, unsent, heads } = await renderRows()
    narrow.value = false
    expect(heads).toContain('結果')
    expect(heads).not.toContain('クリック')
    expect(sent.textContent).toContain('624 人')
    expect(sent.textContent).toContain('開封 71.2%・クリック 15.4%')
    expect(unsent.textContent).not.toMatch(/0\s*人/)
  })
})

describe('V8 一斉配信一覧（src/v8）の動き', () => {
  it('does not evaluate the creation module while only the list is open', async () => {
    act(() => { root.render(<BroadcastListV8 />) })
    await flush()
    expect(initialFormEvaluations).toBe(0)
    expect(host.querySelector('[data-loaded-broadcast-form]')).toBeNull()
  })

  it('未分類の件数を選択中の店舗に絞り、ほかの店舗の配信を足さない', async () => {
    listFolders.mockImplementation(async (_kind, accountId) => ({ success: true, data: [], unfiledCount: accountId === 'account-a' ? 0 : 2 }))
    act(() => { root.render(<BroadcastListV8 />) })
    await flush()
    expect(listFolders).toHaveBeenCalledWith('broadcast', 'account-a')
    expect(host.querySelector('button[title="未分類"]')?.textContent).toBe('未分類0')
  })

  it('狭い幅でも送信枠を保持し、下書きの絞り込みは使える', async () => {
    narrow.value = true
    try {
      act(() => { root.render(<BroadcastListV8 />) })
      await flush()
      expect(host.querySelector('[data-kpi-label][title="今月の送信枠"]')).not.toBeNull()
      expect(host.querySelector('[data-kpi-label][title="下書き"]')).toBeNull()
      const draft = buttonByText('下書き 3')
      expect(draft).toBeTruthy()
      act(() => draft!.click())
      await flush()
      expect(listBroadcasts).toHaveBeenLastCalledWith(expect.objectContaining({ displayStatus: 'draft' }))
    } finally { narrow.value = false }
  })

  it('行を選ぶと下にまとめての帯が出て、選んだ配信をまとめてフォルダへ移す（l5V9a）', async () => {
    listFolders.mockImplementation(async () => ({ success: true, data: [{ id: 'f-1', kind: 'broadcast', name: 'キャンペーン', parentId: null, displayOrder: 0, itemCount: 0, color: '#10B981', createdAt: '', updatedAt: '' }], unfiledCount: 2 }))
    act(() => { root.render(<BroadcastListV8 />) })
    await flush()
    const pick = (label: string) => host.querySelector(`[aria-label="${label}"]`) as HTMLElement
    expect(pick('8月キャンペーンのお知らせを選ぶ'), '行の選ぶ欄がありません').toBeTruthy()
    act(() => { fireEvent.click(pick('8月キャンペーンのお知らせを選ぶ')) })
    act(() => { fireEvent.click(pick('未購入者フォローを選ぶ')) })
    await flush()
    const move = buttonByText('フォルダへ移す')
    expect(move, 'まとめての帯がありません').toBeTruthy()
    act(() => { move!.click() })
    expect(updateBroadcast).not.toHaveBeenCalled()
    const dialog = document.querySelector('[role="dialog"]')!
    act(() => { fireEvent.click(dialog.querySelector('input[aria-label="キャンペーン"]')!) })
    const confirm = [...dialog.querySelectorAll('button')].find(button => button.textContent?.trim() === 'フォルダへ移す')!
    await act(async () => { fireEvent.click(confirm) })
    await flush()
    expect(updateBroadcast).toHaveBeenCalledWith('bc-1', expect.objectContaining({ folderId: 'f-1' }))
    expect(updateBroadcast).toHaveBeenCalledWith('bc-2', expect.objectContaining({ folderId: 'f-1' }))
    await waitFor(() => expect(buttonByText('フォルダへ移す'), '移した後も帯が残っています').toBeUndefined())
  })

  it('行と数の帯・札の件数が出る', async () => {
    act(() => { root.render(<BroadcastListV8 />) })
    await flush()
    expect(host.textContent).toContain('8月キャンペーンのお知らせ')
    expect(host.textContent).toContain('未購入者フォロー')
    expect(host.textContent).toContain('5,000 通のうち 1,842 通を使用')
    expect(buttonByText('すべて 24'), '札「すべて 24」がありません').toBeTruthy()
  })

  it('言葉で絞ると1件になる', async () => {
    act(() => { root.render(<BroadcastListV8 />) })
    await flush()
    const search = host.querySelector('input[placeholder="タイトル・内容で探す"]') as HTMLInputElement
    expect(search, '探す欄がありません').toBeTruthy()
    fireEvent.change(search, { target: { value: '未購入' } })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 320)) })
    await flush()
    expect(host.textContent).not.toContain('8月キャンペーンのお知らせ')
    expect(host.textContent).toContain('未購入者フォロー')
  })

  it('札を押すと状態で、並びを押すと古い順で読み直す', async () => {
    act(() => { root.render(<BroadcastListV8 />) })
    await flush()
    act(() => { buttonByText('下書き 3')?.click() })
    await flush()
    expect(listBroadcasts).toHaveBeenLastCalledWith(expect.objectContaining({ displayStatus: 'draft', cursor: 0 }))
    act(() => { fireEvent.click(host.querySelector('[aria-label="並び"]')!) })
    act(() => { fireEvent.click([...document.querySelectorAll('[role="option"]')].find(el => el.textContent?.includes('古い順'))!.querySelector('button')!) })
    await flush()
    expect(listBroadcasts).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'oldest' }))
    expect(host.querySelector('[aria-label="並び"]'), '並びの字が入れ替わっていません').toBeTruthy()
  })

  it('編集キーの無い運用担当は閲覧のみの帯が出て、作る・保存・フォルダ追加のボタンを置かない', async () => {
    role.current = 'staff'
    act(() => { root.render(<BroadcastListV8 />) })
    await flush()
    expect(host.textContent).toContain('閲覧のみで見ています')
    expect(host.querySelector('input[type="checkbox"]')).toBeNull()
    const buttons = [...host.querySelectorAll('button')]
    // 押せない形で出すのではなく、置かない（2026-10-06 オーナー決定）
    expect(buttons.find((b) => b.textContent?.includes('配信を作る')), '閲覧のみに「配信を作る」が出ています').toBeUndefined()
    expect(buttons.find((b) => b.textContent?.includes('条件を保存する')), '閲覧のみに「条件を保存する」が出ています').toBeUndefined()
    act(() => { buttonByText('保存した検索')!.click() })
    await flush()
    expect([...document.querySelectorAll('[role="menuitem"]')].some(el => el.textContent?.includes('今の条件を保存する')), '閲覧のみのメニューに保存が出ています').toBe(false)
    expect(buttons.find((b) => b.textContent?.includes('フォルダを追加')), '閲覧のみに「フォルダを追加」が出ています').toBeUndefined()
  })

  it('編集キーを持つ運用担当は作れる', async () => {
    role.current = 'staff'
    rememberStaffIdentity({ role: 'staff', permissionKeys: ['/broadcasts', 'broadcast.definition.edit'] } as StaffMember)
    act(() => { root.render(<BroadcastListV8 />) })
    await flush()
    expect(host.textContent).not.toContain('閲覧のみで見ています')
    const create = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('配信を作る')) as HTMLButtonElement
    expect(create.disabled).toBe(false)
  })

  it('配信を作る ▾ は絵（Xr6eu）の分け方：かんたんに送る・詳しく作る（説明つき）。詳しく作るは5つの手順へ移る', async () => {
    act(() => { root.render(<BroadcastListV8 />) })
    await flush()
    const create = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('配信を作る')) as HTMLButtonElement
    act(() => { create.click() })
    await flush()
    const items = [...document.querySelectorAll('[role="menuitem"]')]
    const labels = items.map((item) => item.textContent ?? '')
    expect(labels[0]).toContain('かんたんに送る')
    expect(labels[0]).toContain('文字1通を、全員かタグで。1画面で送れる')
    expect(labels[1]).toContain('詳しく作る')
    expect(labels[1]).toContain('画像・カード・細かい絞り込み・承認（5つの手順）')
    routerPush.mockClear()
    act(() => { (items[1] as HTMLElement).click() })
    expect(routerPush).toHaveBeenCalledWith('/broadcasts/new')
  })

  it('配信を作るメニューは左のフォルダの列から左へはみ出さないよう、左端をそろえて開く（align=start）', async () => {
    act(() => { root.render(<BroadcastListV8 />) })
    await flush()
    const create = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('配信を作る')) as HTMLButtonElement
    act(() => { create.click() })
    await flush()
    const portal = document.querySelector('[data-menu-portal]')
    expect(portal?.querySelector('[role="menu"][aria-label="配信の作り方"]'), '配信の作り方のメニューが開いていません').toBeTruthy()
    expect(portal?.getAttribute('data-align')).toBe('start')
  })

  it('loads the same inline form for template entry and keeps its cancel callback', async () => {
    act(() => { root.render(<BroadcastListV8 />) })
    await flush()
    const create = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('配信を作る'))!
    act(() => create.click())
    await flush()
    const template = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent?.includes('テンプレートから作る'))!
    await act(async () => template.click())
    await waitFor(() => expect(host.querySelector('[data-loaded-broadcast-form]')).toBeTruthy())
    const form = formImport.props as { openTemplatePickerInitially: boolean; onCancel: () => void; tags: unknown[] }
    expect(form.openTemplatePickerInitially).toBe(true)
    expect(form.tags).toEqual([])
    act(() => form.onCancel())
    expect(host.querySelector('[data-loaded-broadcast-form]')).toBeNull()
  })

  it('決まり2：下書きも予約済みも確認してから削除する', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      deleteBroadcast.mockClear()
      // 前の試験の検索語（URL に置かれる）を外す。
      flushListUrlState()
      window.history.replaceState(null, '', '/broadcasts')
      act(() => { root.render(<BroadcastListV8 />) })
      await flush()
      const openMenuOf = (title: string) => {
        const row = [...host.querySelectorAll('tr')].find((tr) => tr.textContent?.includes(title))
        const trigger = row?.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement
        act(() => { trigger.click() })
      }
      const clickMenuItem = (label: string) => {
        const item = [...document.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent?.includes(label)) as HTMLElement
        act(() => { item.click() })
      }
      openMenuOf('未購入者フォロー')
      clickMenuItem('削除する')
      await flush()
      expect(document.body.textContent).toContain('「未購入者フォロー」を削除しますか？')
      expect([...host.querySelectorAll('tr')].some((tr) => tr.textContent?.includes('未購入者フォロー'))).toBe(true)
      await act(async () => { vi.advanceTimersByTime(5100) })
      expect(deleteBroadcast).not.toHaveBeenCalled()
      const confirm = [...document.querySelectorAll('[role="alertdialog"] button')].find((el) => el.textContent?.trim() === '削除する') as HTMLButtonElement
      act(() => confirm.click())
      await flush()
      expect(deleteBroadcast).toHaveBeenCalledWith('bc-2')

      openMenuOf('8月キャンペーンのお知らせ')
      clickMenuItem('削除する')
      await flush()
      expect(document.body.textContent).toContain('を削除しますか？')
    } finally {
      vi.useRealTimers()
    }
  })
  it('統括から来た配信（提案 E-9・l3RQH）は「統括から」の札と鍵を出し、「…」は見る・複製だけ（編集・削除を出さない）', async () => {
    flushListUrlState()
    window.history.replaceState(null, '', '/broadcasts')
    const hqRow = { ...base, id: 'bc-hq', title: '1月の限定メニュー', fromHeadquarters: true, hqRunId: 'run-1', editable: false }
    listBroadcasts.mockImplementation(async () => ({
      success: true,
      data: [hqRow, rowB],
      kpis: { scheduled: 1, thisMonth: 2, delivered: 0, openRate: 0, drafts: 1 },
      statusCounts: { all: 2, scheduled: 1, draft: 1, pending_approval: 0, sent: 0, failed: 0 },
      pagination: { total: 2, limit: 20, cursor: 0, nextCursor: null },
    }))
    act(() => { root.render(<BroadcastListV8 />) })
    await flush()
    const rowOf = (title: string) => [...host.querySelectorAll('tr')].find((tr) => tr.textContent?.includes(title))
    expect(rowOf('1月の限定メニュー')?.textContent).toContain('統括から')
    expect(rowOf('1月の限定メニュー')?.querySelector('input[type="checkbox"]')).toBeNull()
    expect(rowOf('未購入者フォロー')?.textContent).not.toContain('統括から')
    const trigger = rowOf('1月の限定メニュー')?.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement
    act(() => { trigger.click() })
    const labels = [...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent?.trim())
    expect(labels).toContain('配信の詳細を見る')
    expect(labels).toContain('複製')
    expect(labels.some((label) => label?.includes('削除'))).toBe(false)
    expect(labels.some((label) => label?.includes('編集'))).toBe(false)
    expect(labels.some((label) => label?.includes('フォルダへ移す'))).toBe(false)
  })
})

function resetUrl() {
  flushListUrlState()
  window.history.replaceState(null, '', '/broadcasts')
}
it('2ページ目を含む全配信を検索し、検索結果を20件ずつ表示する', async () => {
  resetUrl()
  const rows = Array.from({ length: 125 }, (_, i) => ({ ...rowB, id: `row-${i}`, title: i < 100 ? `通常${i}` : `検索対象${i}` }))
  listBroadcasts.mockImplementation(async (params) => {
    const cursor = Number(params.cursor ?? 0)
    const limit = params.limit ?? 20
    return { success: true, data: rows.slice(cursor, cursor + limit), pagination: { total: rows.length, nextCursor: cursor + limit < rows.length ? String(cursor + limit) : null } }
  })
  act(() => { root.render(<BroadcastListV8 />) })
  await flush()
  fireEvent.change(host.querySelector('input[placeholder="タイトル・内容で探す"]')!, { target: { value: '検索対象' } })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 320)) })
  await flush()
  expect(host.textContent).toContain('検索対象100')
  expect(host.textContent).not.toContain('検索対象124')
  expect(host.textContent).toContain('25件中 1〜20件')
  const next = host.querySelector('button[aria-label="次のページ"]') as HTMLButtonElement
  expect(next).toBeTruthy()
  act(() => next.click())
  await flush()
  expect(host.textContent).toContain('検索対象124')
  expect(host.textContent).toContain('25件中 21〜25件')
  fireEvent.change(host.querySelector('input[placeholder="タイトル・内容で探す"]')!, { target: { value: '見つからない' } })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 320)) })
  await flush()
  expect(host.querySelector('[data-pagination-summary]')?.textContent).toBe('0件')
  fireEvent.change(host.querySelector('input[placeholder="タイトル・内容で探す"]')!, { target: { value: '' } })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 320)) })
  await flush()
  expect(host.textContent).toContain('通常0')
// 複数ページの取得・検索・ページ移動を全部確認し、混雑時も操作全体を待つ。
}, 20_000)

it('全件検索が上限を超えたら部分的な検索結果を表示しない', async () => {
  resetUrl()
  listBroadcasts.mockResolvedValue({ success: true, data: [rowB], pagination: { total: 10001, nextCursor: '100' } })
  act(() => { root.render(<BroadcastListV8 />) })
  await flush()
  fireEvent.change(host.querySelector('input[placeholder="タイトル・内容で探す"]')!, { target: { value: '未購入' } })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 320)) })
  await flush()
  expect(host.textContent).toContain('10,000件')
  expect(host.querySelector('tbody')?.textContent ?? '').not.toContain('未購入者フォロー')
})
it('配信日の共通入口から期間を指定し、選択表示と解除を保つ', async () => {
  resetUrl()
  act(() => { root.render(<BroadcastListV8 />) })
  await flush()
  const trigger = buttonByText('配信日：指定なし')!
  expect(trigger.getAttribute('aria-pressed')).toBe('false')
  act(() => { trigger.click() })
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  act(() => { (document.querySelector('button[aria-label="配信日（開始）"]') as HTMLButtonElement).click() })
  await flush()
  const month = document.querySelector('[role="grid"]')!.getAttribute('aria-label')!.match(/(\d+)年(\d+)月/)!
  const prefix = `${month[1]}-${month[2].padStart(2,'0')}`
  const chooseDay = (day:string) => ([...document.querySelectorAll<HTMLButtonElement>('[role="grid"] button:not([data-outside])')].find(button=>button.textContent===day)!).click()
  act(() => { chooseDay('1') })
  act(() => { (document.querySelector('button[aria-label="配信日（終了）"]') as HTMLButtonElement).click() })
  await flush()
  act(() => { chooseDay('2') })
  await flush()
  expect(listBroadcasts).toHaveBeenLastCalledWith(expect.objectContaining({from:`${prefix}-01`,to:`${prefix}-02`}))
  expect(trigger.getAttribute('aria-pressed')).toBe('true')
  act(() => { ([...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === '外す')!).click() })
  await flush()
  expect(listBroadcasts).toHaveBeenLastCalledWith(expect.objectContaining({from:undefined,to:undefined}))
  expect(trigger.getAttribute('aria-pressed')).toBe('false')
  act(() => { ([...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === '閉じる')!).click() })
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
})
it('保存した検索の送信済み・表示件数・古い順も復元する', async () => {
  resetUrl()
  listViews.mockResolvedValue({ success: true, data: [{ id: 'v1', name: '前月の送信', filters: { statusFilter: 'sent' }, sortKey: 'oldest', pageSize: 50 }] })
  act(() => { root.render(<BroadcastListV8 />) })
  await flush()
  act(() => { buttonByText('保存した検索')!.click() })
  await flush()
  act(() => { ([...document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent?.includes('前月の送信')) as HTMLElement).click() })
  await flush()
  expect(listBroadcasts).toHaveBeenLastCalledWith(expect.objectContaining({ displayStatus: 'sent', limit: 50, sort: 'oldest', cursor: 0 }))
})
it('検索保存は現在の並び順と表示件数を保存する', async () => {
  resetUrl()
  createView.mockClear()
  act(() => { root.render(<BroadcastListV8 />) })
  await flush()
  act(() => { fireEvent.click(host.querySelector('[aria-label="並び"]')!) })
  act(() => { fireEvent.click([...document.querySelectorAll('[role="option"]')].find(el => el.textContent?.includes('古い順'))!.querySelector('button')!) })
  act(() => { buttonByText('保存した検索')!.click() })
  await flush()
  act(() => { ([...document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent?.includes('今の条件を保存する')) as HTMLElement).click() })
  await flush()
  fireEvent.change(host.querySelector('input[aria-label="保存する検索の名前"]')!, { target: { value: '古い配信' } })
  act(() => { buttonByText('保存する')!.click() })
  await flush()
  expect(createView).toHaveBeenCalledWith('account-a', expect.objectContaining({ sortKey: 'oldest', pageSize: 20 }))
})

it('検索の通信失敗は内部の英語を出さず、読み直す案内を出す', async () => {
  listBroadcasts.mockRejectedValue(new Error('API error: 500'))
  act(() => { root.render(<BroadcastListV8 />) })
  await flush()
  expect(host.textContent).not.toContain('API error: 500')
  expect(host.textContent).toContain('再読み込みしても直らない場合はエラー報告へ')
  expect(buttonByText('もう一度読み込む')).toBeTruthy()
  expect(host.textContent).not.toContain('まだ一斉配信がありません')
  const calls = listBroadcasts.mock.calls.length
  listBroadcasts.mockResolvedValue({ success: true, data: [base], pagination: { total: 1, limit: 20, offset: 0 } })
  act(() => { buttonByText('もう一度読み込む')!.click() })
  await flush()
  expect(listBroadcasts.mock.calls.length).toBe(calls + 1)
  expect(host.textContent).toContain(base.title)
  expect(buttonByText('もう一度読み込む')).toBeUndefined()
})

it('取得に成功して0件だったときだけ、空の一覧を出す', async () => {
  listBroadcasts.mockResolvedValue({ success: true, data: [], pagination: { total: 0, limit: 20, offset: 0 } })
  act(() => { root.render(<BroadcastListV8 />) })
  await flush()
  expect(host.textContent).toContain('まだ一斉配信がありません')
  expect(buttonByText('もう一度読み込む')).toBeUndefined()
})

it('WEB-014：一斉配信には手動順・つまみ・上下移動を置かない', async () => {
    await act(async () => root.render(<BroadcastListV8 />)); await flush()
    expect(host.querySelector('[data-reorder-handle]')).toBeNull()
    expect(host.textContent).not.toContain('手動順')
    expect(host.querySelector('[draggable="true"]')).toBeNull()
  })
it('選んだ配信だけを、確認後にその版のままフォルダへ移す', async () => {
  listBroadcasts.mockResolvedValueOnce({ success: true, data: [{ ...base, version: 7 }, { ...rowB, version: 9 }], pagination: { total: 2, limit: 20, cursor: 0 } })
  listFolders.mockResolvedValue({ success: true, data: [{ id: 'campaign', name: 'キャンペーン', color: null }], unfiledCount: 2 })
  act(() => root.render(<BroadcastListV8 />))
  await flush()
  act(() => fireEvent.click(host.querySelector('input[aria-label="8月キャンペーンのお知らせを選ぶ"]')!))
  expect(host.querySelector('[data-row-id="bc-1"]')?.getAttribute('aria-selected')).toBe('true')
  expect(host.querySelector('[data-row-id="bc-2"]')?.getAttribute('aria-selected')).toBe('false')
  const move = [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === 'フォルダへ移す')!
  act(() => fireEvent.click(move))
  expect(updateBroadcast).not.toHaveBeenCalled()
  const dialog = document.querySelector('[role="dialog"]')!
  act(() => fireEvent.click(dialog.querySelector('input[aria-label="キャンペーン"]')!))
  const confirm = [...dialog.querySelectorAll('button')].find(button => button.textContent?.trim() === 'フォルダへ移す')!
  await act(async () => { fireEvent.click(confirm) })
  await flush()
  expect(updateBroadcast.mock.calls).toEqual([['bc-1', { folderId: 'campaign', expectedVersion: 7 }]])
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})

it('並び順の読み直しでは行と件数を残し、状態条件の切替では旧行を隠す', async () => {
  resetUrl()
  act(() => root.render(<BroadcastListV8 />))
  await flush()
  let resolve!: (value: unknown) => void
  listBroadcasts.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  act(() => fireEvent.click(host.querySelector('[aria-label="並び"]')!))
  act(() => fireEvent.click([...document.querySelectorAll('[role="option"]')].find(el => el.textContent?.includes('古い順'))!.querySelector('button')!))
  await flush()
  expect(host.querySelector('[data-row-id="bc-1"]')).not.toBeNull()
  expect(host.querySelector('[aria-busy="true"]')).not.toBeNull()
  await act(async () => resolve({ success: true, data: [rowB, base], pagination: { total: 2 } }))
  await flush()
  listBroadcasts.mockImplementationOnce(() => new Promise(() => {}))
  act(() => buttonByText('下書き')?.click())
  await flush()
  expect(host.querySelector('[data-row-id="bc-1"]')).toBeNull()
})

async function confirmDraftDeletion() {
  const trigger = host.querySelector<HTMLButtonElement>('tr[data-row-id="bc-2"] button[aria-haspopup="menu"]')!
  act(() => { trigger.focus(); trigger.click() })
  const remove = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent?.includes('削除する'))!
  act(() => remove.click())
  await flush()
  const confirm = [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button => button.textContent === '削除する')!
  act(() => confirm.click())
  await flush()
}

it('削除成功後にだけ150ms薄め、次の行へ焦点を移し、再取得失敗を削除失敗にしない', async () => {
  resetUrl()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] })
  try {
    let resolveDelete!: (value: { success: boolean; data: null }) => void
    deleteBroadcast.mockImplementationOnce(() => new Promise(resolve => { resolveDelete = resolve }))
    act(() => root.render(<BroadcastListV8 />))
    await flush()
    await confirmDraftDeletion()
    expect(host.querySelector('tr[data-row-id="bc-2"]')?.hasAttribute('data-leaving')).toBe(false)
    listBroadcasts.mockRejectedValueOnce(new Error('reload failed'))
    await act(async () => resolveDelete({ success: true, data: null }))
    await flush()
    expect(host.querySelector('tr[data-row-id="bc-2"]')?.getAttribute('data-leaving')).toBe('true')
    await act(async () => vi.advanceTimersByTime(20))
    expect(document.activeElement?.closest('tr')?.getAttribute('data-row-id')).toBe('bc-1')
    await act(async () => vi.advanceTimersByTime(129))
    expect(host.querySelector('tr[data-row-id="bc-2"]')).not.toBeNull()
    await act(async () => vi.advanceTimersByTime(1))
    await flush()
    expect(document.body.textContent).toContain('一斉配信を読み込めませんでした')
    expect(document.body.textContent).not.toContain('この配信を削除できませんでした')
    expect(document.querySelector('[role="alertdialog"]:not([aria-hidden="true"])')).toBeNull()
  } finally { vi.useRealTimers() }
})

it('削除失敗は行と確認窓を残し、動きを減らす設定の成功は待たずに行を外す', async () => {
  resetUrl()
  deleteBroadcast.mockRejectedValueOnce(new Error('delete failed'))
  act(() => root.render(<BroadcastListV8 />))
  await flush()
  await confirmDraftDeletion()
  expect(host.querySelector('tr[data-row-id="bc-2"]')?.hasAttribute('data-leaving')).toBe(false)
  expect(document.body.textContent).toContain('この配信を削除できませんでした')
  vi.spyOn(window, 'matchMedia').mockImplementation(query => ({ matches: query.includes('prefers-reduced-motion'), addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList)
  listBroadcasts.mockImplementationOnce(() => new Promise(() => {}))
  const confirm = [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button => button.textContent === '削除する')!
  act(() => confirm.click())
  await flush()
  expect(host.querySelector('tr[data-row-id="bc-2"]')).toBeNull()
  expect(host.querySelector('tr[data-row-id="bc-1"]')).not.toBeNull()
  vi.restoreAllMocks()
})

it('行が消える途中で別の絞り込みを選んでも、古い条件を読み直さない', async () => {
  resetUrl()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    act(() => root.render(<BroadcastListV8 />))
    await flush()
    await confirmDraftDeletion()
    expect(host.querySelector('tr[data-row-id="bc-2"]')?.hasAttribute('data-leaving')).toBe(true)
    const draft = buttonByText('下書き 3')!
    act(() => draft.click())
    await flush()
    const reads = listBroadcasts.mock.calls.length
    expect(listBroadcasts).toHaveBeenLastCalledWith(expect.objectContaining({ displayStatus: 'draft' }))
    await act(async () => vi.advanceTimersByTime(150))
    await flush()
    expect(listBroadcasts).toHaveBeenCalledTimes(reads)
  } finally { vi.useRealTimers() }
})


describe('読込骨格の表示時間と完了への切替', () => {
  it.each(['ready', 'error'])('遅い応答から%sへ進むとき表示後400msを保つ', async (outcome) => {
    vi.useFakeTimers()
    let complete!: (value: unknown) => void
    listBroadcasts.mockImplementation(() => new Promise(resolve => { complete = resolve }))
    const shownBones = () => [...host.querySelectorAll('[aria-busy="true"] [data-skeleton]')]
      .filter(bone => !bone.closest('[data-skeleton-reserve]'))
    try {
      act(() => { root.render(<BroadcastListV8 />) })
      await flush()
      await act(async () => { await vi.advanceTimersByTimeAsync(299) })
      expect(shownBones()).toHaveLength(0)
      await act(async () => { await vi.advanceTimersByTimeAsync(1) })
      expect(shownBones().length).toBeGreaterThan(0)
      const table = host.querySelector('[aria-busy="true"] table')!
      expect(table.querySelector('tbody tr')?.children.length).toBe(table.querySelectorAll('thead th').length)
      await act(async () => { await vi.advanceTimersByTimeAsync(50) })
      await act(async () => { complete(outcome === 'ready'
        ? { success: true, data: [base] }
        : { success: false, error: '画面確認用の読込失敗' }) })
      await flush()
      expect(shownBones().length).toBeGreaterThan(0)
      expect(host.querySelector('[data-row-id]')).toBeNull()
      await act(async () => { await vi.advanceTimersByTimeAsync(349) })
      expect(shownBones().length).toBeGreaterThan(0)
      await act(async () => { await vi.advanceTimersByTimeAsync(1) })
      expect(shownBones()).toHaveLength(0)
      if (outcome === 'ready') expect(host.querySelector('[data-row-id]')).toBeTruthy()
      else expect(host.textContent).toContain('読み込めませんでした')
    } finally { vi.useRealTimers() }
  })

  it('300ms以内の応答は骨格を見せず行へ切り替える', async () => {
    vi.useFakeTimers()
    let complete!: (value: unknown) => void
    listBroadcasts.mockImplementation(() => new Promise(resolve => { complete = resolve }))
    try {
      act(() => { root.render(<BroadcastListV8 />) }); await flush()
      await act(async () => { await vi.advanceTimersByTimeAsync(250); complete({ success: true, data: [base] }) })
      await flush()
      expect(host.querySelector('[data-row-id]')).toBeTruthy()
      expect(host.querySelector('[aria-busy="true"] [data-skeleton]')).toBeNull()
      await act(async () => { await vi.advanceTimersByTimeAsync(500) })
      expect(host.querySelector('[aria-busy="true"] [data-skeleton]')).toBeNull()
    } finally { vi.useRealTimers() }
  })
})
