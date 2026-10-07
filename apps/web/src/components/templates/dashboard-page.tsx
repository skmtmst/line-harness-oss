import type { CSSProperties, ReactNode, Ref } from 'react'
import { PageFrame, PageHeading, type PageHeadingProps } from './page-frame'
import styles from './page-templates.module.css'

export interface DashboardPageProps extends PageHeadingProps {
  boardId?: string
  standalone?: boolean
  /** 板の頭のすぐ下に置くタブの段（E-1 hKRRF の店のタブ）。省くと段を作らない。 */
  tabs?: ReactNode
  notice?: ReactNode
  stats?: ReactNode
  children: ReactNode
  overlays?: ReactNode
}
export function DashboardPage({ boardId, standalone, tabs, notice, stats, children, overlays, ...heading }: DashboardPageProps) {
  return <PageFrame kind="dashboard" boardId={boardId} standalone={standalone}>
    <PageHeading {...heading} />
    {tabs ? <div className={styles.tabs} data-template-region="tabs">{tabs}</div> : null}
    {notice ? <div className={styles.notice} data-template-region="notice">{notice}</div> : null}
    {stats ? <div className={styles.stats} data-template-region="stats">{stats}</div> : null}
    {children}{overlays}
  </PageFrame>
}
/**
 * 段の境界と内側の余白。高さは中身で伸びる。
 * asideSize：右の列の幅。省くと既定（297）。'wide' は 360（E-1 hKRRF）。
 * 'column' は上の数の帯の1マス分（帯と同じ等分の格子に載せ、縦の線を帯の線と一直線にする）。
 * asideColumns：'column' のときの帯のマスの数（省くと --tpl-dash-cols）。
 */
export function DashboardRow({ children, aside, asideRef, variant, asideSize, asideColumns }: { children: ReactNode; aside?: ReactNode; asideRef?: Ref<HTMLElement>; variant?: 'trend' | 'inbox' | 'link'; asideSize?: 'wide' | 'column'; asideColumns?: number }) {
  const gridStyle = asideSize === 'column' && asideColumns ? { '--tpl-dash-cols': asideColumns } as CSSProperties : undefined
  return <div className={styles.dashboardRow} data-template-region="row" data-row={variant} data-aside-size={aside ? asideSize : undefined} style={gridStyle}>
    <div className={styles.dashboardCell}>{children}</div>
    {aside ? <aside ref={asideRef} className={styles.dashboardAside} data-template-region="aside" data-aside-size={asideSize}>{aside}</aside> : null}
  </div>
}
export function DashboardColumns({ children }: { children: ReactNode[] }) {
  return <div className={`${styles.dashboardRow} ${styles.dashboardColumns}`} data-template-region="row">{children.map((child, index) => <div className={styles.dashboardCell} key={index}>{child}</div>)}</div>
}
