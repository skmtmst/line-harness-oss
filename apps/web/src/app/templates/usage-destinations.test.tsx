// @vitest-environment happy-dom
/*
 * #891 N-135/N-142/N-143: 使用先の数と個別遷移。
 *
 * - 使用先の各行が「一覧画面」ではなく、その設定の編集・詳細画面へ行く
 * - 使用中テンプレートの差し替え窓は、使用先の1件目だけでなく全行が
 *   個別に開ける（一括変更させない・させられない）
 * - 質問テンプレートの使用数は「シナリオ N通」と誤表示しない
 * - 0件・1件・複数件を直接試験する
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

const templateGet = vi.hoisted(() => vi.fn())
const searchParams = vi.hoisted(() => ({ value: new URLSearchParams() }))

const TEMPLATES = [
  {
    id: 'tpl-1', name: '来店お礼', category: 'general', messageType: 'text',
    messageContent: 'ご来店ありがとうございました。', folderId: null, question: null,
    usageCount: 3, updatedAt: '2026-09-01T00:00:00.000Z', createdAt: '2026-09-01T00:00:00.000Z',
  },
]

const USED_BY = {
  autoReplies: [
    { id: 'ar-1', keyword: '予約', matchType: 'exact', lineAccountId: 'account-a' },
  ],
  automations: [
    { id: 'au-1', name: '予約後フォロー', eventType: 'booking' },
  ],
  scenarioSteps: [
    { scenarioId: 'sc-1', scenarioName: '来店後', stepId: 'ss-1', stepOrder: 2 },
  ],
  reminderSteps: [
    { reminderId: 're-1', reminderName: '前日案内', stepId: 'rs-1' },
  ],
  richMenuAreas: [
    { groupId: 'rg-1', groupName: '基本', pageName: '表', areaId: 'ra-1', label: '予約' },
  ],
  trackedLinks: [
    { id: 'tl-1', name: '広告A' },
  ],
}

const EMPTY_USED_BY = {
  autoReplies: [], automations: [], scenarioSteps: [],
  reminderSteps: [], richMenuAreas: [], trackedLinks: [],
}

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', accounts: [], loading: false }),
}))

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    templates: {
      list: () => Promise.resolve({ success: true, data: TEMPLATES }),
      get: templateGet,
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      publish: vi.fn(),
    },
    broadcastMessageAssets: { list: () => Promise.resolve({ success: true, data: [] }) },
    folders: {
      list: () => Promise.resolve({ success: true, data: [] }),
      update: vi.fn(),
      delete: vi.fn(),
    },
    friendFields: { list: () => Promise.resolve({ success: true, data: [] }) },
    commonVars: { list: () => Promise.resolve({ success: true, data: [] }) },
    tags: { list: () => Promise.resolve({ success: true, data: [] }) },
    supportMarks: { list: () => Promise.resolve({ success: true, data: [] }) },
    scenarios: { list: () => Promise.resolve({ success: true, data: [] }) },
  },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: () => {}, replace: () => {}, refresh: () => {},
    back: () => {}, forward: () => {}, prefetch: () => {},
  }),
  useSearchParams: () => searchParams.value,
  usePathname: () => '/templates',
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href, ...rest }, children),
}))

import TemplatesPage from './page'
import TemplateDetailPage from './detail/page'
import QuestionTemplatePage from './questions/new/page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function stubRole(role: string | null) {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'lh_staff_role' ? role : null),
    setItem: () => {},
    removeItem: () => {},
  })
}

function stubTemplateGet(usedBy = USED_BY, question: unknown = null) {
  templateGet.mockImplementation((id: string) => Promise.resolve({
    success: true,
    data: {
      ...(TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0]),
      usedBy,
      question,
      hasDraft: true, publishedVersion: 1, publishedAt: '2026-09-01T00:00:00.000Z',
      draftVersion: 2, carouselActions: null, carouselTapLimitMode: 'none',
      carouselTapLimitText: null, questionStatus: 'draft',
    },
  }))
}

beforeEach(() => {
  searchParams.value = new URLSearchParams()
  templateGet.mockReset()
  stubRole('owner')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function renderDetailAndWait(usedBy = USED_BY) {
  stubTemplateGet(usedBy)
  searchParams.value = new URLSearchParams('id=tpl-1')
  render(<TemplateDetailPage />)
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
  await screen.findByText('どこから呼ばれているか')
}

describe('テンプレート詳細の使用先リンク (#891 N-143)', () => {
  test('使用先の各行が個別の編集・詳細画面へ行く', async () => {
    await renderDetailAndWait()

    const hrefs = screen.getAllByText('開く').map((el) => (el as HTMLAnchorElement).getAttribute('href'))
    expect(hrefs).toEqual([
      '/auto-replies/edit?id=ar-1',
      '/scenarios/detail?id=sc-1',
      '/reminders/edit?id=re-1',
      '/rich-menus/edit?id=rg-1',
      '/inflow-links/detail?id=tl-1',
    ])
    // 旧形式オートメーションは開ける画面が無い。リンクを出さず理由を示す
    expect(screen.getByText('開ける画面がありません')).toBeTruthy()
    expect(screen.getByText('オートメーション')).toBeTruthy()
    expect(screen.getByText('予約後フォロー')).toBeTruthy()
  })

  test('使用先が0件なら「どこからも呼ばれていません」と出る', async () => {
    await renderDetailAndWait(EMPTY_USED_BY)

    expect(screen.getByText('どこからも呼ばれていません。')).toBeTruthy()
    expect(screen.queryByText('開く')).toBeNull()
  })
})

describe('テンプレート一覧の差し替え導線 (#891 N-135)', () => {
  async function openBlockedDelete() {
    stubTemplateGet(USED_BY)
    render(<TemplatesPage />)
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })
    await screen.findByText('来店お礼')

    fireEvent.click(screen.getByText('使用先を見る'))
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })
    await screen.findByText('使用中のテンプレートは削除できません')
  }

  test('使用先の全行が個別のリンクで、1件目だけを開く導線はない', async () => {
    await openBlockedDelete()

    const dialog = screen.getByRole('dialog')
    const links = Array.from(dialog.querySelectorAll('a')).map((a) => a.getAttribute('href'))
    expect(links).toEqual([
      '/scenarios/detail?id=sc-1',
      '/auto-replies/edit?id=ar-1',
      '/reminders/edit?id=re-1',
      '/rich-menus/edit?id=rg-1',
      '/inflow-links/detail?id=tl-1',
    ])
    // 旧形式オートメーションはリンクにせず「開けない」と伝える
    expect(dialog.textContent).toContain('オートメーション「予約後フォロー」')
    expect(dialog.textContent).toContain('旧形式')
    // 「Nか所の差し替え画面を開きます」と言いながら1件目しか開かなかった退行
    expect(dialog.textContent).not.toContain('か所の差し替え画面を開きます')
  })

  test('一覧ドロワーの使用先も個別の画面へ行く', async () => {
    stubTemplateGet(USED_BY)
    render(<TemplatesPage />)
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })
    await screen.findByText('来店お礼')

    fireEvent.keyDown(screen.getByRole('link', { name: '来店お礼の詳細を開く' }), { key: 'Enter' })
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })
    await screen.findByText(/使用箇所/)

    expect(screen.getByText('自動返信: 予約', { exact: false }).closest('a')?.getAttribute('href'))
      .toBe('/auto-replies/edit?id=ar-1')
    // 旧形式オートメーションはリンクにしない（別ID空間の画面へ飛ばさない）
    const automationText = screen.getByText('オートメーション: 予約後フォロー', { exact: false })
    expect(automationText.closest('a')).toBeNull()
    expect(automationText.textContent).toContain('旧形式')
  })
})

describe('質問テンプレートの使用数表示 (#891 N-142)', () => {
  test('全カテゴリの合計を「シナリオ N通」と誤表示しない', async () => {
    const question = { text: 'どれにしますか？', tapMode: 'single', choices: [{ label: 'A' }] }
    stubTemplateGet(USED_BY, question)
    searchParams.value = new URLSearchParams('id=tpl-1')
    render(<QuestionTemplatePage />)
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })
    await screen.findByText('この質問を使う場所')

    // USED_BY は6件（シナリオは1件だけ）。合計をシナリオ数とは言わない。
    expect(screen.getByText('使用先 6か所')).toBeTruthy()
    expect(screen.queryByText(/シナリオ \d+通/)).toBeNull()
  })
})
