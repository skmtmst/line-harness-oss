import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE_V7 = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const PAGE = [
  'page.tsx',
  'use-duplicates-data.ts',
  'duplicates-v8.tsx',
].map((name) => readFileSync(join(HERE, name), 'utf8')).join('\n')

/**
 * #984 LAY-12/16: 重複検出の表見出しと0件の件数表示。
 *
 * 見出しは共通の TableHeadRow/Th を通す（画面ごとの直書き th は残さない）。
 * 件数0のとき「0組中 1〜0組」と出していた回帰を防ぎ、
 * 検索で0件のときは解除の導線を必ず出す。
 */
describe('重複検出の表見出しと0件表示（#984 LAY-12/16）', () => {
  it('見出しは共通の TableHeadRow/Th を通す', () => {
    expect(PAGE_V7).toContain("import { TableHeadRow, Th } from '@/components/shared/table'")
    // ★V7: 表の中の状態行は TableStateRow に寄せる。見出しの共通化は変えない。
    expect(PAGE_V7).toContain("import { TableStateRow } from '@/components/shared/table'")
    expect(PAGE_V7).toContain('<TableHeadRow>')
    // v7 の表は共通部品。v8（duplicates-v8.tsx）は板どおりの CSS 表なので対象外。
    expect(PAGE_V7).not.toMatch(/<th\b/)
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

/**
 * R598: 集計（stats）だけ失敗しても候補一覧は残す。集計の失敗は集計欄の
 * 1行で伝えて再試行し、両方失敗のときだけ1枚の失敗にする。
 */
describe('集計失敗でも候補一覧を残す（R598）', () => {
  it('集計の失敗は集計欄の1行で出し、候補の表を残す', () => {
    expect(PAGE).toContain('DuplicatesStatsNotice')
    expect(PAGE).toContain('statsFailure')
    // 集計が無くても（!data）候補の表へ進む。1枚の失敗は両方失敗の条件だけ。
    expect(PAGE).toContain('!data && !candidatesLoading && candidates.length === 0 && candidateError')
    expect(PAGE).toContain('<DuplicatesStatsNotice failure={statsFailure} onRetry={() => load()} />')
  })

  it('捕まえた失敗を残し、403を権限の案内に言い分ける', () => {
    // 集計・候補とも catch の失敗をそのまま残す（loadFailureCopy が言い分ける）。
    expect(PAGE).toContain('setStatsFailure(err)')
    expect(PAGE).toContain('setCandidateFailure(err)')
    expect(PAGE).toContain('error={candidateFailure ?? undefined}')
  })

  it('集計が無いとき数値カードは「—」にし、内訳は出さない', () => {
    expect(PAGE).toContain('detail="読み込めませんでした"')
    // 内訳とマトリックスは集計があるときだけ。
    expect(PAGE.indexOf('{data ? (')).toBeGreaterThan(-1)
  })
})

/**
 * hn6Y8（B）：板の呼び方にそろえる。見直し・探す・比べて決める。
 */
describe('重複検出の板どおりの呼び方（hn6Y8）', () => {
  const V8 = readFileSync(join(HERE, 'duplicates-v8.tsx'), 'utf8')
  it('再検出は「もう一度見直す」', () => {
    expect(V8).toContain('もう一度見直す')
    expect(V8).not.toContain('重複を再検出')
  })
  it('検索は「名前・メール・電話で探す」', () => {
    expect(V8).toContain('名前・メール・電話で探す')
    expect(V8).not.toContain('名前・メール・電話で検索')
  })
  it('行の導線は「比べて決める」', () => {
    expect(V8).toContain('比べて決める')
  })
})
