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
  outlined,
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
   * 先に見せる用（例: ★BG-B `WDJak`「中 サイズ確認」の札
   * `components/hq/banners/export-size-chip.tsx`）。
   *
   * **帯は置き場所だけを持つ。** 色・形・アイコンは渡す側の部品が持つ。
   * 帯は40画面以上で共有しているので、ひとつの画面の見た目をここへ埋めない。
   *
   * ここにボタンや入力を置かない。置くと「操作は中央」が崩れる。
   * 渡さない画面は今までどおり左=状態／中央=操作のままで、見た目は変わらない。
   */
  info?: ReactNode
  /** 中央に並べる操作。実行がいちばん右。 */
  actions: ReactNode
  /**
   * **その画面の板が「枠線のある高さ72の帯」を描いているときに渡す。**
   * （承認済み ★BG-B `qIp42` の `X2oLn`：height 72・stroke `#DADDE2` 1px・影なし）
   *
   * V8 の既定は ★A/M10 の板の浮かせ（高さ60・枠なし・ふんわり影）。これは
   * **別の板**なので、全画面の決まりにはしない（`docs/v8-design-rules.md` §1
   * 「画面ごとに、その板の絵のとおり」）。板が違う画面はこれを渡して戻す。
   *
   * v7 の土台は元から枠線のある高さ72なので、渡しても何も変わらない。
   */
  outlined?: boolean
  className?: string
}) {
  return (
    <div
      className={[
        styles.bar,
        info ? styles.withInfo : null,
        outlined ? styles.outlined : null,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className={styles.lead}>
        {destructive}
        {status ? <p className={styles.status}>{status}</p> : null}
      </div>
      {info ? <div className={styles.info}>{info}</div> : null}
      <div className={styles.actions}>{actions}</div>
      {/*
       * 右端は空ける。ここに何か置くと中央が中央でなくなる。
       * ただし一言を渡した画面は、承認済み ★BG-B `X2oLn` の右の列
       * （`J94Yj` は `justifyContent: end`）どおりボタンが右端に付くので、
       * この空き箱は作らない。
       */}
      {info ? null : <div aria-hidden="true" />}
    </div>
  )
}
