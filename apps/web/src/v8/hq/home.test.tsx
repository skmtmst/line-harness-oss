// @vitest-environment happy-dom
/*
 * V8 統括のアカウント（src/v8/hq/home.tsx）の動きの試験。
 * LINE ID の @ を二重にしない、要確認のカードに引っかかった確認の言葉を出す（全文は title）、
 * 閲覧のみには「更新する」を置かない。
 * 「入る」は見た目のまま、押すと友だちの引き継ぎを続きから進める（2026-10-15 の決まり）。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const accounts = vi.hoisted(() => vi.fn())
const stepImport = vi.hoisted(() => vi.fn())
const role = vi.hoisted(() => ({ value: 'owner' as string }))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      lineAccounts: { ...actual.api.lineAccounts, list: accounts, stepFollowerImport: stepImport },
      lineAccountFolders: { ...actual.api.lineAccountFolders, list: vi.fn(async () => ({ success: true, data: { folders: [], total: 0, unclassifiedCount: 0 } })) },
      tenants: { ...actual.api.tenants, me: vi.fn(async () => ({ success: true, data: { name: '然 -NEN-' } })) },
    },
  }
})
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => React.createElement('a', { href }, children),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/hq',
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/components/hq/platform-notices', () => ({ default: () => null }))
vi.mock('@/lib/staff-role', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/staff-role')>(), useStaffRole: () => role.value }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ setSelectedAccountId: () => {}, refreshAccounts: async () => {} }),
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
  stepImport.mockReset()
  stepImport.mockResolvedValue({ success: true, data: { state: { phase: 'completed' }, busy: false, profilesFetched: 0 } })
  role.value = 'owner'
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function render() {
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
    expect(band.querySelector('svg')).toBeTruthy()
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

  it('「入る」を押すと、友だちの引き継ぎを続きから進める口を叩く', async () => {
    await render()
    const enter = container.querySelector<HTMLButtonElement>('button[aria-label="然 -NEN- TEST へ入る"]')!
    await act(async () => { enter.click() })
    expect(stepImport).toHaveBeenCalledWith('acc-1')
  })

  it('口が返らなくても、口が転んでも「入る」は止まらない', async () => {
    // 返らない場合（答えを待たない）と、転んだ場合（遷移を止めない）の両方。
    stepImport.mockReturnValueOnce(new Promise(() => {}))
    await render()
    const enter = container.querySelector<HTMLButtonElement>('button[aria-label="然 -NEN- TEST へ入る"]')!
    await act(async () => { enter.click() })
    expect(stepImport).toHaveBeenCalledTimes(1)
    stepImport.mockRejectedValueOnce(new Error('worker unavailable'))
    await act(async () => { enter.click() })
    await act(async () => { await Promise.resolve() })
    expect(stepImport).toHaveBeenCalledTimes(2)
  })

  it('閲覧のみは引き継ぎを動かさない', async () => {
    role.value = 'viewer'
    await render()
    const enter = container.querySelector<HTMLButtonElement>('button[aria-label="然 -NEN- TEST へ入る"]')!
    await act(async () => { enter.click() })
    expect(stepImport).not.toHaveBeenCalled()
  })

  it('閲覧のみには「更新する」を置かない', async () => {
    role.value = 'viewer'
    await render()
    const card = container.querySelector('article')!
    expect([...card.querySelectorAll('button')].some((button) => button.textContent === '更新する')).toBe(false)
  })
  it.each(['owner', 'admin', 'viewer'])('アカウントの用途文から権限を推測せず、現在の人%sで設定の入口を決める', async viewerRole => {
    role.value = viewerRole
    accounts.mockResolvedValue({ success: true, data: [{ ...warnedAccount, role: '本店の配信に使う', connection: { status: 'ok', issues: [] } }] })
    await render()
    expect(container.querySelector('button[aria-label$="の設定"]') !== null).toBe(viewerRole !== 'viewer')
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
