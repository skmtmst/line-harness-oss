import type { ReactNode, Ref } from 'react'
import { PageFrame, PageHeading, type PageHeadingProps } from './page-frame'
import styles from './page-templates.module.css'

export interface DashboardPageProps extends PageHeadingProps {
  boardId?: string
  standalone?: boolean
  notice?: ReactNode
  stats?: ReactNode
  children: ReactNode
  overlays?: ReactNode
}
export function DashboardPage({ boardId, standalone, notice, stats, children, overlays, ...heading }: DashboardPageProps) {
  return <PageFrame kind="dashboard" boardId={boardId} standalone={standalone}>
    <PageHeading {...heading} />
    {notice ? <div className={styles.notice} data-template-region="notice">{notice}</div> : null}
    {stats ? <div className={styles.stats} data-template-region="stats">{stats}</div> : null}
    {children}{overlays}
  </PageFrame>
}
/** 段の境界と内側の余白。高さは中身で伸びる。 */
export function DashboardRow({ children, aside, asideRef, variant }: { children: ReactNode; aside?: ReactNode; asideRef?: Ref<HTMLElement>; variant?: 'trend' | 'inbox' | 'link' }) {
  return <div className={styles.dashboardRow} data-template-region="row" data-row={variant}>
    <div className={styles.dashboardCell}>{children}</div>
    {aside ? <aside ref={asideRef} className={styles.dashboardAside} data-template-region="aside">{aside}</aside> : null}
  </div>
}
export function DashboardColumns({ children }: { children: ReactNode[] }) {
  return <div className={`${styles.dashboardRow} ${styles.dashboardColumns}`} data-template-region="row">{children.map((child, index) => <div className={styles.dashboardCell} key={index}>{child}</div>)}</div>
}
