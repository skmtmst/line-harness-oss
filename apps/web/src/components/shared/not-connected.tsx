/**
 * まだ口が無いところの書き方を1つにそろえる。
 *
 * V6の画面は、設計にある節をぜんぶ出したうえで、**取れないものを
 * 取れないと書く**方針で作っている。書き方が画面ごとに違うと、
 * 運用者は「これは0なのか、壊れているのか、まだなのか」を毎回
 * 読み解くことになる。ここで形を決めて、契約試験で守る。
 *
 * **数字は空欄にしない。** 空欄は0にも故障にも見える。`—` を出し、
 * すぐ横に理由を置く。
 *
 * **保存・公開・削除・送信のような主要操作は、押せる形で置かない。**
 * 押せるのに何も起きない操作は、運用者に「やった」と誤解させる。
 * 口が無いなら押せなくして、理由を**見える文字で**出す
 * （吹き出しだけでは読めない）。
 */
import type { ReactNode } from 'react'
import Button from './button'
import styles from './not-connected.module.css'

/** 取れていない数字の代わりに出す字。**0 とは別物。** */
export const NOT_AVAILABLE = '—'

/**
 * 未接続の理由文をそろえる。
 *
 * 例: `notConnectedText('開封の記録')`
 *   → 「まだ繋がっていません。開封の記録が入ると出ます。」
 */
export function notConnectedText(source: string): string {
  return `まだ繋がっていません。${source}が接続されると表示されます。`
}

/**
 * 状態の言葉。**混ぜない。**
 *
 * 未接続・読込中・取得失敗・権限不足・実値0 は、運用者にとって
 * 意味がまったく違う。同じ「—」や空欄で片付けると、直せるのか
 * 待てばよいのか分からなくなる。
 */
export const STATE_TEXT = {
  loading: '読み込んでいます',
  error: '読み込めませんでした',
  retry: '再読み込み',
  forbiddenView: '見る権限がありません',
  forbiddenAct: '操作する権限がありません',
} as const

/**
 * 数字を出すか、`—` と理由を出すかを決める。
 *
 * `value` が数でないとき（未取得・null・NaN）は `—`。
 * **0 は 0 のまま出す。** 数えて0だったことは、取れなかったことと違う。
 */
export function countOrDash(value: number | null | undefined, unit = ''): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value.toLocaleString('ja-JP')}${unit}`
    : NOT_AVAILABLE
}

/** 閲覧・集計・補助の情報が未接続であることを、その場に書く。 */
export function NotConnected({ source }: { source: string }) {
  return (
    <p className={styles.note} data-not-connected={source}>
      {notConnectedText(source)}
    </p>
  )
}

/**
 * 主要操作（保存・公開・削除・送信）の置き方。
 *
 * `reason` があるあいだは押せない。**理由は吹き出しではなく本文に出す。**
 */
export function BlockedAction({
  reason,
  children,
  variant = 'primary',
  onClick,
}: {
  /** 押せない理由。`null` なら普通に押せる。 */
  reason: string | null
  children: ReactNode
  variant?: 'primary' | 'secondary'
  onClick?: () => void
}) {
  return (
    <div className={styles.action}>
      <Button variant={variant} disabled={reason !== null} onClick={onClick}>
        {children}
      </Button>
      {reason !== null ? (
        <p className={styles.reason} data-blocked-reason>
          {reason}
        </p>
      ) : null}
    </div>
  )
}
