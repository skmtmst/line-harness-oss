// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaItem } from '@line-crm/shared'

/**
 * N-205: 差し替え候補は51件あってもページ送りしかなく、名前検索が無かった。
 * 検索欄を足し、ページングと併用できることを実Reactで直接証明する。
 */
const fixture = vi.hoisted(() => ({
  accountId: 'account-a' as string | null,
  listCalls: [] as Array<{ accountId: string; params?: { query?: string; offset?: number; excludeId?: string } }>,
  listQueue: [] as Array<Promise<unknown>>,
  pending: [] as Array<{ resolve: (value: unknown) => void; reject: (error: unknown) => void }>,
  impactCalls: [] as Array<{ id: string; replacementId: string; accountId: string }>,
}))

const ok = (items: MediaItem[], total = items.length) =>
  Promise.resolve({ success: true, data: { items, total, limit: 50, offset: 0 } })

const media = (id: string, filename: string, account: string | null = 'account-a'): MediaItem => ({
  id,
  lineAccountId: account,
  folderId: null,
  kind: 'image',
  filename,
  mimeType: 'image/png',
  sizeBytes: 1200,
  width: 100,
  height: 100,
  durationMs: null,
  url: `https://cdn.example.test/${id}.png`,
  uploadedBy: '管理者',
  createdAt: '2026-09-16T09:00:00+09:00',
  usageCount: 0,
})

const SOURCE = media('src-1', '差し替え元.png')

vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    constructor(readonly status?: number, message = 'API error', readonly data?: unknown) {
      super(message)
    }
  }
  return {
    ApiError,
    api: {
      media: {
        list: (accountId: string, params?: { query?: string; offset?: number; excludeId?: string }) => {
          fixture.listCalls.push({ accountId, params })
          const next = fixture.listQueue.shift()
          return next ?? new Promise((resolve, reject) => { fixture.pending.push({ resolve, reject }) })
        },
        replacementImpact: (id: string, replacementId: string, accountId: string) => {
          fixture.impactCalls.push({ id, replacementId, accountId })
          return Promise.resolve({
            success: true,
            data: {
              replacement: { id: replacementId, filename: '差し替え先.png', kind: 'image' },
              usageCount: 1,
              replaceableCount: 1,
              blockedCount: 0,
              blockedByKind: {},
              canReplace: true,
              canPartiallyReplace: true,
              revision: 'rev-1',
              checkedAt: '2026-09-16T10:00:00+09:00',
              references: [{ kind: 'template', name: 'チラシ', replaceable: true, href: null, state: 'available', scannedAt: '2026-09-16T10:00:00+09:00' }],
            },
          })
        },
        replaceUsages: () => Promise.resolve({ success: true, data: { replacedUsageCount: 1, verification: 'verified' } }),
        contentUrl: (id: string, accountId: string) => `/api/media/${id}/content?accountId=${accountId}`,
      },
    },
  }
})

const { default: MediaReplacementDialog } = await import('./media-replacement-dialog')

let host: HTMLDivElement
let root: Root

async function settle() {
  await Promise.resolve()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await Promise.resolve()
}

async function renderDialog(accountId: string | null = 'account-a') {
  await act(async () => {
    root.render(
      <MediaReplacementDialog
        source={SOURCE}
        accountId={accountId}
        onClose={vi.fn()}
        onComplete={vi.fn()}
      />,
    )
    await settle()
  })
}

function dialog(): HTMLElement {
  const node = document.body.querySelector<HTMLElement>('[role="dialog"]')
  if (!node) throw new Error('ダイアログが開いていません')
  return node
}

async function waitForDialogText(text: string) {
  for (let index = 0; index < 30 && !dialog().textContent?.includes(text); index += 1) {
    await act(async () => { await settle() })
  }
  expect(dialog().textContent).toContain(text)
}

function searchInput(): HTMLInputElement {
  const input = dialog().querySelector<HTMLInputElement>('input[aria-label="差し替え候補を名前で検索"]')
  if (!input) throw new Error('検索欄がありません')
  return input
}

async function typeAndSearch(text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(searchInput(), text)
    searchInput().dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
  })
  await act(async () => {
    ;[...dialog().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '検索')!.click()
    await settle()
  })
}

beforeEach(() => {
  fixture.listCalls.length = 0
  fixture.listQueue.length = 0
  fixture.pending.length = 0
  fixture.impactCalls.length = 0
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('差し替え候補の名前検索（N-205）', () => {
  it('51件の候補を名前検索とページ送りで併用できる', async () => {
    const page1 = Array.from({ length: 50 }, (_, i) => media(`c-${i}`, `候補${String(i).padStart(2, '0')}.png`))
    fixture.listQueue.push(ok(page1, 51))
    await renderDialog()
    await waitForDialogText('候補 51件')

    // ページ送り（2ページ目）は offset 50 で読む。
    fixture.listQueue.push(ok([media('c-50', '候補50.png')], 51))
    const next = [...dialog().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '次へ')!
    await act(async () => { next.click(); await settle() })
    expect(fixture.listCalls.at(-1)?.params?.offset).toBe(50)

    // そのまま名前検索すると1ページ目へ戻り、query 付きで読む（併用）。
    fixture.listQueue.push(ok([media('hit-1', '夏セール候補.png')], 1))
    await typeAndSearch('夏セール')
    expect(fixture.listCalls.at(-1)?.params).toMatchObject({ query: '夏セール', offset: 0, excludeId: 'src-1' })
    await waitForDialogText('絞り込み中')

    // 検索で絞った候補を選ぶと、従来どおり影響確認へ進む。
    const trigger = [...dialog().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.getAttribute('aria-label') === '差し替え先')!
    await act(async () => { trigger.click(); await settle() })
    const option = [...dialog().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '夏セール候補.png')!
    await act(async () => { option.click(); await settle() })
    expect(fixture.impactCalls).toEqual([{ id: 'src-1', replacementId: 'hit-1', accountId: 'account-a' }])
  })

  it('候補の読込中・0件・失敗を分けて出す', async () => {
    fixture.listQueue.push(new Promise((resolve, reject) => { fixture.pending.push({ resolve, reject }) }))
    await renderDialog()
    expect(dialog().textContent).toContain('差し替え候補を読み込んでいます…')

    // 失敗（0件とも混ざらない案内）。
    await act(async () => {
      fixture.pending[0].reject(new Error('network'))
      await settle()
    })
    await waitForDialogText('差し替え候補を読み込めませんでした')

    // 検索結果0件は「候補なし」と別の案内。
    fixture.listQueue.push(ok([], 0))
    await typeAndSearch('存在しない名前')
    await waitForDialogText('「存在しない名前」に合う候補が見つかりませんでした')
  })

  it('アカウント切替後に届いた古い候補応答は捨てる', async () => {
    fixture.listQueue.push(new Promise((resolve, reject) => { fixture.pending.push({ resolve, reject }) }))
    await renderDialog('account-a')

    // account-b へ切り替え → 新しい要求が出る。
    fixture.listQueue.push(ok([media('b-1', 'Bの候補.png', 'account-b')]))
    await act(async () => {
      root.render(
        <MediaReplacementDialog
          source={SOURCE}
          accountId="account-b"
          onClose={vi.fn()}
          onComplete={vi.fn()}
        />,
      )
      await settle()
    })
    expect(fixture.listCalls.map((call) => call.accountId)).toEqual(['account-a', 'account-b'])

    // 遅れて届いた account-a の候補は画面へ出さない。
    await act(async () => {
      fixture.pending[0].resolve({ success: true, data: { items: [media('a-1', 'Aの古い候補.png', 'account-a')], total: 1, limit: 50, offset: 0 } })
      await settle()
    })
    // 候補名は選択肢を開いた中にだけ出る。Aの古い候補は無く、Bの候補だけが並ぶ。
    const trigger = [...dialog().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.getAttribute('aria-label') === '差し替え先')!
    await act(async () => { trigger.click(); await settle() })
    const listbox = dialog().querySelector<HTMLElement>('[role="listbox"]')!
    expect(listbox.textContent).toContain('Bの候補.png')
    expect(listbox.textContent).not.toContain('Aの古い候補')
  })
})
