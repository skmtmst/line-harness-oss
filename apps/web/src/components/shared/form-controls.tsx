import type { ReactNode } from 'react'

/**
 * 入力欄まわりの共通部品。
 *
 * create-page.tsx から分けてある。あちらは作成画面の骨組み（Crumb / Head /
 * Body / Left / Right の data-design）を持っているので、入力欄だけ使いたい
 * 画面が import すると、その画面が骨組みも持っているように見えてしまい、
 * design-structure.test.ts が誤って落ちる。
 */

/** 1行の入力欄。ラベルと説明の付け方を全画面でそろえる。 */
export function Field({
  label,
  htmlFor,
  required,
  note,
  children,
}: {
  label: string
  htmlFor?: string
  required?: boolean
  note?: ReactNode
  children: ReactNode
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-ink-secondary mb-1 block text-sm font-medium">
        {label}
        {/* 設計は「必須」と字で書いている。* だけだと、色が見えない人には
            何も伝わらない。 */}
        {required && (
          <span className="bg-danger-bg text-danger rounded-pill ml-1.5 px-1.5 py-0.5 text-[10px]">
            必須
          </span>
        )}
      </label>
      {children}
      {note && <p className="text-ink-faint mt-1 text-xs leading-relaxed">{note}</p>}
    </div>
  )
}

/** 入力欄の見た目。画面ごとに枠線の色が変わらないようにする。 */
export const inputClass =
  'border-hairline rounded-control focus:ring-accent w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none'
