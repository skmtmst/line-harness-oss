import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
/** 帯の中身（4枚の組み立て）。数の扱いは `broadcast-kpi-values.test.ts` が直に試す。 */
const KPIS = readFileSync(
  join(HERE, '..', '..', 'components', 'broadcasts', 'broadcast-kpi-values.ts'),
  'utf8',
)
/** 帯の描き方（単位を出すかどうか）。 */
const KPI_VIEW = readFileSync(
  join(HERE, '..', '..', 'components', 'broadcasts', 'broadcast-kpis.tsx'),
  'utf8',
)

/**
 * 一斉配信の一覧（設計 `q76C35` ★V6 6-1）の、中身が出せないときの見え方。
 *
 * **一覧が「1件も無い」「読み込めなかった」「権限が無い」を1つの文で
 * 済ませていると、運用する人からは登録したものが消えたように見える。**
 * 直し方がそれぞれ違う——空は作ればよい、失敗は読み直す、権限不足は
 * 誰かに足してもらう——ので、1枚ずつ言い分ける。
 */
describe('一覧の状態（設計 6-1-N `TmHjF`）', () => {
  it('権限不足を読み込み失敗と別の1枚にする', () => {
    /*
     * 403 は読み直しても直らない。失敗の枠に混ぜると「もう一度試す」を
     * 何度押しても直らない道へ誘うことになる。
     */
    expect(PAGE, '403 を見分けていない').toContain('err.status === 403')
    expect(PAGE, '権限不足の1枚が無い').toContain('kind="forbidden"')
  })

  it('権限不足のときは、失敗の帯を重ねて出さない', () => {
    expect(PAGE).toContain('{error && !forbidden && (')
  })

  it('空・失敗・権限不足を共通部品で描く', () => {
    /* 画面ごとに直書きすると、同じ状態が画面ごとに違う顔になる。 */
    expect(PAGE).toContain("import ListState from '@/components/shared/list-state'")
    for (const kind of ['empty', 'error', 'forbidden']) {
      expect(PAGE, `${kind} の1枚が無い`).toContain(`kind="${kind}"`)
    }
  })

  it('読み込めなかったときに「ありません」と言わない', () => {
    expect(PAGE).toContain('title="表示できませんでした"')
    expect(PAGE).not.toContain('いまは読み込めていません。上の案内をご覧ください。')
  })

  it('空・失敗の文言を設計 `TmHjF` どおりにする', () => {
    /* 部品の既定文ではなく、設計に書かれた文をそのまま出す。 */
    expect(PAGE).toContain('title="まだ配信がありません"')
    expect(PAGE).toContain('description="最初の1つを作ると、ここに並びます。"')
    expect(PAGE).toContain('description="再読み込みしても直らないときは、エラー報告へお知らせください。"')
  })
})

/**
 * 帯の4枚（設計 `q76C35`）。
 *
 * **取れない数を 0 で埋めない。** 「下書き 0件」は「下書きは無い」という
 * 別の意味になり、作りかけを見落とす。
 */
describe('一覧の帯（設計 6-1 `q76C35`）', () => {
  it('設計の4枚を、設計の順に出す', () => {
    const order = ['予約中', '下書き', '今月の配信', '平均開封率']
    const at = order.map((title) => KPIS.indexOf(`title: '${title}'`))
    for (const [i, pos] of at.entries()) {
      expect(pos, `${order[i]} の札が無い`).toBeGreaterThan(-1)
    }
    expect([...at].sort((a, b) => a - b), '設計の並びと違う').toEqual(at)
  })

  it('口が返さない「下書き」と「今日」を 0 件と書かない', () => {
    /*
     * `/api/broadcasts/stats` が返すのは 今月の配信・予約中・到達・失敗・
     * 平均開封率 だけ。一覧から数えると**基準が違う**（一覧はLINEアカウントで
     * 絞れるのに集計は絞らない）ので、足しても合わない4枚になる。
     */
    expect(KPIS).toContain("detail: '今日 —（未取得）'")
    expect(KPIS).toContain("detail: '編集途中 ・ 未取得'")
    expect(KPIS, '下書きに数を入れている').toMatch(/title: '下書き',\s*\n\s*value: null,/)
  })

  it('平均開封率の副題を設計どおり「過去28日」だけにする', () => {
    expect(KPIS).toContain("detail: '過去28日',")
    expect(KPIS, '設計に無い言葉を足している').not.toContain('20人未満の配信は除く')
  })

  it('数が無いときは単位も出さない', () => {
    /* `—件` は数に見える。 */
    expect(KPI_VIEW).toContain("typeof card.value === 'number' && Number.isFinite(card.value) && (")
  })

  it('帯の組み立ては、画面から切り離して試せる形にする', () => {
    /*
      部品の中で組み立てていたころは、**文字列の一致を見る契約テストでしか
      確かめられず、`0` と `—` の取り違えが試験をすり抜けた。**
    */
    expect(KPI_VIEW).toContain("import { buildBroadcastKpiCards, countText } from './broadcast-kpi-values'")
    expect(KPI_VIEW).toContain('const cards = buildBroadcastKpiCards(stats)')
  })
})
