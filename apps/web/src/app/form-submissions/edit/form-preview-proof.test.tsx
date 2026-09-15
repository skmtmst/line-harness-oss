// @vitest-environment happy-dom
/**
 * N-174: 専用の確認タブではなく、編集画面に常に出ている顧客プレビューと
 * 保存・公開前検査が「出来上がりを予測してから公開する」役目を果たすことを、
 * 本物の React で固定する。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FormLayout } from '@line-crm/shared'

const net = vi.hoisted(() => ({
  layout: null as unknown,
  updates: [] as unknown[],
  publishCount: 0,
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    fetchApi: vi.fn(async () => ({ success: true, data: [] })),
    api: {
      ...actual.api,
      friendFields: { ...actual.api.friendFields, list: async () => ({ success: true, data: [] }) },
      scenarios: { ...actual.api.scenarios, list: async () => ({ success: true, data: [] }) },
      reminders: { ...actual.api.reminders, list: async () => ({ success: true, data: [] }) },
      templates: { ...actual.api.templates, list: async () => ({ success: true, data: [] }) },
      forms: {
        ...actual.api.forms,
        get: async () => ({
          success: true,
          data: {
            id: 'form-1', name: '参加申込', description: null, fields: [],
            layout: net.layout, onSubmitTagId: null, onSubmitMessageType: null,
            onSubmitMessageContent: null, isActive: false, submitCount: 0,
            ogTitle: null, ogDescription: null, ogImageUrl: null,
            contentRevision: 4, publishedVersionId: null,
          },
        }),
        update: async (_id: string, _accountId: string, body: unknown) => {
          net.updates.push(body)
          return { success: true, data: { id: 'form-1', contentRevision: 5, updatedAt: '' } }
        },
        publish: async () => {
          net.publishCount += 1
          return { success: true, data: { id: 'version-1', replayed: false } }
        },
      },
    },
  }
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams('id=form-1&tab=basic'),
}))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    selectedAccountId: 'account-1',
    selectedAccount: { id: 'account-1', name: 'テスト公式アカウント' },
    loading: false,
  }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {} }))

const { default: EditFormPage } = await import('./page')

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function validLayout(): FormLayout {
  return {
    version: 2,
    header: [],
    sections: [{
      id: 'section-1',
      name: '質問',
      blocks: [{
        id: 'question-1', kind: 'input', type: 'radio', name: 'attendance',
        label: '参加方法', required: true, choiceMode: 'tag',
        choices: [{ id: 'choice-1', label: '会場参加' }],
      }],
    }],
    options: {
      thanksUrl: null, thanksText: 'ありがとうございました。', restorePrevious: false,
      pageTitle: null, submitLabel: '送信', prevLabel: '前へ', nextLabel: '次へ',
      sectionHeader: 'pageNumber', confirmDialog: { enabled: false },
      deadline: { enabled: false }, oncePerFriend: { enabled: false },
      totalLimit: { enabled: false }, afterActions: [],
    },
  }
}

let container: HTMLDivElement
let root: Root

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function renderPage() {
  await act(async () => {
    root.render(<EditFormPage />)
  })
  await flush()
}

function findButton(label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')]
    .find((node) => (node.textContent ?? '').includes(label)) as HTMLButtonElement | undefined
  if (!button) throw new Error(`button not found: ${label}`)
  return button
}

async function click(label: string) {
  await act(async () => {
    findButton(label).click()
  })
  await flush()
}

async function inputValue(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flush()
}

beforeEach(() => {
  net.layout = validLayout()
  net.updates = []
  net.publishCount = 0
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('N-174 公開前プレビューと検証の実React対照', () => {
  it('顧客プレビューを常時表示し、質問の編集を保存前に即時反映する', async () => {
    await renderPage()

    const preview = container.querySelector('[data-design="Preview"]')
    expect(preview).toBeTruthy()
    expect(preview!.textContent).toContain('実際にお客さまが見る画面です')
    expect(preview!.textContent).toContain('参加方法')
    expect(preview!.textContent).toContain('会場参加')

    const title = container.querySelector(
      '[data-design="Inspector"] input[value="参加方法"]',
    ) as HTMLInputElement | null
    expect(title).toBeTruthy()
    await inputValue(title!, 'ご希望の参加方法')

    const previewParagraphs = [...preview!.querySelectorAll('p')]
      .map((node) => node.textContent)
    expect(previewParagraphs).toContain('ご希望の参加方法必須')
    expect(previewParagraphs).not.toContain('参加方法必須')
    expect(net.updates).toHaveLength(0)
  })

  for (const invalid of [
    {
      name: '選択肢なし',
      change: (layout: FormLayout) => {
        const block = layout.sections[0].blocks[0]
        if (block.kind === 'input') block.choices = []
      },
      message: '選択肢がありません',
    },
    {
      name: 'URL不正',
      change: (layout: FormLayout) => {
        layout.sections[0].blocks.push({
          id: 'button-1', kind: 'button', label: '詳しく見る', url: 'example.com/apply',
        })
      },
      message: 'URLの形',
    },
    {
      name: '期限不正',
      change: (layout: FormLayout) => {
        layout.options.deadline = { enabled: true, endsAt: 'not-a-date' }
      },
      message: '期限',
    },
  ]) {
    it(`${invalid.name}は下書き保存でも公開でも要求を始めない`, async () => {
      const layout = validLayout()
      invalid.change(layout)
      net.layout = layout
      await renderPage()

      await click('下書きを保存')
      expect(container.textContent).toContain(invalid.message)
      await click('この版を公開')
      expect(container.textContent).toContain(invalid.message)
      expect(net.updates).toHaveLength(0)
      expect(net.publishCount).toBe(0)
    })
  }

  it('正常な定義は更新を1回だけ保存し、その版を1回だけ公開する', async () => {
    await renderPage()
    await click('この版を公開')

    expect(net.updates).toHaveLength(1)
    expect(net.publishCount).toBe(1)
    expect(container.textContent).toContain('この版を公開しました')
  })
})
