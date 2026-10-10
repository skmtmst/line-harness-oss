
import Link from 'next/link'
import type { AnchorHTMLAttributes } from 'react'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import styles from './text-link.module.css'

/**
 * リンク（→つき。Pencil ★V8 `g5Db8`）。
 *
 * 文字 12px/500 の緑のリンクの右に小さな矢印が付く。乗せると矢印が
 * 2px 右に滑る（120ms）。「受信箱で開く」「配信設定へ」など、
 * 行き先を示す小さな導線に使う。
 */
export default function TextLink({
  href,
  children,
  className,
  external = false,
  ...rest
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  external?: boolean
  href: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <Link href={href} className={[styles.root, className].filter(Boolean).join(' ')} {...rest} target={external ? '_blank' : rest.target} rel={external || rest.target === '_blank' ? 'noopener noreferrer' : rest.rel}>
      <span className={styles.label}>{children}</span>
      {external || rest.target === '_blank' ? <ArrowUpRight size={12} aria-hidden="true" data-external-icon className={styles.arrow} /> : <ArrowRight size={12} aria-hidden="true" className={styles.arrow} />}
    </Link>
  )
}
