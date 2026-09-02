import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * 一覧の表が設計 `q76C35`（V6 6-1 一斉配信）の6列であることを見る。
 *
 * **ファイル全体を toContain で見ない。** 一覧の page.tsx には絞り込みや
 * フォルダの語も入っているので、全体を見ると列と関係のない場所に同じ語が
 * あるだけで通ってしまう。`<thead>` と `<tbody>` を切り出して、その中だけを
 * 数える。
 *
 * 実際に、見出しが8つ・中身が7つで1列ずれていたのを、この形の検査が無くて
 * 撮影するまで誰も気づけなかった。
 */

const SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'),
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

/** 関数の本体だけを、波かっこの対応で切り出す。 */
function functionBody(source: string, signature: string): string {
  const from = source.indexOf(signature)
  expect(from, `${signature} が見つかりません`).toBeGreaterThan(-1)
  let depth = 0
  for (let i = source.indexOf('{', from); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(from, i + 1)
    }
  }
  throw new Error(`${signature} の終わりが見つかりません`)
}

const THEAD = between(SOURCE, '<thead>', '</thead>')
const TBODY = between(SOURCE, '<tbody className="divide-y divide-hairline">', '</tbody>')
/** 1行ぶんの各セル。`<td` で切ると先頭に行の書き出しが来るので1つ落とす。 */
const CELLS = TBODY.split(/<td[\s>]/).slice(1)

describe('一斉配信の一覧の列（設計 q76C35）', () => {
  it('見出しは設計の6列で、順番も同じ', () => {
    const headers = [...THEAD.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)]
      .map((m) => m[1].replace(/\{[\s\S]*?\}/g, '').trim())
      .filter(Boolean)
    expect(headers).toEqual([
      'タイトル・内容',
      '状態',
      '配信条件',
      '配信日時',
      '配信・開封・クリック',
      '操作',
    ])
  })

  /**
   * 見出しと中身の数が合っていること。
   *
   * ここがずれていると、表の見出しが1つ隣の中身に付く。前は「開封（率）」の
   * 下に状態バッジ、「状態」の下に削除ボタンが並んでいた。
   */
  it('見出しの数と1行のセルの数が同じ', () => {
    const headerCount = (THEAD.match(/<th[\s/>]/g) ?? []).length
    expect(CELLS.length).toBe(headerCount)
    expect(headerCount).toBe(6)
  })

  /**
   * まだ送っていない配信に `0件` と書かない。
   *
   * 0通届いたのではなく、届く前だから数が無い。単位を付けた 0 は
   * 「送ったが誰にも届かなかった」に読める。
   */
  it('送信済みでない行の配信・開封・クリックは — で、数や単位を作らない', () => {
    const stats = CELLS[4]
    expect(stats).toContain("broadcast.status !== 'sent'")
    expect(stats).toContain('—')
    expect(stats).not.toMatch(/0\s*件/)
    expect(stats).not.toMatch(/0\s*人/)
  })

  /**
   * 日時は JST で書く。
   *
   * `timeZone` を渡さないと動かしている端末の時計で書き出す。開発機が
   * UTC+7 なので、9時予約が7時と出て、日をまたぐと日付までずれる。
   */
  it('配信日時は Asia/Tokyo で書き出す', () => {
    const body = functionBody(SOURCE, 'function formatDatetime')
    expect(body).toContain("timeZone: 'Asia/Tokyo'")
  })

  /** 取れない日時に `-` ではなく、理由の読める言葉を出す。 */
  it('日時が無い配信は「未設定」と出す', () => {
    const body = functionBody(SOURCE, 'function formatDatetime')
    expect(body).toContain("if (!iso) return '未設定'")
  })
})
