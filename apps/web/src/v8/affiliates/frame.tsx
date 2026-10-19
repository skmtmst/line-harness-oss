'use client'

/*
 * ★V8 成果とアフィリエイトの外枠（Pencil「★V8-B 画面の地図」の成果とアフィリエイトの行）。
 * アフィリエイター ・1152 ・閲覧のみ ・案件 ・
 * 成果承認 ・支払い ・レポート （状態は見本帳 ）。
 *
 * 板の頭（題・説明・右の操作）とタブの段・閲覧のみの帯は5つのタブで同じ。
 * 数の帯・フォルダの列・道具の段・表は各タブが一覧の型（ListPage）の枠へ渡す。
 */
import { createContext, useContext, type ReactNode } from 'react'

import { ListPage, type ListFolderNav } from '@/components/templates'
import { Tabs } from '@/components/shared/tabs'
import Button from '@/components/shared/button'
import styles from './affiliates.module.css'

import ReadOnlyNotice from '@/components/shared/read-only-notice'

/** 5つの一覧が同じ共通表の口へ渡す寸法。 */
export const AFFILIATE_TABLE_LAYOUT = {
  headHeight: 'var(--tpl-af-head-h)',
  rowHeight: 'var(--tpl-af-row-h)',
  gap: 'var(--tpl-af-col-gap)',
  padding: '0 var(--tpl-list-inset)',
  numberInset: 'var(--tpl-af-num-pad-end)',
  bodyTextSize: 'var(--polish-text-body)',
  collapseScope: 'page' as const,
}

export const AFFILIATE_TABS = [
  { key: 'affiliates', label: 'アフィリエイター', board: 'nJlxX' },
  { key: 'offers', label: '案件', board: 'h7dmB' },
  { key: 'approvals', label: '成果承認', board: 'OylSV' },
  { key: 'payment', label: '支払い', board: 'aINnz' },
  { key: 'report', label: 'レポート', board: 'Eo56k' },
] as const

export type AffiliateTabKey = (typeof AFFILIATE_TABS)[number]['key']

export function affiliateTabHref(key: AffiliateTabKey): string {
  return key === 'affiliates' ? '/affiliates' : `/affiliates?tab=${key}`
}

/** タブの名の横の件数（：アフィリエイター 6・案件 4・成果承認 5）。 */
export type AffiliateTabCounts = Partial<Record<AffiliateTabKey, string>>

export interface AffiliateShellContext {
  tab: AffiliateTabKey
  readonly: boolean
  narrow: boolean
  accountId: string | null
  counts: AffiliateTabCounts
  /** 読み直したタブが件数を載せ直す。null で消す。 */
  setCount: (key: AffiliateTabKey, text: string | null) => void
  /** 停止前の確認などから来る `?affiliate=`。 */
  focusAffiliateId: string | null
}

export const AffiliateShell = createContext<AffiliateShellContext>({
  tab: 'affiliates',
  readonly: false,
  narrow: false,
  accountId: null,
  counts: {},
  setCount: () => {},
  focusAffiliateId: null,
})

export function useAffiliateShell(): AffiliateShellContext {
  return useContext(AffiliateShell)
}

/** 閲覧のみの帯。数の帯の上。 */
export function ViewerBand() {
  return (
    <div className={styles.viewerBand}><ReadOnlyNotice role="note"></ReadOnlyNotice></div>
  )
}

/**
 * 作るボタン。閲覧のみの人には出さない（2026-10-06 オーナー：押せない形で
 * 残さず隠す）。隠した作成操作のための空白も置かない。
 */
export function CreateButton({
  href,
  onClick,
  readonly,
  full,
  children,
}: {
  href?: string
  onClick?: () => void
  readonly: boolean
  full?: boolean
  children: ReactNode
}) {
  if (readonly) return null
  return (
    <Button variant="primary" className={full ? 'v8-folder-create w-full' : undefined} href={href} onClick={onClick}>
      {children}
    </Button>
  )
}

export interface AffiliateFrameProps {
  /** 板の頭の右（CSV など）。 */
  help?: ReactNode
  /** 一覧の操作の説明。道具の段の右端の「？」に出す。 */
  listHelp?: ReactNode
  explanation?: ReactNode
  explanationKey?: string
  actions?: ReactNode
  stats?: ReactNode
  folders?: ReactNode
  /** 板が狭く左の列が畳まれたときに型が道具の段へ出す「作る・フォルダ」。 */
  folderNav?: ListFolderNav
  toolbar?: ReactNode
  pagination?: ReactNode
  overlays?: ReactNode
  children: ReactNode
}

/** 5つのタブの共通の外側。題・説明・タブの段・閲覧のみの帯をここで持つ。 */
export function AffiliateFrame({ help, listHelp, explanation, explanationKey, actions, stats, folders, folderNav, toolbar, pagination, overlays, children }: AffiliateFrameProps) {
  const { tab, readonly, narrow, counts } = useAffiliateShell()
  const board = tab === 'affiliates' && narrow
    ? 'KdFRI'
    : tab === 'affiliates' && readonly
      ? 'v9JWQ'
      : AFFILIATE_TABS.find((item) => item.key === tab)?.board
  return (
    <ListPage
      help={<>{"紹介してくれる人（アフィリエイター）と案件を登録し、成果を認めて報酬を払います。成果の数え方はコンバージョンで決めます。"}{help}</>}
      skeleton
      explanation={explanation}
      explanationKey={explanationKey ?? `affiliates:${tab}`}
      boardId={board}
      headingSize="regular"
      title="成果とアフィリエイト"

      actions={actions}
      tabs={
        <div className={styles.tabsBox}>
          <Tabs
            label="成果とアフィリエイトのタブ"
            items={AFFILIATE_TABS.map((item) => ({
              /* 絵は「アフィリエイター 6」で1つの文字。数を別の札に分けない。 */
              label: counts[item.key] ? `${item.label} ${counts[item.key]}` : item.label,
              href: affiliateTabHref(item.key),
              current: item.key === tab,
            }))}
          />
        </div>
      }
      stats={stats ? <>{readonly ? <ViewerBand /> : null}{stats}</> : readonly ? <ViewerBand /> : undefined}
      folders={folders}
      folderNav={folderNav}
      toolbar={toolbar}
      listHelp={listHelp}
      listHelpPlacement={listHelp ? 'end' : undefined}
      pagination={pagination}
      overlays={overlays}
    >
      {children}
    </ListPage>
  )
}
