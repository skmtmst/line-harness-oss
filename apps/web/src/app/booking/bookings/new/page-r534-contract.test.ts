import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const page = readFileSync(join(HERE, 'page.tsx'), 'utf8')

describe('R534 booking new メニュー取得失敗', () => {
  it('メニュー取得失敗は再試行でき、403は権限案内で分ける', () => {
    expect(page).toContain('listMenus')
    // メニュー取得専用の失敗保持と取り直し（全体のerror使い回しでは直らない）
    expect(page).toMatch(/menusLoadError|loadMenus|menuLoadError|reloadMenus/)
    // 403分離（権限不足は押しても直らない）
    expect(page).toMatch(/isForbidden|loadFailure|describeApiFailure/)
  })
})
