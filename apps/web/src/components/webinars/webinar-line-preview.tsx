import LinePreview from '@/components/shared/line-preview'

/**
 * LINEプレビュー（設計 `PV1Vh` `d3rFGD` `Ho8z4` の右側）。
 *
 * 枠は共通部品 `LinePreview`（B-6）。中身の組み立てだけが仕事。
 *
 * **中身は各段の入力から組み立てる。** 新しい口は使わない。
 * 入力がまだ無いときは、**それらしい文を作らずに「まだありません」と書く**。
 * 見本の文を置くと、保存すればそれが届くと読めてしまう。
 */
export default function WebinarLinePreview({
  body,
  buttonLabel,
  empty,
}: {
  /** 吹き出しの本文。入力が無いときは `null`。 */
  body: string | null
  /** 吹き出しの中の押し口。無ければ出さない。 */
  buttonLabel?: string | null
  /** 本文が無いときに出す言葉。何を入れれば埋まるかを書く。 */
  empty: string
}) {
  return (
    <LinePreview
      note="実際のLINE表示に近いプレビューです"
      empty={body ? undefined : empty}
    >
      {body ? (
        <>
          <p className="rounded-card bg-canvas p-4 text-sm leading-relaxed whitespace-pre-wrap text-ink">{body}</p>
          {buttonLabel ? <p className="bg-accent-deep text-on-accent rounded-control mx-auto mt-3 w-fit px-4 py-2 text-xs font-bold">{buttonLabel}</p> : null}
        </>
      ) : null}
    </LinePreview>
  )
}
