/* LINE の予約画面の時刻は先頭の0を落とす（絵 d5fmnM・E3YDK）。 */
import { describe, expect, it } from 'vitest'
import { phoneTime } from './phone'

describe('phoneTime', () => {
  it('1桁の時は先頭の0を落とす', () => {
    expect(phoneTime('09:00')).toBe('9:00')
    expect(phoneTime('00:30')).toBe('0:30')
  })

  it('2桁の時と分の0はそのまま', () => {
    expect(phoneTime('10:00')).toBe('10:00')
    expect(phoneTime('21:05')).toBe('21:05')
  })
})
