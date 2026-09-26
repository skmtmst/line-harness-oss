import Link from 'next/link'
import type { LinkProps } from 'next/link'
import React from 'react'
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
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className' | 'href'> & {
    href?: never
  }

type LinkButtonProps = CommonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'aria-disabled' | 'children' | 'className' | 'disabled' | 'href'> & {
    href: LinkProps['href']
    disabled?: never
    'aria-disabled'?: never
  }

export type ButtonProps = NativeButtonProps | LinkButtonProps

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

  const {
    children,
    className: _className,
    size: _size,
    type = 'button',
    variant: _variant,
    ...buttonProps
  } = props
  return (
    <button type={type} className={classes} {...buttonProps}>
      {children}
    </button>
  )
}
