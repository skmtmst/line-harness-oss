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

describe('スコアのルール：V6の配置', () => {
  it('通常画面はできごとを1行ずつ要約する', () => {
    expect(PAGE).toContain('点をつける・引くこと')
    expect(PAGE).toContain('上から順にあてはめます。同じことが2回起きたら、2回ぶん動きます。')
    expect(PAGE).toContain('grid min-h-10 grid-cols-12')
    expect(PAGE).toContain('rulePointLabel(rule)')
    expect(PAGE).toContain('ruleFrequencyLabel(rule)')
    expect(PAGE).not.toContain('<DataTable>')
  })

  it('1440pxでは本文を使い、右の柱は1536pxから出す', () => {
    expect(PAGE).toContain('grid gap-3 2xl:grid-cols-4')
    expect(PAGE).toContain('2xl:col-span-3')
    /* **`2xl:` を素通ししない。** `not.toContain('xl:…')` は `2xl:` にも当たる。 */
    expect(PAGE).not.toMatch(/(?<![0-9])xl:grid-cols-4/)
    expect(PAGE).not.toMatch(/(?<![0-9])xl:col-span-3/)
  })

  it('帯の分けかたを、できごとの下に置く', () => {
    expect(PAGE).toContain('帯の分けかた')
    for (const label of ['高い（以上）', 'ふつう（以上）', '点の上限']) {
      expect(PAGE).toContain(label)
    }
  })

  it('詳しい入力は共通ダイアログで直す', () => {
    expect(PAGE).toContain('title="できごとの設定を直す"')
    expect(PAGE).toContain('setEditRuleIndex(index)')
    expect(PAGE).toContain('setEditRuleIndex(nextIndex)')
    for (const label of ['きっかけ', '点数の変え方', '回数', '開始日時', '終了日時']) {
      expect(PAGE).toContain('label="' + label + '"')
    }
  })

  it('1人で試す操作も共通ダイアログを開く', () => {
    expect(PAGE).toContain('onClick={() => setTestOpen(true)}>1人で試す')
    expect(PAGE).toContain('title="1人でスコアのルールを試す"')
    expect(PAGE).toContain('友だちの点数や履歴は変えません。')
  })
})
