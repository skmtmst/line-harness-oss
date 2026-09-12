'use client'

import { Download, RefreshCw, Star, Store, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import type { AccountWithStats } from '@/contexts/account-context'
import {
  fileSizeLabel,
  formatLabel,
  generationConditionRows,
  type BannerImage,
  type BannerPreset,
} from '@/lib/hq-banners'

/**
 * 画像の詳細と店舗へ渡す。Pencil 35-3-A `k0JKm`（幅1160）。
 *
 * 全面1枚のオーバーレイに中央そろえで置く（`docs/v6-common-rules.md` §1-7）。
 * 幅は `min(1160px, 100%)`。1920 や 1160 を固定で書かない。
 */
export default function ImageDetailModal({
  image,
  presets,
  accounts,
  projectName,
  sequenceLabel,
  busy,
  error,
  onClose,
  onToggleFavorite,
  onDeliver,
  onRemove,
  onRegenerate,
}: {
  image: BannerImage
  presets: BannerPreset[]
  accounts: AccountWithStats[]
  projectName: string
  /** 「1枚目」など。無ければ出さない。 */
  sequenceLabel?: string
  busy?: boolean
  error?: string
  onClose: () => void
  onToggleFavorite: () => void
  onDeliver: (lineAccountIds: string[]) => Promise<void>
  onRemove: () => Promise<void>
  /** 生成画像だけ。取り込み画像では出さない。 */
  onRegenerate?: () => void
}) {
  const panelRef = useOverlayFocus(true, onClose, busy)
  const [mounted, setMounted] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [confirmRemove, setConfirmRemove] = useState(false)
  useEffect(() => setMounted(true), [])

  const delivered = useMemo(() => new Set(image.deliveredAccountIds), [image.deliveredAccountIds])
  const rows = generationConditionRows(image, presets)
  const deliverable = accounts.filter((a) => !delivered.has(a.id))

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const overlay = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-scrim p-4"
      role="presentation"
      data-design-node="g4MyEA"
      onMouseDown={(event) => {
        if (!busy && event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="banner-image-detail-title"
        aria-busy={busy || undefined}
        tabIndex={-1}
        data-design-node="k0JKm"
        className="flex w-full flex-col rounded-panel border border-hairline bg-canvas shadow-card"
        style={{ maxWidth: 1160 }}
      >
        <div className="flex items-center gap-3 px-5 py-4">
          <h2 id="banner-image-detail-title" className="text-heading font-bold text-ink">画像の詳細</h2>
          <p className="text-caption text-ink-faint">
            {projectName}
            {sequenceLabel ? `・${sequenceLabel}` : ''}
          </p>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="閉じる"
            className="rounded-mini p-1 text-ink-secondary hover:bg-canvas-sunken disabled:opacity-50"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
        <div className="border-t border-hairline" />

        <div className="grid gap-5 p-5 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-center overflow-hidden rounded-card border border-hairline bg-shell">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.media.url} alt="" className="max-h-130 w-full object-contain" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-caption text-ink-faint">
                {image.media.width && image.media.height ? `${image.media.width}×${image.media.height}・` : ''}
                {formatLabel(image.media.mimeType)}・{fileSizeLabel(image.media.sizeBytes)}
              </p>
              <span className="flex-1" />
              <Button href={image.media.url} target="_blank" rel="noreferrer" download={image.media.filename}>
                <Download aria-hidden="true" className="h-4 w-4" />
                ダウンロード
              </Button>
              <Button onClick={onToggleFavorite} disabled={busy} aria-pressed={image.isFavorite}>
                <Star aria-hidden="true" className={image.isFavorite ? 'h-4 w-4 fill-status-warn text-status-warn' : 'h-4 w-4'} />
                お気に入り
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <section data-design-node="i5KDb" className="flex flex-col gap-2.5 rounded-card bg-surface-pearl p-4">
              <h3 className="text-body font-bold text-ink">{image.generation ? '生成時の条件' : 'この画像について'}</h3>
              <dl className="flex flex-col gap-2">
                {rows.map((row) => (
                  <div key={row.label} className="flex gap-3">
                    <dt className="w-24 shrink-0 text-caption font-semibold text-ink-faint">{row.label}</dt>
                    <dd className="min-w-0 flex-1 whitespace-pre-wrap break-words text-label text-ink">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section data-design-node="qyeVH" className="flex flex-col gap-2 rounded-card border border-hairline bg-canvas p-4">
              <div className="flex items-baseline gap-2">
                <h3 className="text-body font-bold text-ink">店舗へ渡す</h3>
                <p className="text-caption text-ink-faint">渡した店舗の登録メディアに入ります</p>
              </div>
              {accounts.length === 0 ? (
                <p className="text-caption text-ink-faint">この統括に店舗がありません。</p>
              ) : (
                <ul className="flex flex-col">
                  {accounts.map((account) => {
                    const already = delivered.has(account.id)
                    const checked = selected.includes(account.id)
                    return (
                      <li key={account.id}>
                        <label
                          className={
                            already
                              ? 'flex h-11 items-center gap-3 rounded-control px-2 text-ink-faint'
                              : checked
                                ? 'flex h-11 cursor-pointer items-center gap-3 rounded-control bg-accent-soft px-2 text-ink'
                                : 'flex h-11 cursor-pointer items-center gap-3 rounded-control px-2 text-ink hover:bg-canvas-sunken'
                          }
                        >
                          <input
                            type="checkbox"
                            className="h-4.5 w-4.5 accent-accent-deep"
                            checked={already || checked}
                            disabled={already || busy}
                            onChange={() => toggle(account.id)}
                          />
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-mini bg-accent-soft text-nano font-bold text-accent-deep">
                            {account.pictureUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={account.pictureUrl} alt="" className="h-full w-full object-cover" />
                            ) : (
                              (account.displayName ?? account.name).slice(0, 1)
                            )}
                          </span>
                          <span className="truncate text-label font-semibold">{account.displayName ?? account.name}</span>
                          <span className="text-micro text-ink-faint">{account.basicId ?? account.channelId}</span>
                          <span className="flex-1" />
                          {already ? (
                            <span className="inline-flex h-5 items-center gap-1 rounded-pill bg-accent-soft px-2 text-nano font-bold text-accent-deep">
                              <Store aria-hidden="true" className="h-3 w-3" />
                              渡し済み
                            </span>
                          ) : null}
                        </label>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </div>
        </div>

        {error ? <p className="px-5 text-label text-status-danger" role="alert">{error}</p> : null}

        <div className="border-t border-hairline" />
        <div data-design-node="V0mgAP" className="flex flex-wrap items-center gap-2 px-5 py-4">
          <button
            type="button"
            onClick={() => setConfirmRemove(true)}
            disabled={busy}
            className="inline-flex h-9 items-center gap-1.5 rounded-control px-3 text-label font-semibold text-status-danger hover:bg-status-danger-soft disabled:opacity-50"
          >
            <Trash2 aria-hidden="true" className="h-4 w-4" />
            一覧から外す
          </button>
          <span className="flex-1" />
          {onRegenerate ? (
            <Button onClick={onRegenerate} disabled={busy}>
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
              同じ設定でもう一度生成
            </Button>
          ) : null}
          <Button onClick={onClose} disabled={busy}>閉じる</Button>
          <Button
            variant="primary"
            disabled={busy || selected.length === 0 || deliverable.length === 0}
            onClick={() => void onDeliver(selected).then(() => setSelected([]))}
          >
            <Store aria-hidden="true" className="h-4 w-4" />
            {busy ? '渡しています…' : `${selected.length}店舗へ渡す`}
          </Button>
        </div>
      </div>

      {confirmRemove ? (
        <ConfirmDialog
          open
          title="この画像を一覧から外しますか？"
          description="統括の一覧に出なくなります。すでに店舗へ渡した画像は、その店舗の登録メディアに残ります。"
          confirmLabel="一覧から外す"
          destructive
          busy={busy}
          onConfirm={() => void onRemove().then(() => setConfirmRemove(false))}
          onCancel={() => setConfirmRemove(false)}
        />
      ) : null}
    </div>
  )

  return mounted && typeof document !== 'undefined' ? createPortal(overlay, document.body) : null
}
