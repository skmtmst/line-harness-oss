// @vitest-environment happy-dom
import { verifiedStaffRole } from '@/test-utils/verified-staff-role'
import { flushListUrlState } from '@/components/shared/list-url-state'
/*
 * V8 統括のアカウント（src/v8/hq/home.tsx）の動きの試験。
 * LINE ID の @ を二重にしない、要確認のカードに引っかかった確認の言葉を出す（全文は title）、
 * 閲覧のみには「更新する」を灰色と理由付きで置く。
 * 「入る」は押すと引き継ぎの状態を確かめ、終わっていれば店へ進み、
 * 未完了・確認失敗なら登録時と同じ進捗画面へ戻す。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const accounts = vi.hoisted(() => vi.fn())
const checkConnection = vi.hoisted(() => vi.fn())
const importState = vi.hoisted(() => vi.fn())
const push = vi.hoisted(() => vi.fn())
const select = vi.hoisted(() => vi.fn())
const role = vi.hoisted(() => ({ value: 'owner' as string }))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    fetchApi: checkConnection,
    api: {
      ...actual.api,
      lineAccounts: { ...actual.api.lineAccounts, list: accounts, followerImportState: importState },
      lineAccountFolders: { ...actual.api.lineAccountFolders, list: vi.fn(async () => ({ success: true, data: { folders: [], total: 0, unclassifiedCount: 0 } })) },
      tenants: { ...actual.api.tenants, me: vi.fn(async () => ({ success: true, data: { name: '然 -NEN-' } })) },
    },
  }
})
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => React.createElement('a', { href }, children),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/hq',
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/components/hq/platform-notices', () => ({ default: () => null }))
vi.mock('@/lib/staff-role', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/staff-role')>(), useStaffRole: () => role.value }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ accounts: [], setSelectedAccountId: select, refreshAccounts: async () => {} }),
}))

import HqHomeV8 from './home'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const warnedAccount = {
  id: 'acc-1', revision: 1, channelId: '2000000001', name: '然 -NEN- TEST', displayName: '然 -NEN- TEST',
  basicId: '@273ytrca', isActive: true, country: null, role: null, displayOrder: 0, archivedAt: null, tags: [],
  stats: { friendCount: 3, activeScenarios: 0, messagesThisMonth: 0, staffCount: 1 },
  connection: {
    status: 'warn', checkedAt: '2026-10-07T10:00:00+09:00', tokenExpired: false,
    issues: [{
      kind: 'webhook_endpoint', result: 'mismatched', expectedUrl: 'https://stg-api.musubo.jp/webhook',
      registeredUrl: 'https://old.example.test/webhook', webhookActive: true, httpStatus: 200,
    }],
  },
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  accounts.mockResolvedValue({ success: true, data: [warnedAccount] })
  checkConnection.mockReset()
  checkConnection.mockResolvedValue({ success: true, data: {} })
  importState.mockReset()
  importState.mockResolvedValue({ success: true, data: { phase: 'completed' } })
  push.mockReset()
  select.mockReset()
  role.value = 'owner'
})

afterEach(() => {
  act(() => root.unmount())
  flushListUrlState()
  container.remove()
  verifiedStaffRole(null)
})

async function render() {
  verifiedStaffRole(role.value === 'owner' ? 'owner' : role.value === 'admin' ? 'admin' : 'viewer')
  await act(async () => { root.render(<HqHomeV8 />) })
  await act(async () => { await Promise.resolve() })
}

describe('統括のアカウント', () => {
  it('カードの入口は短い「入る」にし、読み上げにはアカウント名を残す', async () => {
    await render()
    const enter = container.querySelector('button[aria-label="然 -NEN- TEST へ入る"]')!
    expect(enter.textContent).toBe('入る')
  })
  it('LINE ID の @ を二重にしない', async () => {
    await render()
    const card = container.querySelector('article')!
    expect(card.textContent).toContain('@273ytrca')
    expect(card.textContent).not.toContain('@@')
  })

  it('要確認のカードは、引っかかった確認の言葉を出し、全文を title に持つ', async () => {
    await render()
    const card = container.querySelector('article')!
    const reason = card.querySelector('[title*="old.example.test"]')
    expect(reason?.textContent).toContain('Webhook の URL がこの環境と違います')
    const band = reason!.closest('[data-design-part="notice"]')!
    expect(band.closest('article')).toBe(card)
    expect(card.querySelector('dl')!.compareDocumentPosition(band) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(band.compareDocumentPosition(card.querySelector('button[aria-label$="へ入る"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(band.querySelector('[data-notice-dot]')).toBeTruthy()
    expect(card.textContent).not.toContain('LINE ID・接続状態を確かめてください')
    expect([...card.querySelectorAll('button')].some((button) => button.textContent === '更新する')).toBe(true)
  })

  it('正常のカードには理由の帯を出さない', async () => {
    accounts.mockResolvedValue({ success: true, data: [{ ...warnedAccount, connection: { status: 'ok', issues: [] } }] })
    await render()
    expect(container.querySelector('article [data-design-part="notice"]')).toBeNull()
  })

  it('分類のないカードではLINE IDの情報の次に数を読み、正常ならそのまま操作へ進める', async () => {
    accounts.mockResolvedValue({ success: true, data: [{ ...warnedAccount, connection: { status: 'ok', issues: [] } }] })
    await render()
    const card = container.querySelector('article')!
    const stats = card.querySelector('dl')!
    expect(card.querySelector('[data-tag-overflow]')).toBeNull()
    expect(stats.previousElementSibling?.textContent).toContain('@273ytrca')
    expect(stats.nextElementSibling).toBeNull()
    expect(card.querySelector('button[aria-label$="へ入る"]')).not.toBeNull()
  })

  it('「入る」を押すと引き継ぎの状態を確かめ、終わっていればそのアカウントを覚えて店へ進む', async () => {
    await render()
    const enter = container.querySelector<HTMLButtonElement>('button[aria-label="然 -NEN- TEST へ入る"]')!
    await act(async () => { enter.click() })
    await act(async () => { await Promise.resolve() })
    expect(importState).toHaveBeenCalledWith('acc-1')
    expect(select).toHaveBeenCalledWith('acc-1')
    expect(push).toHaveBeenCalledTimes(1)
    expect(push.mock.calls[0][0]).toBe('/')
  })

  it('引き継ぎ中は店舗を選択せず登録時と同じ進捗画面へ戻す', async () => {
    importState.mockResolvedValue({ success: true, data: { phase: 'importing_ids' } })
    await render()
    const enter = container.querySelector<HTMLButtonElement>('button[aria-label="然 -NEN- TEST へ入る"]')!
    await act(async () => { enter.click() })
    await act(async () => { await Promise.resolve() })
    expect(importState).toHaveBeenCalledWith('acc-1')
    expect(push).toHaveBeenCalledWith('/accounts/new/handover?accountId=acc-1')
    expect(select).not.toHaveBeenCalled()
  })

  it('引き継ぎ状態を読めないときも進捗画面へ戻し、次は止まらない', async () => {
    importState.mockRejectedValueOnce(new Error('worker unavailable'))
    await render()
    const enter = container.querySelector<HTMLButtonElement>('button[aria-label="然 -NEN- TEST へ入る"]')!
    await act(async () => { enter.click() })
    await act(async () => { await Promise.resolve() })
    expect(push).toHaveBeenCalledWith('/accounts/new/handover?accountId=acc-1')
    expect(select).not.toHaveBeenCalled()
    importState.mockResolvedValue({ success: true, data: { phase: 'completed' } })
    await act(async () => { enter.click() })
    await act(async () => { await Promise.resolve() })
    expect(select).toHaveBeenCalledWith('acc-1')
  })

  it('閲覧のみでも引き継ぎが終わっていれば入れる（状態の確認は読み取りだけ）', async () => {
    role.value = 'viewer'
    await render()
    const enter = container.querySelector<HTMLButtonElement>('button[aria-label="然 -NEN- TEST へ入る"]')!
    await act(async () => { enter.click() })
    await act(async () => { await Promise.resolve() })
    expect(importState).toHaveBeenCalledWith('acc-1')
    expect(select).toHaveBeenCalledWith('acc-1')
  })

  it('カードの更新は押した1件だけに送り、失敗したアカウント名を伝える', async () => {
    accounts.mockResolvedValue({ success: true, data: [warnedAccount, { ...warnedAccount, id: 'acc-2', name: '二号店', displayName: '二号店' }] })
    checkConnection.mockRejectedValueOnce(new Error('network'))
    await render()
    const card = [...container.querySelectorAll('article')].find(item => item.textContent?.includes('二号店'))!
    const update = [...card.querySelectorAll('button')].find(button => button.textContent === '更新する')!
    await act(async () => { update.click() })
    expect(checkConnection).toHaveBeenCalledTimes(1)
    expect(checkConnection).toHaveBeenCalledWith('/api/line-accounts/acc-2/connection-checks', expect.objectContaining({ method: 'POST' }))
    expect(container.textContent).toContain('二号店の接続情報を更新できませんでした。')
  })

  it('更新して正常になったカードの警告は再読込の結果に合わせて消す', async () => {
    await render()
    accounts.mockResolvedValue({ success: true, data: [{ ...warnedAccount, connection: { status: 'ok', issues: [] } }] })
    const update = [...container.querySelector('article')!.querySelectorAll('button')].find(button => button.textContent === '更新する')!
    await act(async () => { update.click() })
    expect(container.querySelector('article [data-design-part="notice"]')).toBeNull()
    expect(container.querySelector('article')!.textContent).toContain('正常')
  })

  it('閲覧のみにはNoticeの更新を灰色と理由付きで置き、変更しない', async () => {
    role.value = 'viewer'
    await render()
    const card = container.querySelector('article')!
    const update = [...card.querySelectorAll('button')].find(button => button.textContent === '更新する')!
    expect(update.getAttribute('aria-disabled')).toBe('true')
    await act(async () => { update.click(); update.focus() })
    expect(checkConnection).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('閲覧のみ')
    expect([...container.querySelectorAll('button')].some((button) => button.textContent === '全部を更新')).toBe(false)
  })
  it.each(['owner', 'admin', 'viewer'])('アカウントの用途文から権限を推測せず、現在の人%sで設定の入口を決める', async viewerRole => {
    role.value = viewerRole
    accounts.mockResolvedValue({ success: true, data: [{ ...warnedAccount, role: '本店の配信に使う', connection: { status: 'ok', issues: [] } }] })
    await render()
    expect(container.querySelector('button[aria-label$="の設定"]') !== null).toBe(viewerRole !== 'viewer')
  })



  it('接続に問題の数は対応が要るものの接続の絞り込みへ進める', async () => {
    await render()
    const link = [...container.querySelectorAll('a')].find((anchor) => anchor.textContent?.includes('対応が要るものへ'))!
    expect(link.getAttribute('href')).toBe('/hq/attention?kind=connections')
  })

  it('閲覧のみでも所属とタグを読め、権限者を含む補足の全文へ届く', async () => {
    role.value = 'viewer'
    accounts.mockResolvedValue({ success: true, data: [{ ...warnedAccount, folderId: 'area', folder: { name: '渋谷エリア', color: '#0088ff' }, tags: [{ id: 'main', name: '本店', color: '#0088ff' }], stats: { ...warnedAccount.stats, staffCount: 4 } }] })
    await render()
    const card = container.querySelector('article')!
    expect(card.querySelector('[aria-label="フォルダ：渋谷エリア"]')).not.toBeNull()
    expect(card.querySelector('[aria-label="タグ「本店」"]')).not.toBeNull()
    expect(card.textContent).toContain('権限者 4 人')
    expect([...card.querySelectorAll('button')].some(button => button.textContent === '設定')).toBe(false)
  })
})

it('フォルダがタグにも返っても札は一つで、アーカイブの詳細には矢印を出さない', async () => {
  accounts.mockResolvedValue({ success: true, data: [{ ...warnedAccount, archivedAt: '2026-10-01', folderId: 'area', folder: { name: '渋谷エリア', color: '#0088ff' }, tags: [{ id: 'same', name: '渋谷エリア', color: '#0088ff' }, { id: 'other', name: '本店' }] }] })
  await render()
  const archiveFilter = [...container.querySelectorAll('button')].find(el => el.textContent?.startsWith('アーカイブ'))!
  await act(async () => { archiveFilter.click() })
  const card = container.querySelector('article')!
  const labels = [...card.querySelectorAll('[data-icon-label], [role="group"]')].filter(el => !el.closest('[aria-hidden="true"]') && el.textContent === '渋谷エリア')
  expect(labels).toHaveLength(1)
  const edit = [...card.querySelectorAll('button')].find(el => el.textContent === '登録内容を編集')!
  expect(edit).toBeTruthy()
  expect(edit.querySelectorAll('svg')).toHaveLength(1)
  expect([...card.querySelectorAll('button')].some(el => el.textContent === '詳細')).toBe(false)
  expect([...card.querySelectorAll('button')].find(el => el.textContent === '戻す')?.querySelector('svg')).not.toBeNull()
})


it.each([
  { staffCount: undefined, label: '権限者 —' },
  { staffCount: 0, label: '権限者 0 人' },
])('権限者数の未取得と本当の0人をカードと表で分ける：$label', async ({ staffCount, label }) => {
  window.history.replaceState(null, '', '/hq')
  accounts.mockResolvedValue({ success: true, data: [{ ...warnedAccount, stats: { ...warnedAccount.stats, staffCount } }] })
  await render()
  const card = container.querySelector('article')!
  expect(card.textContent).toContain(label)
  expect(card.querySelector('[title*="権限者"]')?.getAttribute('title')).toContain(label)
  if (staffCount === undefined) expect(card.textContent).not.toContain('権限者 0 人')
  const table = container.querySelector<HTMLButtonElement>('button[aria-label="表"]')!
  await act(async () => { table.click() })
  const row = container.querySelector('tbody tr')!
  expect(row.textContent).toContain(label)
  expect(row.querySelector('[title*="権限者"]')?.getAttribute('title')).toContain(label)
})
