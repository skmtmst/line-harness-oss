'use client'

import { Archive, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Button from '@/components/shared/button'
import FilterChip from '@/components/shared/filter-chip'
import ListState from '@/components/shared/list-state'
import SearchField from '@/components/shared/search-field'
import SelectField from '@/components/shared/select-field'
import { api, ApiError } from '@/lib/api'
import type { BannerImage, BannerProject, BannerUsage } from '@/lib/hq-banners'
import LimitState from './limit-state'
import ProjectCard from './project-card'
import ProjectFormDialog from './project-form-dialog'

type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden'
type Filter = 'all' | 'favorite' | 'running'
type Sort = 'updated' | 'created' | 'name'

const SORT_OPTIONS: Array<{ value: Sort; label: string }> = [
  { value: 'updated', label: '更新が新しい順' },
  { value: 'created', label: '作成が新しい順' },
  { value: 'name', label: '名前順' },
]

/**
 * 35-1 プロジェクト一覧の本体。Pencil `CkmC8`。
 *
 * 検索行 → 絞り込み行 → 区切り線 → 3列のカード。
 * 「アーカイブを見る」は同じ一覧をアーカイブ済みに切り替える（別画面を作らない）。
 */
export default function ProjectsSection({
  usage,
  onChanged,
  headerActions,
}: {
  usage: BannerUsage | null
  /** 作成・アーカイブなどで数が変わったとき。数値カード帯を読み直してもらう。 */
  onChanged: () => void
  /** タブ行の右端に置く操作を、親へ渡す。 */
  headerActions: (actions: ReactNode) => void
}) {
  const router = useRouter()
  const [projects, setProjects] = useState<BannerProject[]>([])
  const [thumbnails, setThumbnails] = useState<Record<string, BannerImage[]>>({})
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [archivedMode, setArchivedMode] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('updated')
  const [filter, setFilter] = useState<Filter>('all')
  const [actionError, setActionError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [formBusy, setFormBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++requestRef.current
    setStatus('loading')
    setActionError('')
    try {
      const [projectRes, imageRes] = await Promise.all([
        api.hqBanners.projects.list({ archived: archivedMode }),
        api.hqBanners.images.list({ limit: 100 }),
      ])
      if (requestId !== requestRef.current) return
      if (!projectRes.success) throw new Error(projectRes.error)
      setProjects(projectRes.data)
      if (imageRes.success) {
        const byProject: Record<string, BannerImage[]> = {}
        for (const image of imageRes.data) {
          const list = (byProject[image.projectId] ??= [])
          if (list.length < 4) list.push(image)
        }
        setThumbnails(byProject)
      }
      setStatus('ready')
    } catch (caught) {
      if (requestId !== requestRef.current) return
      setStatus(caught instanceof ApiError && caught.status === 403 ? 'forbidden' : 'error')
    }
  }, [archivedMode])

  useEffect(() => {
    void load()
    return () => {
      requestRef.current += 1
    }
  }, [load])

  const create = async (input: { name: string; description: string }) => {
    setFormBusy(true)
    setFormError('')
    try {
      const res = await api.hqBanners.projects.create({ name: input.name, description: input.description || null })
      if (!res.success) throw new Error(res.error)
      setFormOpen(false)
      onChanged()
      router.push(`/hq/banners/project?id=${encodeURIComponent(res.data.id)}`)
    } catch (caught) {
      setFormError(caught instanceof Error && caught.message ? caught.message : 'プロジェクトを作れませんでした')
    } finally {
      setFormBusy(false)
    }
  }

  const toggleFavorite = async (project: BannerProject) => {
    setBusyId(project.id)
    setActionError('')
    try {
      const res = await api.hqBanners.projects.update(project.id, { isFavorite: !project.isFavorite })
      if (!res.success) throw new Error(res.error)
      setProjects((prev) => prev.map((p) => (p.id === project.id ? res.data : p)))
    } catch {
      setActionError('お気に入りを変更できませんでした。もう一度お試しください。')
    } finally {
      setBusyId(null)
    }
  }

  useEffect(() => {
    headerActions(
      <>
        <Button variant="primary" onClick={() => setFormOpen(true)}>
          <Plus aria-hidden="true" className="h-4 w-4" />
          プロジェクトを作る
        </Button>
        <Button onClick={() => setArchivedMode((v) => !v)} aria-pressed={archivedMode}>
          <Archive aria-hidden="true" className="h-4 w-4" />
          {archivedMode ? '進行中を見る' : 'アーカイブを見る'}
        </Button>
      </>,
    )
  }, [archivedMode, headerActions])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return projects
      .filter((p) => (q ? `${p.name}\n${p.description ?? ''}`.toLowerCase().includes(q) : true))
      .filter((p) => (filter === 'favorite' ? p.isFavorite : filter === 'running' ? p.runningCount > 0 : true))
      .sort((a, b) => {
        if (sort === 'name') return a.name.localeCompare(b.name, 'ja')
        if (sort === 'created') return b.createdAt.localeCompare(a.createdAt)
        return b.updatedAt.localeCompare(a.updatedAt)
      })
  }, [projects, query, filter, sort])

  return (
    <>
      <LimitState usage={usage} />
      <section data-design-node="CkmC8" className="flex flex-col rounded-card border border-hairline bg-canvas">
        <div className="flex flex-wrap items-center gap-2.5 p-4">
          <SearchField
            placeholder="プロジェクト名・説明で検索"
            aria-label="プロジェクト名・説明で検索"
            value={query}
            onChange={setQuery}
            onClear={() => setQuery('')}
            className="min-w-0 flex-1"
          />
          <label className="flex items-center gap-2 text-caption text-ink-faint">
            並び順
            <SelectField
              aria-label="並び順"
              value={sort}
              onChange={(event) => setSort(event.target.value as Sort)}
              options={SORT_OPTIONS}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 pb-4">
          <FilterChip selected={filter === 'all'} onChange={() => setFilter('all')}>すべて</FilterChip>
          <FilterChip selected={filter === 'favorite'} onChange={(on) => setFilter(on ? 'favorite' : 'all')}>お気に入り</FilterChip>
          <FilterChip selected={filter === 'running'} onChange={(on) => setFilter(on ? 'running' : 'all')}>生成中</FilterChip>
          <span className="flex-1" />
          {status === 'ready' ? (
            <span className="text-micro text-ink-faint">
              {archivedMode ? 'アーカイブ ' : ''}
              {visible.length === projects.length ? `${projects.length}件` : `${projects.length}件中 ${visible.length}件`}
            </span>
          ) : null}
        </div>
        <div className="border-t border-hairline" />

        {actionError ? (
          <p className="px-4 pt-4 text-label text-status-danger" role="alert">{actionError}</p>
        ) : null}

        <div data-design-node="AYX0k" className="p-4">
          {status === 'loading' ? (
            <ListState kind="loading" title="プロジェクトを読み込んでいます" />
          ) : status === 'forbidden' ? (
            <ListState kind="forbidden" description="バナー生成は統括の管理者・オーナーだけが使えます。" />
          ) : status === 'error' ? (
            <ListState
              kind="error"
              title="一覧を読み込めませんでした"
              description="通信の状態を確認して、もう一度お試しください。何度も続く場合はお問い合わせから知らせてください。"
              onRetry={() => void load()}
            />
          ) : projects.length === 0 ? (
            archivedMode ? (
              <ListState kind="empty" title="アーカイブしたプロジェクトはありません" description="進行中の一覧でアーカイブすると、ここに移ります。" />
            ) : (
              <ListState
                kind="empty"
                title="まだプロジェクトがありません"
                description="案件やキャンペーンごとにプロジェクトを作り、その中で画像を生成します。作った画像は店舗へ渡せます。"
                action={
                  <Button variant="primary" onClick={() => setFormOpen(true)}>
                    <Plus aria-hidden="true" className="h-4 w-4" />
                    最初のプロジェクトを作る
                  </Button>
                }
              />
            )
          ) : visible.length === 0 ? (
            <ListState kind="empty" />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {visible.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  thumbnails={thumbnails[project.id] ?? []}
                  busy={busyId === project.id}
                  onOpen={() => router.push(`/hq/banners/project?id=${encodeURIComponent(project.id)}`)}
                  onToggleFavorite={() => void toggleFavorite(project)}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <ProjectFormDialog
        open={formOpen}
        project={null}
        busy={formBusy}
        error={formError}
        onSubmit={(input) => void create(input)}
        onCancel={() => {
          if (formBusy) return
          setFormOpen(false)
          setFormError('')
        }}
      />
    </>
  )
}
