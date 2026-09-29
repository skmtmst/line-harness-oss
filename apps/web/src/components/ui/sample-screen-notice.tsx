import Link from 'next/link'

/**
 * 見本・比較画面の明示（UI監査 #975 U101）。
 *
 * /visual-qa/* は固定データを表示する検証用の画面だが、
 * 見た目が通常の業務画面と同じなので、直リンクで開いた人が本物の
 * 一覧だと取り違える。画面の先頭へ常にこの帯を出し、通常画面への
 * 戻り口も置く。
 */
export default function SampleScreenNotice({
  what,
  backHref,
  backLabel,
}: {
  /** 何の見本か。例:「友だち属性の新しい並び」 */
  what: string
  /** 通常の業務画面への戻り先。 */
  backHref: string
  /** 戻り先の表示名。例:「通常の友だち属性へ戻る」 */
  backLabel: string
}) {
  return (
    <div
      role="note"
      data-sample-screen
      className="border-warning bg-warning-bg mb-4 flex flex-wrap items-center justify-between gap-2 rounded-card border px-4 py-3"
    >
      <p className="text-status-warn-deep text-sm font-semibold">
        これは{what}の見本です
        <span className="text-warning mt-0.5 block text-xs font-normal">
          固定の例データを表示しています。実際のデータの閲覧・編集はできません。
        </span>
      </p>
      <Link
        href={backHref}
        className="border-warning text-status-warn-deep hover:bg-canvas rounded-control shrink-0 border px-3 py-1.5 text-xs font-bold"
      >
        {backLabel}
      </Link>
    </div>
  )
}
