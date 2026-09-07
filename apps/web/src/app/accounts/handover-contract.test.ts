import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'handover/page.tsx'), 'utf8')

/**
 * 乗り換え・引き継ぎ（設計 ★V6 33-4 `nx3XW`）。点検 #496 の項目3・10。
 *
 * **「本実行へ進む」は確認窓つきで本実行の口へつながる**こと。
 * 決め残しがある間は押せない。
 */
describe('V6 33-4 乗り換えの本実行', () => {
  it('本実行の口へ確認窓つきでつなぐ', () => {
    expect(PAGE).toContain('api.accountHandovers.execute')
    expect(PAGE).toContain('ConfirmDialog')
    expect(PAGE).toContain('本実行しますか？')
  })

  it('押しても何も起きないボタンを残さない', () => {
    expect(PAGE).not.toMatch(/<Button[^>]*>\s*本実行へ進む\s*<\/Button>/)
    expect(PAGE).toContain('setConfirmOpen(true)')
  })

  it('決め残しがある間は押せない', () => {
    expect(PAGE).toContain('disabled={(handover.unresolvedReviews ?? 1) > 0}')
  })

  it('実行ずみの再実行は口側の409をそのまま見せる', () => {
    expect(PAGE).toContain('setExecuteError(result.error)')
  })

  it('実行の結果と失敗をはっきり言う', () => {
    expect(PAGE).toContain('本実行が終わりました')
    expect(PAGE).toContain('role="status"')
    expect(PAGE).toContain('role="alert"')
  })
})
