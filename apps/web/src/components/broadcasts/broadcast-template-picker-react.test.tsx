// @vitest-environment happy-dom
/*
 * 一斉配信の作成フォームにあるテンプレート選択を、本物の React で確かめる
 * （IDEA-11）。
 *
 * 見る筋書き:
 *   1. 先頭3件だけではなく、読み込んだ候補が全部出る。
 *   2. 名前・本文の検索と置き場（フォルダ）で目的別に絞れる。
 *      未分類だけを選ぶ口もある。
 *   3. 選んだテンプレートは、挿入前に右側へ全文（改行つき）が出る。
 *   4. フォルダの選択欄は、テンプレートの置き場（kind='template'）から
 *      本物の選択肢を読む。固定の「すべて」だけではない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const TEMPLATE_FOLDERS = [
  { id: 'folder-visit', name: '来店案内', kind: 'template', parentId: null, displayOrder: 0, color: null, accountId: 'acc-1', createdAt: '', updatedAt: '' },
]

const TEMPLATES = [
  { id: 'tpl-1', name: '初回来店のお礼', category: 'general', messageType: 'text', messageContent: 'ご来店ありがとうございました。\n次回のご予約はこちらです。', folderId: 'folder-visit' },
  { id: 'tpl-2', name: '発送のお知らせ', category: 'general', messageType: 'text', messageContent: '商品を発送しました。', folderId: null },
  { id: 'tpl-3', name: '再入荷のお知らせ', category: 'general', messageType: 'text', messageContent: 'お待たせしていた商品が再入荷しました。', folderId: 'folder-visit' },
  { id: 'tpl-4', name: 'キャンペーン終了間際', category: 'general', messageType: 'text', messageContent: 'キャンペーンは明日までです。', folderId: null },
].map((template) => ({
  ...template,
  accountId: 'acc-1',
  publishedAt: '2026-09-01T00:00:00.000Z',
  publishedVersion: 1,
  question: null,
  questionStatus: 'published',
  usageCount: 0,
  tapCount: 0,
  monthlySendCount: null,
  totalSendCount: null,
  hasDraft: false,
  draftRevision: 0,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
}))

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
        list: async () => ({ success: true, data: [] }),
        preflight: async () => ({ success: true, data: { audienceCount: 10 } }),
        previewCount: async () => ({ success: true, data: { count: 10 } }),
      },
      // 置き場は種別で返し分ける。テンプレートの置き場だけ本物の選択肢を返す。
      folders: {
        list: vi.fn(async (kind?: string) =>
          kind === 'template'
            ? { success: true, data: TEMPLATE_FOLDERS }
            : { success: true, data: [] }),
      },
      scenarios: { list: emptyList },
      commonVars: { list: emptyList },
      friendFields: { list: emptyList },
      broadcastMessageAssets: { list: emptyList, upload: emptyList },
      templates: { list: async () => ({ success: true, data: TEMPLATES }) },
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

import BroadcastForm from './broadcast-form'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

async function flush() {
  await act(async () => {
    for (let step = 0; step < 10; step += 1) await Promise.resolve()
  })
}

async function renderPicker() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(
      <BroadcastForm tags={[]} onSuccess={() => {}} onCancel={() => {}} openTemplatePickerInitially />,
    )
  })
  await flush()
}

function templateRows(): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('.broadcast-template-row')]
}

function templateRowNames(): string[] {
  return templateRows().map((row) => row.querySelector('strong')?.textContent ?? '')
}

function setNativeValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype,
    'value',
  )?.set
  setter?.call(element, value)
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
}

async function chooseFolder(value: string) {
  const select = container.querySelector<HTMLSelectElement>('select[aria-label="テンプレートのフォルダ"]')
  expect(select, 'フォルダの選択欄がない').not.toBeNull()
  await act(async () => {
    setNativeValue(select!, value)
  })
  await flush()
}

async function typeSearch(value: string) {
  const input = container.querySelector<HTMLInputElement>('input[aria-label="テンプレート名・本文で検索"]')
  expect(input, '検索欄がない').not.toBeNull()
  await act(async () => {
    setNativeValue(input!, value)
  })
  await flush()
}

async function clickRow(name: string) {
  const row = templateRows().find((el) => el.textContent?.includes(name))
  expect(row, `${name} の行がない`).toBeDefined()
  await act(async () => {
    row!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await flush()
}

afterEach(() => {
  if (root) act(() => { root.unmount() })
  container?.remove()
})

describe('一斉配信のテンプレート選択（IDEA-11）', () => {
  it('先頭3件ではなく、読み込んだ候補をすべて出す', async () => {
    await renderPicker()

    expect(templateRowNames()).toEqual([
      '初回来店のお礼',
      '発送のお知らせ',
      '再入荷のお知らせ',
      'キャンペーン終了間際',
    ])
  })

  it('フォルダの選択肢はテンプレートの置き場から読む', async () => {
    await renderPicker()

    const select = container.querySelector<HTMLSelectElement>('select[aria-label="テンプレートのフォルダ"]')!
    const labels = [...select.options].map((option) => option.textContent)
    expect(labels).toContain('すべて')
    expect(labels).toContain('来店案内')
    expect(labels).toContain('未分類')
  })

  it('名前・本文の検索で絞れる', async () => {
    await renderPicker()
    await typeSearch('再入荷')

    expect(templateRowNames()).toEqual(['再入荷のお知らせ'])
  })

  it('フォルダと未分類で絞れる', async () => {
    await renderPicker()

    await chooseFolder('folder-visit')
    expect(templateRowNames()).toEqual(['初回来店のお礼', '再入荷のお知らせ'])

    await chooseFolder('__none__')
    expect(templateRowNames()).toEqual(['発送のお知らせ', 'キャンペーン終了間際'])
  })

  it('条件に合う候補が無いときは0件と分かる', async () => {
    await renderPicker()
    await typeSearch('存在しない文字列')

    expect(templateRows()).toHaveLength(0)
    expect(container.textContent).toContain('条件に合うテンプレートはありません')
  })

  it('選ぶと挿入前に改行つきの全文がプレビューへ出る', async () => {
    await renderPicker()
    await clickRow('初回来店のお礼')

    const preview = [...container.querySelectorAll<HTMLElement>('section')]
      .find((el) => el.textContent?.includes('メッセージプレビュー'))
    expect(preview, 'プレビューの領域がない').toBeDefined()
    // whitespace-pre-wrap の吹き出しで出るので、改行もそのまま確かめられる。
    const bubble = preview!.querySelector('.whitespace-pre-wrap')
    expect(bubble, '改行つきの全文プレビューがない').not.toBeNull()
    expect(bubble!.textContent).toBe('ご来店ありがとうございました。\n次回のご予約はこちらです。')
  })
})
