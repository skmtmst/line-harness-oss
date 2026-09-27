// @vitest-environment happy-dom
/*
 * 監査 R142・R143 を本物の React で確かめる。
 *
 * R142: 自作カルーセルを編集中にクーポンタブへ移ると、前の素材の編集欄が
 *       消え、保存要求が前の素材へ向かわない。
 * R143: 「もっと見る」の ON/OFF が保存の中身に反映され、開き直すと戻る。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BroadcastAssetManager from './broadcast-asset-manager'

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1', loading: false }),
}))

const { list, create, update } = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<Record<string, unknown>>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...(actual.api as Record<string, unknown>),
      broadcastMessageAssets: {
        list,
        create,
        update,
        delete: async () => ({ success: true }),
        upload: async () => ({ success: true, data: { url: 'https://example.com/a.png' } }),
      },
    },
  }
})

const cardAsset = {
  id: 'asset-card-1',
  lineAccountId: 'acc-1',
  kind: 'card_message',
  name: '夏カルーセル',
  payload: {
    cards: [{ id: 'p1', imageUrl: '', title: 'パネル1', description: '説明', actionLabel: '見る', actionUrl: 'https://example.com/a', template: 'product' }],
    moreCard: true,
  },
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
}

let container: HTMLDivElement
let root: Root

function renderKind(kind: 'card_message' | 'coupon') {
  act(() => {
    root.render(<BroadcastAssetManager kind={kind} />)
  })
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
  })
}

function clickText(label: string) {
  const el = [...container.querySelectorAll('button')].find((b) => b.textContent === label)
  if (!el) throw new Error(`button not found: ${label}`)
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  list.mockImplementation(async ({ kind }: { kind: string }) => ({
    success: true,
    data: kind === 'card_message' ? [cardAsset] : [],
  }))
  create.mockImplementation(async () => ({ success: true, data: null }))
  update.mockImplementation(async () => ({ success: true, data: null }))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

describe('素材の種類を切り替える', () => {
  it('前の素材の編集欄が消える', async () => {
    renderKind('card_message')
    await flush()
    clickText('編集')
    expect(container.querySelector('input[value="夏カルーセル"]')).not.toBeNull()

    // クーポンタブへ移動（読み込み完了後も前の編集が残っていた）。
    renderKind('coupon')
    await flush()
    expect(container.querySelector('input[value="夏カルーセル"]')).toBeNull()
    expect(container.textContent).not.toContain('夏カルーセル')
  })
})

describe('「もっと見る」パネル', () => {
  it('OFF が保存の中身に反映される', async () => {
    list.mockImplementation(async () => ({ success: true, data: [] }))
    renderKind('card_message')
    await flush()
    clickText('カルーセルを作る')

    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement | null
    if (!checkbox) throw new Error('checkbox not found')
    expect(checkbox.checked).toBe(true)
    act(() => {
      checkbox.click()
    })

    const setNativeValue = (el: HTMLInputElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      if (!setter) throw new Error('no value setter')
      act(() => {
        setter.call(el, value)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    const nameInput = container.querySelector('input[placeholder="カルーセルの管理名"]') as HTMLInputElement | null
    if (!nameInput) throw new Error('name input not found')
    setNativeValue(nameInput, '秋カルーセル')
    const titleInput = container.querySelector('input[placeholder="タイトル"]') as HTMLInputElement | null
    if (!titleInput) throw new Error('title input not found')
    setNativeValue(titleInput, 'パネル1')
    clickText('保存')
    await flush()
    expect(create).toHaveBeenCalled()
    const payload = (create.mock.calls[0][0] as { payload: { moreCard: boolean } }).payload
    expect(payload.moreCard).toBe(false)
  })

  it('保存した OFF が開き直しに戻る', async () => {
    list.mockImplementation(async () => ({
      success: true,
      data: [{ ...cardAsset, payload: { ...cardAsset.payload, moreCard: false } }],
    }))
    renderKind('card_message')
    await flush()
    clickText('編集')
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement | null
    if (!checkbox) throw new Error('checkbox not found')
    expect(checkbox.checked).toBe(false)
  })
})
