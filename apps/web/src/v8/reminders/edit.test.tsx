// @vitest-environment happy-dom
/*
 * V8 リマインダを作る②〜⑤・完了（src/v8/reminders/edit.tsx）の動きの試験。BEHAVIOR.md の主な動きを守る。
 * 型（CreatePage）の中に出る・保存して次の手順へ進む・競合（409）の帯が出る・単位の切り替え・完了の行き先。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const pushMock = vi.hoisted(() => vi.fn())

const draftStore = vi.hoisted(() => ({
  draft: null as null | Record<string, unknown>,
  conflict: false,
  saved: [] as Array<Record<string, unknown>>,
}))

vi.mock('next/link', () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) =>
    React.createElement('a', { href, className }, children),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => '/reminders/edit',
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: { id: 'account-a', name: '本店' }, accounts: [{ id: 'account-a', name: '本店' }], loading: false }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
}))

vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  }
  return {
    ApiError,
    fetchApi: vi.fn(async () => ({ success: true, data: {} })),
    eventsApi: { listEvents: vi.fn(async () => ({ items: [] })) },
    api: {
      reminders: {
        getDraft: vi.fn(async () => ({ success: true, data: draftStore.draft })),
        saveDraft: vi.fn(async (_id: string, settings: Record<string, unknown>) => {
          if (draftStore.conflict) throw new ApiError(409, 'VERSION_CONFLICT')
          draftStore.saved.push(settings)
          draftStore.draft = { ...(draftStore.draft ?? {}), settings, versionId: 'v2', updatedAt: '2026-10-01T00:00:00Z' }
          return { success: true, data: draftStore.draft }
        }),
        validateDraft: vi.fn(async () => ({ success: true, data: { valid: true, checks: [], audience: { matched: 172, excluded: 14 } } })),
        previewDraft: vi.fn(async () => ({
          success: true,
          data: {
            targetDate: '2026-10-02T05:00:00.000Z',
            items: [
              { stableStepId: 's1', stepNumber: 1, scheduledAt: new Date(Date.now() + 86_400_000).toISOString(), label: '前日', state: 'scheduled' },
              { stableStepId: 's1', stepNumber: 1, scheduledAt: new Date(Date.now() + 86_400_000).toISOString(), label: '前日', state: 'duplicate' },
            ],
            summary: { audience: 172, next7Days: 124, next30Days: 400, duplicateCount: 3 },
          },
        })),
        audience: vi.fn(async () => ({ success: true, data: { matched: 5, excluded: 1, sample: [] } })),
        publishDraft: vi.fn(async () => ({ success: true, data: null })),
        getTestRecipient: vi.fn(async () => ({ success: true, data: { kind: 'unset' } })),
      },
      friendFields: { list: vi.fn(async () => ({ success: true, data: [] })) },
      folders: { list: vi.fn(async () => ({ success: true, data: [] })) },
    },
  }
})

import ReminderEditV8, { stageFor } from './edit'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function baseDraft() {
  return {
    reminderId: 'reminder-new',
    versionId: 'v1',
    versionNumber: 1,
    status: 'draft',
    lastTestStatus: null,
    lastTestedAt: null,
    publishedAt: null,
    updatedAt: '2026-09-30T00:00:00Z',
    settings: {
      name: '予約前日のご案内',
      description: null,
      lineAccountId: 'account-a',
      folderId: null,
      triggerType: 'booking',
      deliveryMode: 'time',
      triggerFieldId: null,
      triggerEventId: null,
      repeatYearly: false,
      leapYearPolicy: 'feb28',
      triggerOffsetMinutes: null,
      sendAtTime: null,
      targetTagId: null,
      targetCondition: null,
      stopConditions: { bookingCancelled: true, supportMarkCompleted: true, daysAfterTarget: 7, friendBlocked: true },
      steps: [
        { stableStepId: 's1', offsetMinutes: 0, offsetDays: -1, sendAtTime: '18:00', messageType: 'text', messageContent: '{名前}さん\n明日のご案内です。' },
        { stableStepId: 's2', offsetMinutes: -60, offsetDays: null, sendAtTime: null, messageType: 'text', messageContent: 'まもなくです。' },
      ],
    },
  }
}

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  draftStore.draft = baseDraft()
  draftStore.conflict = false
  draftStore.saved = []
  pushMock.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
  document.documentElement.removeAttribute('data-theme')
})

async function render(stage: string | null) {
  await act(async () => { root.render(<ReminderEditV8 reminderId="reminder-new" stage={stage} />) })
  for (let i = 0; i < 4; i += 1) await act(async () => {})
}

const buttonByText = (text: string) =>
  [...document.querySelectorAll('button, a')].find((el) => el.textContent?.trim() === text) as HTMLElement | undefined

describe('V8 リマインダを作る②〜⑤', () => {
  it('今の画面と同じ ?stage= の名前を受け付ける', () => {
    expect(stageFor('target')).toBe('target')
    expect(stageFor(null)).toBe('messages')
    expect(stageFor('preview')).toBe('schedule')
    expect(stageFor('test')).toBe('confirm')
    expect(stageFor('done')).toBe('done')
  })

  it('対象者と止める条件（YChR6）は作る型の中に出て、保存すると通知の中身へ進む', async () => {
    await render('target')
    const frame = host.querySelector('[data-page-template="create"]')
    expect(frame?.getAttribute('data-design-node')).toBe('YChR6')
    expect(host.textContent).toContain('名前：予約前日のご案内・いまは下書きです')
    expect(host.textContent).toContain('186 人')
    expect(host.textContent).toContain('172 人')
    expect(host.querySelectorAll('[role="switch"], button[aria-pressed], input[type="checkbox"]').length).toBeGreaterThan(0)
    const next = buttonByText('次へ：通知の中身')
    expect(next).toBeTruthy()
    await act(async () => { next!.click() })
    for (let i = 0; i < 3; i += 1) await act(async () => {})
    expect(draftStore.saved).toHaveLength(1)
    expect(pushMock).toHaveBeenCalledWith('/reminders/edit?id=reminder-new')
  })

  it('保存が 409 のときは競合の帯（k32cn）を出し、比べる・読み込むを選べる', async () => {
    draftStore.conflict = true
    await render('basics')
    const save = buttonByText('下書きを保存')
    expect(save).toBeTruthy()
    await act(async () => { save!.click() })
    for (let i = 0; i < 3; i += 1) await act(async () => {})
    const frame = host.querySelector('[data-page-template="create"]')
    expect(frame?.getAttribute('data-design-node')).toBe('k32cn')
    const band = host.querySelector('[role="alert"]')
    expect(band?.textContent).toContain('ほかの人が先にリマインダ「予約前日のご案内」を保存しました')
    expect(buttonByText('違いを比べる')).toBeTruthy()
    expect(buttonByText('最新を読み込んで続ける')).toBeTruthy()
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('通知の中身：開いた通知は日・前・時刻で書き、閉じた通知は本文の頭だけを出す', async () => {
    await render(null)
    // happy-dom の窓は幅 1024 なので 1152 の板（r1l0bT）：右の列は「LINEでの見え方を見る」と例だけ。
    expect(host.querySelector('[data-page-template="create"]')?.getAttribute('data-design-node')).toBe('r1l0bT')
    expect(buttonByText('LINEでの見え方を見る')).toBeTruthy()
    expect(host.querySelector('[aria-label="届く日時の例"]')?.textContent).toContain('2通目')
    const cards = host.querySelectorAll('[data-open]')
    expect(cards).toHaveLength(1)
    expect(host.textContent).toContain('1日前 18:00')
    expect(host.textContent).toContain('まもなくです。…')
    expect((host.querySelector('input[type="time"]') as HTMLInputElement | null)?.value).toBe('18:00')
    const add = buttonByText('通知を足す')
    await act(async () => { add!.click() })
    expect(host.textContent).toContain('3通目')
  })

  it('配信予定（T0nis）：重なりの行は「1通にまとめる」と出し、案内の帯で件数を言う', async () => {
    await render('preview')
    expect(host.querySelector('[data-page-template="create"]')?.getAttribute('data-design-node')).toBe('T0nis')
    expect(host.textContent).toContain('今後7日 124通')
    expect(host.textContent).toContain('重なり→1通にまとめる')
    expect(host.textContent).toContain('1通にまとめて送ります（3件）')
  })

  it('有効にした（hjNpJ）：下の帯は無く、一覧・配信予定・詳細へ行ける', async () => {
    await render('done')
    expect(host.querySelector('[data-design-node="hjNpJ"]')).toBeTruthy()
    expect(host.querySelector('[data-template-region="footer"]')).toBeNull()
    expect(buttonByText('一覧へ戻る')?.getAttribute('href')).toBe('/reminders')
    expect(buttonByText('配信予定を見る')?.getAttribute('href')).toBe('/reminders/detail?id=reminder-new&status=planned')
    expect(buttonByText('詳細を見る')?.getAttribute('href')).toBe('/reminders/detail?id=reminder-new')
  })
})
