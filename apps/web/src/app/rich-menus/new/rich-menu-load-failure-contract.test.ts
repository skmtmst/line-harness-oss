import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
/* 作るの v7 本体は 2026-10-05 に撤去。読み込みは `create-v8` が担う。 */
const page = readFileSync(join(HERE, 'create-v8.tsx'), 'utf8')

describe('rich-menus/new 5種の読み込み失敗', () => {
  it('5種の取得失敗を理由つきで出し、同じ条件で読み直せる', () => {
    for (const token of ['folders', 'tags', 'templates', 'forms', 'trackedLinks']) {
      expect(page, `候補 ${token}`).toContain(token)
    }
    // 失敗の理由＋読み直しの口
    expect(page).toMatch(/onRetry|load\(\)|reload|もう一度|再読み込み/)
    expect(page).toMatch(/describeApiFailure|loadFailure|isForbiddenOrRateLimited|isForbidden|権限|混み合/)
  })
})
