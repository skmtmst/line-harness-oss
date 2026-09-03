import type { BroadcastStats } from '@/lib/api'

/**
 * 一斉配信の一覧に出す帯の 4 枚（設計 `q76C35` ★V6 6-1）。
 *
 * **画面から切り離してあるのは、未取得と実測 0 の区別を直に試せるようにするため。**
 * 部品の中で組み立てていたころは、文字列の一致を見る契約テストでしか
 * 確かめられず、**`0` と `—` の取り違えが試験をすり抜けた。**
 *
 * 口が返さないもの（下書き・今日）は `null` のまま置く。
 * **`0` で埋めると「下書きは無い」という別の意味になり、作りかけを見落とす。**
 */

/** 帯の副題に出す数。数が無いなら `—` にして、単位も付けない。 */
export function countText(value: unknown, unit: string): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value.toLocaleString('ja-JP')}${unit}`
    : '—'
}

export type BroadcastKpiCard = {
  title: string
  /** 口が返さなかったものは `null`。**`0` で埋めない。** */
  value: number | null
  unit: string
  detail: string
}

/** 数として画面に出してよいものだけを通す。文字列の `'12'` も通さない。 */
function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * 設計の 4 枚を、設計の順に組み立てる。
 *
 * **「下書き」と「今日」は口が返さない。**
 * `/api/broadcasts/stats` が返すのは 今月の配信・予約中・到達・失敗・
 * 平均開封率 だけ。一覧（`/api/broadcasts`）から数えれば出せそうに見えるが、
 * **一覧は LINE アカウントで絞れるのに集計は絞らない**（`getBroadcastStats`
 * はテナント全体を数える）。基準の違う数を同じ帯に並べると、足しても
 * 合わない 4 枚になる。取れないものは `—` のままにする。
 */
export function buildBroadcastKpiCards(stats: BroadcastStats | null): BroadcastKpiCard[] {
  return [
    {
      title: '予約中',
      value: numberOrNull(stats?.scheduled),
      unit: '件',
      /* 「今日 1件」は口が返さない。数えずに未取得と言う。 */
      detail: '今日 —（未取得）',
    },
    {
      title: '下書き',
      value: null,
      unit: '件',
      /* 同上。**0件と書くと「下書きは無い」という別の意味になる。** */
      detail: '編集途中 ・ 未取得',
    },
    {
      title: '今月の配信',
      value: numberOrNull(stats?.thisMonth),
      unit: '件',
      detail: `${countText(stats?.delivered, '人')}へ到達`,
    },
    {
      title: '平均開封率',
      value: numberOrNull(stats?.openRate),
      unit: '%',
      /*
        設計 `q76C35` の副題は「過去28日」だけ。**言葉を足さない。**
        LINEは20人未満の配信だと開封数を返さないので、その配信は平均から
        外している（0として混ぜると平均が不当に下がる）。この但し書きを
        画面に出すかは Pencil を先に直す話なので、ここには書かない。
      */
      detail: '過去28日',
    },
  ]
}
