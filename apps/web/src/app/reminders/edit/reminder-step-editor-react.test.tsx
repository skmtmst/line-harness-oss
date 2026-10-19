// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  getDraft: vi.fn(),
  saveDraft: vi.fn(),
  validateDraft: vi.fn(),
  routerPush: vi.fn(),
}))

vi.mock('@/components/shell/page-chrome', async () => ({ ...(await import('@/test-utils/page-chrome-mock')).pageChromeMock(), usePageTitle: vi.fn() }))
vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(),
  useRouter: () => ({ push: fixture.routerPush }),
}))
/*
 * R16: 本文欄に差し込みボタン (InsertToolbar) を置いたため、
 * 描画にアカウントの文脈が要る。本体では提供者が渡す。
 * ここでは選び中のアカウントがあるものとして描く。
 */
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-1', loading: false }),
}))
/*
 * R16: 差し込みボタンは任意機能の有無で出し分けるが、読み込みの成否は
 * この試験の対象外。名前・配信日・その他だけ出す状態で描く。
 */
vi.mock('@/lib/use-feature-visibility', () => ({
  useFeatureVisibility: () => ({ status: 'ready' as const, features: null, enabled: () => false }),
}))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api,
    reminders: { ...actual.api.reminders,
      previewDraft: vi.fn(async () => ({ success: true, data: null })),
      validateDraft: vi.fn(async () => ({ success: true, data: { valid: true, checks: [], audience: { matched: 5, excluded: 1 } } })),
      ...fixture,
    },
    folders: { ...actual.api.folders, list: vi.fn(async () => ({ success: true, data: [], unfiledCount: 0 })) },
    friendFields: { ...actual.api.friendFields, list: vi.fn(async () => ({ success: true, data: [] })) },
  } }
})
vi.mock('@/lib/staff-role', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/staff-role')>()), useStaffRole: () => 'owner' }))

const { ApiError: TestApiError } = await import('@/lib/api') as unknown as {
  ApiError: new (status: number, message: string) => Error & { status: number }
}

import ReminderEditV8 from '@/v8/reminders/edit'

const DRAFT_SETTINGS = {
  name: '予約前のお知らせ',
  description: null,
  lineAccountId: 'account-1',
  triggerType: 'booking',
  deliveryMode: 'time',
  triggerFieldId: null,
  triggerEventId: null,
  repeatYearly: false,
  triggerOffsetMinutes: null,
  sendAtTime: '18:00',
  targetTagId: null,
  folderId: null,
  stopConditions: {
    bookingCancelled: true,
    supportMarkCompleted: false,
    daysAfterTarget: 7,
    friendBlocked: true,
  },
  steps: [
    { stableStepId: 's-1', offsetMinutes: 0, offsetDays: -1, sendAtTime: '18:00', messageType: 'text', messageContent: '前日のお知らせ本文' },
    { stableStepId: 's-2', offsetMinutes: 0, offsetDays: 0, sendAtTime: '09:00', messageType: 'text', messageContent: '当日のお知らせ本文' },
  ],
}

function draftResponse(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    data: {
      reminderId: 'r-1',
      versionId: 'v-1',
      versionNumber: 1,
      status: 'draft',
      settings: structuredClone(DRAFT_SETTINGS),
      lastTestStatus: null,
      lastTestedAt: null,
      publishedAt: null,
      ...overrides,
    },
  }
}

function bodyTextarea(container: HTMLElement): HTMLTextAreaElement {
  const area = container.querySelector('[role="textbox"][contenteditable]')
  if (!area) throw new Error('本文テキストエリアが見つかりません')
  return area
}

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  fixture.getDraft.mockResolvedValue(draftResponse())
  fixture.validateDraft.mockResolvedValue({
    success: true,
    data: { valid: true, checks: [], audience: { matched: 5, excluded: 1 } },
  })
  fixture.saveDraft.mockImplementation(async (_id: string, settings: unknown) => draftResponse({
    versionId: 'v-2',
    settings: typeof settings === 'object' && settings
      ? { ...(settings as Record<string, unknown>) }
      : DRAFT_SETTINGS,
  }))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('通知ステップの複数通編集', () => {
  it('2通目を選ぶと、その通の本文を編集できる', async () => {
    const { container } = render(<ReminderEditV8 stage="messages" reminderId="r-1" />)
    await waitFor(() => expect(fixture.getDraft).toHaveBeenCalled())

    // 初期は1通目が選ばれている
    await waitFor(() => expect(bodyTextarea(container).value).toBe('前日のお知らせ本文'))

    fireEvent.click(document.querySelector('[data-reorder-id="s-2"]')!.querySelector('button[aria-expanded]')!)
    await waitFor(() => expect(bodyTextarea(container).value).toBe('当日のお知らせ本文'))
  })

  it('選んだ通だけを変えて全ステップを保存し、開いたときの版を送る', async () => {
    const { container } = render(<ReminderEditV8 stage="messages" reminderId="r-1" />)
    await waitFor(() => expect(bodyTextarea(container).value).toBe('前日のお知らせ本文'))

    fireEvent.click(document.querySelector('[data-reorder-id="s-2"]')!.querySelector('button[aria-expanded]')!)
    await waitFor(() => expect(bodyTextarea(container).value).toBe('当日のお知らせ本文'))
    fireEvent.change(bodyTextarea(container), { target: { value: '当日9時に改稿' } })

    fireEvent.click(screen.getByRole('button', { name: '次へ：配信予定' }))
    await waitFor(() => expect(fixture.saveDraft).toHaveBeenCalled())

    const [id, settings, options] = fixture.saveDraft.mock.calls[0]
    expect(id).toBe('r-1')
    expect(settings.steps).toHaveLength(2)
    expect(settings.steps[0]).toMatchObject({ stableStepId: 's-1', messageContent: '前日のお知らせ本文' })
    expect(settings.steps[1]).toMatchObject({ stableStepId: 's-2', messageContent: '当日9時に改稿' })
    expect(options).toEqual({ expectedVersionId: 'v-1' })
    await waitFor(() => expect(fixture.routerPush).toHaveBeenCalledWith('/reminders/edit?id=r-1&stage=preview'))
  })

  it('通知を追加すると新しい通が選ばれ、削除できる', async () => {
    render(<ReminderEditV8 stage="messages" reminderId="r-1" />)
    await screen.findByLabelText('1 通目の本文')

    fireEvent.click(screen.getByRole('button', { name: '通知を足す' }))
    await screen.findByLabelText('3 通目の本文')

    // 新しい通が選ばれて本文は空。空のままでは保存ボタンを押せない。
    const saveButton = screen.getByRole('button', { name: '次へ：配信予定' }) as HTMLButtonElement
    expect(saveButton.disabled).toBe(true)

    fireEvent.click(within(screen.getByLabelText('3 通目の本文').closest('[data-reorder-id]') as HTMLElement).getByRole('button', { name: '消す' }))
    await waitFor(() => expect(screen.queryByLabelText('3 通目の本文')).toBeNull())
  })

  it('最後の1通は削除できない', async () => {
    fixture.getDraft.mockResolvedValue(draftResponse({
      settings: { ...structuredClone(DRAFT_SETTINGS), steps: [structuredClone(DRAFT_SETTINGS).steps[0]] },
    }))
    render(<ReminderEditV8 stage="messages" reminderId="r-1" />)
    await screen.findByLabelText('1 通目の本文')
    expect((screen.getByRole('button', { name: '消す' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('前へ移動で順番を入れ替えられる', async () => {
    render(<ReminderEditV8 stage="messages" reminderId="r-1" />)
    await waitFor(() => expect(document.querySelector('[data-reorder-id="s-2"]')).toBeTruthy())

    fireEvent.click(document.querySelector('[data-reorder-id="s-2"]')!.querySelector('button[aria-expanded]')!)
    fireEvent.click(within(document.querySelector('[data-reorder-id="s-2"]') as HTMLElement).getByRole('button', { name: '前へ' }))

    // 並び替えたあと保存すると、入れ替わった順のまま送られる
    fireEvent.click(screen.getByRole('button', { name: '次へ：配信予定' }))
    await waitFor(() => expect(fixture.saveDraft).toHaveBeenCalled())
    const settings = fixture.saveDraft.mock.calls[0][1]
    expect(settings.steps.map((step: { stableStepId: string }) => step.stableStepId)).toEqual(['s-2', 's-1'])
  })

  it('本文を変えると離脱時に確認を出す', async () => {
    const { container } = render(<ReminderEditV8 stage="messages" reminderId="r-1" />)
    await waitFor(() => expect(bodyTextarea(container).value).toBe('前日のお知らせ本文'))

    fireEvent.change(bodyTextarea(container), { target: { value: '書きかけ' } })
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('未編集なら離脱確認を出さない', async () => {
    render(<ReminderEditV8 stage="messages" reminderId="r-1" />)
    await screen.findByLabelText('1 通目の本文')
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('画面内リンクへの移動も確認で止める', async () => {
    const { container } = render(<>
      <a href="/reminders">一覧へ</a>
      <ReminderEditV8 stage="messages" reminderId="r-1" />
    </>)
    await waitFor(() => expect(bodyTextarea(container).value).toBe('前日のお知らせ本文'))

    fireEvent.change(bodyTextarea(container), { target: { value: '書きかけ' } })
    fireEvent.click(screen.getByRole('link', { name: '一覧へ' }))
    await screen.findByText('保存していない変更があります')
    expect(fixture.routerPush).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '保存せずに移る' }))
    await waitFor(() => expect(fixture.routerPush).toHaveBeenCalledWith('/reminders'))
  })

  it('R148: 開いたときの版時刻も保存時に送り、版IDが同じでも先勝ちを見逃さない', async () => {
    fixture.getDraft.mockResolvedValue(draftResponse({ updatedAt: '2026-09-27T10:00:00.000+09:00' }))
    const { container } = render(<ReminderEditV8 stage="messages" reminderId="r-1" />)
    await waitFor(() => expect(bodyTextarea(container).value).toBe('前日のお知らせ本文'))

    fireEvent.change(bodyTextarea(container), { target: { value: '改稿' } })
    fireEvent.click(screen.getByRole('button', { name: '次へ：配信予定' }))
    await waitFor(() => expect(fixture.saveDraft).toHaveBeenCalled())

    const options = fixture.saveDraft.mock.calls[0][2]
    expect(options).toEqual({ expectedVersionId: 'v-1', expectedUpdatedAt: '2026-09-27T10:00:00.000+09:00' })
  })

  it('別画面で先に更新されていたら409を知らせ、読み直しを案内する', async () => {
    fixture.saveDraft.mockRejectedValue(new TestApiError(409, 'この下書きは別の画面で先に更新されました'))
    const { container } = render(<ReminderEditV8 stage="messages" reminderId="r-1" />)
    await waitFor(() => expect(bodyTextarea(container).value).toBe('前日のお知らせ本文'))

    fireEvent.change(bodyTextarea(container), { target: { value: '古い画面からの保存する' } })
    fireEvent.click(screen.getByRole('button', { name: '次へ：配信予定' }))

    await screen.findByText(/ほかの人が先にリマインダ/)
    expect(fixture.routerPush).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '最新を読み込んで続ける' })).toBeTruthy()
  })
})
