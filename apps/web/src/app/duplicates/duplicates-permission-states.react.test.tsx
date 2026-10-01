// @vitest-environment happy-dom
/*
 * R598 残件（独立オラクル由来）：権限不足（403）の言い分け。
 *
 * - 集計・候補の両方が403 → 権限の案内だけにし、押しても直らない
 *   再試行は出さない（汎用エラー「通信が切れたか…」にしない）。
 * - 集計の取得済みがある状態で再検出→集計403 → 候補は残し、
 *   集計欄を権限の案内にし、「もう一度」は出さない。
 * - 503の振る舞い（再試行あり・候補残し）は変えない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  stats: vi.fn(),
  list: vi.fn(),
  detect: vi.fn(),
}))

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...(actual.api as unknown as Record<string, unknown>),
      duplicates: { stats: fixture.stats },
      identityCandidates: {
        list: fixture.list,
        detectFriendDuplicates: fixture.detect,
      },
    },
  }
})

import { ApiError } from '@/lib/api'
import DuplicatesPage from './page'

function statsData() {
  return {
    totalFollowing: 100,
    uniquePeople: 90,
    friendDups: 10,
    duplicateGroups: 5,
    wastedPerBroadcastYen: 500,
    msgUnitYen: 50,
    perAccount: [
      { accountId: 'a1', accountName: '然 本店', friends: 60, dups: 6, dupRate: 0.1 },
      { accountId: 'a2', accountName: '然 支店', friends: 40, dups: 4, dupRate: 0.1 },
    ],
    pairwiseOverlap: [{ fromAccountId: 'a1', toAccountId: 'a2', overlap: 3 }],
    computedAt: '2026-09-27T00:00:00.000Z',
  }
}

function candidate() {
  const subject = (id: string, label: string) => ({
    kind: 'friend' as const,
    id,
    label,
    detail: null,
    lineAccountId: 'a1',
    lineAccountName: '然 本店',
    shopKey: null,
    attributes: [],
  })
  return {
    id: 'cand-1',
    kind: 'friend_duplicate' as const,
    status: 'pending' as const,
    version: 1,
    confidence: { score: 90, label: 'high' as const },
    left: subject('f1', '田中太郎'),
    right: subject('f2', '田中たろう'),
    evidenceSummary: ['メールが一致'],
    detectedAt: '2026-09-27T00:00:00.000Z',
    reviewedAt: null,
  }
}

function listData(items: ReturnType<typeof candidate>[]) {
  return {
    items,
    total: items.length,
    limit: 50,
    offset: 0,
    statusCounts: { pending: items.length },
    lowConfidenceCount: 0,
  }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  fixture.stats.mockReset()
  fixture.list.mockReset()
  fixture.detect.mockReset()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

async function renderPage() {
  await act(async () => { root.render(<DuplicatesPage />) })
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {})
  }
}

function retryButton(label: string): HTMLButtonElement {
  const buttons = Array.from(host.querySelectorAll('button'))
  const found = buttons.find((b) => b.textContent === label)
  if (!found) throw new Error(`ボタン「${label}」が見つかりません: ${host.innerHTML.slice(0, 500)}`)
  return found as HTMLButtonElement
}

function hasRetryButton(): boolean {
  return Array.from(host.querySelectorAll('button')).some((b) =>
    /もう一度|再読み込|やり直/.test(b.textContent || ''),
  )
}

describe('権限不足でも候補を残し再試行を出さない（R598残件）', () => {
  it('集計・候補の両方403：権限の案内にし、再試行は出さない', async () => {
    fixture.stats.mockRejectedValue(new ApiError(403))
    fixture.list.mockRejectedValue(new ApiError(403))
    await renderPage()

    expect(host.textContent).toContain('権限')
    expect(hasRetryButton()).toBe(false)
    // 空の一覧と誤認させない。
    expect(host.textContent).not.toContain('条件に合う重複候補はありません')
  })

  it('取得済み集計→再検出で集計403：候補は残し権限の案内、「もう一度」は出さない', async () => {
    fixture.stats
      .mockResolvedValueOnce({ success: true, data: statsData() })
      .mockRejectedValue(new ApiError(403))
    fixture.list.mockResolvedValue({ success: true, data: listData([candidate()]) })
    fixture.detect.mockResolvedValue({ success: true, data: {} })
    await renderPage()
    expect(host.textContent).toContain('田中太郎')

    await act(async () => { retryButton('重複を再検出').click() })
    for (let i = 0; i < 5; i += 1) await act(async () => {})

    // 候補は前回の取得内容のまま残る。
    expect(host.textContent).toContain('田中太郎')
    // 集計欄は権限の案内になり、押しても直らない再試行は消える。
    expect(host.textContent).toContain('権限')
    expect(Array.from(host.querySelectorAll('button')).some((b) => (b.textContent || '') === 'もう一度')).toBe(false)
  })

  it('取得済み集計→再検出で集計503：汎用失敗のまま再試行を残す（403特化で503を壊さない）', async () => {
    fixture.stats
      .mockResolvedValueOnce({ success: true, data: statsData() })
      .mockRejectedValue(new ApiError(503))
    fixture.list.mockResolvedValue({ success: true, data: listData([candidate()]) })
    fixture.detect.mockResolvedValue({ success: true, data: {} })
    await renderPage()
    expect(host.textContent).toContain('田中太郎')

    await act(async () => { retryButton('重複を再検出').click() })
    for (let i = 0; i < 5; i += 1) await act(async () => {})

    expect(host.textContent).toContain('田中太郎')
    expect(host.textContent).toContain('再計算できませんでした')
    retryButton('もう一度')
  })
})
