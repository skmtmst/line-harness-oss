'use client'

/*
 * ★V8 成果とアフィリエイトの外枠（Pencil「★V8-B 画面の地図」の成果とアフィリエイトの行）。
 * アフィリエイター `nJlxX`・1152 `KdFRI`・閲覧のみ `v9JWQ`・案件 `h7dmB`・
 * 成果承認 `OylSV`・支払い `aINnz`・レポート `Eo56k`（状態は見本帳 `rRk0C`）。
 *
 * 板の頭（題・説明・右の操作）とタブの段・閲覧のみの帯は5つのタブで同じ。
 * 数の帯・フォルダの列・道具の段・表は各タブが一覧の型（ListPage）の枠へ渡す。
 */
import { createContext, useContext, type ReactNode } from 'react'
import { Eye } from 'lucide-react'
import { ListPage } from '@/components/templates'
import { Tabs } from '@/components/shared/tabs'
import Button from '@/components/shared/button'
import styles from './affiliates.module.css'

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

/** タブの名の横の件数（nJlxX：アフィリエイター 6・案件 4・成果承認 5）。 */
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

/** 閲覧のみの帯（v9JWQ）。数の帯の上。 */
export function ViewerBand() {
  return (
    <p className={styles.viewerBand} role="note">
      <Eye size={16} aria-hidden="true" />
      <span>閲覧のみで見ています。変える操作は管理者に頼んでください。</span>
    </p>
  )
}

/**
 * 作るボタン。閲覧のみの人には出さない（2026-10-06 オーナー：押せない形で
 * 残さず隠す）。フォルダの列の上（full）は場所だけ空けて並びを絵どおりに保つ。
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
  if (readonly) return full ? <span className={styles.viewerCreateSpace} aria-hidden="true" /> : null
  return (
    <Button variant="primary" className={full ? 'v8-folder-create w-full' : undefined} href={href} onClick={onClick}>
      {children}
    </Button>
  )
}

export interface AffiliateFrameProps {
  /** 板の頭の右（CSV など）。 */
  actions?: ReactNode
  stats?: ReactNode
  folders?: ReactNode
  toolbar?: ReactNode
  pagination?: ReactNode
  overlays?: ReactNode
  children: ReactNode
}

/** 5つのタブの共通の外側。題・説明・タブの段・閲覧のみの帯をここで持つ。 */
export function AffiliateFrame({ actions, stats, folders, toolbar, pagination, overlays, children }: AffiliateFrameProps) {
  const { tab, readonly, narrow, counts } = useAffiliateShell()
  const board = tab === 'affiliates' && narrow
    ? 'KdFRI'
    : tab === 'affiliates' && readonly
      ? 'v9JWQ'
      : AFFILIATE_TABS.find((item) => item.key === tab)?.board
  return (
    <ListPage
      boardId={board}
      headingSize="regular"
      title="成果とアフィリエイト"
      description="紹介してくれる人（アフィリエイター）と案件を登録し、成果を認めて報酬を払います。成果の数え方はコンバージョンで決めます。"
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
      toolbar={toolbar}
      pagination={pagination}
      overlays={overlays}
    >
      {children}
    </ListPage>
  )
}
