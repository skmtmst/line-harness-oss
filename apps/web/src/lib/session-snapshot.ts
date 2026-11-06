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
  /** V-2: いつもと違う端末・場所からのログイン時刻。帯はこれが立っている間だけ出す。 */
  unfamiliarAt: string | null
  /** V-1: 再確認の聞き方。'totp' は認証アプリの6桁、'password' はパスワード。 */
  stepUpMethod: 'totp' | 'password' | 'none'
}

export const SESSION_SNAPSHOT_CHANGED = 'lh-session-snapshot-changed'

let snapshot: SessionSnapshot | null = null
// 認証の詳細を読み直している間の操作制限。本人確認方式やログイン通知の値は作らない。
let pendingPermission: Pick<SessionSnapshot, 'impersonation'> | null = null

/** 代理の切替後、認証の控えが無い間は書込を止める。認証情報の読取口には混ぜない。 */
export function deferImpersonationSnapshot(impersonation: OpsImpersonation): Pick<SessionSnapshot, 'impersonation'> {
  snapshot = null
  pendingPermission = { impersonation: { ...impersonation, mode: 'read' } }
  if (typeof window !== 'undefined') window.dispatchEvent(new window.Event(SESSION_SNAPSHOT_CHANGED))
  return pendingPermission
}

/** 操作の可否だけを読む。読込失敗でも暫定の書込拒否を保つ。 */
export function readPermissionSessionSnapshot(): Pick<SessionSnapshot, 'impersonation'> | null {
  return pendingPermission ?? snapshot
}

/** AuthGuard が確認に成功したときに呼ぶ。 */
export function rememberSessionSnapshot(next: SessionSnapshot): void {
  snapshot = next
  pendingPermission = null
  if (typeof window !== 'undefined') window.dispatchEvent(new window.Event(SESSION_SNAPSHOT_CHANGED))
}

/** 確認に失敗した・セッションを失ったときに呼ぶ。次に読む側は自分で取りに行く。 */
export function forgetSessionSnapshot(): void {
  snapshot = null
  pendingPermission = null
  if (typeof window !== 'undefined') window.dispatchEvent(new window.Event(SESSION_SNAPSHOT_CHANGED))
}

/** 直前の確認結果。まだ無ければ null。 */
export function readSessionSnapshot(): SessionSnapshot | null {
  return snapshot
}
