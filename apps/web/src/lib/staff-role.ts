import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

/**
 * 変更操作（作る・変える・止める・消す・実行する）を扱える役割か。
 *
 * サーバの `requireRole('owner', 'admin')` と同じ境目。見るだけの担当者
 * （staff）の変更口はサーバが 403 で断るので、画面でも入口を出さない。
 * 読み取り（GET）は別の軸で、staff に許されたものは出す。
 *
 * 同じ判定が各画面に散らばっていた（友だち一括の canRunBulk など）ので、
 * 新しく触る画面はここへ寄せる。
 */
export function canManageRole(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'admin'
}

/**
 * ログイン中の担当者の役割。`api.staff.me()` で入り直して読む。
 * 手元の保存値は書き換え可能なので判定に使わない。
 *
 * 確認が終わるまで・読めなかったときは null を返す。呼び出し側は
 * そのあいだ今までどおり操作を出し、役割が staff と分かったら隠す。
 * 最後の守りはサーバの 403（失敗時は権限不足の文を出す）。
 */
export function useStaffRole(): string | null {
  const [role, setRole] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void api.staff.me()
      .then((response) => {
        if (!active || !response.success) return
        setRole(response.data.role)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])
  return role
}
