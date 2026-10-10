import type { ReactNode } from 'react'
import Card from './card'
import styles from './event-roster.module.css'

/** 申込・待ち・取消の記録で共用する、見出しと表を持つカード。 */
export function EventRosterCard({ title, id, note, action, splitAction, children }: {
  title: string; id: string; note?: ReactNode; action?: ReactNode; splitAction?: boolean; children: ReactNode
}) {
  return <Card padding="none" overflow="hidden" aria-labelledby={id}>
    <div className={styles.header} data-roster-header data-split-action={splitAction || undefined}>
      <div className={styles.heading}><h3 id={id}>{title}</h3>{note ? <p>{note}</p> : null}</div>
      {action ? <div className={styles.headerAction}>{action}</div> : null}
    </div>
    {children}
  </Card>
}

export function EventRosterTable({ kind, label, headings, children }: {
  kind: 'applicants' | 'waitlist' | 'cancel'; label: string; headings: string[]; children: ReactNode
}) {
  return <div role="table" aria-label={label} className={styles.table} data-roster-kind={kind}>
    <div role="row" className={styles.tableHead}>{headings.map((heading) => <span role="columnheader" key={heading}>{heading}</span>)}</div>
    {children}
  </div>
}

export function EventRosterRow({ children }: { children: ReactNode }) {
  return <div role="row" className={styles.row}>{children}</div>
}

/** 期限と右端の操作を同じ領域に置く。操作が増えても名前・状態の列は動かない。 */
export function EventRosterActions({ deadline, children }: { deadline: ReactNode; children: ReactNode }) {
  return <span role="cell" className={styles.actionCell}><span className={styles.deadline}>{deadline}</span><span className={styles.actions}>{children}</span></span>
}

export function EventAttendanceSummary({ attended, noShow, before }: { attended: number | null; noShow: number | null; before: number | null }) {
  return <div className={styles.attendance} aria-label="当日の受付">
    <span className={styles.attendanceStrong}>{`参加済 ${attended ?? '—'}人`}</span>
    <span className={styles.attendanceDanger}>{`無断欠席 ${noShow ?? '—'}人`}</span>
    <span>{`受付前 ${before ?? '—'}人`}</span>
    <span className={styles.attendanceNote}>当日、来た人に「参加済」、来なかった人に「無断」を付けます</span>
  </div>
}
