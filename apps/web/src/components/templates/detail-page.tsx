import type { ReactNode } from 'react'
import { PageFrame, PageHeading, type PageHeadingProps } from './page-frame'
import styles from './page-templates.module.css'
export interface DetailPageProps extends PageHeadingProps {
  boardId?: string; standalone?: boolean; tabs?: ReactNode; stats?: ReactNode; summary?: ReactNode; children: ReactNode
  /** 段の余白が異なる板は、既存の寸法変数で指定する。既定の詳細画面はそのまま。 */
  contentPadding?: string
}
export function DetailPage({ boardId, standalone, tabs, stats, summary, children, contentPadding, ...heading }: DetailPageProps) {
  return <PageFrame kind="detail" boardId={boardId} standalone={standalone}>
    <PageHeading {...heading} />
    {tabs ? <div className={styles.tabs} data-template-region="tabs">{tabs}</div> : null}
    {stats ? <div className={styles.stats} data-template-region="stats">{stats}</div> : null}
    <div className={styles.split} data-template-region="body">
      {summary ? <aside className={styles.detailSummary} data-template-region="summary">{summary}</aside> : null}
      <div className={styles.detailContent} data-template-region="content" style={contentPadding ? { padding: contentPadding } : undefined}>{children}</div>
    </div>
  </PageFrame>
}
