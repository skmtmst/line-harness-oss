// @vitest-environment happy-dom
/*
 * テンプレート詳細の形の違う応答（D008）を、実際に mount して確かめる。
 *
 * 詳細APIが success:true だが詳細の形でない応答を返すと、以前は
 * 無題・本文空の幽霊詳細が描かれ、存在しないテンプレートに対して
 * 「テンプレートを編集」「テンプレートを削除」が押せた。
 * 形が違えば「このテンプレートは見つかりません」になり、
 * 編集・削除の口は出ない。
 *
 * 差し替えるのは通信（api.templates.get）と遷移（next/navigation,
 * next/link）だけ。画面の判断は差し替えない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/* `@/lib/api` は読み込んだ時点で API の宛先を要求する。 */
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://worker.example.com'
})

const routing = vi.hoisted(() => ({
  params: new URLSearchParams(),
  pushed: [] as string[],
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: (href: string) => routing.pushed.push(href),
    replace: (href: string) => routing.pushed.push(href),
    refresh: () => {},
    back: () => {},
    forward: () => {},
    prefetch: () => {},
  }),
  useSearchParams: () => routing.params,
  usePathname: () => '/templates/detail',
}))

/* Link は行き先を出すだけの部品。画面の判断とは関わらない。 */
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

const calls = vi.hoisted(() => ({
  templatesGet: vi.fn(),
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      templates: {
        ...actual.api.templates,
        get: calls.templatesGet,
      },
    },
  }
})

import TemplateDetailPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

async function mountAt(search: string) {
  routing.params = new URLSearchParams(search)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(React.createElement(TemplateDetailPage)) })
  await settle()
}

async function settle() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function all(tag: string): HTMLElement[] {
  return Array.from(container.querySelectorAll(tag)) as HTMLElement[]
}

/** 見出しや札の文字で1つ選ぶ。運用の人が画面で読む言葉で探す。 */
function byText(tag: string, text: string): HTMLElement | null {
  return all(tag).find((element) => element.textContent?.trim() === text) ?? null
}

const screenText = () => container.textContent ?? ''

const validDetail = {
  id: 'tmpl-1',
  accountId: 'account-a',
  name: '初回のご案内',
  category: 'general',
  messageType: 'text',
  messageContent: '{{name}}さん、いつもありがとうございます。',
  folderId: null,
  question: null,
  questionStatus: 'draft',
  carouselActions: null,
  carouselTapLimitMode: 'none',
  carouselTapLimitText: null,
  usedBy: {
    autoReplies: [],
    automations: [],
    scenarioSteps: [],
    reminderSteps: [],
    richMenuAreas: [],
    trackedLinks: [],
    broadcasts: [],
  },
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
  hasDraft: false,
  publishedVersion: 1,
  publishedAt: '2026-09-01T00:00:00.000Z',
  draftRevision: 0,
}

beforeEach(() => {
  routing.pushed = []
  calls.templatesGet.mockReset()
  const store = new Map<string, string>([['lh_staff_role', 'owner']])
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  })
})

afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  vi.unstubAllGlobals()
})

describe('D008: 形の違う詳細応答', () => {
  it('本文の無い応答は幽霊詳細にせず「見つかりません」になり操作口が出ない', async () => {
    // 存在しないIDへ、一覧形のまま詳細として返る場合の再現。
    calls.templatesGet.mockResolvedValue({ success: true, data: { items: [] } })

    await mountAt('?id=template-9999')

    expect(screenText()).toContain('このテンプレートは見つかりません')
    // 存在しない相手への操作口は出さない。
    expect(byText('a', 'テンプレートを編集')).toBeNull()
    expect(byText('button', 'テンプレートを削除する')).toBeNull()
    expect(byText('button', '使用中のため削除できません')).toBeNull()
  })

  it('型どおりの応答はこれまでどおり詳細と操作口を出す', async () => {
    calls.templatesGet.mockResolvedValue({ success: true, data: validDetail })

    await mountAt('?id=tmpl-1')

    expect(screenText()).toContain('{{name}}さん、いつもありがとうございます。')
    expect(byText('a', 'テンプレートを編集')).not.toBeNull()
    expect(byText('button', 'テンプレートを削除する')).not.toBeNull()
  })
})
