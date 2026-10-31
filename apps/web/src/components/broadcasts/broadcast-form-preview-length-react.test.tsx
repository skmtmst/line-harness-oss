// @vitest-environment happy-dom
/*
 * 一斉配信の作成（設計 `zZ9fA` 6-1-A ／ `XQfMD` 6-1-C ／ `p97Tf` 6-1-D）の、プレビュー確認と本文の上限を
 * 本物の作成画面で押して確かめる。
 *
 * 見る筋書き:
 *   1. 右側は LINE プレビューと明記し、確認したことを利用者が記録できる。本文を変えたら記録を戻す。
 *   2. 下書きやテンプレートから上限を超えた本文が入っても、保存・テスト送信を押せない形で止め、理由を文字で出す
 *     （保存だけが静かに 400 で失敗する形を作らない）。
 */
import { setTextControlValue } from '@/test-utils/text-control'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_TEXT_LENGTH } from './message-limits'

const account = vi.hoisted(() => ({ id: 'acc-1' as string | null, loading: false }))
const getApi = vi.hoisted(() => vi.fn())
const query = vi.hoisted(() => ({ current: 'draft=draft-1&step=message' }))

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
        create: vi.fn(async () => ({ success: true, data: { id: 'draft-1', version: 8 } })),
        update: vi.fn(async () => ({ success: true, data: { id: 'draft-1', version: 8 } })),
        get: getApi,
        list: emptyList,
        preflight: async () => ({ success: true, data: { audienceCount: 10, hiddenExcluded: 0, warnings: [] } }),
        previewCount: async () => ({ success: true, data: { count: 10 } }),
      },
      folders: { list: emptyList },
      scenarios: { list: emptyList },
      commonVars: { list: emptyList },
      friendFields: { list: emptyList },
      broadcastMessageAssets: { list: emptyList, upload: emptyList },
      templates: { list: emptyList },
      commonActions: { resources: async () => ({ success: true, data: [] }) },
      accountSettings: { getTestRecipients: emptyList },
    },
  }
})

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/broadcasts/new',
  useSearchParams: () => new URLSearchParams(query.current),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: account.id, loading: account.loading }),
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

function draftRow(messageContent: string) {
  return {
    id: 'draft-1', lineAccountId: 'acc-1', title: '秋のキャンペーン告知', messageType: 'text', messageContent,
    messageBubbles: null, targetType: 'all', targetTagId: null, segmentConditions: null, scheduledAt: null,
    status: 'draft', draftStep: 'message', draftPayload: null, messageOptions: null, afterActionVersionId: null,
    trackLinks: false, version: 7,
  }
}

async function renderForm(currentStep?: 'message') {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<BroadcastForm currentStep={currentStep} tags={[]} onSuccess={() => {}} onCancel={() => {}} />)
  })
  await flush()
}

/** 同じ名前のボタンが右の欄と下の帯にあるときは、下の帯（後ろ）のほうを取る。 */
function button(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).filter((item) => item.textContent?.trim() === label).at(-1)
  if (!found) throw new Error(`Missing button: ${label}`)
  return found
}

function body(): HTMLElement {
  return container.querySelector('[role="textbox"][placeholder="テキストを入力"]') as HTMLElement
}

beforeEach(() => {
  account.id = 'acc-1'; account.loading = false
  query.current = 'draft=draft-1&step=message'
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  vi.clearAllMocks()
})

describe('LINEプレビューの確認', () => {
  it('右側をLINEプレビューと明記し、確認済みを記録でき、本文を直すと記録を外す', async () => {
    getApi.mockResolvedValue({ success: true, data: draftRow('保存していた本文') })
    await renderForm('message')
    const help = container.querySelector('#broadcast-line-preview [aria-label="LINEでの見え方の説明"]') as HTMLElement
    await act(async () => { help.click() })
    expect(document.body.textContent).toContain('実際のLINE表示に近い確認用プレビューです。')
    expect(container.textContent).toContain('LINEプレビューが未確認です')

    await act(async () => { Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('配信イメージを見る'))!.click() })
    await flush()
    const checkbox = Array.from(container.querySelectorAll('label')).find((label) => label.textContent?.includes('LINEプレビュー確認済み'))!
      .querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(checkbox.checked).toBe(true)
    await act(async () => { document.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="閉じる"]')!.click() })
    await flush()
    expect(container.textContent).toContain('LINEプレビュー確認済み')

    // 古い見た目への確認を、書き換えたあとの本文へ引き継がない。
    await act(async () => { setTextControlValue(body(), '直した本文') })
    await flush()
    expect(container.textContent).toContain('LINEプレビューが未確認です')
    expect(container.textContent).not.toContain('LINEプレビュー確認済み')
  })
})

describe('本文の上限', () => {
  it('本文の欄は上限の文字数で止まり、いまの文字数と上限を出す', async () => {
    getApi.mockResolvedValue({ success: true, data: draftRow('あいう') })
    await renderForm('message')
    const limit = MAX_TEXT_LENGTH.toLocaleString('en-US')
    expect(container.textContent).toContain(`3 / ${limit}`)
    await act(async () => { setTextControlValue(body(), 'あ'.repeat(MAX_TEXT_LENGTH + 10)) })
    await flush()
    expect(container.textContent).toContain(`${limit} / ${limit}`)
    expect(container.textContent).not.toContain('本文が長すぎます')
  })

  it('上限を超えた本文が下書きから入ったら、保存とテスト送信を押せず、理由を本文の文字で出す', async () => {
    getApi.mockResolvedValue({ success: true, data: draftRow('あ'.repeat(MAX_TEXT_LENGTH + 1)) })
    query.current = 'draft=draft-1'
    await renderForm()
    const save = button('下書きを保存する')
    expect(save.disabled).toBe(true)
    // 押せない理由は吹き出しにも出す。
    expect(save.getAttribute('title')).toContain(`1通は${MAX_TEXT_LENGTH.toLocaleString('en-US')}文字までです。`)
    expect(button('テストを送る').disabled).toBe(true)
    expect(container.textContent).toContain('本文が長すぎます')
  })

  it('上限の内なら保存もテスト送信も押せ、長すぎるという知らせは出さない', async () => {
    getApi.mockResolvedValue({ success: true, data: draftRow('あ'.repeat(MAX_TEXT_LENGTH)) })
    query.current = 'draft=draft-1'
    await renderForm()
    expect(button('下書きを保存する').disabled).toBe(false)
    expect(button('テストを送る').disabled).toBe(false)
    expect(container.textContent).not.toContain('本文が長すぎます')
  })
})

it('撮影用の見本はアカウントの読み込み後も確認済みを保つ', async () => {
  query.current = ''
  account.id = null; account.loading = true
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  const draw = () => <BroadcastForm currentStep="message" visualQaAugustCampaign tags={[]} onSuccess={() => {}} onCancel={() => {}} />
  await act(async () => { root.render(draw()) }); await flush()
  expect(container.textContent).toContain('LINEプレビュー確認済み')
  account.id = 'acc-1'; account.loading = false
  await act(async () => { root.render(draw()) }); await flush()
  expect(container.textContent).toContain('LINEプレビュー確認済み')
  expect(container.querySelector<HTMLInputElement>('#broadcast-line-preview input[type="checkbox"]')?.disabled).toBe(false)
})
