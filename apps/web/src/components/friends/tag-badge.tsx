import type { Tag } from '@line-crm/shared'

interface TagBadgeProps {
  tag: Tag
  onRemove?: () => void
}

/**
 * 友だちに付いているタグの札。
 *
 * 色は「属するフォルダの色」。API がフォルダの色を `color` に入れて返すので、
 * ここでは何も逆算しない。フォルダを決めていない・色を付けていないタグは
 * 灰色になる。
 *
 * 塗りつぶさずに、薄い下地＋文字＋左の丸で出す。全面を濃く塗ると、未対応や
 * 警告といった「状態を表す色」と見分けがつかなくなる。タグ管理・タグの作成
 * 画面も同じ出し方にしてある。
 */
export default function TagBadge({ tag, onRemove }: TagBadgeProps) {
  const color = tag.color || '#8b938d'

  return (
    <span
      className="rounded-pill inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium"
      // 下地は同じ色の 10%（`1a`）。色の数だけ Tailwind の class を用意できない
      // ので、ここだけ style で書く。
      style={{ backgroundColor: `${color}1a`, color }}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
      {tag.name}
      {onRemove && (
        <button
          onClick={onRemove}
          className="ml-0.5 transition-opacity hover:opacity-70"
          aria-label={`タグ「${tag.name}」を削除`}
        >
          <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd" />
          </svg>
        </button>
      )}
    </span>
  )
}
