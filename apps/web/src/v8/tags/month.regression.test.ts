import { afterEach, expect, it, vi } from 'vitest'
import { isThisMonth } from '@/components/friend-fields/tags-page-v4'
afterEach(() => vi.useRealTimers())
it('日本時間で同じ月の別日を含み、前月と前年を除く（WEB278）', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-09T00:00:00Z'))
  expect(isThisMonth('2026-09-30T15:00:00Z')).toBe(true)
  expect(isThisMonth('2026-10-03T00:00:00Z')).toBe(true)
  expect(isThisMonth('2026-09-30T14:59:59Z')).toBe(false)
  expect(isThisMonth('2025-10-03T00:00:00Z')).toBe(false)
})
