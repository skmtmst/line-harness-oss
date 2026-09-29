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
