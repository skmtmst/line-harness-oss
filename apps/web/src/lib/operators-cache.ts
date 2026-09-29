import { api } from './api'

/*
 * 画面を移るたびに取り直していた共通のものを、タブ内で使い回す。
 *
 * 対象: /api/operators（担当者の選択肢）。友だち一覧の絞り込みと
 * 友だち詳細の対応編集が、画面ごとに別々に取りに行っていた。
 * 担当者はアカウントに縛られない共通の名簿なので、短いあいだ共有する。
 *
 * 約束:
 * - 同時の要求は1本に相乗りさせる（取得中の Promise を共有する）
 * - 取れた答えは SHARE_MS のあいだ使い回す。失敗は覚えない（次は取り直す）
 * - ログアウト・セッション切れの後は捨てる（別人の名簿を見せない）
 * - 表示の選択肢にだけ使う。保存の可否はサーバ側（今までどおり）
 */

const SHARE_MS = 30_000

type OperatorsResponse = Awaited<ReturnType<typeof api.operators.list>>

let entry: { at: number; promise: Promise<OperatorsResponse> } | null = null

export function loadOperators(): Promise<OperatorsResponse> {
  const now = Date.now()
  if (entry && now - entry.at < SHARE_MS) return entry.promise
  const promise = api.operators.list()
  entry = { at: now, promise }
  // 失敗は覚えない。取れなかった名簿を使い回すと、復旧後も選択肢が出ないまま残る。
  const forget = () => {
    if (entry?.promise === promise) entry = null
  }
  promise.then((res) => {
    if (!res.success) forget()
  }, forget)
  return promise
}

/** ログアウト・セッション切れ・試験でやり直すときに捨てる。 */
export function clearOperatorsCache(): void {
  entry = null
}
