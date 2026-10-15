
'use client'

import { PageExplanationProvider, PageExplanationToggle, PageExplanationBody } from '@/components/shared/page-explanation'
import type { CSSProperties, ReactNode } from 'react'
import { CollapsedFolderActions, type FolderPanelRow } from '@/components/shared/folder-panel'
import Select from '@/components/shared/select'
import { ListToolbarLeading } from '@/components/shared/list-toolbar'
import HelpTip from '@/components/shared/help-tip'
import { PageFrame, PageHeading, type PageHeadingProps } from './page-frame'
import styles from './page-templates.module.css'
import ReadOnlyNotice from '@/components/shared/read-only-notice'
import { ListFolderContext } from '@/components/shared/list-folder-context'

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
  /** 表とページ送りを道具の段と同じ左右24の内側に置く板（絵が表を白い板の端まで伸ばさない：YMVFD）。既定は B-217 の領域いっぱい。 */
  tableInset?: boolean
  /** 窓の本文（左寄せの flex）でも、一覧の幅を窓いっぱいに広げる。 */
  fillWidth?: boolean
  /** 小窓の一覧は、ページの幅と独立してフォルダを横に並べる。 */
  dialogLayout?: boolean
  toolbar?: ReactNode
  /** 固定した絵で道具の上下余白が16の一覧。通常の14は変えない。 */
  toolbarSpacing?: 'section'
  /** 案内の帯と道具の段の間を16にする固定絵。既定の段間は変えない。 */
  noticeSpacing?: 'section'
  /** 案内と道具を別の行に置く一覧。行同士はカードの間隔（16）。 */
  toolbarRowGap?: 'card'
  /** 表の操作説明。本文に長い文を置かず、道具の段の「？」から読む。 */
  explanation?: ReactNode
  /** 印なしの説明を本文の開始位置へそろえる板だけで指定する。 */
  explanationInset?: 'notice' | 'content'
  listHelp?: ReactNode
  /** 明示の道具のEndへ説明を渡す。既定は道具の外側。 */
  listHelpPlacement?: 'end'
  children: ReactNode
  pagination?: ReactNode
  overlays?: ReactNode
}
export interface ListPageProps extends PageHeadingProps, ListPageBodyProps {
  heightMode?: 'viewport' | 'content'
  boardId?: string
  layout?: 'event-list'
  standalone?: boolean
  tabs?: ReactNode
}

function listFolderNavs(folderNav: ListPageBodyProps['folderNav']) {
  return folderNav ? (Array.isArray(folderNav) ? folderNav : [folderNav]) : []
}
function hasListFolders({ folderNav, folders, collapsedFolders }: ListPageBodyProps) {
  const navs = listFolderNavs(folderNav)
  return navs.length ? navs.some(nav => nav.rows.length > 1) : !!(folders || collapsedFolders)
}
/** 状態・取得処理を持つ子コンポーネントから使う、一覧型の本文。 */
export function ListPageBody({ readOnly, skeleton, stats, folders, collapsedFolders, folderNav, folderInset, folderWidth, contentInset, tableInset, fillWidth, dialogLayout, toolbar, toolbarRowGap, toolbarSpacing, noticeSpacing, explanation, explanationInset = 'notice', listHelp, listHelpPlacement, children, pagination, overlays }: ListPageBodyProps) {
