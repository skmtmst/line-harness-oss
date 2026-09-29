// @vitest-environment happy-dom
/*
 * R530: 権限のない運用担当（staff）には実行結果の再実行・一時停止を出さない。
 * owner/admin には出す。役割×操作の表を実マウントで固定する。
 * 再実行の口側の staff 拒否は Worker の試験で見る。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const runsMock = vi.hoisted(() => vi.fn())
const staffMeMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', () => ({
  api: {
    autoReplies: {
      runs: runsMock,
      retryRun: vi.fn(),
      update: vi.fn(),
    },
    staff: { me: staffMeMock },
  },
  ApiError: class extends Error {
    readonly status: number
    constructor(status: number, message?: string) {
      super(message ?? `API error: ${status}`)
      this.name = 'ApiError'
      this.status = status
    }
  },
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/auto-replies/runs',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: vi.fn(),
}))

import AutoReplyRunsPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function listResponse() {
  return {
    success: true,
    data: {
      rule: { id: 'rule-1', name: '予約問い合わせ', isActive: true, priorityPosition: 1 },
      summary: {
        monthHits: 1,
        totalHits: 1,
        handovers: 0,
        errors: 1,
        lastRunAt: '2026-09-15T01:00:00.000Z',
        averageResponseMs: 800,
      },
      handovers: { waiting: 0, inProgress: 0, completed: 0 },
      triggerBreakdown: [{ trigger: '予約', count: 1, share: 1 }],
      items: [
        {
          id: 'evaluation-1',
          status: 'permanent_failed',
          detail: '返信または一部の処理だけ完了しました',
          durationMs: 800,
          canRetry: true,
          friendName: '田中さん',
          inputPreview: '予約したい',
          triggerLabel: '予約',
          accountLabel: '本店',
          replyStatus: 'accepted',
          actionSummary: { executed: 1, failed: 1 },
          occurredAt: '2026-09-15T01:00:00.000Z',
        },
      ],
      pagination: { total: 1, limit: 20, offset: 0 },
    },
  }
}

let container: HTMLDivElement
let root: Root

async function flush() {
  await act(async () => {
    for (let step = 0; step < 10; step += 1) await Promise.resolve()
  })
}

async function renderPage() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<AutoReplyRunsPage />)
  })
  await flush()
}

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  vi.clearAllMocks()
})

beforeEach(() => {
  runsMock.mockResolvedValue(listResponse())
})

function buttonLabels(): string[] {
  return Array.from(container.querySelectorAll('button')).map((b) => b.textContent ?? '')
}

describe('R530 実行結果の出し分け（役割×操作）', () => {
  it('staff の失敗行には再実行ボタンを出さず、一時停止も出さない', async () => {
    staffMeMock.mockResolvedValue({ success: true, data: { role: 'staff' } })
    await renderPage()

    expect(buttonLabels().some((label) => label.includes('もう一度実行'))).toBe(false)
    expect(buttonLabels().some((label) => label.includes('一時停止'))).toBe(false)
    expect(container.textContent).toContain(
      '実行結果の再実行・一時停止はオーナーと管理者だけができます',
    )
    // 読み取り（確認・書き出し・設定への移動）は残す。
    expect(container.textContent).toContain('最近の実行')
    expect(buttonLabels().some((label) => label.includes('CSVで書き出す'))).toBe(true)
  })

  it('owner の失敗行には再実行・一時停止が出る', async () => {
    staffMeMock.mockResolvedValue({ success: true, data: { role: 'owner' } })
    await renderPage()

    expect(buttonLabels().some((label) => label.includes('もう一度実行'))).toBe(true)
    expect(buttonLabels().some((label) => label.includes('一時停止'))).toBe(true)
    expect(container.textContent).not.toContain(
      '実行結果の再実行・一時停止はオーナーと管理者だけができます',
    )
  })
})

/*
 * 直しを戻すと赤くなる文字契約。実マウントの試験が本命で、
 * こちらは分岐の削除・無条件表示への戻しを見張る。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

describe('R530 実行結果の出し分け契約', () => {
  it('変更の可否は共通の出し分けで決め、手元の保存値で決めない', () => {
    expect(PAGE).toContain("from '@/lib/staff-role'")
    expect(PAGE).toContain('useStaffRole')
    expect(PAGE).toContain('canManageRole')
    expect(PAGE).not.toContain("localStorage.getItem('lh_staff_role')")
  })

  it('再実行・一時停止が canManage で守られ、403 は権限の説明になる', () => {
    expect(PAGE).toContain('{item.canRetry && canManage ? (')
    expect(PAGE).toContain('再実行する権限がありません')
    expect(PAGE).toContain('実行結果の再実行・一時停止はオーナーと管理者だけができます')
  })
})
