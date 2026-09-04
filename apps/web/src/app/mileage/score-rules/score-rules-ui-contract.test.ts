import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const ADJUSTMENT = readFileSync(
  join(HERE, '..', 'friends', 'detail', 'mileage-adjustment-dialog.tsx'),
  'utf8',
)

/*
 * ここは**画面の文字と幅**だけを見る。口とデータは #496 の
 * `mileage-v6-contract.test.ts` が見ている。
 */
describe('スコアのルール：失敗の文言', () => {
  it('`ApiError` の中身をそのまま出さない', () => {
    /*
      `ApiError.message` は 400 以外だと `API error: <番号>` に落ちる
      （`lib/api.ts`）。素通しすると `API error: 405` が利用者に見える。
    */
    expect(PAGE).not.toMatch(/if \(error instanceof ApiError\) return error\.message/)
  })

  it('400 だけ本文を通し、ほかは番号ごとに日本語へ置き換える', () => {
    expect(PAGE).toContain('if (error.status === 400) return error.message')
    for (const status of [403, 404, 405, 409]) {
      expect(PAGE).toMatch(new RegExp(`if \\(error\\.status === ${status}\\) return '[^']+'`))
    }
  })

  it('置き換えた文言に番号や英語を混ぜない', () => {
    /* **返している文だけを見る。** 行ごと見ると `error.status` に当たる。 */
    const returned = [...PAGE.matchAll(/if \(error\.status === (\d{3})\) return '([^']+)'/g)]
    expect(returned.length).toBeGreaterThanOrEqual(4)
    for (const [, status, message] of returned) {
      if (status === '400') continue
      expect(message).not.toMatch(/API|error|status|\d/)
    }
  })

  it('通信そのものが失敗したときも日本語で出す', () => {
    expect(PAGE).toContain('通信に失敗しました。接続を確認してもう一度お試しください。')
  })

  it('同じ機能の手動マイル調整と同じ形にそろえる', () => {
    /* 隣の画面が先にこの形にしている。どちらかだけ直すと、また食い違う。 */
    expect(ADJUSTMENT).toContain('if (error.status === 400) return error.message')
    expect(ADJUSTMENT).toContain('if (error.status === 405)')
  })
})

describe('スコアのルール：一覧の幅', () => {
  it('6列に幅を決める', () => {
    /*
      `DataTable` は `table-layout: fixed`（`data-table.module.css`）。
      決めないと6列が等分され、1440px で名前ときっかけが切れる。
    */
    for (const width of ['w-24', 'w-44', 'w-52', 'w-56', 'w-20']) {
      expect(PAGE).toContain(`className="${width}"`)
    }
    expect(PAGE).toContain('<Th>名前・きっかけ</Th>')
  })

  it('1440px では表を目いっぱい使い、右の柱は 1536px から戻す', () => {
    expect(PAGE).toContain('grid gap-3 2xl:grid-cols-4')
    expect(PAGE).toContain('2xl:col-span-3')
    /* **`2xl:` を素通ししない。** `not.toContain('xl:…')` は `2xl:` にも当たる。 */
    expect(PAGE).not.toMatch(/(?<![0-9])xl:grid-cols-4/)
    expect(PAGE).not.toMatch(/(?<![0-9])xl:col-span-3/)
  })

  it('右の柱は、狭いときに下へ3枚並べる', () => {
    expect(PAGE).toContain('grid gap-3 md:grid-cols-3 2xl:grid-cols-1')
  })

  it('「同じ記録は1回だけ」を途中で折らない', () => {
    expect(PAGE).toMatch(/whitespace-nowrap[^"]*">?[\s\S]{0,200}同じ記録は1回だけ/)
  })

  it('点数と上限回数の入力を列いっぱいにする', () => {
    expect(PAGE).not.toContain('className="mt-2 w-24"')
  })
})
