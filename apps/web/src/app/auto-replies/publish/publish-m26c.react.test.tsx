// @vitest-environment happy-dom
/*
 * m26c: 自動応答の公開・権限・競合（R551-UI/R552-UI/R555/R557/R558 の画面側）。
 * 本物の React で公開フローを押して確かめる。API は mock。
 *
 * 期待する姿（いずれも現状は赤）:
 * - R551-UI: 下書き保存の 409 で、先行内容との比較と読み直しの導線を出す。
 * - R552-UI: 内容が変わった試験結果は使わず、再試験を求める。
 * - R555: 停止の再送は同じ確認キーで、停止履歴を上書きしない。
 * - R557: 公開後の完了画面に、押せない再試験ボタンを出さない。
 * - R558: 公開済みの再読込で公開状態を表示し、404 へ誤遷移しない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class MockApiError extends Error {
    readonly status: number
    readonly code: string | undefined
    readonly data: unknown
    constructor(status: number, message?: string, code?: string, data?: unknown) {
      super(message ?? `API error: ${status}`)
      this.name = 'ApiError'
      this.status = status
      this.code = code
      this.data = data
    }
  }
  return {
    getDraft: vi.fn(),
    conflicts: vi.fn(),
    validateDraft: vi.fn(),
    testDraft: vi.fn(),
    publishDraft: vi.fn(),
    stop: vi.fn(),
    createDraft: vi.fn(),
    saveDraft: vi.fn(),
    update: vi.fn(),
    friendsList: vi.fn(),
    MockApiError,
  }
})
const { MockApiError } = mocks

vi.mock('@/lib/api', () => ({
  api: {
    autoReplies: {
      getDraft: mocks.getDraft,
      conflicts: mocks.conflicts,
      validateDraft: mocks.validateDraft,
      testDraft: mocks.testDraft,
      publishDraft: mocks.publishDraft,
      stop: mocks.stop,
      createDraft: mocks.createDraft,
      saveDraft: mocks.saveDraft,
      update: mocks.update,
    },
    friends: { list: mocks.friendsList },
    folders: { list: vi.fn().mockResolvedValue({ success: true, data: { items: [] } }) },
    tags: { list: vi.fn().mockResolvedValue({ success: true, data: [] }) },
    friendFields: { list: vi.fn().mockResolvedValue({ success: true, data: [] }) },
    supportMarks: { list: vi.fn().mockResolvedValue({ success: true, data: [] }) },
    scenarios: { list: vi.fn().mockResolvedValue({ success: true, data: [] }) },
    commonVars: { list: vi.fn().mockResolvedValue({ success: true, data: [] }) },
  },
  ApiError: mocks.MockApiError,
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/auto-replies/publish',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('id=r1'),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: vi.fn(),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a' }),
}))
vi.mock('@/lib/use-feature-visibility', () => ({
  useFeatureVisibility: () => ({ enabled: () => true }),
}))

import AutoReplyPublishPage from './page'
import EditDialog from '@/components/auto-replies/edit-dialog'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function draftSettings(overrides: Record<string, unknown> = {}) {
  return {
    keyword: '予約',
    matchType: 'contains',
    responseType: 'text',
    responseContent: '承りました',
    templateId: null,
    lineAccountId: 'account-a',
    activeFrom: null,
    activeUntil: null,
    cooldownMinutes: null,
    skipWhenOperatorActive: false,
    priority: 10,
    messageKinds: null,
    receiveSources: ['line'],
    friendConditions: null,
    actions: null,
    responseWeekdays: null,
    responseHolidayRule: null,
    oncePerFriend: false,
    keywords: null,
    respondToAll: false,
    name: '予約問い合わせ',
    keywordMatchMode: 'any',
    folderId: null,
    internalMemo: null,
    ...overrides,
  }
}

function draftVersion(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    data: {
      autoReplyId: 'r1',
      versionId: 'v1',
      versionNumber: 1,
      status: 'draft',
      settings: draftSettings(),
      lastTestStatus: null,
      lastTestedAt: null,
      publishedAt: null,
      matchedLast28Days: null,
      ...overrides,
    },
  }
}

function dryRunResult(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    data: {
      matched: true,
      draftWon: true,
      operatorActive: false,
      winner: {
        autoReplyId: 'r1',
        name: '予約問い合わせ',
        responseType: 'text',
        responseContent: '承りました',
      },
      candidates: [],
      actions: [],
      stateChanged: false,
      ...overrides,
    },
  }
}

const validationOk = {
  success: true,
  data: { valid: true, errors: [], warnings: [], conflicts: [], lastTestStatus: 'succeeded' },
}

const publishOk = {
  success: true,
  data: {
    autoReplyId: 'r1',
    versionId: 'v1',
    versionNumber: 2,
    publishedAt: '2026-09-29T12:00:00+09:00',
    acknowledgedConflictIds: [],
  },
}

const stopOk = {
  success: true,
  data: {
    id: 'r1',
    isActive: false,
    stoppedAt: '2026-09-29T12:10:00+09:00',
    stoppedByStaffId: 's1',
    stoppedByStaffName: '担当',
    stopReason: '理由',
  },
}

let container: HTMLDivElement
let root: Root

async function flush() {
  await act(async () => {
    for (let step = 0; step < 12; step += 1) await Promise.resolve()
  })
}

function buttonsIn(scope: ParentNode, label: string): HTMLButtonElement[] {
  return Array.from(scope.querySelectorAll('button')).filter(
    (button) => (button.textContent ?? '').includes(label),
  )
}

async function click(label: string, scope?: ParentNode) {
  const list = buttonsIn(scope ?? container, label)
  if (list.length === 0) throw new Error(`button not found: ${label}`)
  await act(async () => {
    list[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await flush()
}

beforeEach(() => {
  mocks.getDraft.mockResolvedValue(draftVersion())
  mocks.conflicts.mockResolvedValue({ success: true, data: { conflicts: [] } })
  mocks.friendsList.mockResolvedValue({ success: true, data: { items: [{ id: 'f1' }], total: 1 } })
  mocks.validateDraft.mockResolvedValue(validationOk)
  mocks.testDraft.mockResolvedValue(dryRunResult())
  mocks.publishDraft.mockResolvedValue(publishOk)
  mocks.stop.mockResolvedValue(stopOk)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  vi.clearAllMocks()
})

async function renderPublishPage() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<AutoReplyPublishPage />)
  })
  await flush()
}

/** conflicts → test → confirm → done まで進める。 */
async function goToDone() {
  await renderPublishPage()
  await click('テストへ')
  // テスト段階の追従バーから試験の窓を開く。
  await click('自動応答をテスト')
  // 窓の中の実行ボタン。
  const dialog = container.querySelector('[role="dialog"]')
  if (!dialog) throw new Error('test dialog not open')
  await click('自動応答をテスト', dialog)
  await click('最終確認へ')
  await click('自動応答を有効化')
  if (!container.textContent?.includes('有効化しました')) {
    throw new Error('did not reach done stage')
  }
}

describe('m26c R555/R557: 公開後の完了画面', () => {
  it('停止の再送は同じ確認キーで、再試験ボタンは出さない', async () => {
    mocks.stop.mockRejectedValueOnce(new MockApiError(500, '応答消失'))
    await goToDone()

    // R557: 押せない再試験を案内しない。
    expect(buttonsIn(container, 'テストを再実行')).toHaveLength(0)
    expect(container.textContent).toMatch(/実行状況を確認/)

    // R555: 停止の決定を2回押す。1回目は応答消失、2回目が成功。
    // 確認窓は body 直下の portal に出るため、文書全体から探す。
    await click('自動応答を一時停止')
    await click('停止する', document)
    expect(document.body.textContent).toMatch(/読み直して/)
    await click('停止する', document)
    expect(mocks.stop).toHaveBeenCalledTimes(2)
    const firstKey = mocks.stop.mock.calls[0][2]
    const secondKey = mocks.stop.mock.calls[1][2]
    expect(typeof firstKey).toBe('string')
    expect(secondKey).toBe(firstKey)
    // 初回の停止記録が画面に出る。
    expect(container.textContent).toMatch(/停止しました/)
  });
});

describe('m26c R558: 公開済みの再読込', () => {
  it('公開版の状態を表示し、見つかりませんへ誤遷移しない', async () => {
    mocks.getDraft.mockResolvedValue(draftVersion({ status: 'published' }))
    await renderPublishPage()
    expect(container.textContent).toMatch(/公開済み/)
    expect(container.textContent).not.toMatch(/見つかりません/)
    expect(buttonsIn(container, 'テストを再実行')).toHaveLength(0)
  });
});

describe('m26c R552-UI: 内容が変わった試験結果', () => {
  it('古い試験結果を使わず再試験を求める', async () => {
    mocks.testDraft.mockResolvedValue(dryRunResult({ staleTest: true }))
    await renderPublishPage()
    await click('テストへ')
    await click('自動応答をテスト')
    const dialog = container.querySelector('[role="dialog"]')
    if (!dialog) throw new Error('test dialog not open')
    await click('自動応答をテスト', dialog)
    expect(container.textContent).toMatch(/内容が変わり/)
  });
});

describe('m26c R551-UI: 下書き保存の競合', () => {
  async function renderDialog() {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root.render(
        <EditDialog
          draft={{
            id: 'r1',
            keyword: '予約',
            matchType: 'contains',
            responseType: 'text',
            responseContent: 'Bの内容',
            templateId: null,
            lineAccountId: 'account-a',
            isActive: false,
            versionNumber: 1,
          }}
          templates={[]}
          onClose={() => {}}
          onSaved={() => {}}
        />,
      )
    })
    await flush()
  }

  it('409 で先行内容との比較と読み直しの導線を出す', async () => {
    mocks.update.mockRejectedValueOnce(
      new MockApiError(409, 'ほかの変更が先に保存されました。最新の状態を読み直してください', 'VERSION_CONFLICT', {
        currentVersion: 2,
        current: { keyword: '予約', responseContent: 'Aの内容' },
      }),
    )
    await renderDialog()
    await click('保存')
    expect(container.textContent).toMatch(/先に保存されました/)
    expect(buttonsIn(container, '最新の状態を読み直す')).toHaveLength(1)
    expect(container.textContent).toMatch(/Aの内容/)
  });
});
