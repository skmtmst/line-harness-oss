// @vitest-environment happy-dom
/*
 * 作成画面の下書き保存を本物の React で押して確かめる(#772)。
 * 見る筋書き:
 *   1. 新規作成→保存で作り、続けて保存すると版 1 を付けて送る。
 *   2. 別編集で古くなった保存は409で止まり、「別の画面で更新されたため読み直しました」と
 *      案内して読み直し、古い内容を送り直さない（更新口は1回だけ）。
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

import { ApiError } from '@/lib/api'
import BroadcastForm from './broadcast-form'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

async function flush() {
  await act(async () => {
    for (let step = 0; step < 10; step += 1) await Promise.resolve()
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
  const setter = Object.getOwnPropertyDescriptor(
    element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    'value',
  )?.set
  setter?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

async function fillMinimum() {
  const title = container.querySelector('input[placeholder="例：8月キャンペーンのお知らせ"]') as HTMLInputElement | null
  expect(title).not.toBeNull()
  const body = container.querySelector('textarea[placeholder="テキストを入力"]') as HTMLTextAreaElement | null
  expect(body).not.toBeNull()
  await act(async () => {
    setNativeValue(title!, '検証配信用の題')
    setNativeValue(body!, '検証配信用の本文')
  })
  await flush()
}

function saveButton(): HTMLButtonElement | undefined {
  const buttons = Array.from(container.querySelectorAll('button')).filter(
    (button) => button.textContent === '下書き保存' && !button.disabled,
  )
  return buttons[buttons.length - 1]
}

async function clickSave() {
  const button = saveButton()
  expect(button).toBeDefined()
  await act(async () => {
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await flush()
}

describe('作成画面の下書き保存の版(#772)', () => {
  it('作成→保存で版1を付けて送り、返却版へ進める', async () => {
    createApi.mockResolvedValue({ success: true, data: { id: 'draft-1', version: 1 } })
    updateApi.mockImplementation(async (_id: string, payload: Record<string, unknown>) => ({
      success: true,
      data: { id: 'draft-1', version: Number(payload.expectedVersion) + 1 },
    }))
    await renderForm()
    try {
      await fillMinimum()
      await clickSave()
      expect(createApi).toHaveBeenCalledTimes(1)
      await clickSave()
      await clickSave()
      expect(updateApi).toHaveBeenCalledTimes(2)
      expect(updateApi.mock.calls[0][1]).toMatchObject({ expectedVersion: 1 })
      expect(updateApi.mock.calls[1][1]).toMatchObject({ expectedVersion: 2 })
    } finally {
      unmount()
    }
  })

  it('古くなった保存は409で止まり、案内して読み直す', async () => {
    createApi.mockResolvedValue({ success: true, data: { id: 'draft-1', version: 1 } })
    getApi.mockResolvedValue({ success: true, data: { id: 'draft-1', version: 9 } })
    updateApi.mockRejectedValueOnce(new ApiError(409, '別の画面で下書きが更新されました', 'VERSION_CONFLICT'))
    await renderForm()
    try {
      await fillMinimum()
      await clickSave()
      await clickSave()
      await flush()

      expect(updateApi).toHaveBeenCalledTimes(1)
      expect(container.textContent).toContain('別の画面で更新されたため読み直しました')
      // 読み直している（作成時以外の取得がある）。
      expect(getApi).toHaveBeenCalledWith('draft-1')
    } finally {
      unmount()
    }
  })
})
