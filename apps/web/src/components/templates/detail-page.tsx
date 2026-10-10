'use client'

import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import type { ReactNode } from 'react'
import { PageFrame, PageHeading, type PageHeadingProps } from './page-frame'
import styles from './page-templates.module.css'
import ReadOnlyNotice from '@/components/shared/read-only-notice'

export interface DetailPageProps extends PageHeadingProps {
  readOnly?: boolean
  layout?: 'event-roster'
  /** 説明とタブの間を詰める板だけに指定。既定の詳細画面は変えない。 */
  loading?: boolean
  loadingLabel?: string
  tabSpacing?: 'compact'
  boardId?: string; standalone?: boolean; tabs?: ReactNode; stats?: ReactNode; summary?: ReactNode; children: ReactNode
  /** 段の余白が異なる板は、既存の寸法変数で指定する。既定の詳細画面はそのまま。 */
  contentPadding?: string
}

export function DetailPage({ readOnly, boardId, layout, standalone, tabSpacing, tabs, stats, summary, children, contentPadding, loading = false, loadingLabel, ...heading }: DetailPageProps) {
  return <PageFrame kind="detail" boardId={boardId} layout={layout} standalone={standalone}>
    <PageHeading {...heading} bottomSpacing={tabSpacing} />
    {readOnly ? <ReadOnlyNotice /> : null}
    {tabs ? <div className={styles.tabs} data-template-region="tabs">{tabs}</div> : null}
    {stats ? <div className={styles.stats} data-template-region="stats">{stats}</div> : null}
    <div className={styles.split} data-template-region="body">
      {summary ? <aside className={styles.detailSummary} data-template-region="summary">{summary}</aside> : null}
      <div className={styles.detailContent} data-template-region="content" style={contentPadding ? { padding: contentPadding } : undefined}>{loading ? <DetailLoading label={loadingLabel} /> : children}</div>
    </div>
  </PageFrame>
}

/** 詳細の読み込みは型が持つ。各画面は文だけ渡す。 */
export function DetailSkeleton() {
 return <div data-detail-skeleton aria-hidden="true" className="flex flex-col gap-4 p-6"><Skeleton width="35%" height={24}/><Skeleton width="100%" height={88}/>{[0,1,2].map(i=><Skeleton key={i} width="100%" height={40}/>)}</div>
}
export function DetailLoading({label='詳細を読み込んでいます'}:{label?:string}) {
 return <div role="status" aria-busy="true" data-template-region="loading"><span className="sr-only">{label}</span><DelayedSkeleton loading skeleton={<DetailSkeleton/>}/></div>
}
