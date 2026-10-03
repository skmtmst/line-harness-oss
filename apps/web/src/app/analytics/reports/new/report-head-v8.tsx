import Link from 'next/link'

import styles from './report-v8.module.css'

/**
 * 定期レポート作成のV8見出し。板 `H5UoIu`（更新の競合時は `G83vi`）。
 *
 * `page.tsx` は `PageHeader` の仕組みに寄せる決まり（本文に h1 を直書き
 * しない）のため、V8 の見出しだけをここに置く。見た目は変えない。
 */
export default function ReportHeadV8({ editing }: { editing: boolean }) {
  return (
    <div className={styles.head}>
      <Link className={styles.back} href="/analytics">← 分析へ</Link>
      <h1 className={styles.title}>{editing ? '定期レポートを直す' : 'レポートを作る'}</h1>
      <p className={styles.lead}>見たい数をまとめて、決まった曜日・時刻にLINEやメールで届けます。数が急に動いたときだけ知らせることもできます。</p>
    </div>
  )
}
