import type { eventsApi, EventSlot, EventSlotInput } from '@/lib/api'

export type InitialSlotCache = { slot: EventSlot; needsRefresh: boolean }

/** 応答喪失も同じキーで再送。作成済みの枠は最新の版で更新し、重ねて作らない。 */
export async function saveInitialSlot({ api, accountId, eventId, input, cached, capture }: {
  api: Pick<typeof eventsApi, 'createSlots' | 'listSlots' | 'updateSlot'>
  accountId: string
  eventId: string
  input: EventSlotInput
  cached: InitialSlotCache | null
  capture: (cache: InitialSlotCache) => void
}) {
  let slot = cached?.slot
  if (slot && cached?.needsRefresh) {
    slot = (await api.listSlots(accountId, eventId)).items.find(row => row.id === slot!.id)
    if (!slot) throw new Error('作成済みの予約枠を確認できませんでした。入力は残っています。')
  }
  if (!slot) slot = (await api.createSlots(accountId, eventId, [input])).items[0]
  if (!slot?.id) throw new Error('予約枠の保存結果を確認できませんでした。')
  capture({ slot, needsRefresh: false })
  if (Date.parse(slot.starts_at) !== Date.parse(input.starts_at) || Date.parse(slot.ends_at) !== Date.parse(input.ends_at) || slot.capacity !== input.capacity) {
    if (!Number.isInteger(slot.version) || (slot.version ?? 0) < 1) {
      capture({ slot, needsRefresh: true })
      throw new Error('予約枠の版を確認できませんでした。入力を残して、もう一度確認してください。')
    }
    // 更新の応答を失ったときは、次の再試行で先に読み直す。古い版を再送しない。
    capture({ slot, needsRefresh: true })
    const updated = await api.updateSlot(accountId, eventId, slot.id, {
      starts_at: input.starts_at, ends_at: input.ends_at, capacity: input.capacity,
    }, slot.version!)
    capture({ slot: updated, needsRefresh: false })
  }
}
