import { api } from './api'

/*
 * 画面を移るたびに取り直していた共通のものを、タブ内で使い回す。
 *
 * 対象: /api/line-accounts（一覧）。検証環境の実測では、全画面が
 * /api/auth/session の確認が終わるまで待ってから取りに行っていた（直列）。
 * 一覧の取得自体はセッションの「結果」を要らない（Cookie だけあれば
 * 取れる。権限の出し分けはサーバ側と AuthGuard が今までどおり行う）ので、
 * AuthGuard の確認と並べて先に取り始める。
 *
 * 約束:
 * - 同時の要求は1本に相乗りさせる（取得中の Promise を共有する）
 * - 取れた答えは SHARE_MS のあいだ使い回す。失敗は覚えない（次は取り直す）
 * - 載せる側の取り直し（refreshAccounts）は reload で必ず取り直す。
 *   アカウントの追加・停止の直後に古い一覧を見せない
 * - ログアウト・セッション切れ・アカウント切替の後は捨てる
 *   （捨てる口は clearLineAccountsCache。呼ぶのは logout と AuthGuard）
 */

const SHARE_MS = 30_000

type AccountsResponse = Awaited<ReturnType<typeof api.lineAccounts.list>>

let entry: { at: number; promise: Promise<AccountsResponse> } | null = null

/** 載せる側（AccountProvider）が使う。取得中・取得直後なら相乗りする。 */
export function loadLineAccounts(options?: { reload?: boolean }): Promise<AccountsResponse> {
  if (options?.reload) entry = null
  const now = Date.now()
  if (entry && now - entry.at < SHARE_MS) return entry.promise
  const promise = api.lineAccounts.list(false)
  entry = { at: now, promise }
  // 失敗は覚えない。取れなかった一覧を使い回すと、復旧後も失敗表示のまま残る。
  const forget = () => {
    if (entry?.promise === promise) entry = null
  }
  promise.then((res) => {
    if (!res.success) forget()
  }, forget)
  return promise
}

/** AuthGuard のセッション確認と並べて、先に取り始めるだけ。結果は載せる側が読む。 */
export function prefetchLineAccounts(): void {
  try {
    void loadLineAccounts().catch(() => undefined)
  } catch {
    // 取れなくても AuthGuard の確認は続ける。載せる側が失敗表示を出す。
  }
}

/** ログアウト・セッション切れのときに捨てる。次に載せる側は取り直す。 */
export function clearLineAccountsCache(): void {
  entry = null
}
