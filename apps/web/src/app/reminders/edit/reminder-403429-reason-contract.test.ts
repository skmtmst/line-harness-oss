import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(HERE, 'issue469-reminder-screens.tsx'), 'utf8')

/**
 * D015: リマインダ編集の取得失敗は、403・429で理由が要る。
 * 403は権限の案内（再試行なし）、429は待ち案内（再試行あり）。
 * それ以外は画面の汎用文のまま。
 */
describe('D015 リマインダ編集の読み込み失敗', () => {
  it('403・429だけ共通理由へ切り替える目安を持つ', () => {
    expect(src).toContain('isForbiddenOrRateLimited')
    expect(src).toContain("loadFailureCopy(loadError, 'リマインダ')")
  })

  it('画面固有の汎用文を残す（403・429以外は画面の文のまま）', () => {
    expect(src).toContain('リマインダを読み込めませんでした')
  })
})
