import type { ReactNode } from 'react'
import Link from 'next/link'
import styles from './icon-row.module.css'

/**
 * 印＋文字（＋右の文字・ボタン）の行。印・文字のかたまり・右の物を、行の上下の真ん中にそろえる
 * （2026-10-27 オーナー指摘：友だちの詳細の行で文字が真ん中からずれていた）。
 *
 * - `icon`：左の印。`iconShape` が `box` は角丸の四角（枠つき）、`round` は灰の丸
 * - `title`・`sub`：題と補足。2 行でも 1 行でも、かたまりごと真ん中に置く
 * - `end`：右の文字・時刻・ボタン。これも真ん中
 * - `surface`：`card`＝白いカード（影）、`muted`＝点線の薄い地、`pearl`＝薄い地、`plain`＝地なし
 * - `connect`：履歴の縦線。印の下から次の行の印の上までつなぐ（最後の行は付けない）
 *
 * 行の高さを取るための空の段（棒の場所など）を文字の下に置かない。置くと文字が上へ寄る。
 * 見張り：apps/web/scripts/v8-guard/row-centering-browser.mjs（ずれが 1px を超えたら落ちる）。
 */
export default function IconRow({ icon, iconShape = 'box', title, sub, end, surface = 'plain', href, external = false, connect = false, titleAttribute }: {
  icon: ReactNode
  iconShape?: 'box' | 'round'
  title: ReactNode
  sub?: ReactNode
  end?: ReactNode
  surface?: 'card' | 'muted' | 'pearl' | 'plain'
  href?: string
  external?: boolean
  connect?: boolean
  /** 題が省略された時に全文を出す。 */
  titleAttribute?: string
}) {
  const body = <>
    <span className={styles.icon} data-icon-shape={iconShape} data-center-row-part="icon" aria-hidden="true">{icon}</span>
    <span className={styles.text} data-center-row-part="text">
      <span className={styles.title} title={titleAttribute}>{title}</span>
      {sub ? <span className={styles.sub}>{sub}</span> : null}
    </span>
    {end ? <span className={styles.end} data-center-row-part="end">{end}</span> : null}
  </>
  const props = { className: styles.row, 'data-center-row': '', 'data-surface': surface, 'data-connect': connect || undefined }
  if (href && external) return <a {...props} href={href} target="_blank" rel="noreferrer">{body}</a>
  if (href) return <Link {...props} href={href}>{body}</Link>
  return <div {...props}>{body}</div>
}
