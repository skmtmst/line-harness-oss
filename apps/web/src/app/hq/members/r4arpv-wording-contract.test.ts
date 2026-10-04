import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const DIR = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(DIR, 'page.tsx'), 'utf8')

/** 統括メンバーの役割の凡例（板 `r4ARpV`）の歯止め。 */
describe('r4ARpV 役割の凡例', () => {
  it('表の下に4つの役割のできることを出す', () => {
    expect(PAGE).toContain('役割：統括（請求・メンバーまで全部）／管理者／担当者（担当範囲のアカウントだけ）／閲覧のみ（見るだけ）')
  })
})
