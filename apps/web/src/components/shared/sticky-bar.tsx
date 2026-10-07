import type { ReactNode } from 'react'
import styles from './sticky-bar.module.css'

/**
 * 下部追従バー。作成・編集画面の最下段。Pencil V5 の `Ai3fq`。
 *
 * **保存はここにしか置かない。** ヘッダーにも置くと、どちらを押せば
 * よいか分からなくなる。
 *
 * ## 並びは部品が決める
 *
 * **削除だけが左端。ほかは中央。右端は空ける。**
 *
 * 設計 `bV5Vs`（シナリオ編集）と `XBkiQ`（保存した検索を編集）は
 * どちらも同じ形——左端に赤い「このシナリオを削除」「この条件を削除」、
 * 中央に「キャンセル / 複製して保存 / 変更を保存」。
 *
 * **消す操作を、保存の隣に置かない。** 隣にあると、押し間違いが
 * 「保存したつもりが消えていた」になる。離すのは見た目の好みではない。
 *
 * ボタンの並びは「やめる → 下書き → 実行」で、実行がいちばん右。
 */
export default function StickyBar({
  destructive,
  status,
  info,
  actions,
  className,
}: {
  /**
   * 消す操作。**左端に、ほかから離して置く。**
   * 無ければ左端は空く（中央の位置は変わらない）。
   */
  destructive?: ReactNode
  /**
   * いまの状態。「下書き・最終保存 10:24」など。
   * 設計の2画面には無いので、**無い画面を作ってよい。**
   */
  status?: ReactNode
  /**
   * 操作の手前に添える**読むだけの一言**。押したときに何が起きるかを
   * 先に見せる用（例: ★BG-B `GcuH5`「1040 × 1040 で書き出します」）。
   *
   * ここにボタンや入力を置かない。置くと「操作は中央」が崩れる。
   * 渡さない画面は今までどおり左=状態／中央=操作のままで、見た目は変わらない。
   */
  info?: ReactNode
  /** 中央に並べる操作。実行がいちばん右。 */
  actions: ReactNode
  className?: string
}) {
  return (
    <div
      className={[styles.bar, info ? styles.withInfo : null, className]
        .filter(Boolean)
        .join(' ')}
    >
      <div className={styles.lead}>
        {destructive}
        {status ? <p className={styles.status}>{status}</p> : null}
      </div>
      {info ? <p className={styles.info}>{info}</p> : null}
      <div className={styles.actions}>{actions}</div>
      {/* 右端は空ける。ここに何か置くと中央が中央でなくなる。 */}
      <div aria-hidden="true" />
    </div>
  )
}
