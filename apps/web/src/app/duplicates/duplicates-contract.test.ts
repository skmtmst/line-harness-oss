import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')

/**
 * #984 LAY-12/16: 重複検出の表見出しと0件の件数表示。
 *
 * 見出しは共通の TableHeadRow/Th を通す（画面ごとの直書き th は残さない）。
 * 件数0のとき「0組中 1〜0組」と出していた回帰を防ぎ、
 * 検索で0件のときは解除の導線を必ず出す。
 */
describe('重複検出の表見出しと0件表示（#984 LAY-12/16）', () => {
  it('見出しは共通の TableHeadRow/Th を通す', () => {
    expect(PAGE).toContain("import { TableHeadRow, Th } from '@/components/shared/table'")
    // ★V7: 表の中の状態行は TableStateRow に寄せる。見出しの共通化は変えない。
    expect(PAGE).toContain("import { TableStateRow } from '@/components/shared/table'")
    expect(PAGE).toContain('<TableHeadRow>')
    expect(PAGE).not.toMatch(/<th\b/)
  })

  it('候補が0件のとき「1〜0組」を出さない', () => {
    expect(PAGE).toContain('candidateTotal === 0')
    expect(PAGE).toContain("'0組'")
    expect(PAGE).not.toContain('1〜0')
  })

  it('検索で0件のとき解除の導線を出す', () => {
    expect(PAGE).toContain('検索条件に合う候補はありません')
    expect(PAGE).toContain('検索条件を解除する')
    expect(PAGE).toContain("setQuery(''); setStatus('')")
  })
})

/**
 * #1011 FRIEND-11/12: 候補は51件目以降へも辿れるように、ページ送りと
 * サーバー側検索を持つ。「すべて」は全状態を見る。失敗は0件と区別し、
 * 状態切替の先行応答が後から届いても採用しない。
 */
describe('重複候補の全件到達と応答の新旧管理（#1011 FRIEND-11/12）', () => {
  it('ページ送りとサーバー側の検索・状態絞り込みを持つ', () => {
    expect(PAGE).toContain("import Pagination from '@/components/shared/pagination'")
    expect(PAGE).toContain('offset: (page - 1) * CANDIDATE_PAGE_SIZE')
    expect(PAGE).toContain('q: debouncedQuery.trim() || undefined')
    // 「すべて」は status を送って全状態を見る（pending固定ではない）。
    expect(PAGE).toContain("status: (status || 'all')")
  })

  it('集計は読み込んだ1ページ分ではなく全件の件数を出す', () => {
    expect(PAGE).toContain('statusCounts')
    expect(PAGE).toContain('lowConfidenceCount')
  })

  it('条件を変えたら1ページ目へ戻り、検索入力はdebounceする', () => {
    expect(PAGE).toContain('setPage(1)')
    expect(PAGE).toContain('[debouncedQuery, status]')
    expect(PAGE).toContain('setDebouncedQuery(query)')
  })

  it('失敗を0件と区別し、古い応答を採用しない', () => {
    expect(PAGE).toContain('candidateError')
    expect(PAGE).toContain('候補一覧を読み込めませんでした')
    // 世代番号と条件キーの両方で応答を照合する。
    expect(PAGE).toContain('candidatesReqRef.current')
    expect(PAGE).toContain('candidatesKeyRef.current !== key')
    // 失敗時は件数表示へ進まず、読み込み待ちを0件と誤認させない。
    expect(PAGE.indexOf('candidateError ?')).toBeLessThan(PAGE.indexOf('candidateTotal === 0 && !candidatesLoading'))
  })
})
