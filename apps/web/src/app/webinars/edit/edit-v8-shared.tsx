'use client'

/*
 * ★V8-B ウェビナー編集の段で共に使う脇の部品。
 *
 * v7 の編集画面（`page.tsx`）にある `SummaryAside`・`EditorDetails` と
 * 同じ中身。v7 側は触らず、V8 の段（CTA・通知・確認）から使う。
 */
import type { ReactNode } from 'react'
import Disclosure from '@/components/shared/disclosure'
import LinePreview from '@/components/shared/line-preview'

export function SummaryAside({
  rows,
  previewBody,
  previewButton,
  previewFirst = false,
  children,
}: {
  rows: Array<[string, string]>
  previewBody: string
  previewButton?: string | null
  previewFirst?: boolean
  children?: ReactNode
}) {
  const summary = (
    <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
        <h2 className="text-ink text-sm font-bold">設定サマリー</h2>
        <dl className="divide-hairline mt-3 divide-y">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-start justify-between gap-4 py-3 text-xs"><dt className="text-ink-faint">{label}</dt><dd className="text-ink text-right font-semibold">{value}</dd></div>
          ))}
        </dl>
    </section>
  )
  const preview = (
    <div className="min-h-[365px] shadow-card">
    <LinePreview
      note="実際のLINE表示に近いプレビューです"
    >
        <div className="bg-canvas text-ink rounded-control p-4 text-sm font-medium leading-relaxed">{previewBody}</div>
        {previewButton ? <div className="bg-accent-deep text-on-accent mx-auto mt-3 w-fit rounded-control px-4 py-2 text-xs font-medium">{previewButton}</div> : null}
    </LinePreview>
    </div>
  )
  return (
    <aside className="space-y-3 xl:w-[390px] xl:shrink-0">
      {previewFirst ? <>{preview}{summary}</> : <>{summary}{preview}</>}
      {children}
    </aside>
  )
}

export function EditorDetails({ label, children }: { label: string; children: ReactNode }) {
  return <Disclosure title={label}>{children}</Disclosure>
}
