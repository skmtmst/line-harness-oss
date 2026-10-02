// @vitest-environment happy-dom
/*
 * D004: 読み込みの失敗を理由別に出し分ける。権限なし(403)でも
 * 「通信が切れたか、サーバが応えませんでした」と出して再試行へ誘わない。
 * 403は権限の案内・再試行なし、429は待ち時間の案内、通信失敗だけ再試行。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  push: vi.fn(),
  get: vi.fn(),
  editor: vi.fn(),
}))

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: fixture.push }),
  usePathname: () => '/webinars/edit',
  useSearchParams: () => new URLSearchParams('id=webinar-1'),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ accounts: [], loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    webinarApi: {
      ...(actual.webinarApi as unknown as Record<string, unknown>),
      get: fixture.get,
      editor: fixture.editor,
    },
  }
})

import EditWebinarPage from './page'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  fixture.push.mockClear()
  fixture.get.mockReset()
  fixture.editor.mockReset()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

async function render() {
  await act(async () => { root.render(<EditWebinarPage />) })
  await flush()
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

function retryButton(): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === 'もう一度読み込む',
  ) as HTMLButtonElement | undefined
}

describe('ウェビナー編集の読み込み失敗の出し分け（D004）', () => {
  it('403は権限の案内を出し、再試行は出さない', async () => {
    const { ApiError } = await import('@/lib/api')
    fixture.get.mockRejectedValue(new ApiError(403, 'Forbidden'))
    fixture.editor.mockRejectedValue(new ApiError(403, 'Forbidden'))
    await render()

    expect(host.textContent).toContain('ウェビナーを見る権限がありません')
    expect(host.textContent).not.toContain('通信が切れた')
    expect(retryButton()).toBeUndefined()
  })

  it('429は混み合いの案内を出し、再試行は出る', async () => {
    const { ApiError } = await import('@/lib/api')
    fixture.get.mockRejectedValue(new ApiError(429, 'Too Many Requests'))
    fixture.editor.mockRejectedValue(new ApiError(429, 'Too Many Requests'))
    await render()

    expect(host.textContent).toContain('混み合っています')
    expect(host.textContent).not.toContain('通信が切れた')
    expect(retryButton()).not.toBeUndefined()
  })

  it('通信失敗は再試行ありの通信文面のまま', async () => {
    fixture.get.mockRejectedValue(new Error('network down'))
    fixture.editor.mockRejectedValue(new Error('network down'))
    await render()

    // 一覧と同じ共通の通信文面（webinarLoadFailure のその他文）。
    expect(host.textContent).toContain('ウェビナーを表示できませんでした')
    expect(host.textContent).toContain('通信状態を確認して、もう一度読み込んでください')
    expect(retryButton()).not.toBeUndefined()
  })

  it('再試行で直ったら中身に戻る', async () => {
    fixture.get
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue({
        success: true,
        data: {
          id: 'webinar-1', accountId: null, title: '採用ウェビナー', slug: 'recruit',
          status: 'draft', videoPrefix: null, durationSeconds: 600, schedule: [],
          cta: null, createdAt: 'x', updatedAt: 'x',
        },
      })
    fixture.editor.mockResolvedValue({
      success: true,
      data: {
        version: 3, deliveryKind: 'on_demand', viewingCondition: { kind: 'all', label: '全員' },
        publicDescription: '', registrationFormId: null, notificationMessages: {},
        notificationTest: null,
        actionPolicy: { templateBody: '', missingResultPolicy: 'escalate' },
        publicPage: { url: null, unavailableReason: null, description: '', test: null, form: null },
        publication: { status: 'draft', draftVersion: 3, publishedVersion: null, publishedAt: null },
        monitoring: {
          notificationFailures: 0, duplicateRegistrations: 0,
          viewSegmentFailures: 0, actionFailures: 0,
        },
      },
    })
    await render()
    expect(retryButton()).not.toBeUndefined()

    await act(async () => { retryButton()!.click() })
    await flush()

    expect(host.textContent).not.toContain('ウェビナーを表示できませんでした')
    expect(host.textContent).not.toContain('通信状態を確認して、もう一度読み込んでください')
    expect(retryButton()).toBeUndefined()
    // 読み直した中身（編集の段）が戻る。
    expect(host.textContent).toContain('基本設定')
  })
})
