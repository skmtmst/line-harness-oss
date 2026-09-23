// @vitest-environment happy-dom
/*
 * 監査 #615（BC-01/02/03）の受け入れを、本物の React で確かめる。
 *
 * 見る筋書き:
 *   BC-01: 本文を書きかけのままメッセージ形式を行き来しても、
 *          戻したときに書きかけの本文が残っている。
 *   BC-02: 「テンプレートから選ぶ」（?templatePicker=1）で開くと、
 *          見出しだけでなくメッセージの段へ進み、候補が実際に出る。
 *   BC-03: 確認の段のプレビュー・配信後アクションに、決めていない
 *          固定の日時・人数・タグ名を出さない。
 */
import React, { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BroadcastStepKey } from './broadcast-steps'

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
        preflight: async () => ({ success: true, data: { audienceCount: 0 } }),
        previewCount: async () => ({ success: true, data: { count: 0 } }),
      },
      folders: { list: vi.fn(async () => ({ success: true, data: [] })) },
      scenarios: { list: emptyList },
      commonVars: { list: emptyList },
      friendFields: { list: emptyList },
      broadcastMessageAssets: { list: emptyList, upload: emptyList },
      templates: {
        list: async () => ({ success: true, data: [
          { id: 'tpl-1', name: '初回来店のお礼', category: 'general', messageType: 'text', messageContent: 'ご来店ありがとうございました。', folderId: null, accountId: 'acc-1', publishedAt: '2026-09-01T00:00:00.000Z', publishedVersion: 1, question: null, questionStatus: 'published', usageCount: 0, tapCount: 0, monthlySendCount: null, totalSendCount: null, hasDraft: false, draftRevision: 0, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
        ] }),
        listPage: async () => ({ success: true, data: { items: [
          { id: 'tpl-1', name: '初回来店のお礼', category: 'general', messageType: 'text', messageContent: 'ご来店ありがとうございました。', folderId: null, accountId: 'acc-1', publishedAt: '2026-09-01T00:00:00.000Z', publishedVersion: 1, question: null, questionStatus: 'published', usageCount: 0, tapCount: 0, monthlySendCount: null, totalSendCount: null, hasDraft: false, draftRevision: 0, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
        ], total: 1, limit: 100 } }),
      },
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

/** /broadcasts/new と同じ、段を外から持つ形。 */
function SteppedForm({ initialStep, openTemplatePickerInitially = false, stepCalls }: {
  initialStep: BroadcastStepKey
  openTemplatePickerInitially?: boolean
  stepCalls?: BroadcastStepKey[]
}) {
  const [step, setStep] = useState<BroadcastStepKey>(initialStep)
  return (
    <BroadcastForm
      tags={[]}
      onSuccess={() => {}}
      onCancel={() => {}}
      currentStep={step}
      onStepChange={(next) => { stepCalls?.push(next); setStep(next) }}
      openTemplatePickerInitially={openTemplatePickerInitially}
    />
  )
}

async function renderStepped(initialStep: BroadcastStepKey, options: { openTemplatePickerInitially?: boolean; stepCalls?: BroadcastStepKey[] } = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(
      <SteppedForm
        initialStep={initialStep}
        openTemplatePickerInitially={options.openTemplatePickerInitially}
        stepCalls={options.stepCalls}
      />,
    )
  })
  await flush()
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = element instanceof HTMLSelectElement
    ? HTMLSelectElement.prototype
    : element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  setter?.call(element, value)
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
}

async function clickTab(label: string) {
  const tab = [...container.querySelectorAll<HTMLElement>('[role="tab"]')]
    .find((el) => el.textContent === label)
  expect(tab, `「${label}」のタブがない`).toBeDefined()
  await act(async () => {
    tab!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await flush()
}

afterEach(() => {
  if (root) act(() => { root.unmount() })
  container?.remove()
})

describe('監査 #615：一斉配信の受け入れ', () => {
  it('BC-01: 書きかけの本文は、形式を行き来しても残る', async () => {
    await renderStepped('message')

    const textarea = () => container.querySelector<HTMLTextAreaElement>('textarea[placeholder="テキストを入力"]')
    expect(textarea(), '本文の入力欄がない').not.toBeNull()

    await act(async () => { setNativeValue(textarea()!, 'おはようございます') })
    await flush()
    expect(textarea()!.value).toBe('おはようございます')

    // 画像へ切り替えると本文欄は画像の入力へ変わる
    await clickTab('画像')
    expect(textarea(), '画像形式なのに本文欄が残っている').toBeNull()

    // テキストへ戻すと、書きかけの本文がそのまま返る
    await clickTab('テキスト')
    expect(textarea(), 'テキストへ戻しても本文欄が出ない').not.toBeNull()
    expect(textarea()!.value).toBe('おはようございます')
  })

  it('BC-02: 「テンプレートから選ぶ」は見出しだけでなく候補まで出る', async () => {
    const stepCalls: BroadcastStepKey[] = []
    await renderStepped('basic', { openTemplatePickerInitially: true, stepCalls })

    // メッセージの段へ一緒に進まないと、選択窓は描画されない段の中に隠れたままになる。
    expect(stepCalls).toContain('message')

    const rows = [...container.querySelectorAll<HTMLElement>('.broadcast-template-row')]
    expect(rows.map((row) => row.querySelector('strong')?.textContent)).toContain('初回来店のお礼')
  })

  it('BC-03: 確認の段は固定の日時・人数・タグ名を出さない', async () => {
    await renderStepped('confirm')

    const text = container.textContent ?? ''
    expect(text).not.toContain('2026/08/24')
    expect(text).not.toContain('1,213')
    expect(text).not.toContain('タグ「配信済み」を追加')
  })

  it('BC-03: 配信後アクション未選択のままでは、あるかのようなタグ名を出さない', async () => {
    await renderStepped('message')

    const text = container.textContent ?? ''
    expect(text).not.toContain('8月キャンペーン配信済み')
    expect(text).toContain('実行しない')
  })
})
