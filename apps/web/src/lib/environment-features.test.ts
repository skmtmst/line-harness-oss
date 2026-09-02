import { afterEach, describe, expect, it, vi } from 'vitest'
import { restaurantTestUiEnabled } from './environment-features'

describe('管理画面の環境限定機能', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('環境変数が未設定なら表示しない', () => {
    vi.stubEnv('NEXT_PUBLIC_RESTAURANT_TEST_ENABLED', '')
    expect(restaurantTestUiEnabled()).toBe(false)
  })

  it.each(['', 'false', '0', 'yes'])(
    '明示的なtrue以外では飲食店テストを表示しない: %s',
    (value) => expect(restaurantTestUiEnabled(value)).toBe(false),
  )

  it.each(['true', 'TRUE', ' true '])('明示的なtrueだけ表示する: %s', (value) => {
    expect(restaurantTestUiEnabled(value)).toBe(true)
  })
})
