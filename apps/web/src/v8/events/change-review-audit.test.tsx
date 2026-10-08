// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const net = vi.hoisted(() => ({ getEvent: vi.fn(), listSlots: vi.fn(), previewEventChange: vi.fn(), applyEventChange: vi.fn() }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'a' }) }))
vi.mock('@/lib/api', () => ({ eventsApi: net }))
import { useChangeReview } from './change-review-model'
const slot = { id: 's', starts_at: '2026-10-01T05:00:00Z', ends_at: '2026-10-01T06:00:00Z', capacity: 10, is_active: 1 }
afterEach(() => { cleanup(); vi.resetAllMocks() })
it('WEB-152: 別イベントの遅れた取得を捨てる', async () => {
 let finish!: (v: unknown) => void
 net.getEvent.mockImplementation((_account, id) => id === 'old' ? new Promise(r => { finish = r }) : Promise.resolve({ id, name: '新しいイベント' }))
 net.listSlots.mockResolvedValue({ items: [slot] })
 const view = renderHook(({ id }) => useChangeReview(id), { initialProps: { id: 'old' } })
 view.rerender({ id: 'new' })
 await waitFor(() => expect(view.result.current.event?.id).toBe('new'))
 await act(async () => finish({ id: 'old', name: '古いイベント' }))
 expect(view.result.current.event?.id).toBe('new')
})
it('WEB-153: 適用後は予約枠と入力の基準を揃え、未保存を消す', async () => {
 net.getEvent.mockResolvedValue({ id: 'e', version: 1, name: 'イベント' })
 net.listSlots.mockResolvedValueOnce({ items: [slot] }).mockResolvedValue({ items: [{ ...slot, capacity: 12 }] })
 net.previewEventChange.mockResolvedValue({ blocked: false })
 net.applyEventChange.mockResolvedValue({ notified: 1, affected_confirmed: 1, affected_waiting: 0 })
 const view = renderHook(() => useChangeReview('e'))
 await waitFor(() => expect(view.result.current.status).toBe('ready'))
 act(() => view.result.current.setEdits({ s: { ...view.result.current.edits.s, capacity: '12' } }))
 await act(async () => { await view.result.current.runPreview() })
 await act(async () => { await view.result.current.runApply() })
 expect(view.result.current.hasChanges).toBe(false)
 expect(view.result.current.slots?.[0].capacity).toBe(12)
 expect(view.result.current.applied?.notified).toBe(1)
})
