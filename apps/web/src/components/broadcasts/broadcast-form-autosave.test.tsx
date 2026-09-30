// @vitest-environment happy-dom
/*
 * 一斉配信の書きかけを守る試験（★V7 sTJsh §5）。
 *
 * 見る筋書き:
 *   1. 通せる形で入力が2秒止まると、下書きへ静かに保存し「下書き保存済み」と出す。
 *      続けて直しても同じ下書きを更新するだけで、新しい下書きは増えない。
 *   2. まだ通せない形（本文なし）では自動で保存しない。
 *   3. 書きかけのまま「一覧に戻る」を押すと確認が出て、
 *      「保存して移る」は保存が通ったときだけ離れる。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const createApi = vi.hoisted(() => vi.fn())
const updateApi = vi.hoisted(() => vi.fn())
const getApi = vi.hoisted(() => vi.fn())
const onCancelSpy = vi.hoisted(() => vi.fn())
const pushSpy = vi.hoisted(() => vi.fn())

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

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
  useRouter: () => ({ push: pushSpy, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/broadcasts/new',
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1', loading: false }),
}))

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
    root.render(<BroadcastForm tags={[]} onSuccess={() => {}} onCancel={onCancelSpy} />)
  })
  await flush()
}

function unmount() {
  act(() => {
    root.unmount()
  })
  container.remove()
}

function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')!.set!
  setter.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function titleInput(): HTMLInputElement {
  return container.querySelector('input[placeholder="例：8月キャンペーンのお知らせ"]') as HTMLInputElement
}

function messageInput(): HTMLTextAreaElement {
  return container.querySelector('textarea[placeholder="テキストを入力"]') as HTMLTextAreaElement
}

function clickButton(label: string) {
  // 確認の窓はポータルで body 直下に出るので、container ではなく文書全体から探す。
  const button = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)
  if (!button) throw new Error(`ボタンが見つからない: ${label}`)
  button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

async function waitForDebounce() {
  // 自動保存の間合いは2秒。余裕を持って2.6秒待つ。
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 2600))
  })
  await flush()
}

describe('一斉配信の下書き自動保存（★V7 sTJsh §5）', () => {
  afterEach(() => {
    unmount()
    vi.clearAllMocks()
  })

  it('通せる形で入力が2秒止まると下書きへ保存し、続きは同じ下書きを更新する', async () => {
    createApi.mockResolvedValue({ success: true, data: { id: 'draft-auto', version: 1 } })
    updateApi.mockResolvedValue({ success: true, data: { id: 'draft-auto', version: 2 } })
    await renderForm()

    await act(async () => { setValue(titleInput(), '秋の案内') })
    await act(async () => { setValue(messageInput(), 'お知らせ本文') })
    await waitForDebounce()

    expect(createApi).toHaveBeenCalledTimes(1)
    expect(updateApi).not.toHaveBeenCalled()
    expect(container.textContent).toContain('下書き保存済み')

    // 続けて直しても新しい下書きは増えず、同じIDを更新する。
    await act(async () => { setValue(messageInput(), 'お知らせ本文（追記）') })
    await waitForDebounce()

    expect(createApi).toHaveBeenCalledTimes(1)
    expect(updateApi).toHaveBeenCalledTimes(1)
    expect(updateApi.mock.calls[0][0]).toBe('draft-auto')
  }, 15000)

  it('まだ通せない形では自動で保存せず、未保存であることを薄く出す', async () => {
    await renderForm()
    await act(async () => { setValue(titleInput(), 'タイトルだけ') })
    await waitForDebounce()

    expect(createApi).not.toHaveBeenCalled()
    expect(updateApi).not.toHaveBeenCalled()
    expect(container.textContent).toContain('下書きはまだ保存していません')
  }, 15000)

  it('書きかけのまま離れようとすると確認が出て、「保存して移る」は保存が通れば離れる', async () => {
    createApi.mockResolvedValue({ success: true, data: { id: 'draft-auto', version: 1 } })
    await renderForm()
    await act(async () => { setValue(titleInput(), '秋の案内') })
    await act(async () => { setValue(messageInput(), '本文') })

    await act(async () => { clickButton('一覧に戻る') })
    // 離れず、確認の窓が出ている
    expect(onCancelSpy).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('保存していない変更があります')

    await act(async () => { clickButton('保存して移る') })
    await flush()
    expect(createApi).toHaveBeenCalledTimes(1)
    expect(onCancelSpy).toHaveBeenCalledTimes(1)
  }, 15000)

  it('「保存して移る」で保存に失敗したら画面に留まる', async () => {
    createApi.mockResolvedValue({ success: false, error: '保存できませんでした' })
    await renderForm()
    await act(async () => { setValue(titleInput(), '秋の案内') })
    // 通せる形にするため本文も入れる（タイトルだけだと保存自体が検査で止まる）
    await act(async () => { setValue(messageInput(), '本文') })

    await act(async () => { clickButton('一覧に戻る') })
    expect(document.body.textContent).toContain('保存していない変更があります')

    await act(async () => { clickButton('保存して移る') })
    await flush()
    expect(createApi).toHaveBeenCalledTimes(1)
    // 保存が通らなかったので離れず、窓も閉じて画面へ戻る
    expect(onCancelSpy).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('保存していない変更があります')
    expect(container.textContent).toContain('保存できませんでした')
  }, 15000)
})
