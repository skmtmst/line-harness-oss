'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { LEGAL_LINKS } from '@/lib/auth-email'

/**
 * ログイン前の画面の入れ物。★V6 0-1／36-4／36-6 の「登録カード」（幅 520）。
 *
 * 地は `$canvas-parchment`（= `bg-shell` #f5f5f7）で、白いカード（角丸 18 = `rounded-large`）を真ん中に置く。
 * ロゴ「m musubo」→ 見出し → 説明 → 中身。フッターに規約などのリンク。
 * リンク先がまだ無いものは文字だけ出す（`LEGAL_LINKS`）。
 */
export default function AuthCard({
  title,
  description,
  children,
  node,
  cardNode,
}: {
  title: string
  description: ReactNode
  children: ReactNode
  /** Pencil の画面ノード。 */
  node: string
  /** Pencil のカードノード。 */
  cardNode: string
}) {
  return (
    <main data-design-node={node} className="flex min-h-svh flex-col items-center justify-center bg-shell px-4 py-8 sm:px-6">
      <section
        data-design-node={cardNode}
        className="flex w-full max-w-130 flex-col items-center gap-5 rounded-large border border-hairline bg-canvas px-6 py-9 shadow-float sm:px-10"
      >
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-control bg-accent-deep text-heading font-bold text-on-accent">
            m
          </span>
          <span className="text-display font-bold text-ink">musubo</span>
        </div>
        <div className="flex w-full flex-col items-center gap-2 text-center">
          <h1 className="text-heading font-bold text-ink">{title}</h1>
          <p className="text-caption text-ink-faint">{description}</p>
        </div>
        {children}
      </section>
      <footer className="mt-6 flex flex-wrap items-center justify-center gap-4 text-micro text-ink-faint">
        <LegalLink href={LEGAL_LINKS.terms}>利用規約</LegalLink>
        <LegalLink href={LEGAL_LINKS.privacy}>プライバシーポリシー</LegalLink>
        <LegalLink href={LEGAL_LINKS.commerce}>特定商取引法に基づく表記</LegalLink>
        <Link href="/hq/support" className="hover:underline">お問い合わせ</Link>
      </footer>
    </main>
  )
}

function LegalLink({ href, children }: { href: string | null; children: ReactNode }) {
  if (!href) return <span>{children}</span>
  return (
    <a href={href} target="_blank" rel="noreferrer" className="hover:underline">
      {children}
    </a>
  )
}

/** 項目のラベル行＋入力欄＋赤字。設計の「項目」（ラベル・補足・入力・エラー文）。 */
export function AuthField({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string
  hint?: string
  error?: string | null
  htmlFor: string
  children: ReactNode
}) {
  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <label htmlFor={htmlFor} className="text-label font-bold text-ink">
          {label}
        </label>
        {hint ? <span className="text-micro text-ink-faint">{hint}</span> : null}
      </div>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-micro text-status-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
