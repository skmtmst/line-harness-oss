import { describe, expect, it } from 'vitest'
import { canReturnToHqFrom } from './hq-return'

describe('統括へ戻れるか（上の帯の切り替えと左下の自分のメニューで共通）', () => {
  it('店の画面のオーナー・管理者だけ', () => {
    expect(canReturnToHqFrom('owner', '/friends', false)).toBe(true)
    expect(canReturnToHqFrom('admin', '/', false)).toBe(true)
    expect(canReturnToHqFrom('staff', '/friends', false)).toBe(false)
    expect(canReturnToHqFrom('viewer', '/friends', false)).toBe(false)
    expect(canReturnToHqFrom('', '/friends', false)).toBe(false)
    expect(canReturnToHqFrom(null, '/friends', false)).toBe(false)
  })

  it('統括の画面（/hq の下・統括の殻）では出さない', () => {
    expect(canReturnToHqFrom('owner', '/hq', false)).toBe(false)
    expect(canReturnToHqFrom('owner', '/hq/members', false)).toBe(false)
    expect(canReturnToHqFrom('owner', '/accounts/new', true)).toBe(false)
  })
})
