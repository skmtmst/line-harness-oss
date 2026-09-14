import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error 画面確認用のスクリプトは素のJS。型定義は持たない。
import { AUTOMATION_RUNS } from '../../../../../../scripts/visual-qa/fixtures.mjs'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
/**
 * 実口のソース。**画面と同じ形を返しているか**を突き合わせるために読む(#735)。
 *
 * ここを `toContain` で片側だけ見ていたころは、実口のキー名や状態の写像を
 * 変えても**この試験は緑のままだった**(#735 の証拠節)。片側に文字列がある
 * ことではなく、**両側が同じ形であること**を見る。
 */
const ROUTE = readFileSync(
  new URL('../../../../../worker/src/routes/automations.ts', import.meta.url),
  'utf8',
)

/** `type X = { ... }` / `const X: Record<..> = { ... }` の直下のキーを拾う。 */
function keysOfBlock(source: string, opener: string): string[] {
  const start = source.indexOf(opener)
  if (start < 0) throw new Error(`見つからない: ${opener}`)
  let depth = 0
  let end = -1
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') { depth -= 1; if (depth === 0) { end = i; break } }
  }
  if (end < 0) throw new Error(`閉じ括弧が見つからない: ${opener}`)
  const body = source.slice(source.indexOf('{', start) + 1, end)
  // 入れ子の中身は数えない(直下のキーだけ)。
  const flat = body.replace(/\{[^{}]*\}/g, '')
  return [...flat.matchAll(/^\s*'?\"?([\w.]+)'?\"?\s*:/gm)].map((m) => m[1])
}

describe('V6 オートメーションが動いた記録（DkPY0）', () => {
  it('実ノードと既存の実行記録APIを結ぶ', () => {
    expect(PAGE).toContain('data-design-node="DkPY0"')
    expect(PAGE).toContain('/api/automation-runs?')
    expect(PAGE).toContain("params.set('lineAccountId', selectedAccountId)")
    expect(PAGE).toContain("params.set('search', query.trim())")
    expect(PAGE).toContain("params.set('status', resultFilter)")
  })

  it('設計の4指標・検索・絞り込み・列を持つ', () => {
    for (const word of [
      'この30日に動いた',
      'いちばん動いた',
      '失敗した',
      '条件に外れて動かなかった',
      '友だちの名前・オートメーションの名前で検索',
      'いつ・だれに',
      'したこと',
      'かかった時間',
    ]) expect(PAGE).toContain(word)
  })

  it('読込・空・絞込0件・失敗を区別する', () => {
    expect(PAGE).toContain("'loading' | 'ready' | 'error'")
    expect(PAGE).toContain('動いた記録を読み込んでいます')
    expect(PAGE).toContain('動いた記録はまだありません')
    expect(PAGE).toContain('条件に合う記録はありません')
    expect(PAGE).toContain('動いた記録を読み込めませんでした')
  })

  it('詳細を開き、失敗した処理だけを安全な再実行口へ接続する', () => {
    expect(PAGE).toContain('もう一度やる')
    expect(PAGE).toContain('/api/automation-runs/${encodeURIComponent(run.id)}/retry')
    expect(PAGE).toContain('成功済みの処理は二重に実行しません')
    expect(PAGE).toContain('失敗した処理をもう一度やる')
    expect(PAGE).toContain('CSV書き出しは未接続')
    expect(PAGE).toContain('<Button disabled>CSVで書き出す</Button>')
    expect(PAGE).toContain('setSelectedRun(run)')
    expect(PAGE).toContain('実行記録の中身')
    expect(PAGE).toContain('成功済みの処理を二重に動かさないため')
  })

  it('壊れた応答を描画せず取得失敗へ倒す', () => {
    expect(PAGE).toContain('!response.data.summary')
    expect(PAGE).toContain('!Array.isArray(response.data.items)')
    expect(PAGE).toContain('実行記録の応答形式が正しくありません')
  })

  it('検索の連打で古い応答が新しい表示を上書きしない (#580)', () => {
    expect(PAGE).toContain('loadGeneration.current')
    expect(PAGE).toContain('generation !== loadGeneration.current')
    expect(PAGE).toContain('setTimeout(() => void load(), 400)')
  })

  it('変えられない表示条件は選択肢に見せない (#580)', () => {
    expect(PAGE).toContain('この30日・20件表示')
    expect(PAGE).not.toContain('onChange={() => undefined}')
  })
})

/*
 * ここから下は**形の突合**(#735)。
 *
 * 上の表明は「画面のコードにこの文字列があるか」を見るもので、**実口が別の形を
 * 返し始めても気づけない**。実際、サーバーの状態写像を取り違える逆変異
 * (`COMMON_STATUS_TO_DOMAIN.succeeded` を `['failed']` にする)も、応答のキー名を
 * 取り違える逆変異(`mostRunName` → `mostRunLabel`)も、**この試験は緑のまま**だった。
 *
 * 上の表明は消していない。あちらは画面側にしか無いもの(設計ノード・文言・連打
 * 対策・再実行の注意書き)を見張っていて、突合では代わりにならない。
 */
describe('#735 実行記録の形が、画面・実口・見本で揃っている', () => {
  it('集計のキーが、画面の型と実口の応答と見本で一致する', () => {
    const screen = keysOfBlock(PAGE, 'type RunsResponse = {').filter((k) => k !== 'summary')
    const screenSummary = keysOfBlock(PAGE.slice(PAGE.indexOf('type RunsResponse')), 'summary: {')
    const routeSummary = keysOfBlock(ROUTE.slice(ROUTE.indexOf('const body: AutomationExecutionRunsResponse')), 'summary: {')
    const fixtureSummary = Object.keys((AUTOMATION_RUNS as { summary: Record<string, unknown> }).summary)
    expect(screenSummary.length).toBeGreaterThan(0)
    expect([...routeSummary].sort()).toEqual([...screenSummary].sort())
    expect([...fixtureSummary].sort()).toEqual([...screenSummary].sort())
    // 画面の型の直下(items / pagination)も落ちていないこと。
    expect(screen).toEqual(expect.arrayContaining(['items', 'pagination']))
  })

  it('画面が知っている状態だけを実口が返す', () => {
    const screenStatuses = [...PAGE.matchAll(/type RunStatus = ([^\n]+)/g)][0][1]
      .split('|').map((s) => s.trim().replace(/'/g, ''))
    const routeCommon = keysOfBlock(ROUTE, 'const COMMON_STATUS_TO_DOMAIN')
    const routeToCommonValues = [...ROUTE.slice(ROUTE.indexOf('const DOMAIN_STATUS_TO_COMMON'))
      .slice(0, ROUTE.slice(ROUTE.indexOf('const DOMAIN_STATUS_TO_COMMON')).indexOf('};'))
      .matchAll(/:\s*'([\w_]+)'/g)].map((m) => m[1])
    expect([...routeCommon].sort()).toEqual([...screenStatuses].sort())
    // 実口が画面の知らない状態を返さないこと。
    expect([...new Set(routeToCommonValues)].filter((s) => !screenStatuses.includes(s))).toEqual([])
  })

  it('状態の写像が往復して元に戻る', () => {
    const toDomain = Object.fromEntries(
      [...ROUTE.slice(ROUTE.indexOf('const COMMON_STATUS_TO_DOMAIN'))
        .slice(0, ROUTE.slice(ROUTE.indexOf('const COMMON_STATUS_TO_DOMAIN')).indexOf('};'))
        .matchAll(/^\s*([\w_]+):\s*\[([^\]]+)\]/gm)]
        .map((m) => [m[1], m[2].split(',').map((s) => s.trim().replace(/'/g, ''))]),
    ) as Record<string, string[]>
    const toCommon = Object.fromEntries(
      [...ROUTE.slice(ROUTE.indexOf('const DOMAIN_STATUS_TO_COMMON'))
        .slice(0, ROUTE.slice(ROUTE.indexOf('const DOMAIN_STATUS_TO_COMMON')).indexOf('};'))
        .matchAll(/^\s*([\w_]+):\s*'([\w_]+)'/gm)]
        .map((m) => [m[1], m[2]]),
    ) as Record<string, string>
    expect(Object.keys(toDomain).length).toBeGreaterThan(0)
    /*
     * 「動いたもので絞ったのに、失敗したものが出る」を止める。
     * 絞り込み(common→domain)で選んだ domain を、表示(domain→common)へ
     * 通したら、元の common に戻らなければならない。
     */
    const broken = Object.entries(toDomain).flatMap(([common, domains]) =>
      domains.filter((domain) => toCommon[domain] !== common).map((domain) => `${common}→${domain}→${toCommon[domain]}`))
    expect(broken).toEqual([])
  })

  it('見本の実行記録が、画面の型どおりの形を持つ', () => {
    const screenRun = keysOfBlock(PAGE, 'type AutomationRun = {')
    const fixtureRun = Object.keys((AUTOMATION_RUNS as { items: Record<string, unknown>[] }).items[0])
    expect(screenRun.length).toBeGreaterThan(0)
    // 画面が読むキーは、見本にすべて入っていること(見本が足りないと空欄で撮れてしまう)。
    expect(screenRun.filter((k) => !fixtureRun.includes(k))).toEqual([])
  })
})
