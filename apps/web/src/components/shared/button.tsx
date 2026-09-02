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
  variant?: 'primary' | 'secondary'
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
  const classes = [styles.button, styles[variant], props.className].filter(Boolean).join(' ')

  if ('href' in props && props.href !== undefined) {
    const { children, className: _className, href, variant: _variant, ...linkProps } = props
    return (
      <Link href={href} className={classes} {...linkProps}>
        {children}
      </Link>
    )
  }

  const {
    children,
    className: _className,
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
