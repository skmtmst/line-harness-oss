'use client'

import { Check, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import FilterChip from '@/components/shared/filter-chip'
import ListState from '@/components/shared/list-state'
import SearchField from '@/components/shared/search-field'
import { api } from '@/lib/api'
import { imageMatchesQuery, tileCaption, type BannerImage, type BannerPreset, type BannerProject } from '@/lib/hq-banners'

type Scope = 'all' | 'favorite' | 'project'

/**
 * 参照画像をライブラリから選ぶ。Pencil 35-2-B `biOEb`（画面 `L5PMT`）。
 *
 * 1 枚だけ選ぶ。タイルを押すと選ばれ、「この画像を参照にする」で決まる。
 * 手元のファイルは「手元のファイルを選ぶ」から（親がプロジェクトへ取り込んで参照にする）。
 */
export default function ReferencePickerDialog({
  open,
  projectId,
  presets,
  projects,
  selectedId,
  onClose,
  onPick,
  onUpload,
}: {
  open: boolean
  projectId: string
  presets: BannerPreset[]
  projects: BannerProject[]
  selectedId: string | null
  onClose: () => void
  onPick: (image: BannerImage) => void
  onUpload: (file: File) => void
}) {
  const [images, setImages] = useState<BannerImage[] | null>(null)
  const [nextBefore, setNextBefore] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [scope, setScope] = useState<Scope>('all')
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<BannerImage | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError('')
    setPicked(null)
    void api.hqBanners.images
      .list({ limit: 60 })
      .then((res) => {
        if (cancelled) return
        if (!res.success) throw new Error(res.error)
        setImages(res.data)
        setNextBefore(res.nextBefore ?? null)
      })
      .catch(() => {
        if (!cancelled) setError('画像を読み込めませんでした。')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const loadMore = async () => {
    if (!nextBefore || loading) return
    setLoading(true)
    try {
      const res = await api.hqBanners.images.list({ limit: 60, before: nextBefore })
      if (!res.success) throw new Error(res.error)
      setImages((prev) => [...(prev ?? []), ...res.data])
      setNextBefore(res.nextBefore ?? null)
    } catch {
      setError('続きを読み込めませんでした。')
    } finally {
      setLoading(false)
    }
  }

  const projectNames = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects])
  const visible = useMemo(() => {
    const list = images ?? []
    return list.filter((image) => {
      if (scope === 'favorite' && !image.isFavorite) return false
      if (scope === 'project' && image.projectId !== projectId) return false
      return imageMatchesQuery(image, query, projectNames.get(image.projectId) ?? '')
    })
  }, [images, scope, projectId, query, projectNames])

  const current = picked ?? (selectedId ? (images ?? []).find((i) => i.id === selectedId) ?? null : null)

  return (
    <Dialog
      open={open}
      title="参照画像を選ぶ"
      description="ライブラリから 1 枚選びます。"
      onCancel={onClose}
      error={error || undefined}
      designNode="biOEb"
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <Button onClick={() => fileRef.current?.click()}>
            <Upload aria-hidden="true" className="h-4 w-4" />
            手元のファイルを選ぶ
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            aria-label="参照画像のファイルを選ぶ"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) onUpload(file)
            }}
          />
          <span className="flex-1" />
          <Button onClick={onClose}>キャンセル</Button>
          <Button variant="primary" disabled={!current} onClick={() => current && onPick(current)}>
            <Check aria-hidden="true" className="h-4 w-4" />
            この画像を参照にする
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-60 flex-1">
            <SearchField value={query} onChange={setQuery} onClear={() => setQuery('')} placeholder="画像名・プロジェクト名で検索" aria-label="参照画像を検索" />
          </div>
          <FilterChip selected={scope === 'all'} onChange={() => setScope('all')}>すべて</FilterChip>
          <FilterChip selected={scope === 'favorite'} onChange={() => setScope('favorite')}>お気に入り</FilterChip>
          <FilterChip selected={scope === 'project'} onChange={() => setScope('project')}>このプロジェクト</FilterChip>
        </div>

        {images === null ? (
          <ListState kind="loading" title="画像を読み込んでいます" />
        ) : visible.length === 0 ? (
          <ListState kind="empty" title="選べる画像がありません" description="生成した画像や取り込んだ画像がここに並びます。手元のファイルを選ぶこともできます。" />
        ) : (
          <div data-design-node="exeSo" role="listbox" aria-label="参照にする画像" className="grid max-h-160 grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 md:grid-cols-4">
            {visible.map((image) => {
              const selected = current?.id === image.id
              return (
                <button
                  key={image.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => setPicked(image)}
                  className="flex flex-col gap-1.5 text-left"
                >
                  <span
                    className={
                      selected
                        ? 'relative block aspect-square w-full overflow-hidden rounded-control border-2 border-accent bg-step-idle'
                        : 'relative block aspect-square w-full overflow-hidden rounded-control border border-hairline bg-step-idle'
                    }
                  >
                    {/* 統括の画像は Worker から配信されるので next/image の最適化は使わない（image-tile と同じ） */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image.media.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                    {selected ? (
                      <span className="absolute bottom-2 right-2 flex h-6 w-6 items-center justify-center rounded-pill bg-accent-deep text-on-accent">
                        <Check aria-hidden="true" className="h-3.5 w-3.5" />
                      </span>
                    ) : null}
                  </span>
                  <span className="truncate text-caption font-semibold text-ink">{projectNames.get(image.projectId) ?? '—'} #{image.sequence}</span>
                  <span className="truncate text-nano text-ink-faint">{tileCaption(image, presets)}</span>
                </button>
              )
            })}
          </div>
        )}
        {nextBefore ? (
          <div className="flex justify-center">
            <Button onClick={() => void loadMore()} disabled={loading}>
              {loading ? '読み込んでいます…' : '続きを読み込む'}
            </Button>
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}
