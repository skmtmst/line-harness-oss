'use client'

import React, { forwardRef, useEffect, useId, useState } from 'react'
import type {
  ComponentPropsWithoutRef,
  ReactNode,
} from 'react'
import { FieldContext } from './field-context'
import HelpTip from './help-tip'
import { TextArea as BaseTextArea, TextField } from './text-field'
import styles from './form-controls.module.css'

/**
 * 入力欄まわりの共通部品。
 *
 * create-page.tsx から分けてある。あちらは作成画面の骨組み（Crumb / Head /
 * Body / Left / Right の data-design）を持っているので、入力欄だけ使いたい
 * 画面が import すると、その画面が骨組みも持っているように見えてしまい、
 * design-structure.test.ts が誤って落ちる。
 */

/**
 * 「必須」の札。#976 U086: 画面ごとに `（必須）`・`*`・自前の赤丸が
 * 混ざっていたので、必須項目の印はすべてこの1形にそろえる。
 * `<Field required>` を使えば自動で付く。Field を組めない場所
 * （legend や行内のラベル）ではこの部品を直接置く。
 */
export function RequiredBadge() {
  return <span className={styles.required}>必須</span>
}

/**
 * 「任意」の札（Td4TN・RaMf3：括弧なし・11px/17・左に6・文と同じ行）。
 * 必須のような丸い地は付けず、薄い灰の文字だけ。
 */
export function OptionalBadge() {
  return <span className={styles.optional}>任意</span>
}

/** 1行の入力欄。ラベルと説明の付け方を全画面でそろえる。 */
export function Field({
  label,
  htmlFor,
  required,
  optional,
  note,
  error,
  help,
  helpLabel,
  helpHref,
  count,
  children,
}: {
  label: string
  htmlFor?: string
  required?: boolean
  optional?: boolean
  note?: ReactNode
  error?: ReactNode
  /**
   * 言葉の意味・単位・いつ時点の値か。ラベルのすぐ右の「？」へ入れる
   * （★V7・§2-1b）。必須の印・入力の直し方・失敗は入れない。
   */
  help?: ReactNode
  /** 「？」の見出し。省略時は label。読み上げ名は「{見出し}の説明」。 */
  helpLabel?: string
  /** 長い説明がある場所。渡すと吹き出しに「くわしく」が出る。 */
  helpHref?: string
  /**
   * 文字数の表示（「12/100文字」）。欄の下の右に出し、上限を超えたら赤くする。
   * 読み上げは欄の説明（aria-describedby）につなぐ。
   */
  count?: { value: number; max: number }
  children: ReactNode
}) {
  const hasHelp = help !== undefined && help !== null
  /*
   * 誤りの見せ方を全画面でそろえる（動きの点検・8）。
   * - 誤りが出た欄で打ち直し始めたら、その場で赤と文を引っ込める（直している最中に赤くし続けない）。
   * - 欄を離れたとき、画面がまだ誤りを持っていれば、もう一度見せる。
   * - 画面が新しい誤りを渡したら（文が変わったら）、すぐ見せる。
   * 打ち始めの瞬間に赤くするかどうかは画面の確かめ方次第だが、出たあとの消え方はここで決める。
   */
  const [quiet, setQuiet] = useState(false)
  const errorKey = typeof error === 'string' ? error : error ? 'node' : ''
  useEffect(() => { setQuiet(false) }, [errorKey])
  const shownError = quiet ? null : error
  /*
   * 読み上げのつなぎ（共通部品の1本化・2026-10-08）。説明・誤りの文・文字数に id を振り、
   * 中の入力欄（TextField・TextArea・TextInput）へ aria-describedby / aria-invalid /
   * aria-required として渡す。画面ごとに書かない。
   */
  const baseId = useId()
  const noteId = `${baseId}-note`
  const errorId = `${baseId}-error`
  const countId = `${baseId}-count`
  const showNote = !shownError && Boolean(note)
  const over = count ? count.value > count.max : false
  const describedBy = [shownError ? errorId : null, showNote ? noteId : null, count ? countId : null].filter(Boolean).join(' ') || undefined
  return (
    <FieldContext.Provider value={{ controlId: htmlFor, describedBy, invalid: Boolean(shownError), required: Boolean(required) }}>
    <div
      className={styles.field}
      data-field-quiet={quiet && error ? '' : undefined}
      onInput={error ? () => { if (!quiet) setQuiet(true) } : undefined}
      onBlur={quiet ? () => setQuiet(false) : undefined}
    >
      {/* 「？」は label の外に置く。中に入れるとラベルがボタンを指してしまい、
          入力欄との結びつき（htmlFor・読み上げ）が壊れる。 */}
      <div className={styles.labelRow}>
        <label htmlFor={htmlFor} className={styles.label}>
          {label}
          {/* 設計は「必須」と字で書いている。* だけだと、色が見えない人には
              何も伝わらない。 */}
          {required && <RequiredBadge />}
          {optional && !required && <OptionalBadge />}
        </label>
        {hasHelp ? (
          <HelpTip label={`${helpLabel ?? label}の説明`}>
            {help}
            {helpHref ? <a href={helpHref} className={styles.helpLink}>くわしく</a> : null}
          </HelpTip>
        ) : null}
      </div>
      {children}
      {shownError ? <p id={errorId} className={styles.error} role="alert">{shownError}</p> : null}
      {showNote ? <p id={noteId} className={styles.note}>{note}</p> : null}
      {count ? (
        <p id={countId} className={[styles.count, over && styles.countOver].filter(Boolean).join(' ')} data-field-count={over ? 'over' : ''}>
          {count.value.toLocaleString('ja-JP')}/{count.max.toLocaleString('ja-JP')}文字
        </p>
      ) : null}
    </div>
    </FieldContext.Provider>
  )
}

/*
 * 1行・複数行の入力欄の正本は text-field.tsx（★V8 Ume2U・i5BW8b）。
 * ここの TextInput・TextArea は、その部品を呼ぶだけの薄い包み。
 * 足すのは v7 の見た目の差（読み取り専用の地・押せないときの薄さ・複数行の
 * 大きさ固定）だけで、v8 では TextField・TextArea と同じ物になる。
 * 新しく書く画面は text-field.tsx を直接使う。
 */
type TextInputProps = ComponentPropsWithoutRef<typeof TextField>

/** 1行入力（Pencil V5 `ytG7l`）。正本 TextField の包み。 */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { className, ...props },
  ref,
) {
  return (
    <TextField
      ref={ref}
      data-design-node="ytG7l"
      {...props}
      className={[styles.legacyControl, className].filter(Boolean).join(' ')}
    />
  )
})

type TextAreaProps = ComponentPropsWithoutRef<typeof BaseTextArea>

/** 複数行入力（Pencil V5 `keKe3`）。正本 TextArea の包み。 */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { className, ...props },
  ref,
) {
  return (
    <BaseTextArea
      ref={ref}
      data-design-node="keKe3"
      {...props}
      className={[styles.legacyControl, styles.legacyTextarea, className].filter(Boolean).join(' ')}
    />
  )
})

/** 入力欄の見た目。画面ごとに枠線の色が変わらないようにする。 */
export const inputClass =
  'border-hairline rounded-control focus-visible:outline-action w-full border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2'
