import Notice from '@/components/shared/notice'
import Button from '@/components/shared/button'

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
  /** 何の見本か。例:「タグの新しい並び」 */
  what: string
  /** 通常の業務画面への戻り先。 */
  backHref: string
  /** 戻り先の表示名。例:「通常のタグへ戻る」 */
  backLabel: string
}) {
  return (
    <Notice tone="warn"
      role="note"
      data-sample-screen
      className="mb-4"
      heading={<>これは{what}の見本です</>}
      action={<Button href={backHref}>{backLabel}</Button>}
    >
          固定の例データを表示しています。実際のデータの閲覧・編集はできません。
    </Notice>
  )
}
