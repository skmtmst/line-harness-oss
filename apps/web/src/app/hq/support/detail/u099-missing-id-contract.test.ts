import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'),
  'utf8',
)

/*
 * #975 U099: /hq/support/detail に id なしで開くと、取得が走らず
 * 「読み込んでいます…」のまま止まった。
 * id は3値（undefined=未確定 / null=idなし / 文字列）で持ち、
 * id なしが確定したら案内と一覧へ戻る導線を出す。
 */
describe('問い合わせ詳細の id なし（#975 U099）', () => {
  it('id がないときは読み込みのままにせず案内を出す', () => {
    expect(PAGE).toContain('useState<string | null | undefined>(undefined)')
    expect(PAGE).toContain('idMissing = id === null')
    expect(PAGE).toContain('idMissing ? (')
    expect(PAGE).toContain('開くお問い合わせが指定されていません')
    // 戻り先は ★V7 TargetMissing の backHref が持つ。
    expect(PAGE).toContain('backHref="/hq/support"')
    expect(PAGE).toContain('問い合わせの一覧へ戻る')
  })

  it('id があるときだけ詳細を取得する', () => {
    expect(PAGE).toContain('if (id === undefined) return')
    expect(PAGE).toContain('if (id) void load(id)')
  })
})
