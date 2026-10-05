import type { ReactNode } from 'react'
import { PageFrame, PageHeading, type PageHeadingProps } from './page-frame'
import styles from './page-templates.module.css'
export interface AnalyticsPageProps extends PageHeadingProps {
  boardId?: string; standalone?: boolean; period: ReactNode; stats?: ReactNode
  children: ReactNode; aside?: ReactNode; asideToggle?: ReactNode
}
export function AnalyticsPage({ boardId, standalone, period, stats, children, aside, asideToggle, ...heading }: AnalyticsPageProps) {
  return <PageFrame kind="analytics" boardId={boardId} standalone={standalone}>
    <PageHeading {...heading} />
    <div className={styles.period} data-template-region="period">{period}</div>
    {stats ? <div className={styles.stats} data-template-region="stats">{stats}</div> : null}
    {asideToggle ? <div className={styles.asideToggle}>{asideToggle}</div> : null}
    <div className={styles.split} data-template-region="body">
      <div className={styles.analyticsContent} data-template-region="content">{children}</div>
      {aside ? <aside className={styles.analyticsAside} data-template-region="aside">{aside}</aside> : null}
    </div>
  </PageFrame>
}
