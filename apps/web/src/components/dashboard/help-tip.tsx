/**
 * 見出しの脇の「？」。定義・分母・計算・単位・いつ時点・言葉の意味など、
 * 見出しやラベルだけでは伝わらない補足だけを入れる（本文に書いて箱を
 * 高くしない）。失敗・警告・必須・直し方・数字そのものは入れない。
 *
 * 本線の共有部品（`shared/help-tip`）ができたら一本化する。それまでは
 * 同じ props の形（`text`＋`label`）でここに置く。
 */
export function HelpTip({ text, label = '補足を見る' }: { text: string; label?: string }) {
  return (
    <span className="group relative inline-flex shrink-0 items-center">
      {/*
        枠は付けない（枠付きの直書きボタンに見えるため）。
        文字だけの小さな「？」にし、ホバー・フォーカスで補足を出す。
      */}
      <button
        type="button"
        aria-label={label}
        className="text-ink-faint hover:text-ink inline-flex h-6 w-6 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
      >
        <span aria-hidden="true" className="text-micro leading-none font-bold">？</span>
      </button>
      <span
        role="tooltip"
        className="bg-canvas border-hairline text-ink shadow-float absolute top-full left-0 z-10 mt-1 hidden w-52 rounded-control border p-2 text-xs leading-relaxed font-normal group-hover:block group-focus-within:block"
      >
        {text}
      </span>
    </span>
  )
}
