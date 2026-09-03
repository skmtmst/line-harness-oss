import React from 'react'
export type StepState = 'done' | 'current' | 'todo'

export type StepTrailItem = {
  label: string
  state: StepState
}

/**
 * 何段のうちの何段目かを出す。
 *
 * **段が無いと、この画面で全部決めるのか、まだ続きがあるのかが分からない。**
 * 「作成後の編集画面で設定します」と本文で断っていても、**あと何が残るかは
 * 数で見せたほうが早い。**
 *
 * シナリオ作成（`cCB7r`）で作った形をそのまま部品にした。**同じ考え方を
 * 2か所で別々に書かない。**
 */
export default function StepTrail({
  label,
  items,
}: {
  /** 読み上げ用の名前。「◯◯の進み方」。 */
  label: string
  items: StepTrailItem[]
}) {
  return (
    <ol
      data-design="Steps"
      aria-label={label}
      className="bg-canvas rounded-card border-hairline mt-4 flex flex-wrap items-center gap-3 border px-4 py-3 text-xs"
    >
      {items.map((item, index) => (
        <StepGroup key={item.label} item={item} n={index + 1} withLine={index > 0} />
      ))}
    </ol>
  )
}

function StepGroup({ item, n, withLine }: { item: StepTrailItem; n: number; withLine: boolean }) {
  return (
    <>
      {withLine ? <li aria-hidden className="border-hairline w-10 border-t" /> : null}
      <li
        className="flex items-center gap-2"
        aria-current={item.state === 'current' ? 'step' : undefined}
      >
        <span
          className={`rounded-pill flex h-6 w-6 items-center justify-center text-xs font-bold ${
            item.state === 'done'
              ? 'bg-accent-deep text-on-accent'
              : item.state === 'current'
                ? 'border-accent text-accent border-2'
                : 'border-hairline text-ink-faint border'
          }`}
        >
          {item.state === 'done' ? '✓' : n}
        </span>
        <span className={item.state === 'todo' ? 'text-ink-faint' : 'text-ink font-bold'}>
          {item.label}
        </span>
      </li>
    </>
  )
}
