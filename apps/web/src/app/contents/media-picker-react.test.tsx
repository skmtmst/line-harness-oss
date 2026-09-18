// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaItem } from '@line-crm/shared'

/**
 * 登録メディアを別機能から選ぶ共通の窓（N-193 / N-205）。
 *
 * - 開くと選択中アカウントのメディアを実API（のモック）から読む
 * - 名前検索とページ送りを併用できる（51件の候補で証明）
 * - アカウント切替後に届いた古い応答は捨て、別アカウントの候補は出さない
 * - 読込中・0件・失敗を分けて出す
 */
const fixture = vi.hoisted(() => ({
  listCalls: [] as Array<{ accountId: string; params?: { kind?: string; query?: string; limit?: number; offset?: number } }>,
  /** 呼び出し順に結果を返す。Promise をぶら下げたままにもできる。 */
  listQueue: [] as Array<Promise<unknown>>,
  pending: [] as Array<{ resolve: (value: unknown) => void; reject: (error: unknown) => void }>,
}))

const ok = (items: MediaItem[], total = items.length) =>
  Promise.resolve({ success: true, data: { items, total, limit: 20, offset: 0 } })
const pendingList = () =>
  new Promise((resolve, reject) => { fixture.pending.push({ resolve, reject }) })

const media = (id: string, filename: string, account: string | null = 'account-a', kind: MediaItem['kind'] = 'image'): MediaItem => ({
  id,
  lineAccountId: account,
  folderId: null,
  kind,
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

vi.mock('@/lib/api', () => ({
  api: {
    media: {
      list: (accountId: string, params?: { kind?: string; query?: string; limit?: number; offset?: number }) => {
        fixture.listCalls.push({ accountId, params })
        const next = fixture.listQueue.shift()
        return next ?? pendingList()
      },
      contentUrl: (id: string, accountId: string) => `/api/media/${id}/content?accountId=${accountId}`,
    },
  },
}))

const { default: MediaPickerDialog } = await import('./media-picker-dialog')

let host: HTMLDivElement
let root: Root
let mounted = false

async function settle() {
  await Promise.resolve()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await Promise.resolve()
}

async function renderPicker(props: Partial<React.ComponentProps<typeof MediaPickerDialog>> = {}) {
  const onSelect = props.onSelect ?? vi.fn()
  const onClose = props.onClose ?? vi.fn()
  await act(async () => {
    root.render(
      <MediaPickerDialog
        open
        accountId="account-a"
        kind="image"
        onClose={onClose}
        onSelect={onSelect}
        {...props}
      />,
    )
    await settle()
  })
  return { onSelect, onClose }
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

function optionButton(filename: string): HTMLButtonElement {
  const button = [...document.body.querySelectorAll<HTMLButtonElement>('[role="option"]')]
    .find((candidate) => candidate.textContent?.includes(filename))
  if (!button) throw new Error(`候補がありません: ${filename}`)
  return button
}

beforeEach(() => {
  fixture.listCalls.length = 0
  fixture.listQueue.length = 0
  fixture.pending.length = 0
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  mounted = true
})

afterEach(async () => {
  if (mounted) await act(async () => { root.unmount() })
  host.remove()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('登録メディア選択窓（N-193 / N-205）', () => {
  it('開くと選択中アカウントのメディアをAPIから読み、選ぶとその1件を返す', async () => {
    fixture.listQueue.push(ok([media('m-1', 'チラシ画像.png')]))
    const { onSelect } = await renderPicker()

    await waitForDialogText('チラシ画像.png')
    expect(fixture.listCalls).toEqual([
      { accountId: 'account-a', params: { kind: 'image', query: undefined, limit: 20, offset: 0 } },
    ])

    await act(async () => { optionButton('チラシ画像.png').click(); await settle() })
    expect(onSelect).toHaveBeenCalledTimes(1)
    const picked = onSelect.mock.calls[0][0] as MediaItem
    expect(picked.id).toBe('m-1')
    expect(picked.kind).toBe('image')
  })

  it('51件あるとき名前検索とページ送りを併用できる', async () => {
    const page1 = Array.from({ length: 20 }, (_, i) => media(`m-${i}`, `素材${String(i).padStart(2, '0')}.png`))
    const page2 = Array.from({ length: 20 }, (_, i) => media(`m-${i + 20}`, `素材${String(i + 20).padStart(2, '0')}.png`))
    fixture.listQueue.push(ok(page1, 51))
    await renderPicker()
    await waitForDialogText('51件')

    // ページ送り: 2ページ目は offset 20 で読む。
    fixture.listQueue.push(ok(page2, 51))
    const next = [...dialog().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.getAttribute('aria-label') === '次のページ')!
    await act(async () => { next.click(); await settle() })
    expect(fixture.listCalls.at(-1)?.params?.offset).toBe(20)

    // そのまま名前検索すると1ページ目へ戻り、query 付きで読む。
    fixture.listQueue.push(ok([media('m-hit', '夏チラシ.png')], 1))
    const input = dialog().querySelector<HTMLInputElement>('input[aria-label="メディア名で検索"]')!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(input, 'チラシ')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await settle()
    })
    const searchButton = [...dialog().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '検索')!
    await act(async () => { searchButton.click(); await settle() })
    expect(fixture.listCalls.at(-1)?.params).toMatchObject({ query: 'チラシ', offset: 0 })
    await waitForDialogText('夏チラシ.png')
    await waitForDialogText('絞り込み中')
  })

  it('アカウント切替後に届いた古い応答は捨て、別アカウントの候補を出さない', async () => {
    // account-a の読み込みをぶら下げたまま、account-b へ切り替える。
    fixture.listQueue.push(pendingList())
    const { onSelect } = await renderPicker()

    fixture.listQueue.push(ok([media('b-1', 'アカウントBの画像.png', 'account-b')]))
    await act(async () => {
      root.render(
        <MediaPickerDialog
          open
          accountId="account-b"
          kind="image"
          onClose={vi.fn()}
          onSelect={onSelect}
        />,
      )
      await settle()
    })
    expect(fixture.listCalls.map((call) => call.accountId)).toEqual(['account-a', 'account-b'])

    // 遅れて届いた account-a の応答は捨てる（B用の読み込み中が続く）。
    await act(async () => {
      fixture.pending[0].resolve({ success: true, data: { items: [media('a-1', 'アカウントAの古い画像.png', 'account-a')], total: 1, limit: 20, offset: 0 } })
      await settle()
    })
    expect(dialog().textContent).not.toContain('アカウントAの古い画像')
    await waitForDialogText('アカウントBの画像.png')

    // APIが別アカウントの候補を混ぜて返しても、画面へは出さない。
    fixture.listQueue.push(ok([media('x-1', '別アカウントの画像.png', 'account-c'), media('b-2', 'Bの共有候補.png', 'account-b')]))
    const reloadSearch = dialog().querySelector<HTMLInputElement>('input[aria-label="メディア名で検索"]')!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(reloadSearch, '候補')
      reloadSearch.dispatchEvent(new Event('input', { bubbles: true }))
      ;[...dialog().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '検索')!.click()
      await settle()
    })
    await waitForDialogText('Bの共有候補.png')
    expect(dialog().textContent).not.toContain('別アカウントの画像')
  })

  it('読込中・0件・失敗を分けて出し、失敗は読み直せる', async () => {
    fixture.listQueue.push(pendingList())
    await renderPicker()
    expect(dialog().textContent).toContain('メディアを読み込んでいます…')

    // 0件は失敗とは別の案内。
    await act(async () => {
      fixture.pending[0].resolve({ success: true, data: { items: [], total: 0, limit: 20, offset: 0 } })
      await settle()
    })
    await waitForDialogText('選べるメディアがまだありません')

    // 失敗は専用の案内と「読み直す」。別の語で検索して再取得を起こす。
    fixture.listQueue.push(Promise.resolve({ success: false, error: 'server error' }))
    const input = dialog().querySelector<HTMLInputElement>('input[aria-label="メディア名で検索"]')!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(input, 'なし')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      ;[...dialog().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '検索')!.click()
      await settle()
    })
    await waitForDialogText('メディアを読み込めませんでした')

    fixture.listQueue.push(ok([media('m-9', '復帰後の画像.png')]))
    const retry = [...dialog().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '読み直す')!
    await act(async () => { retry.click(); await settle() })
    await waitForDialogText('復帰後の画像.png')
  })
})
