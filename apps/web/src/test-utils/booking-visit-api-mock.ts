import { vi } from 'vitest'

/** 旧予約試験も、現役の人の来店印の読み口を持つ（印なしの既定）。 */
export function bookingVisitApiMock() {
  return {
    getToday: vi.fn(async () => ({ bookings: [], seats: [], timeline: [] })),
    postVisitMark: vi.fn(),
    deleteVisitMark: vi.fn(),
  }
}
