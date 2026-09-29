// @vitest-environment happy-dom
/*
 * M001・M002・M003（回答フォーム編集）の試験。本物の React で確かめる。
 *
 * - M001：保存の失敗（403・500・通信断）で内部文・英語文が出ず、
 *   日本語の理由と立て直し方が出る。文言は共通部品が持つ。
 * - M002：読み込み403で権限不足と分かり、再試行は出ない。
 * - M003：応答消失後の再送は保存済みとして扱い、他人の変更とは区別する。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const net = vi.hoisted(() => ({
  /** 保存の失敗のさせ方。 */
  updateBehavior: 'ok' as 'ok' | 'forbidden' | 'serverError' | 'offline' | 'conflict',
  /** 読み込みの失敗のさせ方。 */
  loadBehavior: 'ok' as 'ok' | 'forbidden',
  /** 409後の読み直しで返す中身。'same' は自分の再送、'other' は他人の編集。 */
  reconcileContent: 'same' as 'same' | 'other',
  putCount: 0,
  getCount: 0,
}))

const LAYOUT = {
  version: 2 as const,
  header: [],
  sections: [{ id: 'section-1', name: '質問', blocks: [] }],
  options: {
    thanksUrl: null, thanksText: 'ありがとうございました。', restorePrevious: false,
    pageTitle: null, submitLabel: '送信', prevLabel: '前へ', nextLabel: '次へ',
    sectionHeader: 'pageNumber' as const, confirmDialog: { enabled: false },
    deadline: { enabled: false }, oncePerFriend: false,
    totalLimit: { enabled: false }, afterActions: [],
  },
}

function loadedForm(contentRevision: number, name: string) {
  return {
    id: 'form-1', name, description: null, fields: [],
    layout: LAYOUT, onSubmitTagId: null, onSubmitMessageType: null,
    onSubmitMessageContent: null, isActive: false, submitCount: 0,
    ogTitle: null, ogDescription: null, ogImageUrl: null, contentRevision,
    publishedVersionId: null, publishedContentRevision: null,
  }
}

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
        get: async () => {
          net.getCount += 1
          if (net.loadBehavior === 'forbidden' && net.getCount === 1) {
            throw new actual.ApiError(403, 'API error: 403')
          }
          // 409後の読み直し（2回目以降）。初回と同じ中身なら自分の再送。
          const name = net.getCount >= 2 && net.reconcileContent === 'other'
            ? 'ほかの人が変えた名前'
            : 'サーバ側の名前'
          const revision = net.getCount >= 2 ? 5 : 4
          return { success: true, data: loadedForm(revision, name) }
        },
        update: async () => {
          net.putCount += 1
          if (net.updateBehavior === 'forbidden') throw new actual.ApiError(403, 'API error: 403')
          if (net.updateBehavior === 'serverError') throw new actual.ApiError(500, 'API error: 500')
          if (net.updateBehavior === 'offline') throw new TypeError('Failed to fetch')
          if (net.updateBehavior === 'conflict') {
            throw new actual.ApiError(409, 'conflict', 'form_content_changed', {
              contentRevision: 5, updatedAt: '2026-09-11T14:32:00.000+09:00',
            })
          }
          return { success: true, data: { id: 'form-1', contentRevision: 5, updatedAt: '' } }
        },
      },
    },
  }
})

const navigation = vi.hoisted(() => ({ query: 'id=form-1&tab=basic' }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(navigation.query),
}))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-1', selectedAccount: { name: 'テスト店' }, loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {} }))

const { default: EditFormPage } = await import('./page')

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

function findButton(text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')]
    .find((node) => (node.textContent ?? '').includes(text)) as HTMLButtonElement | undefined
}

async function renderPage() {
  await act(async () => {
    root.render(<EditFormPage />)
  })
  await flush()
}

beforeEach(() => {
  net.putCount = 0
  net.getCount = 0
  net.updateBehavior = 'ok'
  net.loadBehavior = 'ok'
  net.reconcileContent = 'same'
  navigation.query = 'id=form-1&tab=basic'
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
})

describe('M001 保存の失敗は日本語の理由と立て直し方で出す', () => {
  it('403では権限の確認が出て、内部文は出ない', async () => {
    net.updateBehavior = 'forbidden'
    await renderPage()
    await act(async () => {
      findButton('下書きを保存')!.click()
    })
    await flush()
    expect(container.textContent).toContain('権限')
    expect(container.textContent).not.toContain('API error')
  })

  it('500では時間をおいての再試行が出て、内部文は出ない', async () => {
    net.updateBehavior = 'serverError'
    await renderPage()
    await act(async () => {
      findButton('下書きを保存')!.click()
    })
    await flush()
    expect(container.textContent).toContain('時間をおいて')
    expect(container.textContent).not.toContain('API error')
  })

  it('通信断では接続の確認が出て、英語文は出ない', async () => {
    net.updateBehavior = 'offline'
    await renderPage()
    await act(async () => {
      findButton('下書きを保存')!.click()
    })
    await flush()
    expect(container.textContent).not.toContain('Failed to fetch')
    expect(container.textContent).toContain('もう一度お試しください')
  })
})

describe('M002 読み込み403は権限不足と分かり、再試行は出ない', () => {
  it('権限不足の案内と一覧への戻り方が出る', async () => {
    net.loadBehavior = 'forbidden'
    await renderPage()
    expect(container.textContent).toContain('権限がありません')
    // 再試行ボタンは出さない。
    expect(findButton('もう一度読み込む')).toBeUndefined()
    // 一覧への戻り方は出す。
    expect(container.textContent).toContain('回答フォーム一覧へ戻る')
  })
})

describe('M003 応答消失後の再送は保存済みとして扱う', () => {
  it('同じ中身なら「ほかの人」ではなく保存済みになる', async () => {
    net.updateBehavior = 'conflict'
    net.reconcileContent = 'same'
    await renderPage()
    await act(async () => {
      findButton('下書きを保存')!.click()
    })
    await flush()
    await flush()
    expect(net.putCount).toBe(1)
    // 読み直して比べている。
    expect(net.getCount).toBeGreaterThan(1)
    expect(container.textContent).toContain('下書きを保存しました')
    expect(container.textContent).not.toContain('ほかの人が')
    expect(container.querySelector('[data-qa="form-edit-conflict-reload"]')).toBeNull()
  })

  it('違う中身ならほかの人の編集として読み直し導線を出す', async () => {
    net.updateBehavior = 'conflict'
    net.reconcileContent = 'other'
    await renderPage()
    await act(async () => {
      findButton('下書きを保存')!.click()
    })
    await flush()
    await flush()
    expect(container.textContent).toContain('ほかの人が')
    expect(container.querySelector('[data-qa="form-edit-conflict-reload"]')).toBeTruthy()
  })
})
