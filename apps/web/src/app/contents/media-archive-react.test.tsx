// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaItem } from '@line-crm/shared'

/**
 * 登録メディアの退避・復帰（N-201）。
 * 既定の一覧から外れ、「アーカイブ済み」棚でだけ見えること、
 * 理由必須・管理者限定・戻せることを画面で固定する。
 */
const fixture = vi.hoisted(() => ({
  accountId: 'account-a' as string | null,
  role: 'owner' as 'owner' | 'admin' | 'staff',
  listCalls: [] as Array<{ accountId: string; params?: { archived?: string } }>,
  archiveCalls: [] as Array<{ id: string; accountId: string; reason: string }>,
  restoreCalls: [] as Array<{ id: string; accountId: string; reason: string }>,
  archiveResult: { success: true } as { success: boolean; error?: string; data?: unknown },
  archiveThrows: null as null | { status: number },
  archived: false,
}))

const MEDIA: MediaItem = {
  id: 'media-1',
  lineAccountId: 'account-a',
  folderId: null,
  kind: 'image',
  filename: '店舗の画像.png',
  mimeType: 'image/png',
  sizeBytes: 1200,
  width: 100,
  height: 100,
  durationMs: null,
  url: 'https://example.test/a.png',
  uploadedBy: '管理者',
  createdAt: '2026-09-16T09:00:00+09:00',
  usageCount: 2,
}

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: fixture.accountId, loading: false }),
}))

vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    constructor(readonly status?: number, message = 'API error') {
      super(message)
    }
  }
  return {
    ApiError,
    api: {
      featureSettings: {
        visibility: () => Promise.resolve({ success: true, data: { features: { media: true } } }),
      },
      staff: {
        me: () => Promise.resolve({ success: true, data: { role: fixture.role } }),
      },
      folders: {
        list: () => Promise.resolve({ success: true, data: [], unfiledCount: 0 }),
      },
      media: {
        list: (accountId: string, params?: { archived?: string }) => {
          fixture.listCalls.push({ accountId, params })
          const items = params?.archived === 'only'
            ? (fixture.archived ? [{ ...MEDIA, archivedAt: '2026-09-07T01:00:00.000Z', archivedBy: 'u-1', archiveReason: '整理' }] : [])
            : (fixture.archived ? [] : [MEDIA])
          return Promise.resolve({
            success: true,
            data: { items, total: items.length, limit: 20, offset: 0 },
          })
        },
        quota: () => Promise.resolve({
          success: true,
          data: { usageBytes: 1200, reservedBytes: 0, limitBytes: 10000, remainingBytes: 8800, usageRate: 0.12, state: 'normal' },
        }),
        detail: () => Promise.reject(new ApiError(404, 'Not found')),
        archive: (id: string, accountId: string, reason: string) => {
          fixture.archiveCalls.push({ id, accountId, reason })
          return fixture.archiveThrows
            ? Promise.reject(new ApiError(fixture.archiveThrows.status, 'conflict'))
            : Promise.resolve(fixture.archiveResult)
        },
        restore: (id: string, accountId: string, reason: string) => {
          fixture.restoreCalls.push({ id, accountId, reason })
          return fixture.archiveThrows
            ? Promise.reject(new ApiError(fixture.archiveThrows.status, 'conflict'))
            : Promise.resolve(fixture.archiveResult)
        },
        contentUrl: (id: string, accountId: string) => `/api/media/${id}/content?accountId=${accountId}`,
      },
    },
  }
})

function setNativeValue(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

const { default: ContentsPage } = await import('./page')

let host: HTMLDivElement
let root: Root
let mounted = false

async function settle() {
  await Promise.resolve()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await Promise.resolve()
}

async function renderPage() {
  await act(async () => {
    root.render(<ContentsPage />)
    await settle()
  })
}

async function waitForText(text: string) {
  for (let index = 0; index < 20 && !host.textContent?.includes(text); index += 1) {
    await act(async () => { await settle() })
  }
  expect(host.textContent).toContain(text)
}

function buttonByLabel(label: string): HTMLButtonElement {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.getAttribute('aria-label') === label || candidate.textContent === label)
  if (!button) throw new Error(`ボタンがありません: ${label}`)
  return button
}

async function clickChip(label: string) {
  const chip = [...host.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.textContent?.trim() === label)
  if (!chip) throw new Error(`絞り込みがありません: ${label}`)
  await act(async () => { chip.click(); await settle() })
}

beforeEach(() => {
  fixture.accountId = 'account-a'
  fixture.role = 'owner'
  fixture.listCalls.length = 0
  fixture.archiveCalls.length = 0
  fixture.restoreCalls.length = 0
  fixture.archiveResult = { success: true, data: MEDIA }
  fixture.archiveThrows = null
  fixture.archived = false
  window.history.replaceState({}, '', '/contents')
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  mounted = true
})

afterEach(async () => {
  if (mounted) await act(async () => { root.unmount() })
  host.remove()
  window.history.replaceState({}, '', '/contents')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('登録メディアの退避と復帰（N-201）', () => {
  it('既定の一覧は退避済みを外し、「アーカイブ済み」棚だけ archived=only で読む', async () => {
    await renderPage()
    await waitForText(MEDIA.filename)
    expect(fixture.listCalls.every((call) => call.params?.archived === undefined)).toBe(true)

    await clickChip('アーカイブ済み')
    expect(fixture.listCalls.at(-1)?.params?.archived).toBe('only')
  })

  it('退避には理由が必須で、確定すると理由付きでAPIを呼ぶ', async () => {
    await renderPage()
    await waitForText(MEDIA.filename)

    await act(async () => { buttonByLabel(`${MEDIA.filename}をアーカイブ`).click(); await settle() })
    expect(document.body.textContent).toContain('理由必須（あとから履歴で確認できます）')

    const confirm = [...document.body.querySelectorAll<HTMLButtonElement>('button')]
      .find((candidate) => candidate.textContent === 'アーカイブする')!
    expect(confirm).not.toBeNull()
    expect(confirm.disabled).toBe(true)

    const input = document.body.querySelector<HTMLInputElement>('input[aria-label="理由"]')
    expect(input).not.toBeNull()
    await act(async () => {
      setNativeValue(input!, '古いキャンペーン素材の整理')
      await settle()
    })
    expect(confirm.disabled).toBe(false)

    await act(async () => { confirm.click(); await settle() })
    expect(fixture.archiveCalls).toEqual([
      { id: 'media-1', accountId: 'account-a', reason: '古いキャンペーン素材の整理' },
    ])
  })

  it('退避済みの札は編集・削除・まとめ選択を出さず、「一覧へ戻す」だけを残す', async () => {
    fixture.archived = true
    await renderPage()
    await clickChip('アーカイブ済み')
    await waitForText(MEDIA.filename)

    expect(host.textContent).toContain('退避済み')
    expect(host.querySelector(`button[aria-label="${MEDIA.filename}の名前を変える"]`)).toBeNull()
    expect(host.querySelector(`button[aria-label="${MEDIA.filename}を削除"]`)).toBeNull()
    const checkbox = host.querySelector<HTMLInputElement>(`input[aria-label="${MEDIA.filename}を選ぶ"]`)
    expect(checkbox?.disabled).toBe(true)

    await act(async () => { buttonByLabel(`${MEDIA.filename}を一覧へ戻す`).click(); await settle() })
    const input = document.body.querySelector<HTMLInputElement>('input[aria-label="理由"]')!
    await act(async () => {
      setNativeValue(input, '再び使うため')
      await settle()
    })
    // 確認窓の確定ボタンは札の「一覧へ戻す」と同名なので、ダイアログ内だけを見る。
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!
    const restoreConfirm = [...dialog.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent === '一覧へ戻す')!
    await act(async () => { restoreConfirm.click(); await settle() })
    expect(fixture.restoreCalls).toEqual([
      { id: 'media-1', accountId: 'account-a', reason: '再び使うため' },
    ])
  })

  it('staffには退避・復帰の押し口を出さない', async () => {
    fixture.role = 'staff'
    await renderPage()
    await waitForText(MEDIA.filename)
    expect(host.querySelector(`button[aria-label="${MEDIA.filename}をアーカイブ"]`)).toBeNull()
    expect(host.querySelector(`button[aria-label="${MEDIA.filename}を削除"]`)).toBeNull()
  })

  it('409（直前に退避済み）は失敗文を出しつつ一覧を読み直す', async () => {
    // fetchApi は非2xxで ApiError を投げる。{success:false} の返りでは来ない。
    fixture.archiveThrows = { status: 409 }
    await renderPage()
    await waitForText(MEDIA.filename)
    const callsBefore = fixture.listCalls.length

    await act(async () => { buttonByLabel(`${MEDIA.filename}をアーカイブ`).click(); await settle() })
    const input = document.body.querySelector<HTMLInputElement>('input[aria-label="理由"]')!
    await act(async () => {
      setNativeValue(input, '整理')
      await settle()
    })
    await act(async () => { [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'アーカイブする')!.click(); await settle() })

    expect(document.body.textContent).toContain('既にアーカイブ済みです')
    expect(fixture.listCalls.length).toBeGreaterThan(callsBefore)
  })
})
