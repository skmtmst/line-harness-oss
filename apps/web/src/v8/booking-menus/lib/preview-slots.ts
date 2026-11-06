import type { BookingAvailabilitySlot } from '@/lib/api'

/**
 * 指名なしの空き：担当ごとの枠を日時で合わせ、どれか1人でも空いていれば空き。
 * LIFF で「指名なし」を選んだときと同じ見え方にする。
 */
export function mergeStaffSlots(byStaff: Array<{ slots?: BookingAvailabilitySlot[] }>): BookingAvailabilitySlot[] {
  const merged = new Map<string, BookingAvailabilitySlot>()
  for (const person of byStaff) {
    for (const slot of person.slots ?? []) {
      const key = `${slot.date} ${slot.start}`
      const current = merged.get(key)
      if (!current || (slot.remaining ?? 0) > (current.remaining ?? 0)) merged.set(key, slot)
    }
  }
  return [...merged.values()].sort((a, b) => (a.date === b.date ? a.start.localeCompare(b.start) : a.date.localeCompare(b.date)))
}
