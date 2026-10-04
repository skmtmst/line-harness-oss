'use client'

import '@/app/hq/readonly-v8.css'
import Select from '@/components/shared/select'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import { describeApiFailure, japaneseDetailOf } from '@/components/shared/api-error-message'
import FilterChip from '@/components/shared/filter-chip'
import HelpTip from '@/components/shared/help-tip'
import ListState from '@/components/shared/list-state'
import SearchField from '@/components/shared/search-field'
import type { AccountWithStats } from '@/contexts/account-context'
import { useAdminTheme } from '@/lib/use-admin-theme'
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
import BannerSideNav, { type BannerChrome } from './banner-side-nav-v8'
import ImageDetailModal from './image-detail-modal'
import ImageTile from './image-tile'
import UploadTargetDialog from './upload-target-dialog'

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
  onChrome,
}: {
  presets: BannerPreset[]
  accounts: AccountWithStats[]
  /** 渡す・外すで数が変わったとき。 */
  onChanged: () => void
  /** 板の左列（操作＋見る）に置く中身を、親へ渡す。 */
  onChrome?: (chrome: BannerChrome) => void
}) {
  // v7 の取得は30枚を保つ。件数選択は V8 だけ（v7 を変えない）。
  const theme = useAdminTheme()
  const [v8PageSize, setV8PageSize] = useState(10)
  const pageSize = theme === 'v8' ? v8PageSize : PAGE_SIZE
  const [uploadOpen, setUploadOpen] = useState(false)
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
    setLoadingMore(false)
    setActionError('')
    try {
      const [imageRes, activeRes, archivedRes] = await Promise.all([
        api.hqBanners.images.list({ favorite: filter === 'favorite', limit: pageSize }),
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
  }, [filter, pageSize])

  useEffect(() => {
    void load()
    return () => {
      requestRef.current += 1
    }
  }, [load])

  const loadMore = async () => {
    if (!nextBefore || loadingMore) return
    const requestId = requestRef.current
    setLoadingMore(true)
    try {
      const res = await api.hqBanners.images.list({ favorite: filter === 'favorite', before: nextBefore, limit: pageSize })
      if (requestId !== requestRef.current) return
      if (!res.success) throw new Error(res.error)
      setImages((prev) => [...prev, ...res.data.filter((i) => !prev.some((p) => p.id === i.id))])
      setNextBefore(res.nextBefore ?? null)
    } catch {
      if (requestId !== requestRef.current) return
      setActionError('続きを読み込めませんでした。もう一度お試しください。')
    } finally {
      if (requestId === requestRef.current) setLoadingMore(false)
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

  /*
   * M022：原文のまま出さず、共通の状態別案内へ渡す。
   * 窓は開いたままなので送り直しはできる（再試行の言葉つき）。
   */
  const modalFailureMessage = (caught: unknown, action: string): string =>
    japaneseDetailOf(caught) || describeApiFailure(caught, action, {
      forbidden: 'この操作はオーナーか管理者だけができます。必要なときはオーナーか管理者の方に操作してもらってください。',
    })

  const deliver = async (image: BannerImage, lineAccountIds: string[]) => {
    setModalBusy(true)
    setModalError('')
    try {
      const res = await api.hqBanners.images.deliver(image.id, lineAccountIds)
      if (!res.success) throw new Error(res.error)
      replaceImage(res.data.image)
      onChanged()
    } catch (caught) {
      setModalError(modalFailureMessage(caught, 'アカウントへの受け渡し'))
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
      setModalError(modalFailureMessage(caught, '一覧からの削除'))
    } finally {
      setModalBusy(false)
    }
  }

  useEffect(() => {
    onChrome?.({
      action: <UploadTargetDialog.Trigger onClick={() => setUploadOpen(true)} />,
      nav: status === 'ready' ? (
        <BannerSideNav
          items={[
            { key: 'all', label: 'すべて', count: images.length, selected: filter === 'all', onSelect: () => setFilter('all') },
            { key: 'favorite', label: 'お気に入り', count: images.filter((i) => i.isFavorite).length, selected: filter === 'favorite', onSelect: () => setFilter('favorite') },
            { key: 'delivered', label: '渡し済み', count: images.filter((i) => i.deliveredAccountIds.length > 0).length, selected: filter === 'delivered', onSelect: () => setFilter('delivered') },
            { key: 'unused', label: '未使用', count: images.filter((i) => i.deliveredAccountIds.length === 0).length, selected: filter === 'unused', onSelect: () => setFilter('unused') },
          ]}
        />
      ) : null,
    })
  }, [onChrome, status, images, filter])

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
        {/*
          検索は独立した全幅の行にする（U017・プロジェクト一覧と同じ形）。
          同じ行に注記を置くと、狭い幅で欄が潰れる。
        */}
        <div data-search-row className="p-4 pb-0">
          <SearchField
            placeholder="テキスト・指示・プロジェクト名で検索"
            aria-label="テキスト・指示・プロジェクト名で検索"
            value={query}
            onChange={setQuery}
            onClear={() => setQuery('')}
            className="w-full"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 p-4">
          <FilterChip selected={filter === 'all'} onChange={() => setFilter('all')}>すべて</FilterChip>
          <FilterChip selected={filter === 'favorite'} onChange={(on) => setFilter(on ? 'favorite' : 'all')}>お気に入り</FilterChip>
          <FilterChip selected={filter === 'delivered'} onChange={(on) => setFilter(on ? 'delivered' : 'all')}>アカウントへ渡し済み</FilterChip>
          <FilterChip selected={filter === 'unused'} onChange={(on) => setFilter(on ? 'unused' : 'all')}>未使用</FilterChip>
          <span className="mx-1 h-5 border-l border-hairline" aria-hidden="true" />
          <span className="text-caption font-semibold text-ink-faint">用途</span>
          {SHAPE_FILTERS.map((item) => (
            <FilterChip key={item.key} selected={shape === item.key} onChange={(on) => setShape(on ? item.key : null)}>
              {item.label}
            </FilterChip>
          ))}
          <span className="flex-1" />
          <span className="text-caption text-ink-faint">並び順: 作成が新しい順</span>
          {status === 'ready' ? (
            <span className="text-micro text-ink-faint">
              {visible.length === images.length ? `${images.length}枚を表示中` : `読み込んだ ${images.length}枚のうち ${visible.length}枚`}
              {nextBefore ? '・続きがあります' : ''}
            </span>
          ) : null}
        </div>
        {theme === 'v8' && (
          <div className="flex flex-wrap items-center justify-end gap-3 px-4 pb-4">
            <span className="inline-flex items-center gap-1 whitespace-nowrap text-caption text-ink-secondary">
              取得件数
              <HelpTip label="画像の取得件数の説明">
                一度に読み込む画像の枚数です。検索と用途・渡し済みの条件は、読み込んだ画像に適用します。
              </HelpTip>
            </span>
            <Select
              aria-label="画像の取得件数"
              value={String(v8PageSize)}
              size="page-size"
              onChange={(value) => setV8PageSize(Number(value))}
              options={[10, 20, 50].map((value) => ({ value: String(value), label: `${value}枚` }))}
            />
          </div>
        )}
        <div className="border-t border-hairline" />

        {actionError ? <p className="px-4 pt-4 text-label text-danger" role="alert">{actionError}</p> : null}

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
            <div className="v8-ro-hq-bannerGrid grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
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
              <Button onClick={() => void loadMore()} disabled={loadingMore} busy={loadingMore} busyLabel="読み込んでいます…">
                {`さらに${pageSize}枚を表示`}
              </Button>
            </div>
          ) : null}
        </div>
      </section>

      <UploadTargetDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onPick={(projectId) => {
          setUploadOpen(false)
          router.push(`/hq/banners/project?id=${encodeURIComponent(projectId)}`)
        }}
      />

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
