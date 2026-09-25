import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * 使いやすさ点検（2026-09-25）の表はみ出しの直し。
 * /auto-replies・/reminders・/contents/vars は 1152px（表の器 787〜802）で
 * `min-w-[820px]` などの最小幅が器を超え、横スクロールしていた。
 * 本物のブラウザで測れない場所でも予算が守れるよう、列幅の決めごとを
 * 文字で固定する。器の内訳は各 page.tsx の注釈に書いてある。
 *
 * 決めごと（3表共通）
 * - 表に最小幅（`min-w-[...px]`）を置かない。`table-fixed` で器いっぱいにする
 * - 固定する列の合計は 1152px の器（787）に収める。伸ばすのは文字の列だけ
 * - 操作列は固定幅＋右端 sticky
 * - 折り返さない文字は `truncate`＋`title` か、行を分ける
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const read = (name: string) => readFileSync(join(HERE, name), 'utf8')

/** `w-XX`（XX は 4px 単位の整数）だけを足す。割合・flex の列は伸ばす側。 */
function fixedWidthSum(sources: string[]): number {
  let sum = 0
  for (const src of sources) {
    for (const match of src.matchAll(/w-(\d+)/g)) sum += Number(match[1]) * 4
  }
  return sum
}

describe('1152px の器に収まる表（最小幅なし）', () => {
  it('自動応答の表に最小幅がなく、固定列の合計が 576 である', () => {
    const page = read('auto-replies/page.tsx')
    expect(page).not.toMatch(/min-w-\[\d+px\]/)
    const head = page.slice(page.indexOf('<thead>'), page.indexOf('</thead>'))
    // 状態 80＋条件 128＋返すもの 128＋今月 80＋操作 160。残りはルール名。
    expect(fixedWidthSum([head])).toBe(80 + 128 + 128 + 80 + 160)
  })

  it('リマインダの表に最小幅がなく、固定列の合計が 544 である', () => {
    const page = read('reminders/page.tsx')
    expect(page).not.toMatch(/min-w-\[\d+px\]/)
    const head = page.slice(page.indexOf('<thead'), page.indexOf('</thead>'))
    // 状態 64＋基準日 128＋予定 64＋最終送信 128＋操作 160。残りは名前。
    expect(fixedWidthSum([head])).toBe(64 + 128 + 64 + 128 + 160)
  })

  it('共通情報の表に最小幅がなく、固定列の合計が 696 である', () => {
    const page = read('contents/vars/page.tsx')
    expect(page).not.toMatch(/min-w-\[\d+px\]/)
    const head = page.slice(page.indexOf('<thead>'), page.indexOf('</thead>'))
    // 選択 40＋名前 112＋キー 160＋使用場所 128＋更新 112＋操作 144。残りは中身。
    expect(fixedWidthSum([head])).toBe(40 + 112 + 160 + 128 + 112 + 144)
  })
})

describe('折り返さない文字は器からはみ出さない', () => {
  it('自動応答の今月・累計は1行で切り、全文は列の title にある', () => {
    const page = read('auto-replies/page.tsx')
    expect(page).toMatch(/block max-w-full truncate[^>]*>累計 \{r\.hits\?\.total/)
  })

  it('共通情報の更新日・予定は2行に分け、1行で横に流さない', () => {
    const page = read('contents/vars/page.tsx')
    expect(page).not.toMatch(/whitespace-nowrap\}> *\{formatListDate/)
    expect(page).toContain('<span className="block">{formatListDate(item.updatedAt)}</span>')
  })
})
