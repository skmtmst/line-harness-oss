import type { ReactNode } from 'react'
import { PageFrame, PageHeading, type PageHeadingProps } from './page-frame'
import styles from './page-templates.module.css'

export interface ListPageBodyProps {
  stats?: ReactNode
  folders?: ReactNode
  /** 狭い板でも同じフォルダ選択・作る操作へ到達できる口。 */
  collapsedFolders?: ReactNode
  toolbar?: ReactNode
  children: ReactNode
  pagination?: ReactNode
  overlays?: ReactNode
}
export interface ListPageProps extends PageHeadingProps, ListPageBodyProps {
  boardId?: string
  standalone?: boolean
  tabs?: ReactNode
}
/** 状態・取得処理を持つ子コンポーネントから使う、一覧型の本文。 */
export function ListPageBody({ stats, folders, collapsedFolders, toolbar, children, pagination, overlays }: ListPageBodyProps) {
  return <div className={styles.listBody}>
    {stats ? <div className={styles.stats} data-template-region="stats">{stats}</div> : null}
    <div className={styles.split} data-template-region="body">
      {folders ? <aside className={styles.folders} data-template-region="folders">{folders}</aside> : null}
      <div className={styles.main}>
        {toolbar || collapsedFolders ? <div className={styles.toolbar} data-template-region="toolbar">
          {collapsedFolders ? <div className={styles.collapsedFolders}>{collapsedFolders}</div> : null}{toolbar}
        </div> : null}
        <div className={styles.content} data-template-region="content">{children}</div>
        {pagination ? <div className={styles.pagination} data-template-region="pagination">{pagination}</div> : null}
      </div>
    </div>{overlays}
  </div>
}
export function ListPage({ boardId, standalone, tabs, title, description, help, identity, actions, crumbs, steps, headingSize, ...body }: ListPageProps) {
  return <PageFrame kind="list" boardId={boardId} standalone={standalone}>
    <PageHeading {...{ title, description, help, identity, actions, crumbs, steps, headingSize }} />
    {tabs ? <div className={styles.tabs} data-template-region="tabs">{tabs}</div> : null}
    <ListPageBody {...body} />
  </PageFrame>
}

/** 読込・空・失敗の条件を画面側に残したままページ送りの余白を型へ寄せる。 */
export function ListPagePagination({ children }: { children: ReactNode }) {
  return <div className={styles.pagination} data-template-region="pagination"><div className={styles.paginationRow}>{children}</div></div>
}
