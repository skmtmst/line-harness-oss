'use client'

import { MoreHorizontal } from 'lucide-react'
import { useRef, useState, type ButtonHTMLAttributes, type MouseEvent, type ReactNode, type RefObject } from 'react'
import ActionMenu, { type ActionMenuItem } from './action-menu'
import Button from './button'
import IconButton from './icon-button'
import ReorderHandle from './reorder-handle'
import styles from './row-actions.module.css'

type Base = { className?: string } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>

function RowIconButton({
  label,
  tone,
  grip,
  className,
  buttonRef,
  children,
  ...rest
}: Base & { label: string; tone?: 'danger'; grip?: boolean; buttonRef?: RefObject<HTMLButtonElement | null>; children: ReactNode }) {
  return (
    <button
      ref={buttonRef}
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
 *
 * 中身は共通の並び替え部品（./reorder-handle）の `icon` の見た目。
 * 新しい画面は ReorderHandle と useReorder を直接使う（ドラッグ・上下キー・「…」を1つにする）。
 */
export function DragHandle({ label = '並び替える', ...rest }: Base & { label?: string }) {
  return <ReorderHandle look="icon" label={label} ariaLabel={label} title={label} {...rest} />
}

/**
 * 削除。Pencil V5 の `Ls12y`。★V5 で75回。
 *
 * 押した先では必ず確認を出す。消える件数と、参照している場所を先に見せる。
 */
export function DeleteAction({ label = '削除する', ...rest }: Base & { label?: string }) {
  return (
    <RowIconButton label={label} tone="danger" {...rest}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
        <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </RowIconButton>
  )
}

/**
 * その他操作（…）。Pencil V5 の `H0V8EK`。
 */
export function MoreAction({ label = 'そのほかの操作', buttonRef, ...rest }: Base & { label?: string; buttonRef?: RefObject<HTMLButtonElement | null> }) {
  return (
    <RowIconButton label={label} buttonRef={buttonRef} {...rest}>
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <circle cx="5" cy="12" r="1.8" />
        <circle cx="12" cy="12" r="1.8" />
        <circle cx="19" cy="12" r="1.8" />
      </svg>
    </RowIconButton>
  )
}

/* ------------------------------------------------------------- 「…」 */

/**
 * 危ない操作（tone: 'danger'）を最後へ集め、最初の1つの前に区切りを入れる。
 * 「危険な操作は赤字で区切りの下」は部品の中で決める（画面ごとに並べない）。
 */
export function orderRowMenuItems(items: ActionMenuItem[]): ActionMenuItem[] {
  const safe = items.filter((item) => item.tone !== 'danger')
  const danger = items.filter((item) => item.tone === 'danger')
  return [
    ...safe,
    ...danger.map((item, index) => ({ ...item, dividerBefore: index === 0 ? safe.length > 0 : false })),
  ]
}

type RowMenuTriggerProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-expanded' | 'aria-haspopup' | 'aria-label' | 'children' | 'className' | 'onClick' | 'type'
> & {
  [key: `data-${string}`]: string | undefined
}

export type RowMenuProps = {
  /** 「…」の中の項目。危ない操作（tone: 'danger'）は部品が最後・区切りの下へ回す。 */
  items: ActionMenuItem[]
  /** 「…」ボタンの読み上げ名（例：「春のセールの操作」）。 */
  label: string
  /** メニューの読み上げ名。省略時は label。 */
  menuLabel?: string
  /** メニューの下に出す補足（例：閲覧専用の理由）。 */
  note?: string
  /**
   * 開いているか（画面が持つとき）。右クリックの ContextMenu と同じ行の
   * 「…」を1つの状態で開け閉めするときなどに渡す。渡さなければ部品が持つ。
   */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /**
   * 見た目。'box' は ★V8 の行の「…」（KspUx の印ボタン＋横の3点）。
   * 'plain' は枠の無い V5 の「…」（RowActions・v7 の一覧）。
   */
  appearance?: 'box' | 'plain'
  /** 「…」ボタンの大きさなど、画面の絵に合わせる class。 */
  className?: string
  /** 「…」ボタンの title。省略時は label。 */
  title?: string
  /** 「…」ボタンへ渡す追加属性（撮影入口の data-qa-open・disabled など）。 */
  triggerProps?: RowMenuTriggerProps
}

/**
 * 行の右端の「…」（★V8 hnuY9 その他操作メニュー）。全部の画面がこれを使う。
 *
 * 部品の中で決めていること：
 * - 押した「…」から開く（位置の基準は押したボタン。下に場所が無ければ上へ）
 * - Esc・外を押す・Tab で閉じ、閉じたら「…」へ戻る。矢印・Home・End で項目を移る
 * - 「…」と項目の押下は行（tr の詳細へ行く押下など）へ伝えない
 * - 危ない操作は赤字で、区切りの下・最後
 */
export function RowMenu({
  items,
  label,
  menuLabel,
  note,
  open: openProp,
  onOpenChange,
  appearance = 'box',
  className,
  title,
  triggerProps,
}: RowMenuProps) {
  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOpenState(next)
    onOpenChange?.(next)
  }
  const triggerRef = useRef<HTMLButtonElement>(null)
  if (items.length === 0) return null
  const toggle = (event: MouseEvent<HTMLButtonElement>) => {
    /* R13: 「…」自体の押下も行の詳細遷移へ伝えない。 */
    event.stopPropagation()
    setOpen(!open)
  }
  const common = {
    ...triggerProps,
    'aria-haspopup': 'menu' as const,
    'aria-expanded': open,
    onClick: toggle,
  }
  return (
    <>
      {appearance === 'plain' ? (
        <MoreAction {...common} label={label} buttonRef={triggerRef} className={className} />
      ) : (
        <IconButton {...common} ref={triggerRef} aria-label={label} title={title ?? label} className={className} data-row-menu="">
          <MoreHorizontal size={16} aria-hidden="true" />
        </IconButton>
      )}
      <ActionMenu
        open={open}
        ariaLabel={menuLabel ?? label}
        onClose={() => setOpen(false)}
        items={orderRowMenuItems(items)}
        note={note}
        anchorRef={triggerRef}
      />
    </>
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
    <Button {...props} size="compact" className={styles.rowButton}>
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
  const items: ActionMenuItem[] = destructiveItem
    ? [...menuItems, { ...destructiveItem, tone: 'danger' }]
    : menuItems
  return (
    <span className={[styles.rowActions, className].filter(Boolean).join(' ')}>
      {detail ? <RowActionButton action={detail} defaultLabel="詳細" /> : null}
      {edit ? <RowActionButton action={edit} defaultLabel="編集" /> : null}
      {items.length > 0 ? (
        <RowMenu
          appearance="plain"
          items={items}
          label={subjectName ? `${subjectName}のその他操作` : 'そのほかの操作'}
          menuLabel={subjectName ? `${subjectName}の操作` : '操作'}
          note={menuNote}
          triggerProps={menuButtonProps}
        />
      ) : (
        /*
         * 「⋯」が無い行（送信済みなど）でも同じ幅の場所を取る。
         * 無いと主ボタン（詳細）が右へずれて行ごとにそろわない。
         * 見せない・読ませないが、幅は「⋯」と同じだけ取る。
         */
        <span className={styles.morePlaceholder} data-more-placeholder aria-hidden="true" />
      )}
    </span>
  )
}
