// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { IdempotencyKeyStore } from '@/lib/idempotency-key-store'
const fx = vi.hoisted(() => ({ schedule: vi.fn(), notify: vi.fn() }))
vi.mock('@/components/shared/toast', () => ({ notifyToast: fx.notify }))
vi.mock('@/lib/api', () => ({ api: { chats: { scheduled: async () => ({ success: true, data: { scheduled: [] } }), schedule: fx.schedule } } }))
import { useInboxSchedule } from './use-inbox-schedule'
const ref = <T,>(current: T) => ({ current })
function options(image = false) {
  return {
    getFriendName: () => '山田さん', detailAccountRef: ref<string | null>('A'), selectedChatIdRef: ref<string | null>('one'), selectedChatId: 'one', selectedAccountId: 'A',
    messageContent: '予約の本文', pendingImage: image ? { mode: 'line-image' as const, originalContentUrl: 'https://example.com/image.png', previewImageUrl: 'https://example.com/preview.png' } : null,
    pendingAttachment: null, setError: vi.fn(), dropSentDraft: vi.fn(), pendingImageRef: ref(null), setPendingImage: vi.fn(), setPendingImageMeta: vi.fn(),
    attachDraftsRef: ref(new Map()), putAttachment: vi.fn(), setMessageContent: vi.fn(), quotedMessage: null, sendKeysRef: ref(new IdempotencyKeyStore()), setQuotedMessage: vi.fn(),
  }
}
beforeEach(() => { vi.clearAllMocks(); fx.schedule.mockReset().mockResolvedValue({ success: true }) })
afterEach(cleanup)
it('すべて予約できたときだけ対象名付きで成功を知らせる', async () => {
  const opts = options()
  const view = renderHook(() => useInboxSchedule(opts))
  act(() => view.result.current.setScheduleInput('2026-10-30T10:00'))
  await act(async () => view.result.current.handleScheduleSend())
  expect(fx.notify).toHaveBeenCalledWith('「山田さん」へのメッセージを予約しました')
  expect(opts.setError).not.toHaveBeenCalled()
})
it('一部だけ予約できたら成功の知らせにせず、未予約の本文を残して失敗を表示する', async () => {
  fx.schedule.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false })
  const opts = options(true)
  const view = renderHook(() => useInboxSchedule(opts))
  act(() => view.result.current.setScheduleInput('2026-10-30T10:00'))
  await act(async () => view.result.current.handleScheduleSend())
  expect(opts.dropSentDraft).toHaveBeenCalledTimes(1)
  expect(opts.setMessageContent).not.toHaveBeenCalled()
  expect(opts.setError).toHaveBeenCalledWith(expect.stringContaining('一部のメッセージを予約できませんでした'))
  expect(fx.notify).not.toHaveBeenCalled()
})
it('応答前に会話が変わったら新しい会話へ成功の知らせを出さない', async () => {
  let resolve!: (value: { success: boolean }) => void
  fx.schedule.mockReturnValueOnce(new Promise(yes => { resolve = yes }))
  const opts = options()
  const view = renderHook(() => useInboxSchedule(opts))
  act(() => view.result.current.setScheduleInput('2026-10-30T10:00'))
  let task!: Promise<void>
  act(() => { task = view.result.current.handleScheduleSend() })
  opts.selectedChatIdRef.current = 'two'
  await act(async () => { resolve({ success: true }); await task })
  expect(fx.notify).not.toHaveBeenCalled()
})
