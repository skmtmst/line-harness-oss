// @vitest-environment happy-dom
/*
 * 配信作成の保存失敗の案内（監査 R580）。
 *
 * 再現: 対象者の段で配信名を空欄のまま「下書き保存」を押す。
 * 以前は失敗の文がメッセージの段の中にだけあり、押した段では理由が
 * 見えなかった（非表示の段に隠れていた）。
 *
 * 見る筋書き:
 *   - 押した段（対象者）で理由が見える（非表示の段に隠れない）
 *   - 直す欄がある段（基本設定）への移動が出て、押すとその段へ移る
 *   - 不備がある段自身では移動を出さない（同じ場所にいるため）
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

const createApi = vi.hoisted(() => vi.fn())
const updateApi = vi.hoisted(() => vi.fn())
const getApi = vi.hoisted(() => vi.fn())
const onStepChange = vi.hoisted(() => vi.fn())

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
import type { BroadcastStepKey } from './broadcast-steps'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

async function flush() {
  await act(async () => {
    for (let step = 0; step < 12; step += 1) await Promise.resolve()
  })
}

async function renderForm(step: BroadcastStepKey) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(
      <BroadcastForm
        tags={[]}
        onSuccess={() => {}}
        onCancel={() => {}}
        currentStep={step}
        onStepChange={onStepChange}
      />,
    )
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

/** 非表示の段の中にあるか。`hidden` の祖先がいれば押した段からは見えない。 */
function hiddenAncestor(element: Element | null): Element | null {
  return element?.closest('.hidden') ?? null
}

function saveDraftButton(): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find(
    (item) => (item.textContent ?? '').includes('下書きを保存する') && !item.disabled,
  )
  if (!button) throw new Error('下書きを保存するボタンがありません')
  return button as HTMLButtonElement
}

function errorText(): Element | null {
  const found = [...container.querySelectorAll('[role="alert"]')].find(
    (item) => (item.textContent ?? '').includes('管理用タイトルを入力してください'),
  )
  return found ?? null
}

describe('保存失敗の案内（R580）', () => {
  it('対象者の段で保存を押すと、その段で理由と基本設定への移動が見える', async () => {
    await renderForm('audience')
    try {
      await act(async () => {
        saveDraftButton().dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      await flush()
      // 理由は押した段で見える（非表示の段に隠れない）。
      const alert = errorText()
      expect(alert, '理由が見えません').toBeTruthy()
      expect(hiddenAncestor(alert), '理由が非表示の段に隠れています').toBeNull()
      // 直す欄がある段への移動が出る。
      const move = [...container.querySelectorAll('button')].find(
        (item) => (item.textContent ?? '').includes('基本設定へ移動'),
      )
      expect(move, '基本設定への移動がありません').toBeTruthy()
      expect(hiddenAncestor(move ?? null), '移動が非表示の段に隠れています').toBeNull()
      await act(async () => {
        move!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      await flush()
      expect(onStepChange).toHaveBeenCalledWith('basic')
    } finally {
      unmount()
    }
  })

  it('不備がある段自身では移動を出さない', async () => {
    await renderForm('basic')
    try {
      await act(async () => {
        saveDraftButton().dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      await flush()
      const alert = errorText()
      expect(alert, '理由が見えません').toBeTruthy()
      expect(hiddenAncestor(alert), '理由が非表示の段に隠れています').toBeNull()
      // 同じ段にいるので移動は要らない。
      const move = [...container.querySelectorAll('button')].find(
        (item) => (item.textContent ?? '').includes('へ移動'),
      )
      expect(move).toBeFalsy()
    } finally {
      unmount()
    }
  })
})
