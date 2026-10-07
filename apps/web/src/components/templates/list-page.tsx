import type { ReactNode } from 'react'
import Select from '@/components/shared/select'
import { PageFrame, PageHeading, type PageHeadingProps } from './page-frame'
import styles from './page-templates.module.css'

/**
 * 左の列（フォルダ・タグ・設定のメニュー）を、白い板が狭いとき（1100 未満）に
 * 道具の段の先頭へ畳んで出すための中身。絵 L7zA7C・uBMuB の1段目「作る・フォルダ：すべて」。
 * 画面は FolderPanel に渡しているのと同じ rows・activeId・onSelect・作るボタンを渡すだけ。
 * 閲覧のみの画面は createAction を渡さない（押せない作るボタンは出さない）。
 */
export interface ListFolderNav {
  rows: { id: string; label: string }[]
  activeId: string
  onSelect: (id: string) => void
  /** 作るボタン。広い板でフォルダの列の上に置いているものと同じ操作。 */
  createAction?: ReactNode
  /** 選ぶ欄の呼び名（「フォルダ」「タグ」など）。選択肢は「呼び名：名前」で出す。 */
  label?: string
}
export interface ListPageBodyProps {
  stats?: ReactNode
  folders?: ReactNode
  /** 狭い板でも同じフォルダ選択・作る操作へ到達できる口。渡すと folderNav より優先する。 */
  collapsedFolders?: ReactNode
  /**
   * collapsedFolders を渡さない画面のための口。型が「作る・フォルダを選ぶ欄」を組んで畳んだ段に出す。
   * 左の列に選ぶものが2つある画面（統括のテンプレートの種類と分類など）は配列で渡す。
   */
  folderNav?: ListFolderNav | ListFolderNav[]
  /** 左の列の左の余白を 24 にする（統括の画面。絵 JKjsE・LRc93 ほか）。ふつうの一覧は 12。 */
  folderInset?: boolean
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
export function ListPageBody({ stats, folders, collapsedFolders, folderNav, folderInset, toolbar, children, pagination, overlays }: ListPageBodyProps) {
  const navs = folderNav ? (Array.isArray(folderNav) ? folderNav : [folderNav]) : []
  const collapsed = collapsedFolders ?? (folders && navs.length > 0 ? navs.map((nav, index) => <CollapsedFolderNav key={nav.label ?? index} {...nav} />) : null)
  return <div className={styles.listBody}>
    {stats ? <div className={styles.stats} data-template-region="stats">{stats}</div> : null}
    <div className={styles.split} data-template-region="body">
      {folders ? <aside className={styles.folders} data-template-region="folders" data-folder-inset={folderInset || undefined}>{folders}</aside> : null}
      <div className={styles.main}>
        {toolbar || collapsed ? <div className={styles.toolbar} data-template-region="toolbar" data-collapsed-only={toolbar ? undefined : ''}>
          {collapsed ? <div className={styles.collapsedFolders} data-template-region="collapsed-folders">{collapsed}</div> : null}{toolbar}
        </div> : null}
        <div className={styles.content} data-template-region="content">{children}</div>
        {pagination ? <div className={styles.pagination} data-template-region="pagination">{pagination}</div> : null}
      </div>
    </div>{overlays}
  </div>
}
/** folderNav から組む、畳んだときの「作る・フォルダを選ぶ欄」。 */
function CollapsedFolderNav({ rows, activeId, onSelect, createAction, label = 'フォルダ' }: ListFolderNav) {
  return <>
    {createAction ? <span className={styles.collapsedCreate}>{createAction}</span> : null}
    <span className={styles.collapsedSelect}>
      <Select aria-label={label} value={activeId} onChange={onSelect} options={rows.map((row) => ({ value: row.id, label: `${label}：${row.label}` }))} />
    </span>
  </>
}
export function ListPage({ boardId, standalone, tabs, title, description, help, identity, actions, steps, headingSize, ...body }: ListPageProps) {
  return <PageFrame kind="list" boardId={boardId} standalone={standalone}>
    <PageHeading {...{ title, description, help, identity, actions, steps, headingSize }} />
    {tabs ? <div className={styles.tabs} data-template-region="tabs">{tabs}</div> : null}
    <ListPageBody {...body} />
  </PageFrame>
}

/** 読込・空・失敗の条件を画面側に残したままページ送りの余白を型へ寄せる。 */
export function ListPagePagination({ children }: { children: ReactNode }) {
  return <div className={styles.pagination} data-template-region="pagination"><div className={styles.paginationRow}>{children}</div></div>
}
