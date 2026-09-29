import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

/** #975 U070: イベント未指定のときは一覧へ戻る入口を出す。 */
describe('イベント申込の選び直し（#975 U070）', () => {
  it('未指定はエラー文字だけでなく一覧への入口を出す', () => {
    expect(PAGE).toContain('どのイベントの申込かが決まっていません')
    expect(PAGE).toContain('イベント一覧へ戻る')
    expect(PAGE).toContain('href="/events"')
  })
})
