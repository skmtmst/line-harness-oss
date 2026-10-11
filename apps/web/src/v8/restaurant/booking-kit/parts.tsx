'use client'

/*
 * ★V8 飲食店向け（在庫・予約台帳・座席・メニュー）で使い回す小さな部品。
 * - RowMore：行の右端の「…」（右クリックだけで開く操作にしない）。
 * - RsDialog：絵の窓（幅・上からの位置・題の下 14 の間・下の線と右寄せのボタン）。
 */
import { Field as SharedField } from '@/components/shared/form-controls'
import { type CSSProperties, type FormEvent, type ReactNode } from 'react'
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
export function RsDialog({ open, title, titleNote, width, top, tone, busy, designNode, titleIcon, titleRow, plainTitle = false, headerHeight, contentPadding, bodyGap, footerPlain = false, footerGap, onCancel, onSubmit, noValidate = false, actions, children }: {
  open: boolean
  title: string
  /** 題の下の小さな補足（絵の窓の頭が題＋1行のとき）。渡さないときは出ない。 */
  titleNote?: ReactNode
  width: number
  top: number
  tone?: 'default' | 'destructive'
  busy?: boolean
  designNode?: string
  /** 題の左に置く絵（危険な操作の確認の注意三角など）。 */
  titleIcon?: ReactNode
  /*
   * 題の段の形を絵の値にする。`'mark'` は左の丸い印と題を縦の中央でそろえ、
   * 間12・題 18/700 にする（絵 dgeTy・XCVGd の確認の窓）。渡さないときは共通のまま。
   */
  titleRow?: 'mark'
  /** 題のまわりを桃色の帯で囲まない（絵が白い見出しのとき）。 */
  plainTitle?: boolean
  /** 題の段の高さを絵の値にする（例 77）。渡さないときは共通の高さのまま。 */
  headerHeight?: number
  /** 中身の余白を絵の値にする（例 `18px 24px 20px`）。 */
  contentPadding?: string
  /** 中身の段どうしの間を絵の値にする。既定は 14。 */
  bodyGap?: number
  /** 下のボタンの段に上の線を引かない（絵に線が無いとき）。 */
  footerPlain?: boolean
  /** 下のボタンの段の上の間を絵の値にする。既定は線ありで 14・線なしで 8。 */
  footerGap?: number
  onCancel: () => void
  onSubmit?: () => void
  noValidate?: boolean
  actions: ReactNode
  children: ReactNode
}) {
  /*
   * 絵の値を渡された分だけ変数で下へ流す。渡さない窓はいままでの間のまま。
   * 欄の題と中身の間は窓からまとめて渡さない。`DialogField` は共通の欄
   * （`components/shared/form-controls`）を出すので、間はその欄の `contentGap`
   * （`--field-content-gap`）だけが効く。窓側の変数は届かない。
   */
  const bodyStyle = bodyGap === undefined
    ? undefined
    : ({ '--rs-dlg-body-gap': `${bodyGap}px` } as CSSProperties)
  const body = (
    <>
      {children}
      <div
        className={footerPlain ? styles.dialogActionsPlain : styles.dialogActions}
        style={footerGap === undefined ? undefined : ({ '--rs-dlg-actions-pad-top': `${footerGap}px` } as CSSProperties)}
      >
        {actions}
      </div>
    </>
  )
  return (
    <Dialog
      open={open}
      title={title}
      titleNote={titleNote}
      tone={tone}
      busy={busy}
      titleIcon={titleIcon}
      designTitleRow={titleRow}
      confirmation={plainTitle || undefined}
      designWidth={width}
      designTop={top}
      designHeaderHeight={headerHeight}
      designContentPadding={contentPadding}
      designNode={designNode}
      onCancel={onCancel}
    >
      {onSubmit ? (
        <form
          className={styles.dialogBody}
          style={bodyStyle}
          noValidate={noValidate}
          onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); onSubmit() }}
        >
          {body}
        </form>
      ) : (
        <div className={styles.dialogBody} style={bodyStyle}>{body}</div>
      )}
    </Dialog>
  )
}

/** 窓の中の欄（題＋中身）。題は選ぶ欄なら 12/600、入力欄なら 13/500（絵のとおり）。 */
export function DialogField({ label, htmlFor, optional, contentGap, children }: {
  label: ReactNode
  kind?: 'input' | 'select'
  htmlFor?: string
  /** `false` で「任意」の札を出さない。入力欄ではない見出しに使う（渡さないときは今までどおり出す）。 */
  optional?: boolean
  /** 題と中身の間を絵の値にする。共通の欄の任意の引数へそのまま渡す（既定は 14）。 */
  contentGap?: number
  children: ReactNode
}) {
  return <SharedField label={label} htmlFor={htmlFor} optional={optional} contentGap={contentGap}>{children}</SharedField>
}

export function DialogNote({ children }: { children: ReactNode }) {
  return <p className={styles.note}>{children}</p>
}
