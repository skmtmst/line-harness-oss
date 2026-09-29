// @vitest-environment happy-dom
/*
 * 一斉配信のボタン・テキスト操作（監査 R206・R208・R209）。
 *
 * 見る筋書き:
 *   R206: ボタンの不備は番号と項目を日本語で言い、直したら保存できる。
 *         下書き保存も確認と同じ検査を通す（通さないと Worker で断られて
 *         「保存できませんでした」だけになっていた）。
 *   R208: テキストのまま削除・上下移動ができ、本文を保って並べ替わる。
 *   R209: ボタンの編集欄は1つだけ（2通目を直すと全通に反映されていた）。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

const createApi = vi.hoisted(() => vi.fn())
const updateApi = vi.hoisted(() => vi.fn())
const getApi = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  const emptyList = async () => ({ success: true, data: [] })
  return {
    ...actual,
    api: {
      ...actual.api,
      broadcasts: {
        ...actual.api.broadcasts,
        create: createApi,
        update: updateApi,
        get: getApi,
        list: async () => ({ success: true, data: [] }),
        preflight: async () => ({ success: true, data: { audienceCount: 10 } }),
        previewCount: async () => ({ success: true, data: { count: 10 } }),
      },
      folders: { list: emptyList },
      scenarios: { list: emptyList },
      commonVars: { list: emptyList },
      friendFields: { list: emptyList },
      broadcastMessageAssets: { list: emptyList, upload: emptyList },
      templates: { list: emptyList },
      commonActions: { resources: async () => ({ success: true, data: [] }) },
      accountSettings: { getTestRecipients: async () => ({ success: true, data: [] }) },
    },
  }
})

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/broadcasts/new',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1', loading: false }),
}))

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import BroadcastForm from './broadcast-form'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

async function flush() {
  await act(async () => {
    for (let step = 0; step < 12; step += 1) await Promise.resolve()
  })
}

async function renderForm() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<BroadcastForm tags={[]} onSuccess={() => {}} onCancel={() => {}} />)
  })
  await flush()
}

function unmount() {
  act(() => {
    root.unmount()
  })
  container.remove()
  vi.clearAllMocks()
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  setter?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

function titleInput(): HTMLInputElement | null {
  return container.querySelector('input[placeholder="例：8月キャンペーンのお知らせ"]')
}

function textareas(): HTMLTextAreaElement[] {
  return [...container.querySelectorAll<HTMLTextAreaElement>('textarea[placeholder="テキストを入力"]')]
}

function buttonByText(label: string): HTMLButtonElement | undefined {
  // アイコンの前後に空白が入るので部分一致で探す。
  return [...container.querySelectorAll('button')].find(
    (button) => (button.textContent ?? '').includes(label) && !button.disabled,
  )
}

function headings(): string[] {
  return [...container.querySelectorAll('h4')]
    .map((h) => h.textContent ?? '')
    .filter((text) => text.includes('通目'))
}

describe('一斉配信のボタンとテキスト操作（R206・R208・R209）', () => {
  it('R209: テキストが2通でもボタンの編集欄は1つだけ', async () => {
    await renderForm()
    try {
      expect(headings()).toEqual(['1通目・テキスト'])
      await act(async () => {
        buttonByText('メッセージを追加')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      await flush()
      expect(headings()).toEqual(['1通目・テキスト', '2通目・テキスト'])
      // 各テキストの下に編集欄が出ていた頃は、ここが2つになっていた。
      const addButtons = [...container.querySelectorAll('button')].filter(
        (button) => (button.textContent ?? '').includes('＋ ボタンを追加'),
      )
      expect(addButtons).toHaveLength(1)
    } finally {
      unmount()
    }
  })

  it('R208: テキストのまま削除・上下移動ができ、本文を保って並べ替わる', async () => {
    await renderForm()
    try {
      await act(async () => {
        buttonByText('メッセージを追加')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      await flush()
      await act(async () => {
        setNativeValue(textareas()[0], 'あ')
        setNativeValue(textareas()[1], 'い')
      })
      await flush()
      expect(textareas().map((t) => t.value)).toEqual(['あ', 'い'])

      // 1通目を下へ動かすと、本文を保ったまま入れ替わる。
      const downButtons = [...container.querySelectorAll('button[aria-label="下へ移動"]')]
      expect(downButtons).toHaveLength(2)
      await act(async () => {
        downButtons[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      await flush()
      expect(headings()).toEqual(['1通目・テキスト', '2通目・テキスト'])
      expect(textareas().map((t) => t.value)).toEqual(['い', 'あ'])

      // 2通目をテキストのまま削除できる（画像へ切り替える裏技は要らない）。
      const deleteButtons = [...container.querySelectorAll('button')].filter(
        (button) => button.textContent === '削除' && !button.disabled,
      )
      expect(deleteButtons).toHaveLength(2)
      await act(async () => {
        deleteButtons[1].dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      await flush()
      expect(headings()).toEqual(['1通目・テキスト'])
      expect(textareas().map((t) => t.value)).toEqual(['い'])
    } finally {
      unmount()
    }
  })

  it('R206: ボタンの不備は番号と項目で言い、直したら下書き保存できる', async () => {
    createApi.mockResolvedValue({ success: true, data: { id: 'draft-new', version: 1 } })
    await renderForm()
    try {
      await act(async () => {
        setNativeValue(titleInput()!, 'ボタン監査の配信')
        setNativeValue(textareas()[0], '本文です')
      })
      await flush()
      await act(async () => {
        buttonByText('＋ ボタンを追加')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      await flush()

      // 空のまま保存すると、何番の何が足りないかを言う（理由のない失敗にしない）。
      await act(async () => {
        buttonByText('下書き保存')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      await flush()
      expect(container.textContent).toContain('ボタン1の名前を入力してください')
      expect(createApi).not.toHaveBeenCalled()

      await act(async () => {
        setNativeValue(
          container.querySelector('input[aria-label="ボタン1の名前"]') as HTMLInputElement,
          '資料を見る',
        )
      })
      await flush()
      await act(async () => {
        buttonByText('下書き保存')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      await flush()
      expect(container.textContent).toContain('ボタン1のURLを入力してください')
      expect(createApi).not.toHaveBeenCalled()

      await act(async () => {
        setNativeValue(
          container.querySelector('input[aria-label="ボタン1のURL"]') as HTMLInputElement,
          'not-a-url',
        )
      })
      await flush()
      // 入力欄の近くにも https の制限が出る。
      expect(container.textContent).toContain('ボタン1のURLは https:// から始めてください')
      await act(async () => {
        buttonByText('下書き保存')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      await flush()
      expect(createApi).not.toHaveBeenCalled()

      // 正しいURLへ直すと保存できる。
      await act(async () => {
        setNativeValue(
          container.querySelector('input[aria-label="ボタン1のURL"]') as HTMLInputElement,
          'https://example.com/qa-r39',
        )
      })
      await flush()
      await act(async () => {
        buttonByText('下書き保存')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      await flush()
      expect(createApi).toHaveBeenCalledTimes(1)
      expect(container.textContent).not.toContain('ボタン1のURLは https:// から始めてください')
    } finally {
      unmount()
    }
  })
})
