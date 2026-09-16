'use client'

import type { ReactNode } from 'react'

/** 運営コンソールの画面見出し。共通トップバー相当（画面名＋右操作）。 */
export default function OpsPageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <header className="mb-4 flex h-14 items-center justify-between gap-4 border-b border-hairline">
      <h1 className="text-title font-bold text-ink">{title}</h1>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  )
}
