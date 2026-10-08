import { execFileSync } from 'node:child_process'
// @ts-expect-error JS fixture
import { REMINDER_NEW_PREVIEW } from './fixtures.mjs'
// @ts-expect-error JS tool
import { captureClockFor, storeYmd } from './qa-clock.mjs'
import { describe, expect, it } from 'vitest'

describe('ROOT-14 固定の時計と店舗のtimezone', () => {
  it('リマインダの見本も固定時刻を使い、特別な撮影時計の指定は残す', () => {
    expect(REMINDER_NEW_PREVIEW.items[0].scheduledAt).toBe('2026-10-02T09:00:00.000Z')
    expect(captureClockFor('/reminders', '2026-08-25T03:00:00.000Z')).toBe('2026-08-25T03:00:00.000Z')
    expect(storeYmd('2026-10-01T15:30:00Z', 'Asia/Tokyo')).toBe('2026-10-02')
  })
  it.each(['Asia/Tokyo', 'Asia/Ho_Chi_Minh', 'UTC'])('端末TZ=%sでも店舗の明日18時を生成する', TZ => {
    const script = `import { storeAt } from './scripts/visual-qa/qa-clock.mjs'; console.log(storeAt(18, 0, 1));`
    const value = execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, TZ }, encoding: 'utf8', timeout: 60000 }).trim()
    expect(value).toBe('2026-10-02T09:00:00.000Z')
  })
})
