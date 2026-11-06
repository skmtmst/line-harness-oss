import { describe, expect, it, vi } from 'vitest'
import type { EventSlot } from '@/lib/api'
import { saveInitialSlot, type InitialSlotCache } from './save-initial-slot'

const input = { starts_at: '2026-10-20T05:00:00Z', ends_at: '2026-10-20T06:00:00Z', capacity: 3, client_key: 'first-slot:event-1' }
const original: EventSlot = { ...input, id: 'slot-1', event_id: 'event-1', capacity: 2, version: 4, is_active: 1, sort_order: 0 }

describe('作成応答を失った最初の枠', () => {
  it('同じキーで戻った既存枠を、返された版で今の入力へ更新する', async () => {
    const api = { createSlots: vi.fn().mockResolvedValue({ items: [original] }), listSlots: vi.fn(), updateSlot: vi.fn().mockResolvedValue({ ...original, ...input, version: 5 }) }
    const capture = vi.fn()
    await saveInitialSlot({ api, accountId: 'account-1', eventId: 'event-1', input, cached: null, capture })
    expect(api.createSlots).toHaveBeenCalledWith('account-1','event-1',[input])
    expect(api.updateSlot).toHaveBeenCalledWith('account-1','event-1','slot-1',{ starts_at: input.starts_at, ends_at: input.ends_at, capacity: 3 },4)
    expect(capture.mock.lastCall?.[0]).toEqual({ slot: { ...original, ...input, version: 5 }, needsRefresh: false })
  })
  it('更新の応答を失ったら先に読み直し、完了したPOST・PUTを重ねない', async () => {
    const api = { createSlots: vi.fn().mockResolvedValue({ items: [original] }), listSlots: vi.fn().mockResolvedValue({ items: [{ ...original, ...input, version: 5 }] }), updateSlot: vi.fn().mockRejectedValue(new Error('応答喪失')) }
    let cached: InitialSlotCache | null = null
    const capture = (next: InitialSlotCache) => { cached = next }
    await expect(saveInitialSlot({ api, accountId: 'account-1', eventId: 'event-1', input, cached, capture })).rejects.toThrow('応答喪失')
    await saveInitialSlot({ api, accountId: 'account-1', eventId: 'event-1', input, cached, capture })
    expect(api.createSlots).toHaveBeenCalledOnce()
    expect(api.updateSlot).toHaveBeenCalledOnce()
    expect(api.listSlots).toHaveBeenCalledOnce()
  })
  it('更新失敗後に入力を変えても、読み直した新しい版で残りだけ送る', async () => {
    const api = { createSlots: vi.fn(), listSlots: vi.fn().mockResolvedValue({ items: [{ ...original, version: 7 }] }), updateSlot: vi.fn().mockResolvedValue({ ...original, ...input, version: 8 }) }
    await saveInitialSlot({ api, accountId: 'account-1', eventId: 'event-1', input, cached: { slot: original, needsRefresh: true }, capture: vi.fn() })
    expect(api.createSlots).not.toHaveBeenCalled()
    expect(api.updateSlot.mock.calls[0][4]).toBe(7)
  })
  it('版が無い・確認できない枠は更新せず、作成済みの記録を残す', async () => {
    const api = { createSlots: vi.fn().mockResolvedValue({ items: [{ ...original, version: undefined }] }), listSlots: vi.fn(), updateSlot: vi.fn() }
    const capture = vi.fn()
    await expect(saveInitialSlot({ api, accountId: 'account-1', eventId: 'event-1', input, cached: null, capture })).rejects.toThrow('版を確認できませんでした')
    expect(api.updateSlot).not.toHaveBeenCalled()
    expect(capture.mock.lastCall?.[0].needsRefresh).toBe(true)
  })
})
