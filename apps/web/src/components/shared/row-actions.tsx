'use client'

import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import ActionMenu, { type ActionMenuItem } from './action-menu'
import Button from './button'
import styles from './row-actions.module.css'

type Base = { className?: string } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>

function IconButton({
  label,
  tone,
  grip,
  className,
  children,
  ...rest
}: Base & { label: string; tone?: 'danger'; grip?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={[styles.action, tone === 'danger' && styles.danger, grip && styles.grip, className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </button>
  )
}

/**
 * 並び替えハンドル。Pencil V5 の `K65Uhe`。★V5 で75回。
 *
 * **行の先頭に置く。** 右の操作列に混ぜない。
 */
export function DragHandle({ label = '並び替える', ...rest }: Base & { label?: string }) {
  return (
    <IconButton label={label} grip {...rest}>
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <circle cx="9" cy="6" r="1.6" />
        <circle cx="15" cy="6" r="1.6" />
        <circle cx="9" cy="12" r="1.6" />
        <circle cx="15" cy="12" r="1.6" />
        <circle cx="9" cy="18" r="1.6" />
        <circle cx="15" cy="18" r="1.6" />
      </svg>
    </IconButton>
  )
}

/**
 * 削除。Pencil V5 の `Ls12y`。★V5 で75回。
 *
 * 押した先では必ず確認を出す。消える件数と、参照している場所を先に見せる。
 */
export function DeleteAction({ label = '削除する', ...rest }: Base & { label?: string }) {
  return (
    <IconButton label={label} tone="danger" {...rest}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
        <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </IconButton>
  )
}

/**
 * その他操作（…）。Pencil V5 の `H0V8EK`。
 */
export function MoreAction({ label = 'そのほかの操作', ...rest }: Base & { label?: string }) {
  return (
    <IconButton label={label} {...rest}>
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <circle cx="5" cy="12" r="1.8" />
        <circle cx="12" cy="12" r="1.8" />
        <circle cx="19" cy="12" r="1.8" />
      </svg>
    </IconButton>
  )
}

/* ------------------------------------------------------------- LAY-18 */

/*
 * #985 LAY-18: 一覧の操作はアプリ全体で同じルールにする。
 *
 * - 「詳細」は右端操作欄の先頭。閲覧する画面がない機能には置かない。
 * - 「編集」は「詳細」の次。同じ枠付きの補助ボタン（共通 Button）。
 * - 複製・停止・アーカイブなどは「⋯」へ同じ順序で集約する。
 * - 削除など元に戻せない操作は区切りの後・赤で必ず最後に置く。
 *   ただし実装・許可されている操作だけを出す。全機能に削除を足さない。
 * - 権限で許可されない操作は呼び出し側が渡さない（サーバ側の権限
 *   判定はそのまま維持する）。
 * - 使用中等で押せない操作は disabledReason で理由を示す。
 * - タッチ端末では「⋯」を含め操作領域44pxを確保する（CSS側）。
 */

/** 「詳細」「編集」のような先頭に出す操作。遷移か実行かのどちらか。 */
export type RowAction = {
  /** 既定は役割の名前（「詳細」「編集」）。行き先が役割と違うときだけ明記する。 */
  label?: string
  disabled?: boolean
} & ({ href: string; onClick?: never } | { onClick: () => void; href?: never })

/** 「⋯」の中へ入れる削除などの操作。色と区切りは部品側で固定する。 */
export type RowActionDestructiveItem = Omit<ActionMenuItem, 'tone' | 'dividerBefore'>

export type RowActionsProps = {
  /** 先頭の操作。既定ラベルは「詳細」。 */
  detail?: RowAction
  /** 2番目の操作。既定ラベルは「編集」。 */
  edit?: RowAction
  /** 「⋯」に集約する複製・停止・アーカイブなど。 */
  menuItems?: ActionMenuItem[]
  /** 削除など元に戻せない操作。区切りの後に赤で最後へ置く。 */
  destructiveItem?: RowActionDestructiveItem
  /** メニューの下に出す補足（例：閲覧専用の理由）。 */
  menuNote?: string
  /** aria名に使う行の名前（例：テンプレート名）。 */
  subjectName?: string
  /** 「⋯」ボタンへ渡す追加属性（撮影入口の data-qa-open など）。 */
  menuButtonProps?: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-expanded' | 'aria-label' | 'children' | 'className' | 'onClick' | 'type'> & {
    [key: `data-${string}`]: string | undefined
  }
  className?: string
}

function RowActionButton({ action, defaultLabel }: { action: RowAction; defaultLabel: string }) {
  const label = action.label ?? defaultLabel
  const props =
    'href' in action && action.href !== undefined
      ? { href: action.href }
      : { onClick: action.onClick, disabled: action.disabled }
  return (
    <Button {...props} className={styles.rowButton}>
      {label}
    </Button>
  )
}

/**
 * 一覧行の右端に置く操作の並び。「詳細」「編集」の枠付きボタンと、
 * それ以外を集約する「⋯」メニューを同じ順・同じ見た目で出す。
 */
export function RowActions({
  detail,
  edit,
  menuItems = [],
  destructiveItem,
  menuNote,
  subjectName,
  menuButtonProps,
  className,
}: RowActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const items: ActionMenuItem[] = destructiveItem
    ? [...menuItems, { ...destructiveItem, tone: 'danger', dividerBefore: menuItems.length > 0 }]
    : menuItems
  return (
    <span className={[styles.rowActions, className].filter(Boolean).join(' ')}>
      {detail ? <RowActionButton action={detail} defaultLabel="詳細" /> : null}
      {edit ? <RowActionButton action={edit} defaultLabel="編集" /> : null}
      {items.length > 0 ? (
        <>
          <MoreAction
            {...menuButtonProps}
            label={subjectName ? `${subjectName}のその他操作` : 'そのほかの操作'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          />
          <ActionMenu
            open={menuOpen}
            ariaLabel={subjectName ? `${subjectName}の操作` : '操作'}
            onClose={() => setMenuOpen(false)}
            items={items}
            note={menuNote}
          />
        </>
      ) : null}
    </span>
  )
}
