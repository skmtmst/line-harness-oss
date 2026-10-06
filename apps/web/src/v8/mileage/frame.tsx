'use client'

/*
 * ★V8 マイルの外枠（Pencil「★V8-B 画面の地図」のマイルの行）。
 * たまる決めごと `OC0gy`・1152 `ZJIyl`・閲覧のみ `E2Any`・使い道 `S35pO`・
 * 友だちの残高 `CJlf4`・履歴 `oRbJi`・行動スコア `IRPw8`。
 *
 * 板の頭（題・説明・右の操作）とタブの段・閲覧のみの帯は5つのタブで同じ。
 * 数の帯・フォルダの列・道具の段・表は各タブが一覧の型（ListPage）の枠へ渡す。
 */
import { createContext, useContext, type ReactNode } from 'react'
import { Eye } from 'lucide-react'
import { ListPage } from '@/components/templates'
import { Tabs } from '@/components/shared/tabs'
import Button from '@/components/shared/button'
import styles from './mileage.module.css'

export const MILEAGE_TABS = [
  { key: 'earning-rules', label: 'たまる決めごと', board: 'OC0gy' },
  { key: 'rewards', label: '使い道', board: 'S35pO' },
  { key: 'balances', label: '友だちの残高', board: 'CJlf4' },
  { key: 'history', label: '履歴', board: 'oRbJi' },
  { key: 'score', label: '行動スコア', board: 'IRPw8' },
] as const

export type MileageTabKey = (typeof MILEAGE_TABS)[number]['key']

export function mileageTabHref(key: MileageTabKey): string {
  return key === 'earning-rules' ? '/mileage' : `/mileage?tab=${key}`
}

/** タブの名の横の件数（OC0gy：たまる決めごと 6・使い道 5・友だちの残高 1,284）。 */
export type MileageTabCounts = Partial<Record<MileageTabKey, string>>

export interface MileageShellContext {
  tab: MileageTabKey
  readonly: boolean
  narrow: boolean
  counts: MileageTabCounts
  /** 読み直したタブが件数を載せ直す。null で消す。 */
  setCount: (key: MileageTabKey, text: string | null) => void
}

export const MileageShell = createContext<MileageShellContext>({
  tab: 'earning-rules',
  readonly: false,
  narrow: false,
  counts: {},
  setCount: () => {},
})

export function useMileageShell(): MileageShellContext {
  return useContext(MileageShell)
}

/** 閲覧のみの帯（E2Any）。数の帯の上。 */
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
 * 残さず隠す。絵 E2Any は押せない形で描いているが、決定を優先する）。
 */
export function CreateButton({
  href,
  readonly,
  full,
  children,
}: {
  href: string
  readonly: boolean
  full?: boolean
  children: ReactNode
}) {
  // 閲覧のみ：押せない作るボタンは置かない。フォルダの列の上（full）は場所だけ空けて並びを絵どおりに保つ。
  if (readonly) return full ? <span className={styles.viewerCreateSpace} aria-hidden="true" /> : null
  return (
    <Button variant="primary" className={full ? 'v8-folder-create w-full' : undefined} href={href}>
      {children}
    </Button>
  )
}

export interface MileageFrameProps {
  /** 板の頭の右（CSV など）。 */
  actions?: ReactNode
  stats?: ReactNode
  folders?: ReactNode
  collapsedFolders?: ReactNode
  toolbar?: ReactNode
  pagination?: ReactNode
  overlays?: ReactNode
  children: ReactNode
}

/** 5つのタブの共通の外側。題・説明・タブの段・閲覧のみの帯をここで持つ。 */
export function MileageFrame({ actions, stats, folders, collapsedFolders, toolbar, pagination, overlays, children }: MileageFrameProps) {
  const { tab, readonly, narrow, counts } = useMileageShell()
  const board = tab === 'earning-rules' && narrow
    ? 'ZJIyl'
    : tab === 'earning-rules' && readonly
      ? 'E2Any'
      : MILEAGE_TABS.find((item) => item.key === tab)?.board
  return (
    <ListPage
      boardId={board}
      headingSize="regular"
      title="マイル"
      description="行動でマイルがたまり、クーポン・特典と交換できます。"
      actions={actions}
      tabs={
        <div className={styles.tabsBox}>
        <Tabs
          label="マイルのタブ"
          items={MILEAGE_TABS.map((item) => ({
            /* 絵は「たまる決めごと 6」で1つの文字。数を別の札に分けない。 */
            label: counts[item.key] ? `${item.label} ${counts[item.key]}` : item.label,
            href: mileageTabHref(item.key),
            current: item.key === tab,
          }))}
        />
        </div>
      }
      stats={stats ? <>{readonly ? <ViewerBand /> : null}{stats}</> : readonly ? <ViewerBand /> : undefined}
      folders={folders}
      collapsedFolders={collapsedFolders}
      toolbar={toolbar}
      pagination={pagination}
      overlays={overlays}
    >
      {children}
    </ListPage>
  )
}
