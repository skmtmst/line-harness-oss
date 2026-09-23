import type { OpsImpersonation } from '@/lib/api'

/*
 * V6R-S0-a: AuthGuard が受け取った /api/auth/session の応答を、同じ画面の中で使い回す。
 *
 * 以前は代理ログイン帯（components/ops/impersonation-notice.tsx）が、AuthGuard の
 * 確認が終わってから同じ /api/auth/session をもう一度取りに行っていた。帯は
 * AuthGuard の内側にしか載らないので、帯が動く時点で答えは必ず手元にある。
 * 検証環境の実測で、全画面がこの2回目の往復（約0.33秒）を直列に待っていた。
 *
 * ここに置くのは「代理ログイン中かどうか」だけ。権限や CSRF は今までどおり
 * AuthGuard が localStorage に書く。認証を省略する道具ではない（API 側の確認は残る）。
 */
export interface SessionSnapshot {
  impersonation: OpsImpersonation | null
}

let snapshot: SessionSnapshot | null = null

/** AuthGuard が確認に成功したときに呼ぶ。 */
export function rememberSessionSnapshot(next: SessionSnapshot): void {
  snapshot = next
}

/** 確認に失敗した・セッションを失ったときに呼ぶ。次に読む側は自分で取りに行く。 */
export function forgetSessionSnapshot(): void {
  snapshot = null
}

/** 直前の確認結果。まだ無ければ null。 */
export function readSessionSnapshot(): SessionSnapshot | null {
  return snapshot
}
