import Link from 'next/link'
import styles from './side-cards.module.css'

export interface FeatureLink {
  /** 相手の機能名。サイドメニューに出ている名前と同じにする。 */
  label: string
  /** ひとこと。「何のためにつながっているか」を書く。 */
  note: string
  href?: string
}

/**
 * つながる先。この画面から呼ぶ・呼ばれる機能を並べる。
 *
 * 右カラム（幅390px）を持つ画面（作成型・詳細型・右カラム付きボード型）に置く。
 * 一覧型と1カラムのボードには置かず、案内帯の文中で相手の名前を「」で呼ぶ。
 * 行き先の書き方を2種類に増やさないため。
 *
 * **行は「名前」と「ひとこと」だけ。** ここに操作やスイッチを足さない。
 */
export function FeatureLinkCard({ items, className }: { items: FeatureLink[]; className?: string }) {
  return (
    <section className={[styles.card, className].filter(Boolean).join(' ')}>
      <h2 className={styles.title}>つながる先</h2>
      {items.map((item) => (
        <div key={item.label} className={styles.linkRow}>
          {item.href ? (
            <Link href={item.href} className={styles.linkName}>
              <ArrowRight />
              {item.label}
            </Link>
          ) : (
            <span className={styles.linkName}>
              <ArrowRight />
              {item.label}
            </span>
          )}
          <span className={styles.linkNote}>{item.note}</span>
        </div>
      ))}
    </section>
  )
}

export interface CareItem {
  /** 見出し。「〜できない」「〜が変わる」など、起きることを先に書く。 */
  head: string
  /** なぜそうなるか。 */
  note?: string
}

/**
 * 気をつけること。先に知らないと事故になることを並べる。
 *
 * **右カラムのいちばん下**に置く。「つながる先」の次。
 */
export function CareCard({ items, className }: { items: CareItem[]; className?: string }) {
  return (
    <section className={[styles.card, styles.careCard, className].filter(Boolean).join(' ')}>
      <h2 className={[styles.title, styles.careTitle].join(' ')}>気をつけること</h2>
      {items.map((item) => (
        <div key={item.head} className={styles.careRow}>
          <AlertIcon />
          <div className={styles.careText}>
            <p className={styles.careHead}>{item.head}</p>
            {item.note ? <p className={styles.careNote}>{item.note}</p> : null}
          </div>
        </div>
      ))}
    </section>
  )
}

function ArrowRight() {
  return (
    <svg className={styles.linkIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function AlertIcon() {
  return (
    <svg className={styles.careIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M12 4l9 16H3l9-16z" strokeLinejoin="round" />
      <path d="M12 10v4M12 17h.01" strokeLinecap="round" />
    </svg>
  )
}
