'use client'

import styles from './image-multi-select.module.css'

export type SelectableImage = { id: string; url: string; name: string; size: string }

/** 選んだ順と上限を保つ画像の複数選択。検索・取得は呼び出し側が持つ。 */
export default function ImageMultiSelect({ items, selectedIds, max, onToggle, compact = false, disabled = false, designNode }: { items: SelectableImage[]; selectedIds: string[]; max: number; onToggle: (id: string) => void; compact?: boolean; disabled?: boolean; designNode?: string }) {
  const full = selectedIds.length >= max
  return (
          <div
            data-design-node={designNode}
            role="listbox"
            aria-label="参照にする画像"
            aria-multiselectable="true"
            className={compact ? "grid max-h-160 grid-cols-4 gap-3 overflow-y-auto" : "grid max-h-160 grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 md:grid-cols-4"}
          >
            {items.map((image) => {
              const index = selectedIds.indexOf(image.id)
              const selectedTile = index >= 0
              return (
                <button
                  key={image.id}
                  type="button"
                  role="option"
                  aria-selected={selectedTile}
                  // 3 枚そろったら、選んでいないタイルは押しても増えないので触れない形にする。
                  disabled={disabled || (!selectedTile && full)}
                  onClick={() => onToggle(image.id)}
                  className={compact ? styles.tile : "flex flex-col gap-1.5 text-left disabled:opacity-50"}
                >
                  <span
                    className={
                      selectedTile
                        ? 'relative block aspect-square w-full overflow-hidden rounded-control border-2 border-accent bg-step-idle'
                        : 'relative block aspect-square w-full overflow-hidden rounded-control border border-hairline bg-step-idle'
                    }
                  >
                    {/* 統括の画像は Worker から配信されるので next/image の最適化は使わない（image-tile と同じ） */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                    {selectedTile ? (
                      <span className="absolute bottom-2 left-2 rounded-pill bg-accent-deep px-2 py-0.5 text-nano font-semibold text-on-accent">
                        {`${index + 1}枚目`}
                      </span>
                    ) : null}
                  </span>
                  <>
                    <span className={compact ? styles.name : "truncate text-caption font-semibold text-ink"}>{image.name}</span>
                    <span className={compact ? styles.size : "truncate text-nano text-ink-faint tabular-nums"}>{image.size}</span>
                  </>
                </button>
              )
            })}
          </div>
  )
}
