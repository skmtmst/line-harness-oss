'use client'

import { useEffect, type ReactNode } from 'react'
import { setDocumentTitle } from '@/lib/document-title'
import { PageHeading } from '@/components/templates/page-frame'
import authStyles from '@/components/templates/auth-page.module.css'
import { CONTACT_URL, LEGAL_LINKS } from '@/lib/auth-email'
import { nameInitial } from '@/lib/name-initial'

/**
 * ログイン前の画面の入れ物。★管理画面 0-1／36-4／36-6 の「登録カード」（幅 520）。
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
  variant,
  titleId,
  authLayout,
  brandName,
  brandNote,
  step,
  wide,
}: {
  title: string
  description: ReactNode
  children: ReactNode
  /** Pencil の画面ノード。 */
  node?: string
  /** Pencil のカードノード。 */
  cardNode?: string
  variant?: 'totp'
  titleId?: string
  authLayout?: 'admin' | 'ops'
  /** カードの頭に出す会社名。無ければ musubo。 */
  brandName?: string
  /** 会社名の下の小さな文字。 */
  brandNote?: string
  /** ログインの何段目か（「2 / 2」）。カードの頭の右に出す。 */
  step?: { current: number; total: number }
  /** 中身が広いカード（二段階認証の設定）。 */
  wide?: boolean
}) {
  // ログイン前の画面もタブの題を「<見出し> | musubo」にする。
  useEffect(() => { setDocumentTitle(title) }, [title])
  // V8 login confirmation/enrollment inherits its existing card tokens.
  if (variant === 'totp') return <main className={authStyles.page} data-auth-layout={authLayout}>
    <section className={authStyles.card} aria-label={title} data-auth-layout={authLayout} data-auth-width={wide ? 'wide' : undefined} data-design-node={cardNode}>
    <AuthCardHead brandName={brandName} brandNote={brandNote} step={step} />
    {/* 題 20/600 と説明 1 行を 1 組の見出しとして渡す。 */}
    <PageHeading
      title={title}
      titleAs="h1"
      titleId={titleId}
      inset="none"
      subtitle={authLayout === 'admin' ? description : undefined}
      subtitleSize="body"
      help={authLayout === 'admin' ? undefined : description}
    />
    {children}
  </section></main>

  const legal = (
    <footer className="flex flex-wrap items-center justify-center gap-4 text-micro text-ink-faint">
      <LegalLink href={LEGAL_LINKS.terms}>利用規約</LegalLink>
      <LegalLink href={LEGAL_LINKS.privacy}>プライバシーポリシー</LegalLink>
      <LegalLink href={LEGAL_LINKS.commerce}>特定商取引法に基づく表記</LegalLink>
      {/*
        ログインしていない人のお問い合わせは、サービスサイトの /contact/ へ。
        /hq/support はログインが要り、ログイン画面へ戻されてしまう（監査 m18e）。
      */}
      <a href={CONTACT_URL} target="_blank" rel="noreferrer" className="hover:underline">
        お問い合わせ
      </a>
    </footer>
  )

  // ログインの 1 段目：二段階認証（2 段目）と同じ地・同じ幅・同じカード（枠の線なしで影だけ）。
  if (step) return (
    <main data-design-node={node} className={authStyles.page} data-auth-layout="admin" data-auth-foot="">
      <section data-design-node={cardNode} className={authStyles.card} aria-label={title} data-auth-layout="admin">
        <AuthCardHead brandName={brandName} brandNote={brandNote} step={step} />
        <PageHeading title={title} titleAs="h1" titleId={titleId} inset="none" subtitle={description} subtitleSize="body" />
        {children}
      </section>
      {legal}
    </main>
  )

  return (
    <main data-design-node={node} className="flex min-h-svh flex-col items-center justify-center bg-shell px-4 py-8 sm:px-6">
      <section
        data-design-node={cardNode}
        className="flex w-full max-w-130 flex-col items-center gap-5 rounded-large border border-hairline bg-canvas px-6 py-9 shadow-float sm:px-10"
      >
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-control bg-accent-deep text-heading font-bold text-on-accent">
            m
          </span>
          <span className="text-display font-bold text-ink">musubo</span>
        </div>
        <div className="flex w-full flex-col items-center gap-2 text-center">
          <h1 className="text-heading font-bold text-ink">{title}</h1>
          <p className="text-caption text-balance text-ink-faint">{description}</p>
        </div>
        {children}
      </section>
      <div className="mt-6">{legal}</div>
    </main>
  )
}

/** カードの頭：会社の印・会社名・musubo、右に「2 / 2」、下に薄い線（統括のアカウントのカードと同じ作り）。 */
function AuthCardHead({ brandName, brandNote = 'musubo', step }: { brandName?: string; brandNote?: string; step?: { current: number; total: number } }) {
  const name = brandName || 'musubo'
  // 会社名が無い時は「musubo」を 2 回並べない。
  return <div className={authStyles.head} data-auth-head="">
    <span className={authStyles.headMark} aria-hidden="true" data-auth-brand-mark="">{nameInitial(name)}</span>
    <div className={authStyles.headName}><strong>{name}</strong>{brandName || brandNote !== 'musubo' ? <small>{brandNote}</small> : null}</div>
    {step ? <span className={authStyles.headStep}><span className="sr-only">ログインの手順 </span>{step.current} / {step.total}</span> : null}
  </div>
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
  action,
  children,
}: {
  label: string
  hint?: string
  error?: string | null
  htmlFor: string
  /** ラベルの行の右端に置く小さな導線（パスワードを忘れた方など）。 */
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex w-full flex-col gap-2">
      {/*
        U100: ラベルと補足を同じ行に並べると、320pxや200%拡大で
        補足が幅を取ってラベルが途中で折れる（「メールアド／レス」）。
        縦に積めば、ラベル→補足→入力→エラーの順でそのまま読める。
      */}
      <div className="flex w-full items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-label font-medium text-ink">
          {label}
        </label>
        {action ? <span className="shrink-0 text-label">{action}</span> : null}
      </div>
      {hint ? <p className="text-micro text-ink-faint">{hint}</p> : null}
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-micro text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
