'use client'

import type { ReactNode } from 'react'

/** 運営コンソールの画面見出し。共通トップバー相当（画面名＋右操作）。 */
export default function OpsPageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <header className="mb-4 flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-hairline py-2">
      <h1 className="min-w-0 text-title font-bold text-ink">{title}</h1>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}
