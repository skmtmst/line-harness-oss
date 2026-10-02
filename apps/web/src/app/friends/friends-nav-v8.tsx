'use client'

/*
 * ★V8 友だちの「データ管理」メニュー（specs/friends-data-menu.md・採用 D、
 * Pencil `XWrGf`・`sdbsQ`）。
 *
 * v7 で見えていたタブ行（友だち一覧・重複検出・統合ユーザー・UID移行）は
 * v8 では出さない。低頻度の管理画面への行き先は右上の「データ管理 ▾」へ
 * まとめ、管理画面同士は「← 友だち一覧 › データ管理 › 今の画面」の段で
 * 往復できるようにする。
 *
 * 項目の名前と行き先は `friends-tabs.ts` の FRIENDS_MERGED_TABS が正本
 * （キー・名前・href をここで書き換えない）。API・権限も変えない。
 */
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useRef, useState } from 'react'
import { ChevronDown, Database } from 'lucide-react'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import Button from '@/components/shared/button'
import { useStaffRole, canManageRole } from '@/lib/staff-role'
import { FRIENDS_MERGED_TABS } from './friends-tabs'
import styles from './friends-v8.module.css'

/** メニューの組に出す短い説明（Pencil `XWrGf` の文言）。 */
const MANAGE_DESCRIPTIONS: Record<string, string> = {
  duplicates: '重複の可能性を確かめる',
  merged: 'まとめた人の一覧',
  'uid-migration': '別のアカウントへ引き継ぐ',
}

/**
 * 「データ管理 ▾」の開くボタンとメニュー。
 *
 * `onExportCurrentPage` は友だち一覧タブだけが渡す（表示中のページを
 * CSVにする今どおりの動き）。管理画面では「表示中」が無いので項目ごと
 * 出さない。
 */
export function FriendsDataMenuV8({
  onExportCurrentPage,
}: {
  onExportCurrentPage?: (() => void) | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement | null>(null)
  const staffRole = useStaffRole()
  /*
   * CSVの出し入れは owner/admin だけ（spec §3「権限が無い人にはその項目を
   * 出さない」）。役割が読めるまでは今までどおり出す（最後の守りは
   * /friends/migrations 側の 403）。
   */
  const canManageCsv = staffRole === null || canManageRole(staffRole)

  const manageItems: ActionMenuItem[] = FRIENDS_MERGED_TABS.filter(
    (tab) => tab.key !== 'list',
  ).map((tab, index) => ({
    id: tab.key,
    label: tab.label,
    description: MANAGE_DESCRIPTIONS[tab.key],
    sectionBefore: index === 0 ? '同じ人をまとめる' : undefined,
    external: true,
    qaOpen: `friends-data-menu-${tab.key}`,
    onSelect: () => router.push(tab.href ?? '/friends'),
  }))

  const csvHref = '/friends/migrations'
  const fileItems: ActionMenuItem[] = [
    ...(onExportCurrentPage
      ? [{
          id: 'export-visible',
          label: '表示中をCSVで書き出す',
          qaOpen: 'friends-data-menu-export-visible',
          onSelect: onExportCurrentPage,
        }]
      : []),
    ...(canManageCsv
      ? [
          {
            id: 'csv-export',
            label: 'CSVで書き出す',
            external: true,
            qaOpen: 'friends-data-menu-csv-export',
            onSelect: () => router.push(csvHref),
          },
          {
            id: 'csv-import',
            label: '取り込む',
            external: true,
            qaOpen: 'friends-data-menu-csv-import',
            onSelect: () => router.push(csvHref),
          },
        ]
      : []),
  ]
  // 組の見出し「ファイル」は先頭の項目にだけ付ける（同じ見出しを2回出さない）。
  if (fileItems.length > 0) fileItems[0].sectionBefore = 'ファイル'

  return (
    <span data-friends-data-menu="v8">
      <Button
        type="button"
        variant="secondary"
        ref={anchorRef}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Database aria-hidden="true" className="h-3.5 w-3.5" />
        データ管理
        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
      </Button>
      <ActionMenu
        open={open}
        items={[...manageItems, ...fileItems]}
        onClose={() => setOpen(false)}
        ariaLabel="データ管理"
        anchorRef={anchorRef}
      />
    </span>
  )
}

/**
 * 一覧タブの板の頭（ywJ5H・sdbsQ）：題「友だち」＋説明1行、右に
 * 「データ管理 ▾」（副）→「友だちを取り込む」（主・緑は1つ）。
 * 「友だちを取り込む」の行き先は既にある CSV 取り込み（/friends/migrations）。
 * 一覧の表そのもの（KPI・絞り込み・表）は機能11の担当で、ここでは触らない。
 */
export function FriendsListHeadV8({
  onExportCurrentPage,
}: {
  onExportCurrentPage?: (() => void) | null
}) {
  return (
    <div className={styles.head}>
      <div className={styles.headText}>
        <h2 className={styles.headTitle}>友だち</h2>
        <p className={styles.headDescription}>
          LINE でつながっている人の一覧です。タグと対応の状態で絞り込めます。
        </p>
      </div>
      <div className={styles.headAction}>
        <FriendsDataMenuV8 onExportCurrentPage={onExportCurrentPage} />
        <Button variant="primary" href="/friends/migrations">
          友だちを取り込む
        </Button>
      </div>
    </div>
  )
}

/**
 * 管理画面の「← 友だち一覧 › データ管理 › 今の画面」の段（sdbsQ）。
 * 右に同じ「データ管理 ▾」を置き、隣の管理画面へ直接移れるようにする。
 */
export function FriendsManageNavV8({ current }: { current: string }) {
  return (
    <div className={styles.manageNav} data-friends-manage-nav="v8">
      <nav aria-label="データ管理の中の現在地" className={styles.manageCrumbs}>
        <Link href="/friends">← 友だち一覧</Link>
        <span className={styles.sep} aria-hidden="true">›</span>
        <span className={styles.group}>データ管理</span>
        <span className={styles.sep} aria-hidden="true">›</span>
        <span className={styles.here} aria-current="page">{current}</span>
      </nav>
      <FriendsDataMenuV8 />
    </div>
  )
}
