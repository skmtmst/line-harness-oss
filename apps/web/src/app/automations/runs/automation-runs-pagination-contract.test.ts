import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

/*
 * R24 の画面の契約。limit=20・offset=0 固定へ戻すと赤くなる。
 */
describe('実行記録のページ送り（R24）', () => {
  it('共通のページ送りで21件目以降をたどれる', () => {
    expect(PAGE).toContain("from '@/components/shared/pagination'")
    expect(PAGE).toContain('<Pagination')
    expect(PAGE).toContain('pageCount={')
    expect(PAGE).toContain('onPageChange={setPage}')
  })

  it('読む位置を limit・offset で送る（先頭20件に固定しない）', () => {
    expect(PAGE).toContain("offset: String((page - 1) * RUNS_PAGE_SIZE)")
    expect(PAGE).not.toContain("offset: '0'")
  })

  it('条件を変えたら先頭のページへ戻す', () => {
    expect(PAGE).toContain('setPage(1)')
    expect(PAGE).toContain('changeResultFilter')
  })

  it('件数の表示は読んでいる範囲に合わせる', () => {
    expect(PAGE).toContain('data.pagination.offset + 1')
    expect(PAGE).toContain('data.pagination.offset + data.items.length')
  })
})
