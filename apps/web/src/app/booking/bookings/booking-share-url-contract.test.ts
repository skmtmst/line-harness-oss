import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const LIST = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

describe('予約URLの未設定案内', () => {
  it('API接続先の欠落とLIFF未設定で文言を分ける(点検#516軽4)', () => {
    // どちらもURLが作れないが、直す人が違う(管理者/アカウント設定)。混ぜると切り分けを誤る。
    expect(LIST).toContain('APIの接続先が設定されていません')
    expect(LIST).toContain('このアカウントには LIFF ID が未設定です')
    expect(LIST).toContain('!workerBase')
  })
})
