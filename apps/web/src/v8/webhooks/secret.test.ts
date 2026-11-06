/*
 * src/v8/webhooks/secret.ts の試験。元の app/webhooks/secret.test.ts と同じ中身
 * （2026-10-06 に写した。元の試験は切り替えの日まで残す）。中身を変えるときは両方を直す。
 */
import { describe, expect, it } from 'vitest'

import { MIN_SECRET_LENGTH, generateSecret } from './secret'

describe('外部連携の秘密値づくり(#506 軽)', () => {
  it('口側の下限32文字を満たす', () => {
    expect(MIN_SECRET_LENGTH).toBe(32)
    for (let i = 0; i < 10; i += 1) {
      const secret = generateSecret()
      expect(secret.length).toBeGreaterThanOrEqual(32)
      expect(secret).toMatch(/^[0-9a-f]+$/)
    }
  })

  it('呼ぶたび違う値になる', () => {
    expect(generateSecret()).not.toBe(generateSecret())
  })
})
