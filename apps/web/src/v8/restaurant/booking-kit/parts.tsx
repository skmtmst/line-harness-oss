'use client'

/*
 * ★V8 飲食店向け（在庫・予約台帳・座席・メニュー）で使い回す小さな部品。
 * - RowMore：行の右端の「…」（右クリックだけで開く操作にしない）。
 * - RsDialog：絵の窓（幅・上からの位置・題の下 14 の間・下の線と右寄せのボタン）。
 */
import { Field as SharedField } from '@/components/shared/form-controls'
import { type FormEvent, type ReactNode } from 'react'
import type { ActionMenuItem } from '@/components/shared/action-menu'
import Dialog from '@/components/shared/dialog'
import { RowMenu } from '@/components/shared/row-actions'
import styles from './parts.module.css'

/** 行の「…」。読み上げ名は「{subject}の操作」。 */
export function RowMore({ subject, items }: { subject: string; items: ActionMenuItem[] }) {
  if (items.length === 0) return <span className={styles.morePlaceholder} aria-hidden="true" />
  return (
    <span className={styles.moreBox}>
      <RowMenu appearance="plain" label={`${subject}の操作`} menuLabel={`${subject}の操作の一覧`} className={styles.more} items={items} />
    </span>
  )
}

/**
 * 絵の窓。共通の Dialog に幅と位置を渡し、中身・下のボタンは絵の並び
 * （題の段のあと 14 の間・各段 14・下の線の上 14）で置く。
 * onSubmit を渡すと中身を form にする（Enter で保存できる）。
 */
export function RsDialog({ open, title, width, top, tone, busy, designNode, titleIcon, plainTitle = false, contentPadding, footerPlain = false, onCancel, onSubmit, noValidate = false, actions, children }: {
  open: boolean
  title: string
  width: number
  top: number
  tone?: 'default' | 'destructive'
  busy?: boolean
  designNode?: string
  /** 題の左に置く絵（危険な操作の確認の注意三角など）。 */
  titleIcon?: ReactNode
  /** 題のまわりを桃色の帯で囲まない（絵が白い見出しのとき）。 */
  plainTitle?: boolean
  /** 中身の余白を絵の値にする（例 `18px 24px 20px`）。 */
  contentPadding?: string
  /** 下のボタンの段に上の線を引かない（絵に線が無いとき）。 */
  footerPlain?: boolean
  onCancel: () => void
  onSubmit?: () => void
  noValidate?: boolean
  actions: ReactNode
  children: ReactNode
}) {
  const body = (
    <>
      {children}
      <div className={footerPlain ? styles.dialogActionsPlain : styles.dialogActions}>{actions}</div>
    </>
  )
  return (
    <Dialog
      open={open}
      title={title}
      tone={tone}
      busy={busy}
      titleIcon={titleIcon}
      confirmation={plainTitle || undefined}
      designWidth={width}
      designTop={top}
      designContentPadding={contentPadding}
      designNode={designNode}
      onCancel={onCancel}
    >
      {onSubmit ? (
        <form
          className={styles.dialogBody}
          noValidate={noValidate}
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
export function DialogField({ label, htmlFor, children }: { label: ReactNode; kind?: 'input' | 'select'; htmlFor?: string; children: ReactNode }) {
  return <SharedField label={label} htmlFor={htmlFor}>{children}</SharedField>
}

export function DialogNote({ children }: { children: ReactNode }) {
  return <p className={styles.note}>{children}</p>
}
