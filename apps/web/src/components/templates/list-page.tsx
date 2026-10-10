
import type { ReactNode } from "react"
import { CollapsedFolderActions, type FolderPanelRow } from "@/components/shared/folder-panel"
import Select from "@/components/shared/select"
import HelpTip from "@/components/shared/help-tip"
import { PageFrame, PageHeading, type PageHeadingProps } from "./page-frame"
import styles from "./page-templates.module.css"
import ReadOnlyNotice from "@/components/shared/read-only-notice"








/**
 * 左の列（フォルダ・タグ・設定のメニュー）を、白い板が狭いとき（1100 未満）に
 * 道具の段の先頭へ畳んで出すための中身。絵 L7zA7C・uBMuB の1段目「作る・フォルダ：すべて」。
 * 画面は FolderPanel に渡しているのと同じ rows・activeId・onSelect・作るボタンを渡すだけ。
 * 閲覧のみの画面は createAction を渡さない（押せない作るボタンは出さない）。
 */
export interface ListFolderNav {
  rows: Array<Pick<FolderPanelRow, 'id' | 'label'> & Partial<FolderPanelRow>>
  activeId: string
  onSelect: (id: string) => void
  /** 作るボタン。広い板でフォルダの列の上に置いているものと同じ操作。 */
  createAction?: ReactNode
  /** 選ぶ欄の呼び名（「フォルダ」「タグ」など）。選択肢は「呼び名：名前」で出す。 */
  label?: string
  /** 畳んだ選ぶ欄の幅（px）。「種類：リッチメニュー」のように選択肢が長い画面だけ渡す。省くと共通の幅（150）。 */
  width?: number
}
export interface ListPageBodyProps {
  /** B-178：テンプレート一覧を基準にした段・寸法。窓や設定内の一覧は対象外。 */
  skeleton?: boolean
  readOnly?: boolean
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
  /** 指定した板だけ、余白を含めた外寸にする。既定の列幅は変えない。 */
  folderWidth?: number
  /** 表以外の配布内容も一覧の道具列と同じ左右余白へ収める。 */
  contentInset?: boolean
  /** 窓の本文（左寄せの flex）でも、一覧の幅を窓いっぱいに広げる。 */
  fillWidth?: boolean
  /** 小窓の一覧は、ページの幅と独立してフォルダを横に並べる。 */
  dialogLayout?: boolean
  toolbar?: ReactNode
  /** 表の操作説明。本文に長い文を置かず、道具の段の「？」から読む。 */
  listHelp?: ReactNode
  children: ReactNode
  pagination?: ReactNode
  overlays?: ReactNode
}
export interface ListPageProps extends PageHeadingProps, ListPageBodyProps {
  boardId?: string
  layout?: 'event-list'
  standalone?: boolean
  tabs?: ReactNode
}
/** 状態・取得処理を持つ子コンポーネントから使う、一覧型の本文。 */
export function ListPageBody({ readOnly, skeleton, stats, folders, collapsedFolders, folderNav, folderInset, folderWidth, contentInset, fillWidth, dialogLayout, toolbar, listHelp, children, pagination, overlays }: ListPageBodyProps) {
  const navs = folderNav ? (Array.isArray(folderNav) ? folderNav : [folderNav]) : []
  const collapsed = collapsedFolders ?? (folders && navs.length > 0 ? navs.map((nav, index) => <CollapsedFolderNav key={nav.label ?? index} {...nav} />) : null)
  return <div className={styles.listBody} data-list-skeleton={skeleton ? 'templates' : undefined} data-dialog-layout={dialogLayout || undefined} style={fillWidth ? { width: '100%' } : undefined}>
    {readOnly ? <ReadOnlyNotice /> : null}
    {stats ? <div className={styles.stats} data-template-region="stats">{stats}</div> : null}
    <div className={styles.split} data-template-region="body">
      {folders ? <aside className={styles.folders} data-template-region="folders" data-shared-part="folder-column" data-folder-inset={folderInset || undefined} data-folder-width={folderWidth ? true : undefined} style={folderWidth ? { width: folderWidth, boxSizing: 'border-box' } : undefined}>{folders}</aside> : null}
      <div className={styles.main}>
        {toolbar || collapsed || listHelp ? <div className={styles.toolbar} data-template-region="toolbar" data-list-toolbar={skeleton || undefined} data-collapsed-only={toolbar || listHelp ? undefined : ''}>
          {collapsed ? <div className={styles.collapsedFolders} data-template-region="collapsed-folders">{collapsed}</div> : null}{toolbar}
          {listHelp ? <HelpTip label="一覧の操作の説明">{listHelp}</HelpTip> : null}
        </div> : null}
        <div className={styles.content} data-template-region="content" data-content-inset={contentInset || undefined}>{children}</div>
        {pagination ? <div className={styles.pagination} data-template-region="pagination">{pagination}</div> : null}
      </div>
    </div>{overlays}
  </div>
}
/** folderNav から組む、畳んだときの「作る・フォルダを選ぶ欄」。 */
function CollapsedFolderNav({ rows, activeId, onSelect, createAction, label = 'フォルダ', width }: ListFolderNav) {
  const selected = rows.find((row) => row.id === activeId)
  return <>
    {createAction ? <span className={styles.collapsedCreate}>{createAction}</span> : null}
    <span className={styles.collapsedSelect} style={width ? { width } : undefined}>
      <Select aria-label={label} value={activeId} onChange={onSelect} options={rows.map((row) => ({ value: row.id, label: `${label}：${row.label}` }))} />
    </span>
    {selected?.leadingActions?.length ? <CollapsedFolderActions row={{ ...selected, count: selected.count ?? null }} /> : null}
  </>
}
export function ListPage({ boardId, layout, standalone, tabs, title, help, identity, actions, crumbs, steps, headingSize, ...body }: ListPageProps) {
  return <PageFrame kind="list" boardId={boardId} layout={layout} standalone={standalone} skeleton={body.skeleton}>
    <PageHeading {...{ title, help, identity, actions, crumbs, steps, headingSize }} />
    {tabs ? <div className={styles.tabs} data-template-region="tabs">{tabs}</div> : null}
    <ListPageBody {...body} />
  </PageFrame>
}

/** 読込・空・失敗の条件を画面側に残したままページ送りの余白を型へ寄せる。 */
export function ListPagePagination({ children }: { children: ReactNode }) {
  return <div className={styles.pagination} data-template-region="pagination"><div className={styles.paginationRow}>{children}</div></div>
}

/** B-178：件数とページ送りを右へそろえる。外側の余白は型の段が持つ。 */
export function ListPager({ children }: { children: ReactNode }) {
  return <div className={styles.paginationRow} data-list-pager>{children}</div>
}
