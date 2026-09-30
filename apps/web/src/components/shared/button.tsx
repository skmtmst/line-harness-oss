import Link from 'next/link'
import type { LinkProps } from 'next/link'
import { Check, LoaderCircle } from 'lucide-react'
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ReactNode,
} from 'react'
import styles from './button.module.css'

type CommonProps = {
  /**
   * `danger` は確定ダイアログの削除・解除などに使う赤。
   * `#976` U077/U084: 危険操作は共通ボタンの1役割として持ち、
   * 画面ごとの直書き赤（濃さがバラバラだった）を1本にする。
   */
  variant?: 'primary' | 'secondary' | 'danger'
  /**
   * `compact` は一覧の行内・絞り込み行など、32px級の操作と高さを
   * そろえるときだけ使う（★V7：行内の操作は32）。本文の操作は
   * `standard` のままにする。
   */
  size?: 'standard' | 'field' | 'compact'
  className?: string
  children: ReactNode
}

type NativeButtonProps = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className' | 'href' | 'aria-busy'> & {
    href?: never
    /** 開いた直後に標的を寄せたいときだけ渡す（未保存の離脱確認の主ボタン）。 */
    ref?: React.Ref<HTMLButtonElement>
    /**
     * ★V7 仕上げ §2「保存中」。true の間は回る印＋`busyLabel`（規定
     * 「保存中…」）に見た目を切り替え、押せなくする（二重送信を防ぐ）。
     * 文字が変わっても幅はぶれない。呼び出し側はいままでの
     * `{saving ? '保存中…' : '…'}` の代わりに `busy={saving}` を渡す。
     */
    busy?: boolean | null
    /** `busy` の間に出す文字。規定は「保存中…」。 */
    busyLabel?: string
    /**
     * ★V7 仕上げ §2「完了」。true に切り替わったら ✓＋`doneLabel`
     * （規定「保存しました」）を1.2秒だけ出してから元の文字へ戻る。
     * 失敗したときは渡さない——ボタンは元に戻り、理由は知らせ
     * （Toast）と欄の下に出す。
     */
    done?: boolean | null
    /** `done` の間に出す文字。規定は「保存しました」。 */
    doneLabel?: string
  }

type LinkButtonProps = CommonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'aria-disabled' | 'children' | 'className' | 'disabled' | 'href'> & {
    href: LinkProps['href']
    disabled?: never
    'aria-disabled'?: never
  }

export type ButtonProps = NativeButtonProps | LinkButtonProps

/** 「完了」の見せ時間（★V7 仕上げ §2: 1.2秒）。 */
const DONE_FLASH_MS = 1200

/**
 * Pencil V5 の `nBRKk`（主要）と `uzNEC`（副次）を正本にした共通ボタン。
 * V6専用のボタン部品は存在しないため、V6画面でもこの寸法を使う。
 *
 * 見た目は部品が固定し、呼び出し側は幅と外側余白だけを `className` で決める。
 * 表示制御にはTailwindのdisplayクラスではなくHTMLの `hidden` 属性を使う。
 */
export default function Button(props: ButtonProps) {
  const variant = props.variant ?? 'secondary'
  const size = props.size ?? 'standard'
  const classes = [styles.button, styles[variant], styles[size], props.className].filter(Boolean).join(' ')

  if ('href' in props && props.href !== undefined) {
    const { children, className: _className, href, size: _size, variant: _variant, ...linkProps } = props
    return (
      <Link href={href} className={classes} {...linkProps}>
        {children}
      </Link>
    )
  }

  return <NativeButton {...props} classes={classes} />
}

function NativeButton(props: NativeButtonProps & { classes: string }) {
  const {
    children,
    classes,
    className: _className,
    variant: _variant,
    size: _size,
    href: _href,
    type = 'button',
    busy,
    busyLabel = '保存中…',
    done,
    doneLabel = '保存しました',
    disabled,
    ref,
    ...buttonProps
  } = props

  /*
   * ★V7 仕上げ §2「保存中・完了」。DOM に出す文字は常に今のラベル1つだけ
   * （読み上げ・検索が迷子にならないよう、隠した文字は残さない）。
   * 幅はぶれないよう、平常時に測った幅を `min-width` に留めておき、
   * 「保存中…」「保存しました」の間もその幅を下回らない。
   */
  const stateful = busy !== undefined || done !== undefined
  const busyNow = busy === true

  /* done が true になったら 1.2 秒だけ ✓ を出して元の文字へ戻す。 */
  const [doneFlashing, setDoneFlashing] = useState(false)
  useEffect(() => {
    if (done === true && busy !== true) {
      setDoneFlashing(true)
      const timer = setTimeout(() => setDoneFlashing(false), DONE_FLASH_MS)
      return () => clearTimeout(timer)
    }
    setDoneFlashing(false)
  }, [done, busy])

  const elementRef = useRef<HTMLButtonElement | null>(null)
  const idleWidthRef = useRef(0)
  useLayoutEffect(() => {
    const el = elementRef.current
    if (!el || !stateful) return
    if (busy === true || done === true) {
      if (idleWidthRef.current > 0) el.style.minWidth = `${idleWidthRef.current}px`
      return
    }
    el.style.minWidth = ''
    idleWidthRef.current = el.offsetWidth
  })

  const setRefs = (el: HTMLButtonElement | null) => {
    elementRef.current = el
    if (typeof ref === 'function') ref(el)
    else if (ref) ref.current = el
  }

  const shownDone = doneFlashing && !busyNow
  return (
    <button
      type={type}
      className={classes}
      ref={setRefs}
      disabled={disabled || busyNow}
      aria-busy={busyNow ? true : undefined}
      {...buttonProps}
    >
      {busyNow ? <LoaderCircle className={styles.spin} size={15} aria-hidden="true" /> : null}
      {shownDone ? <Check size={15} aria-hidden="true" /> : null}
      {busyNow ? busyLabel : shownDone ? doneLabel : children}
    </button>
  )
}
