// @vitest-environment happy-dom
/*
 * 409 の知らせが**3つのタブすべて**で DOM に出ることを、本物の React で確かめる
 * 試験（#723 独立審査の差し戻し）。
 *
 * 差し戻しの中身はこうだった。知らせが基本タブの枠の中にあったため
 *   基本タブ      : 出る
 *   デザイン設定  : **DOM にも出ない**
 *   オプション設定: DOM には出るが覆いの下敷き
 * **押した人は何も起きないので「保存された」と思って離れる。**
 *
 * 共通部品（`SaveConflictBar`）へ移したので、タブに関係なく出る。
 * ここは DOM に出るかだけを見る。**重なり**は実ブラウザでしか確かめられない
 * ので、`form-submissions-browser-behavior.mjs` の 7b が見ている。
 *
 * `.test.tsx` は `apps/web/vitest.config.ts` の include に入るので、
 * Required gate の `pnpm --filter web test` で必ず走る。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const net = vi.hoisted(() => ({
  /** 次の保存の結果。'conflict' は 409。 */
  saveResult: 'conflict' as 'ok' | 'conflict',
  putCount: 0,
}))

const LAYOUT = {
  version: 2 as const,
  header: [],
  sections: [{ id: 'section-1', name: '質問', blocks: [] }],
  options: {
    thanksUrl: null, thanksText: 'ありがとうございました。', restorePrevious: false,
    pageTitle: null, submitLabel: '送信', prevLabel: '前へ', nextLabel: '次へ',
    sectionHeader: 'pageNumber' as const, confirmDialog: { enabled: false },
    deadline: { enabled: false }, oncePerFriend: { enabled: false },
    totalLimit: { enabled: false }, afterActions: [],
  },
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
        get: async () => ({
          success: true,
          data: {
            id: 'form-1', name: 'サーバ側の名前', description: null, fields: [],
            layout: LAYOUT, onSubmitTagId: null, onSubmitMessageType: null,
            onSubmitMessageContent: null, isActive: true, submitCount: 0,
            ogTitle: null, ogDescription: null, ogImageUrl: null, contentRevision: 4,
          },
        }),
        update: async () => {
          net.putCount += 1
          if (net.saveResult === 'conflict') {
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
  useAccount: () => ({ selectedAccountId: 'account-1', loading: false }),
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

beforeEach(() => {
  net.putCount = 0
  net.saveResult = 'conflict'
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

describe('保存が 409 で弾かれたときの知らせ（3つのタブ）', () => {
  for (const [tab, saveLabel] of [
    ['basic', '下書きを保存'],
    ['design', '下書きを保存'],
    ['options', '下書きを保存'],
  ] as const) {
    it(`${tab} タブでも、文言と「読み直す」が DOM に出る`, async () => {
      navigation.query = `id=form-1&tab=${tab}`
      await act(async () => {
        root.render(<EditFormPage />)
      })
      await flush()

      const save = findButton(saveLabel)
      expect(save, `${tab}: 保存ボタンがある`).toBeTruthy()
      await act(async () => {
        save!.click()
      })
      await flush()

      expect(net.putCount).toBe(1)
      // 文言が出ている。デザインタブで出ないのが差し戻し理由だった。
      expect(container.textContent).toContain('ほかの人が')
      expect(container.textContent).toContain('先に保存しました')
      // 読み直す出口も出ている。
      const reload = container.querySelector('[data-qa="form-edit-conflict-reload"]')
      expect(reload, `${tab}: 読み直す出口がある`).toBeTruthy()
      // 二重に出さない（元の位置からは消してある）。
      expect(container.querySelectorAll('[data-qa="form-edit-conflict-reload"]').length).toBe(1)
      // タブの外（共通部品）に出ている。
      expect(reload!.closest('[data-design-part="save-conflict-bar"]')).toBeTruthy()
    })
  }

  it('保存が通ったときは知らせを出さない', async () => {
    net.saveResult = 'ok'
    navigation.query = 'id=form-1&tab=design'
    await act(async () => {
      root.render(<EditFormPage />)
    })
    await flush()
    await act(async () => {
      findButton('下書きを保存')!.click()
    })
    await flush()
    expect(net.putCount).toBe(1)
    expect(container.querySelector('[data-design-part="save-conflict-bar"]')).toBeNull()
    /*
     * 成功の「保存しました」は基本タブの枠の中にあるので、デザインタブでは
     * 出ない。**これは #723 の差し戻し理由ではなく、前からの作り**なので
     * ここでは触らない（失敗が黙るのと違い、成功が黙っても作業は消えない）。
     * 司令塔へは所見として報告した。
     */
    expect(container.textContent).not.toContain('保存しました')
  })
})
