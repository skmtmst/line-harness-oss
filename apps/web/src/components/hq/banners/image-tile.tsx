'use client'

import { LoaderCircle, Star, Store } from 'lucide-react'
import type { BannerImage, BannerPreset } from '@/lib/hq-banners'
import { aspectBadge, shortDateTime, tileCaption } from '@/lib/hq-banners'

/**
 * 画像1枚のタイル。Pencil 35-2 `lC5ny`（詳細・4列）／35-3 `x8s7r`（ライブラリ・5列）。
 *
 * 画像枠の上に、左から 比率の札・お気に入り、右に 渡し済みの札。
 * 下にキャプション（詳細では日時と用途、ライブラリではプロジェクト名と日時）。
 */
export default function ImageTile({
  image,
  presets,
  variant,
  projectName,
  onOpen,
  onToggleFavorite,
}: {
  image: BannerImage
  presets: BannerPreset[]
  variant: 'project' | 'library'
  /** ライブラリで出すプロジェクト名。 */
  projectName?: string
  onOpen: () => void
  onToggleFavorite?: () => void
}) {
  const delivered = image.deliveredAccountIds.length > 0
  return (
    <div data-design-node={variant === 'project' ? 'lC5ny' : 'x8s7r'} className="flex flex-col gap-1.5">
      <div className="relative overflow-hidden rounded-card border border-hairline bg-shell">
        <button
          type="button"
          onClick={onOpen}
          aria-label={`${projectName ?? tileCaption(image, presets)} の画像を開く`}
          className="block w-full"
          style={{ aspectRatio: variant === 'project' ? '276 / 200' : '299 / 190' }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.media.url} alt="" className="h-full w-full object-cover" loading="lazy" />
        </button>
        <div className="pointer-events-none absolute inset-x-2 top-2 flex items-center gap-1.5">
          <span className="inline-flex h-5 items-center rounded-mini bg-canvas/80 px-1.5 text-nano font-bold text-ink-secondary">
            {aspectBadge(image)}
          </span>
          {onToggleFavorite ? (
            <button
              type="button"
              onClick={onToggleFavorite}
              aria-pressed={image.isFavorite}
              aria-label={image.isFavorite ? 'お気に入りから外す' : 'お気に入りにする'}
              className="pointer-events-auto inline-flex h-5 w-5 items-center justify-center rounded-mini bg-canvas/80"
            >
              <Star
                aria-hidden="true"
                className={image.isFavorite ? 'h-3.5 w-3.5 fill-status-warn text-status-warn' : 'h-3.5 w-3.5 text-ink-faint'}
              />
            </button>
          ) : null}
          <span className="flex-1" />
          {delivered ? (
            <span className="inline-flex h-5 items-center gap-1 rounded-mini bg-canvas/80 px-1.5 text-nano font-bold text-accent-deep">
              <Store aria-hidden="true" className="h-3 w-3" />
              渡し済み
            </span>
          ) : null}
        </div>
      </div>
      {variant === 'library' ? (
        <>
          <p className="truncate text-caption font-semibold text-ink">{projectName ?? '—'}</p>
          <p className="text-micro text-ink-faint">{shortDateTime(image.createdAt)}</p>
        </>
      ) : (
        <p className="truncate text-micro text-ink-faint">{tileCaption(image, presets)}</p>
      )}
    </div>
  )
}

/** 生成中の枠。Pencil 35-2-A `E7SBF`。できた枚数から順に本物の画像へ置き換わる。 */
export function PendingTile({ index, running }: { index: number; running: boolean }) {
  return (
    <div data-design-node="E7SBF" className="flex flex-col gap-1.5" role="status" aria-live="polite">
      <div
        className="flex flex-col items-center justify-center gap-2 rounded-card border border-hairline bg-step-idle"
        style={{ aspectRatio: '276 / 200' }}
      >
        <LoaderCircle aria-hidden="true" className={running ? 'h-6 w-6 animate-spin text-ink-faint' : 'h-6 w-6 text-ink-faint'} />
        <span className="text-caption text-ink-secondary">
          {running ? `${index}枚目を生成中…` : `${index}枚目 待機中`}
        </span>
      </div>
      <p className="text-micro text-ink-faint">{running ? '数十秒かかります' : '前の1枚ができたら始まります'}</p>
    </div>
  )
}
