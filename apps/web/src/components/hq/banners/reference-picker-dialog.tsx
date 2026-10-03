'use client'

import { Check, Upload } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import FilterChip from '@/components/shared/filter-chip'
import ListState from '@/components/shared/list-state'
import SearchField from '@/components/shared/search-field'
import { api } from '@/lib/api'
import { useAdminTheme } from '@/lib/use-admin-theme'
import { imageMatchesQuery, tileCaption, type BannerImage, type BannerPreset, type BannerProject, type BannerReferenceMode } from '@/lib/hq-banners'

type Scope = 'all' | 'favorite' | 'project'

/**
 * 参照画像をライブラリから選ぶ。★V8 `UcBQ5`。
 *
 * 1 枚だけ選ぶ。タイルを押すと選ばれ、使い方と一緒に「この画像を使う」で決まる。
 * 手元のファイルは下の「ファイルを選ぶ」から（親がプロジェクトへ取り込んで参照にする）。
 */
export default function ReferencePickerDialog({
  open,
  projectId,
  presets,
  projects,
  selectedId,
  initialUsage,
  onClose,
  onPick,
  onUpload,
}: {
  open: boolean
  projectId: string
  presets: BannerPreset[]
  projects: BannerProject[]
  selectedId: string | null
  /** 開いたときの使い方（親の入力の値）。無ければ「雰囲気を参考にする」。 */
  initialUsage?: BannerReferenceMode | null
  onClose: () => void
  onPick: (image: BannerImage, usage: BannerReferenceMode) => void
  onUpload: (file: File) => void
}) {
  const theme = useAdminTheme()
  const v8 = theme === 'v8'
  const [images, setImages] = useState<BannerImage[] | null>(null)
  const [nextBefore, setNextBefore] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [scope, setScope] = useState<Scope>('all')
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<BannerImage | null>(null)
  /** 参照画像の使い方（UcBQ5）。選ぶときに親の入力へ一緒に入れる。 */
  const [usage, setUsage] = useState<BannerReferenceMode>('inspire')
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

  // 開くたび使い方を親の値に戻す（取ってくる処理とは分ける）。
  useEffect(() => {
    if (open) setUsage(initialUsage ?? 'inspire')
  }, [open, initialUsage])

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

  /** R606: 検索0件の空状態から、検索語と絞り込みを外す。 */
  const clearSearchConditions = useCallback(() => {
    setQuery('')
    setScope('all')
  }, [])

  /**
 * 参照画像の名前と寸法（UcBQ5）。名前はファイル名から拡張子を落とし、
 * 寸法は用途の指定寸法、無ければ画像自体の大きさを使う。
 */
function referenceName(image: BannerImage): string {
  return image.media.filename.replace(/\.[a-z0-9]+$/i, '') || '画像'
}

function referenceSize(image: BannerImage, presets: BannerPreset[]): string {
  const preset = image.generation ? presets.find((p) => p.key === image.generation?.presetKey) : null
  const width = preset?.targetWidth ?? image.media.width
  const height = preset?.targetHeight ?? image.media.height
  return width && height ? `${width}×${height}` : '—'
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
      description={v8 ? 'ライブラリから 1 枚選びます。生成した画像や取り込んだ画像がここに並びます。手元のファイルを選ぶこともできます。' : 'ライブラリから 1 枚選びます。'}
      onCancel={onClose}
      error={error || undefined}
      designNode="UcBQ5"
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <Button onClick={() => fileRef.current?.click()}>
            <Upload aria-hidden="true" className="h-4 w-4" />
            {v8 ? 'ファイルを選ぶ' : '手元のファイルを選ぶ'}
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
          <Button variant="primary" disabled={!current} onClick={() => current && onPick(current, usage)}>
            <Check aria-hidden="true" className="h-4 w-4" />
            {v8 ? 'この画像を使う' : 'この画像を参照にする'}
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
          <>
            {/*
              R606: 全画像0件と検索一致0件を区別する。画像があるのに
              絞り込んで0件のときは未登録の説明を出さず、条件を外す口を付ける。
            */}
            {images.length === 0 ? (
              <ListState kind="empty" title="選べる画像がありません" description="生成した画像や取り込んだ画像がここに並びます。手元のファイルを選ぶこともできます。" />
            ) : (
              <ListState
                kind="empty"
                emptyPreset="filtered"
                action={<Button onClick={clearSearchConditions}>条件を外す</Button>}
              />
            )}
          </>
        ) : (
          <>
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
                      v8 ? (
                        <span className="absolute bottom-2 left-2 rounded-pill bg-accent-deep px-2 py-0.5 text-nano font-semibold text-on-accent">
                          選んだ
                        </span>
                      ) : (
                        <span className="absolute bottom-2 right-2 flex h-6 w-6 items-center justify-center rounded-pill bg-accent-deep text-on-accent">
                          <Check aria-hidden="true" className="h-3.5 w-3.5" />
                        </span>
                      )
                    ) : null}
                  </span>
                  {v8 ? (
                    <>
                      <span className="truncate text-caption font-semibold text-ink">{referenceName(image)}</span>
                      <span className="truncate text-nano text-ink-faint tabular-nums">{referenceSize(image, presets)}</span>
                    </>
                  ) : (
                    <>
                      <span className="truncate text-caption font-semibold text-ink">{projectNames.get(image.projectId) ?? '—'} #{image.sequence}</span>
                      <span className="truncate text-nano text-ink-faint">{tileCaption(image, presets)}</span>
                    </>
                  )}
                </button>
              )
            })}
          </div>
          {v8 ? (
            <fieldset className="rounded-control bg-canvas-sunken p-3">
              <legend className="px-1 text-label font-medium text-ink">参照画像の使い方</legend>
              <div className="flex flex-wrap gap-4">
                <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-caption text-ink">
                  <input type="radio" name="reference-usage" className="h-4 w-4 accent-accent-deep" checked={usage === 'inspire'} onChange={() => setUsage('inspire')} />
                  雰囲気を参考にする
                </label>
                <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-caption text-ink">
                  <input type="radio" name="reference-usage" className="h-4 w-4 accent-accent-deep" checked={usage === 'edit'} onChange={() => setUsage('edit')} />
                  土台に描き直す
                </label>
              </div>
            </fieldset>
          ) : null}
          </>
        )}
        {nextBefore ? (
          <div className="flex justify-center">
            <Button onClick={() => void loadMore()} disabled={loading} busy={loading} busyLabel="読み込んでいます…">続きを読み込む
            </Button>
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}
