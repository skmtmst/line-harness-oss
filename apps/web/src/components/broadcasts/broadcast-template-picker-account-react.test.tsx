// @vitest-environment happy-dom
/*
 * 一斉配信のテンプレート候補は、選んでいるアカウントのものだけを出す。
 *
 * 見る筋書き:
 *   1. 候補の口へ選んでいるアカウントを渡し、未公開・別のアカウントのテンプレートは出さない。
 *      コンテンツ（カルーセルなど）の候補も同じアカウントで読む。
 *   2. アカウントを切り替えたあと、前のアカウントの答えが遅れて届いても候補を上書きしない。
 *   3. 切り替えたら、前のアカウントで仮に選んでいた候補は選ばれていない形に戻る。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const account = vi.hoisted(() => ({ id: 'acc-1' }))
const templatesList = vi.hoisted(() => vi.fn())
const assetsList = vi.hoisted(() => vi.fn())

const template = (id: string, name: string, accountId: string, extra: Record<string, unknown> = {}) => ({
  id, name, accountId,
  category: 'general', messageType: 'text', messageContent: `${name}の本文`, folderId: null,
  publishedAt: '2026-09-01T00:00:00.000Z', publishedVersion: 1,
  question: null, questionStatus: 'published', usageCount: 0, tapCount: 0,
  monthlySendCount: null, totalSendCount: null, hasDraft: false, draftRevision: 0,
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  ...extra,
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
        get: vi.fn(),
        list: emptyList,
        preflight: async () => ({ success: true, data: { audienceCount: 10 } }),
        previewCount: async () => ({ success: true, data: { count: 10 } }),
      },
      folders: { list: emptyList },
      scenarios: { list: emptyList },
      commonVars: { list: emptyList },
      friendFields: { list: emptyList },
      broadcastMessageAssets: { list: assetsList, upload: emptyList },
      templates: { list: templatesList },
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
  useAccount: () => ({ selectedAccountId: account.id, selectedAccount: { id: account.id, name: account.id }, loading: false }),
}))

vi.mock('@/components/shared/entity-select', () => import('@/test-utils/entity-select-mock'))

import BroadcastForm from './broadcast-form'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

async function flush() {
  await act(async () => {
    for (let step = 0; step < 10; step += 1) await Promise.resolve()
  })
}

const form = () => <BroadcastForm tags={[]} onSuccess={() => {}} onCancel={() => {}} openTemplatePickerInitially />

async function renderPicker() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(form()) })
  await flush()
}

async function switchAccount(id: string) {
  account.id = id
  await act(async () => { root.render(form()) })
  await flush()
}

const rows = () => [...document.querySelectorAll<HTMLInputElement>('[role="dialog"] input[type="radio"]')]
const rowNames = () => rows().map((row) => row.getAttribute('aria-label'))

beforeEach(() => {
  account.id = 'acc-1'
  templatesList.mockReset()
  assetsList.mockReset()
  assetsList.mockImplementation(async ({ accountId }: { accountId: string }) => ({
    success: true,
    data: accountId === 'acc-1'
      ? [{ id: 'asset-1', kind: 'card_message', name: '秋のカルーセル', lineAccountId: 'acc-1', payload: {}, updatedAt: '2026-09-01T00:00:00.000Z' }]
      : [],
  }))
})

afterEach(() => {
  if (root) act(() => { root.unmount() })
  container?.remove()
})

describe('一斉配信のテンプレート候補とアカウント', () => {
  it('選んでいるアカウントで候補を読み、未公開と別のアカウントのテンプレートは出さない', async () => {
    templatesList.mockResolvedValue({
      success: true,
      data: [
        template('tpl-ready', '来店のお礼', 'acc-1'),
        template('tpl-draft', '書きかけのご案内', 'acc-1', { publishedAt: null, publishedVersion: 0 }),
        template('tpl-other', '別の店のお知らせ', 'acc-2'),
      ],
    })
    await renderPicker()

    expect(templatesList).toHaveBeenCalledWith(undefined, 'acc-1')
    expect(assetsList).toHaveBeenCalledWith({ accountId: 'acc-1' })
    expect(rowNames()).toEqual(['秋のカルーセル', '来店のお礼'])
  })

  it('切り替えたあとに前のアカウントの答えが遅れて届いても、候補を上書きしない', async () => {
    let finishFirst!: (value: unknown) => void
    templatesList.mockImplementation((_: unknown, accountId: string) => accountId === 'acc-1'
      ? new Promise((resolve) => { finishFirst = resolve })
      : Promise.resolve({ success: true, data: [template('tpl-b', '2号店の予約案内', 'acc-2')] }))
    await renderPicker()

    await switchAccount('acc-2')
    expect(rowNames()).toEqual(['2号店の予約案内'])

    await act(async () => { finishFirst({ success: true, data: [template('tpl-a', '1号店の予約案内', 'acc-1')] }) })
    await flush()
    expect(rowNames()).toEqual(['2号店の予約案内'])
  })

  it('切り替えたら、前のアカウントで仮に選んでいた候補を選ばれていない形に戻す', async () => {
    templatesList.mockImplementation(async (_: unknown, accountId: string) => ({
      success: true,
      data: [template('tpl-shared', '同じ名前のご案内', accountId)],
    }))
    await renderPicker()
    const before = rows().find((row) => row.getAttribute('aria-label') === '同じ名前のご案内')!
    await act(async () => { before.click() })
    expect(before.checked).toBe(true)

    await switchAccount('acc-2')
    expect(templatesList).toHaveBeenLastCalledWith(undefined, 'acc-2')
    const after = rows().find((row) => row.getAttribute('aria-label') === '同じ名前のご案内')!
    expect(after.checked).toBe(false)
  })
})
