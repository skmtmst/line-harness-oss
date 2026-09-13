'use client'

import { Star } from 'lucide-react'
import type { BannerImage, BannerProject } from '@/lib/hq-banners'
import { relativeUpdated } from '@/lib/hq-banners'

/**
 * プロジェクトのカード。Pencil 35-1 `iDZtt`。
 *
 * 上に最新4枚のモザイク（高さ150・すきま2）、下に名前・説明・枚数・更新。
 * 星はカードの中の独立した操作（押しても詳細へ飛ばない）。
 */
export default function ProjectCard({
  project,
  thumbnails,
  onOpen,
  onToggleFavorite,
  busy,
}: {
  project: BannerProject
  /** 最新4枚。無い枚は地の色で埋める。 */
  thumbnails: BannerImage[]
  onOpen: () => void
  onToggleFavorite: () => void
  busy?: boolean
}) {
  const cells = [0, 1, 2, 3].map((i) => thumbnails[i] ?? null)
  return (
    <article
      data-design-node="iDZtt"
      className="flex flex-col overflow-hidden rounded-card border border-hairline bg-canvas shadow-card"
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${project.name} を開く`}
        className="flex w-full gap-0.5 bg-shell text-left"
        style={{ height: 150 }}
      >
        {cells.map((image, i) => (
          <span key={i} className="block min-w-0 flex-1 overflow-hidden bg-step-idle">
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image.media.url} alt="" className="h-full w-full object-cover" loading="lazy" />
            ) : null}
          </span>
        ))}
      </button>
      <div className="flex flex-col gap-1.5 px-3.5 pb-3.5 pt-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpen}
            className="min-w-0 flex-1 truncate text-left text-body font-bold text-ink hover:underline"
          >
            {project.name}
          </button>
          <button
            type="button"
            onClick={onToggleFavorite}
            disabled={busy}
            aria-pressed={project.isFavorite}
            aria-label={project.isFavorite ? `${project.name} をお気に入りから外す` : `${project.name} をお気に入りにする`}
            className="shrink-0 rounded-mini p-0.5 text-ink-faint hover:bg-canvas-sunken disabled:opacity-50"
          >
            <Star
              aria-hidden="true"
              className={project.isFavorite ? 'h-4 w-4 fill-status-warn text-status-warn' : 'h-4 w-4 text-hairline'}
            />
          </button>
        </div>
        <p className="truncate text-caption text-ink-faint">{project.description || '説明はまだありません'}</p>
        <div className="flex items-center gap-2 text-micro">
          <span className="font-semibold text-ink-secondary">{project.imageCount}枚</span>
          <span className="text-ink-faint">更新 {relativeUpdated(project.updatedAt)}</span>
          <span className="flex-1" />
          {project.runningCount > 0 ? (
            <span className="inline-flex h-5 items-center gap-1 rounded-pill bg-status-info-soft px-2 font-semibold text-status-info">
              生成中
            </span>
          ) : null}
          {project.archivedAt ? (
            <span className="inline-flex h-5 items-center rounded-pill bg-step-idle px-2 font-semibold text-ink-secondary">
              アーカイブ
            </span>
          ) : null}
        </div>
      </div>
    </article>
  )
}
