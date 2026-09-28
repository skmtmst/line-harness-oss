import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * 一斉配信の一覧の崩れ止め（m20i）。
 *
 * 1440pxの撮影で見つかった3つの崩れを、文字の検査で守る。
 * 幅の確認そのものは司令塔が撮影で行う。ここでは崩れの原因
 * （列幅の足し算・札の重なり・折れる条件文）を固定する。
 *
 * - 表の枠が8px横に送れ、「…」が枠の端で切れかけていた
 * - 「承認待ち」の札が2つ縦に並び、「?」が下へはみ出していた
 * - 「タグ：NEN会員（定期）」が3行に折れて行が高くなっていた
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const TABLE_CSS = readFileSync(
  join(HERE, '..', '..', 'components', 'shared', 'data-table.module.css'),
  'utf8',
)

/** `start` と `end` にはさまれた中身だけを返す。 */
function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  expect(from, `${start} が見つかりません`).toBeGreaterThan(-1)
  const to = source.indexOf(end, from)
  expect(to, `${end} が見つかりません`).toBeGreaterThan(from)
  return source.slice(from + start.length, to)
}

const THEAD = between(PAGE, '<thead>', '</thead>')
const TBODY = between(PAGE, '<tbody>', '</tbody>')

describe('一斉配信の一覧の幅（m20i・その1）', () => {
  it('共通の表が table-fixed で、列幅どおりに敷く', () => {
    // table-fixed でないと、中身の長い行が列幅を押し広げて枠をはみ出す。
    expect(TABLE_CSS, '共通表が table-fixed でない').toContain('table-layout: fixed')
  })

  it('操作列は固定幅（px）で、詳細＋…が収まる', () => {
    // % だと狭い帯で100pxを切り、中身（詳細約56＋間8＋…32＋余白24）が
    // 右へはみ出して枠が横に送れていた。★V7：操作列は固定幅。
    // 右端の余白は共通の12px（詰めない）。中身90＋余白24＝114に収まる幅にする。
    const opHead = THEAD.match(/<Th style=\{\{\s*width:\s*(\d+)\s*\}\}[^>]*>\s*操作/)
    expect(opHead, '操作列の固定幅が無い').not.toBeNull()
    const opWidth = Number((opHead as RegExpMatchArray)[1])
    expect(opWidth, '操作列が狭く中身がはみ出す').toBeGreaterThanOrEqual(114)
    expect(opWidth, '操作列が広すぎて結果が潰れる').toBeLessThanOrEqual(124)
    expect(THEAD, '操作列に % が残っている').not.toMatch(/操作[\s\S]{0,80}width:\s*'\d+%/)
  })

  it('% の列と操作列の固定幅を足してもいちばん狭い帯に収まる', () => {
    // いちばん狭い帯は1280px時の表（約700px）。ここに収まれば
    // 1152px（表約800px）・1440px（表約835px）でも横に送れない。
    const percents = [...THEAD.matchAll(/width:\s*'(\d+)%'/g)].map((m) => Number(m[1]))
    expect(percents.length, '% の列が見つかりません').toBeGreaterThan(0)
    const percentSum = percents.reduce((n, v) => n + v, 0)
    const op = THEAD.match(/width:\s*(\d{3})/)
    expect(op, '操作列の固定幅が見つかりません').not.toBeNull()
    const narrowest = 700
    expect(
      (percentSum / 100) * narrowest + Number((op as RegExpMatchArray)[1]),
      `% の合計 ${percentSum}＋操作列では700pxの帯に収まらない`,
    ).toBeLessThanOrEqual(narrowest - 2)
  })

  it('操作列は右端に留まり、中身は右へ寄せる', () => {
    // #768 の sticky が無いと、表が横に流れる帯で操作が見えなくなる。
    // 固定幅で余るぶんを左へ空けると「…」が浮くので右へ寄せる。
    expect(THEAD, '見出しの sticky が無い').toContain('sticky right-0')
    expect(TBODY, '操作セルの sticky が無い').toContain('sticky right-0')
    expect(TBODY, '操作の中身を右へ寄せていない').toContain('justify-end')
  })
})

describe('一斉配信の一覧の状態の札（m20i・その2）', () => {
  it('同じ言葉の札は2つ出さず、承認の札1つにする', () => {
    // 状態の札（承認待ち）と承認の札（承認待ち）が縦に2つ並び、
    // 「?」が下へはみ出していた。言葉が同じ組み合わせだけ1つにする。
    expect(PAGE, '重なりの見分けが無い').toContain('approvalDuplicatesStatus')
    expect(PAGE, '承認待ちの重なりを見ていない').toContain("broadcast.displayStatus === 'pending_approval'")
    expect(PAGE, '期限切れの重なりを見ていない').toContain("broadcast.displayStatus === 'expired'")
  })

  it('1つにした札と「?」は同じ高さで横に並べ、折り返さない', () => {
    // 「?」が下へ回ると行が高くなり、はみ出して見える。
    const dupBranch = between(PAGE, 'approvalDuplicatesStatus ? (', ': (')
    expect(dupBranch, '重なり側に承認の札が無い').toContain('<ApprovalBadge')
    expect(dupBranch, '重なり側に状態の札が残っている').not.toContain('statusInfo.label')
    expect(dupBranch, '重なり側が折り返す').not.toContain('flex-wrap')
    expect(dupBranch, '重なり側が1行になっていない').toContain('whitespace-nowrap')
  })
})

describe('一斉配信の一覧の配信条件の幅（m20i・その3）', () => {
  it('1440pxで「友だち全員」は全文、タグ名は8文字以上見える', () => {
    // 条件列が15%だとタグ名が4文字しか見えなかった。タイトルと
    // 結果を詰めたぶんを条件へ回し、1440px（表約835px）で読める幅にする。
    const condHead = THEAD.match(/<Th style=\{\{\s*width:\s*'(\d+)%'\s*\}\}[^>]*>\s*配信条件/)
    expect(condHead, '配信条件の列幅が無い').not.toBeNull()
    const condPercent = Number((condHead as RegExpMatchArray)[1])
    expect(condPercent, '配信条件が狭く中身が読めない').toBeGreaterThanOrEqual(19)
    // 「タグ：」＋タグ名8文字分（約127px）＋余白24が1440pxの表に収まる。
    expect(
      (condPercent / 100) * 835 - 24,
      `配信条件 ${condPercent}% では1440pxでタグ名8文字が見えない`,
    ).toBeGreaterThanOrEqual(120)
  })

  it('見出しは短い「結果」で、中身の3行はそのまま', () => {
    // 見出しが「配信・開封・クリック」だと「クリッ」で切れていた。
    expect(THEAD, '見出しが長いまま').toContain('結果')
    expect(THEAD, '長い見出しが残っている').not.toContain('配信・開封・クリック')
  })

  it('率は数字と同じ行に置く', () => {
    // 「(15.4%)」だけ次の行へ折れていた。数字と率を1つの nowrap にする。
    const openRow = between(PAGE, '開封:', 'uniqueClick')
    expect(openRow, '開封の率が折れる').toContain('whitespace-nowrap')
    const clickRow = between(PAGE, 'クリック:', '</p>')
    expect(clickRow, 'クリックの率が折れる').toContain('whitespace-nowrap')
  })

  it('結果の列は各行が1440pxで1行に収まる幅にする', () => {
    // 結果列が14%だと「開封:」の後で数字が折れていた。操作列を
    // 中身幅（110px）まで詰めたぶんを結果へ回す。
    const statsHead = THEAD.match(/<Th style=\{\{\s*width:\s*'(\d+)%'\s*\}\}[^>]*>\s*結果/)
    expect(statsHead, '結果の列幅が無い').not.toBeNull()
    const statsPercent = Number((statsHead as RegExpMatchArray)[1])
    expect(statsPercent, '結果が狭く行が折れる').toBeGreaterThanOrEqual(17)
    // 「クリック: 96 (15.4%)」1行分＋余白24が1440pxの表に収まる。
    expect(
      (statsPercent / 100) * 835 - 24,
      `結果 ${statsPercent}% では1440pxで各行が1行に収まらない`,
    ).toBeGreaterThanOrEqual(108)
  })
})

describe('一斉配信の一覧の配信条件と日時（m20i・その3つづき）', () => {
  it('配信条件は1行で省略し、全文は title で見せる', () => {
    // 「タグ：NEN会員（定期）」が3行に折れて行が高くなっていた。
    // 短い文字列は途中で折らず、1行省略＋title（共通ルール）。
    expect(TBODY, '条件の省略が無い').toContain('block truncate')
    expect(TBODY, '条件の全文を見せていない').toContain('title={audience}')
  })

  it('配信日時は途中で折らない', () => {
    // 「8/24 10:00」の真ん中の空白で折れると2行になり、行が高くなる。
    const dateCell = between(TBODY, 'tabular-nums', 'formatDatetime')
    expect(dateCell, '日時が折れる').toContain('whitespace-nowrap')
  })
})

describe('一斉配信の一覧の色（m20i・共通ルール）', () => {
  it('素の Tailwind 色を使わない', () => {
    // 色は必ずトークン（bg-info-bg など）。素の色は置かない。
    expect(PAGE, '素の紫が残っている').not.toContain('purple-')
  })
})
