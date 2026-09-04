import styles from './webinar-line-preview.module.css'

/**
 * LINEプレビュー（設計 `PV1Vh` `d3rFGD` `Ho8z4` の右側）。
 *
 * **中身は各段の入力から組み立てる。** 新しい口は使わない。
 * 入力がまだ無いときは、**それらしい文を作らずに「まだありません」と書く**。
 * 見本の文を置くと、保存すればそれが届くと読めてしまう。
 */
export default function WebinarLinePreview({
  body,
  buttonLabel,
  empty,
}: {
  /** 吹き出しの本文。入力が無いときは `null`。 */
  body: string | null
  /** 吹き出しの中の押し口。無ければ出さない。 */
  buttonLabel?: string | null
  /** 本文が無いときに出す言葉。何を入れれば埋まるかを書く。 */
  empty: string
}) {
  return (
    <section className={styles.panel} data-webinar-part="line-preview">
      <h2 className={styles.title}>LINEプレビュー</h2>
      {/* 断りを先に置く。実物と1ピクセル同じではない。 */}
      <p className={styles.badge}>実際のLINE表示に近いプレビューです</p>
      <div className={styles.bubble}>
        {body ? (
          <p className={styles.body}>{body}</p>
        ) : (
          <p className={styles.empty}>{empty}</p>
        )}
        {body && buttonLabel ? <p className={styles.button}>{buttonLabel}</p> : null}
      </div>
    </section>
  )
}
