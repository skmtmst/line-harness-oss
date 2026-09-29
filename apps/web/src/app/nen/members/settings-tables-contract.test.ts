import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const RANK = readFileSync(join(HERE, 'rank-settings-tab.tsx'), 'utf8')
const LIFETIME = readFileSync(join(HERE, 'lifetime-tab.tsx'), 'utf8')
const MEMBERS = readFileSync(join(HERE, 'members-tab.tsx'), 'utf8')

/**
 * R55: 会員の設定表が1440px・768pxで重なって読めない。
 * 会員一覧と同じ形（@container＋谷間帯の列削減＋1行省略＋title）で守る。
 * 幅の前提：768pxではサイドバーなし（表幅688）・1440pxでは2/3幅（表幅741）。
 * タグ見出しは約115px要る。戻すと赤くなるよう、畳まない列の固定幅に
 * 上限を置く（数字は「狭い表でも残す列が収まる」ための予算）。
 */

/** thead内の w-NN をpxに直して合計する。 */
function fixedHeadWidths(source: string): number {
  const head = source.slice(source.indexOf('<thead>'), source.indexOf('</thead>'))
  return [...head.matchAll(/\bw-(\d+)\b/g)]
    .reduce((sum, match) => sum + Number(match[1]) * 4, 0)
}

/**
 * cq-hide-below-* が付くThとTdの組が同じ数だけある（片方だけ畳まない）。
 * 行が別関数（会員一覧のMemberRow）のときは bodyFrom で探す起点を変える。
 */
function hiddenPairs(source: string, marker: string, bodyFrom = '<tbody>'): { th: number; td: number } {
  const head = source.slice(source.indexOf('<thead>'), source.indexOf('</thead>'))
  const body = source.slice(source.indexOf(bodyFrom))
  const th = (head.match(new RegExp(`<Th[^>]*${marker}`, 'g')) ?? []).length
  const td = (body.match(new RegExp(`<Td[^>]*${marker}`, 'g')) ?? []).length
  return { th, td }
}

describe('R55 会員設定表の重なり', () => {
  it('ランク設定表は表幅で列を畳み、畳まない列は予算に収める', () => {
    /*
     * m18s: 器（@container）は区画に置き、表の枠には付けない。表の幅（100%）
     * がサイズ封じ込めの中で決まると、枠いっぱいに広がらず右側が空く
     * （1440pxで帯と区切り線が約912pxで止まった）。区画に余白はなく枠と
     * 同幅のため、会員数を畳む境目（800）は変わらない。戻すと赤。
     */
    expect(RANK).toContain('@container min-w-0 xl:col-span-2')
    expect(RANK).not.toContain('<DataTable className="@container">')
    // 操作列は固定幅・右寄せで表の右端に付く。戻すと赤。
    expect(RANK).toContain('<Th className="w-14" align="right">')
    // 会員数だけを狭い表で畳む。ThとTdの組が一致する。
    const pairs = hiddenPairs(RANK, 'cq-hide-below-800')
    expect(pairs.th).toBe(1)
    expect(pairs.td).toBe(1)
    // 畳まない固定列の合計（600）が、741pxの表でタグ見出し115pxを残せる。
    // 戻す（680）と赤くなる。
    expect(fixedHeadWidths(RANK)).toBeLessThanOrEqual(600)
  })

  it('ライフタイム表は2段階で畳み、説明文は省略＋titleで読める', () => {
    expect(LIFETIME).toContain('<DataTable className="@container">')
    const narrow = hiddenPairs(LIFETIME, 'cq-hide-below-1010')
    expect(narrow.th).toBe(1)
    expect(narrow.td).toBe(1)
    const narrower = hiddenPairs(LIFETIME, 'cq-hide-below-800')
    expect(narrower.th).toBe(1)
    expect(narrower.td).toBe(1)
    // 畳むまでの間は説明文が隣へ重ならない。
    expect(LIFETIME).toContain('truncate')
    expect(LIFETIME).toContain('title="限定グッズは決まり次第ここで設定します"')
  })
})

/*
 * m18s: 3表とも「幅を固定しない列は1つだけ・隠す列はThとTdの両方を消す」
 * の形にする。固定列の合計＋吸収列＝表の幅になるため、1440px・1152px・
 * 1920px のどの幅でも見出しの帯と行の線が右端まで届く。幅の決め方は
 * 幅によらない（器の判定だけが幅で変わる）ため、文字どおりの構造で守る。
 * 戻すと赤。
 */

/** 最初の行のTdのclassを順に取り出す（colSpanの行は除く）。 */
function firstRowTdClasses(source: string, from = '<tbody>'): Array<string | null> {
  const body = source.slice(source.indexOf(from))
  const row = body.slice(body.indexOf('<Tr'), body.indexOf('</Tr>'))
  return [...row.matchAll(/<Td([^>]*)>/g)].map((match) =>
    /className="([^"]*)"/.exec(match[1])?.[1] ?? null,
  )
}

/** 幅クラス（w-NN）だけを取り出す。無い列は吸収列。 */
function widthOf(className: string | null): string | null {
  return className === null ? null : (/\bw-\d+\b/.exec(className)?.[0] ?? null)
}

describe('m18s 3表とも列幅の合計が表の幅になる', () => {
  it('ランク表はタグの1列だけが残りを受け取る', () => {
    const widths = firstRowTdClasses(RANK)
    expect(widths).toEqual(['w-44', 'w-40', 'w-28', null, 'cq-hide-below-800 w-24', 'w-14'])
    // タグ以外の幅は見出しと行で同じ。幅指定なしはタグだけ。
    expect(widthOf(widths[3])).toBeNull()
    expect(widths.filter((w) => widthOf(w) === null)).toHaveLength(1)
  })

  it('ライフタイム表は特典の1列だけが残りを受け取る', () => {
    const widths = firstRowTdClasses(LIFETIME)
    expect(widths).toEqual(['w-52', 'w-56', 'cq-hide-below-800', 'cq-hide-below-1010 w-28', 'w-44', 'w-14'])
    expect(widths.filter((w) => widthOf(w) === null)).toHaveLength(1)
  })

  it('会員一覧表はペットの1列だけが残りを受け取る', () => {
    const widths = firstRowTdClasses(MEMBERS, 'function MemberRow')
    expect(widths).toEqual([
      'w-72',
      'w-28',
      'w-32',
      'w-32',
      'w-28',
      null,
      'cq-hide-below-1120 w-28',
      'cq-hide-below-1010 w-24',
      'bg-canvas sticky right-0 w-16',
    ])
    expect(widths.filter((w) => widthOf(w) === null)).toHaveLength(1)
  })

  it('隠す列はThとTdの両方を消す（片方だけ残さない）', () => {
    for (const [name, source, marker, bodyFrom] of [
      ['ranks', RANK, 'cq-hide-below-800', undefined],
      ['lifetime-benefit', LIFETIME, 'cq-hide-below-800', undefined],
      ['lifetime-reached', LIFETIME, 'cq-hide-below-1010', undefined],
      ['members-last', MEMBERS, 'cq-hide-below-1120', 'function MemberRow'],
      ['members-rate', MEMBERS, 'cq-hide-below-1010', 'function MemberRow'],
    ] as const) {
      const pairs = hiddenPairs(source, marker, bodyFrom)
      expect({ name, ...pairs }).toEqual({ name, th: 1, td: 1 })
    }
  })
})
