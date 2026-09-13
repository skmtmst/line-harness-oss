'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import FilterChip from '@/components/shared/filter-chip'
import ListState from '@/components/shared/list-state'
import SearchField from '@/components/shared/search-field'
import type { AccountWithStats } from '@/contexts/account-context'
import { api, ApiError } from '@/lib/api'
import {
  SHAPE_FILTERS,
  imageMatchesQuery,
  presetKeysForShape,
  type BannerImage,
  type BannerPreset,
  type BannerProject,
  type ShapeFilter,
} from '@/lib/hq-banners'
import ImageDetailModal from './image-detail-modal'
import ImageTile from './image-tile'

type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden'
type Filter = 'all' | 'favorite' | 'delivered' | 'unused'

const PAGE_SIZE = 30

/**
 * 35-3 画像ライブラリの本体。Pencil `QEWug`。
 *
 * 統括の全画像を新しい順に30枚ずつ。お気に入りは API で絞り、
 * 渡し済み・未使用・用途（形）は読み込んだ分を手元で絞る。
 * 並び順は「作成が新しい順」だけなので、選べないプルダウンは置かない（§2-2）。
 */
export default function LibrarySection({
  presets,
  accounts,
  onChanged,
}: {
  presets: BannerPreset[]
  accounts: AccountWithStats[]
  /** 渡す・外すで数が変わったとき。 */
  onChanged: () => void
}) {
  const router = useRouter()
  const [images, setImages] = useState<BannerImage[]>([])
  const [nextBefore, setNextBefore] = useState<string | null>(null)
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [loadingMore, setLoadingMore] = useState(false)
  const [projects, setProjects] = useState<Record<string, BannerProject>>({})
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [shape, setShape] = useState<ShapeFilter | null>(null)
  const [openImage, setOpenImage] = useState<BannerImage | null>(null)
  const [modalBusy, setModalBusy] = useState(false)
  const [modalError, setModalError] = useState('')
  const [actionError, setActionError] = useState('')
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++requestRef.current
    setStatus('loading')
    setActionError('')
    try {
      const [imageRes, activeRes, archivedRes] = await Promise.all([
        api.hqBanners.images.list({ favorite: filter === 'favorite', limit: PAGE_SIZE }),
        api.hqBanners.projects.list(),
        api.hqBanners.projects.list({ archived: true }),
      ])
      if (requestId !== requestRef.current) return
      if (!imageRes.success) throw new Error(imageRes.error)
      setImages(imageRes.data)
      setNextBefore(imageRes.nextBefore ?? null)
      const map: Record<string, BannerProject> = {}
      for (const p of [...(activeRes.success ? activeRes.data : []), ...(archivedRes.success ? archivedRes.data : [])]) map[p.id] = p
      setProjects(map)
      setStatus('ready')
    } catch (caught) {
      if (requestId !== requestRef.current) return
      setStatus(caught instanceof ApiError && caught.status === 403 ? 'forbidden' : 'error')
    }
  }, [filter])

  useEffect(() => {
    void load()
    return () => {
      requestRef.current += 1
    }
  }, [load])

  const loadMore = async () => {
    if (!nextBefore || loadingMore) return
    setLoadingMore(true)
    try {
      const res = await api.hqBanners.images.list({ favorite: filter === 'favorite', before: nextBefore, limit: PAGE_SIZE })
      if (!res.success) throw new Error(res.error)
      setImages((prev) => [...prev, ...res.data.filter((i) => !prev.some((p) => p.id === i.id))])
      setNextBefore(res.nextBefore ?? null)
    } catch {
      setActionError('続きを読み込めませんでした。もう一度お試しください。')
    } finally {
      setLoadingMore(false)
    }
  }

  const replaceImage = (next: BannerImage) => {
    setImages((prev) => prev.map((i) => (i.id === next.id ? next : i)))
    setOpenImage((cur) => (cur?.id === next.id ? next : cur))
  }

  const toggleFavorite = async (image: BannerImage) => {
    setActionError('')
    setModalError('')
    try {
      const res = await api.hqBanners.images.update(image.id, { isFavorite: !image.isFavorite })
      if (!res.success) throw new Error(res.error)
      replaceImage(res.data)
    } catch {
      setActionError('お気に入りを変更できませんでした。もう一度お試しください。')
    }
  }

  const deliver = async (image: BannerImage, lineAccountIds: string[]) => {
    setModalBusy(true)
    setModalError('')
    try {
      const res = await api.hqBanners.images.deliver(image.id, lineAccountIds)
      if (!res.success) throw new Error(res.error)
      replaceImage(res.data.image)
      onChanged()
    } catch (caught) {
      setModalError(caught instanceof Error && caught.message ? caught.message : '店舗へ渡せませんでした。もう一度お試しください。')
    } finally {
      setModalBusy(false)
    }
  }

  const remove = async (image: BannerImage) => {
    setModalBusy(true)
    setModalError('')
    try {
      const res = await api.hqBanners.images.remove(image.id)
      if (!res.success) throw new Error(res.error)
      setImages((prev) => prev.filter((i) => i.id !== image.id))
      setOpenImage(null)
      onChanged()
    } catch (caught) {
      setModalError(caught instanceof Error && caught.message ? caught.message : '一覧から外せませんでした。もう一度お試しください。')
    } finally {
      setModalBusy(false)
    }
  }

  const shapeKeys = useMemo(() => (shape ? new Set(presetKeysForShape(presets, shape)) : null), [presets, shape])
  const visible = useMemo(
    () =>
      images
        .filter((i) => imageMatchesQuery(i, query, projects[i.projectId]?.name))
        .filter((i) => (filter === 'delivered' ? i.deliveredAccountIds.length > 0 : filter === 'unused' ? i.deliveredAccountIds.length === 0 : true))
        .filter((i) => (shapeKeys ? (i.generation ? shapeKeys.has(i.generation.presetKey) : false) : true)),
    [images, query, filter, shapeKeys, projects],
  )

  return (
    <>
      <section data-design-node="QEWug" className="flex flex-col rounded-card border border-hairline bg-canvas">
        <div className="flex flex-wrap items-center gap-2.5 p-4">
          <SearchField
            placeholder="テキスト・指示・プロジェクト名で検索"
            aria-label="テキスト・指示・プロジェクト名で検索"
            value={query}
            onChange={setQuery}
            onClear={() => setQuery('')}
            className="min-w-0 flex-1"
          />
          <span className="text-caption text-ink-faint">並び順: 作成が新しい順</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 pb-4">
          <FilterChip selected={filter === 'all'} onChange={() => setFilter('all')}>すべて</FilterChip>
          <FilterChip selected={filter === 'favorite'} onChange={(on) => setFilter(on ? 'favorite' : 'all')}>お気に入り</FilterChip>
          <FilterChip selected={filter === 'delivered'} onChange={(on) => setFilter(on ? 'delivered' : 'all')}>店舗へ渡し済み</FilterChip>
          <FilterChip selected={filter === 'unused'} onChange={(on) => setFilter(on ? 'unused' : 'all')}>未使用</FilterChip>
          <span className="mx-1 h-5 border-l border-hairline" aria-hidden="true" />
          <span className="text-caption font-semibold text-ink-faint">用途</span>
          {SHAPE_FILTERS.map((item) => (
            <FilterChip key={item.key} selected={shape === item.key} onChange={(on) => setShape(on ? item.key : null)}>
              {item.label}
            </FilterChip>
          ))}
          <span className="flex-1" />
          {status === 'ready' ? (
            <span className="text-micro text-ink-faint">
              {visible.length === images.length ? `${images.length}枚を表示中` : `読み込んだ ${images.length}枚のうち ${visible.length}枚`}
              {nextBefore ? '・続きがあります' : ''}
            </span>
          ) : null}
        </div>
        <div className="border-t border-hairline" />

        {actionError ? <p className="px-4 pt-4 text-label text-status-danger" role="alert">{actionError}</p> : null}

        <div data-design-node="lQDQz" className="flex flex-col gap-4 p-4">
          {status === 'loading' ? (
            <ListState kind="loading" title="画像を読み込んでいます" />
          ) : status === 'forbidden' ? (
            <ListState kind="forbidden" description="バナー生成は統括の管理者・オーナーだけが使えます。" />
          ) : status === 'error' ? (
            <ListState
              kind="error"
              title="一覧を読み込めませんでした"
              description="通信の状態を確認して、もう一度お試しください。何度も続く場合はお問い合わせから知らせてください。"
              onRetry={() => void load()}
            />
          ) : images.length === 0 ? (
            <ListState
              kind="empty"
              title="まだ画像がありません"
              description="プロジェクトの中で生成した画像と、取り込んだ画像がここに並びます。"
            />
          ) : visible.length === 0 ? (
            <ListState kind="empty" />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {visible.map((image) => (
                <ImageTile
                  key={image.id}
                  image={image}
                  presets={presets}
                  variant="library"
                  projectName={projects[image.projectId]?.name}
                  onOpen={() => {
                    setModalError('')
                    setOpenImage(image)
                  }}
                  onToggleFavorite={() => void toggleFavorite(image)}
                />
              ))}
            </div>
          )}
          {status === 'ready' && nextBefore ? (
            <div className="flex justify-center">
              <Button onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? '読み込んでいます…' : `さらに${PAGE_SIZE}枚を表示`}
              </Button>
            </div>
          ) : null}
        </div>
      </section>

      {openImage ? (
        <ImageDetailModal
          image={openImage}
          presets={presets}
          accounts={accounts}
          projectName={projects[openImage.projectId]?.name ?? 'プロジェクト'}
          busy={modalBusy}
          error={modalError}
          onClose={() => {
            if (modalBusy) return
            setOpenImage(null)
          }}
          onToggleFavorite={() => void toggleFavorite(openImage)}
          onDeliver={(ids) => deliver(openImage, ids)}
          onRemove={() => remove(openImage)}
          onRegenerate={
            openImage.generation
              ? () => router.push(`/hq/banners/project?id=${encodeURIComponent(openImage.projectId)}&from=${encodeURIComponent(openImage.id)}`)
              : undefined
          }
        />
      ) : null}
    </>
  )
}
