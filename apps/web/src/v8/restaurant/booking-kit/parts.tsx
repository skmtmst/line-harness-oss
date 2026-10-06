'use client'

/*
 * ★V8 飲食店向け（在庫・予約台帳・座席・メニュー）で使い回す小さな部品。
 * - RowMore：行の右端の「…」（右クリックだけで開く操作にしない）。
 * - RsDialog：絵の窓（幅・上からの位置・題の下 14 の間・下の線と右寄せのボタン）。
 */
import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import Dialog from '@/components/shared/dialog'
import { MoreAction } from '@/components/shared/row-actions'
import styles from './parts.module.css'

/** 行の「…」。読み上げ名は「{subject}の操作」。 */
export function RowMore({ subject, items }: { subject: string; items: ActionMenuItem[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  if (items.length === 0) return <span className={styles.morePlaceholder} aria-hidden="true" />
  return (
    <span className={styles.moreBox}>
      <MoreAction
        buttonRef={ref}
        label={`${subject}の操作`}
        className={styles.more}
        aria-expanded={open}
        onClick={(event) => { event.stopPropagation(); setOpen((value) => !value) }}
      />
      <ActionMenu open={open} ariaLabel={`${subject}の操作の一覧`} onClose={() => setOpen(false)} items={items} anchorRef={ref} />
    </span>
  )
}

/**
 * 絵の窓。共通の Dialog に幅と位置を渡し、中身・下のボタンは絵の並び
 * （題の段のあと 14 の間・各段 14・下の線の上 14）で置く。
 * onSubmit を渡すと中身を form にする（Enter で保存できる）。
 */
export function RsDialog({ open, title, width, top, tone, busy, designNode, onCancel, onSubmit, actions, children }: {
  open: boolean
  title: string
  width: number
  top: number
  tone?: 'default' | 'destructive'
  busy?: boolean
  designNode?: string
  onCancel: () => void
  onSubmit?: () => void
  actions: ReactNode
  children: ReactNode
}) {
  const body = (
    <>
      {children}
      <div className={styles.dialogActions}>{actions}</div>
    </>
  )
  return (
    <Dialog
      open={open}
      title={title}
      tone={tone}
      busy={busy}
      designWidth={width}
      designTop={top}
      designNode={designNode}
      onCancel={onCancel}
    >
      {onSubmit ? (
        <form
          className={styles.dialogBody}
          onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); onSubmit() }}
        >
          {body}
        </form>
      ) : (
        <div className={styles.dialogBody}>{body}</div>
      )}
    </Dialog>
  )
}

/** 窓の中の欄（題＋中身）。題は選ぶ欄なら 12/600、入力欄なら 13/500（絵のとおり）。 */
export function DialogField({ label, kind = 'input', htmlFor, children }: {
  label: ReactNode
  kind?: 'input' | 'select'
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className={styles.field}>
      <label htmlFor={htmlFor} className={kind === 'select' ? styles.fieldLabelSelect : styles.fieldLabel}>{label}</label>
      {children}
    </div>
  )
}

export function DialogNote({ children }: { children: ReactNode }) {
  return <p className={styles.note}>{children}</p>
}
