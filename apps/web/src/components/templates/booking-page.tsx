import type { ReactNode } from 'react'
import { PageFrame, PageHeading, type PageHeadingProps } from './page-frame'
import styles from './page-templates.module.css'

/** O2Z8u・GcyTr：題と主操作の直下に数の帯を置く予約の型。 */
export function BookingPage({ children, ...heading }: PageHeadingProps & { children: ReactNode }) {
  return <PageFrame kind="booking" boardId="acRIl">
    <div className={styles.bookingHeading}><PageHeading {...heading} /></div>
    {children}
  </PageFrame>
}

export function BookingPageStats({ children }: { children: ReactNode }) {
  return <div className={styles.bookingStats} data-template-region="stats" data-blank-ok="数の帯を予定の列幅にそろえ、右の予約詳細欄の幅を残す">{children}</div>
}

export function BookingPageContent({ children }: { children: ReactNode }) {
  return <div className={styles.bookingContent} data-template-region="content">{children}</div>
}
