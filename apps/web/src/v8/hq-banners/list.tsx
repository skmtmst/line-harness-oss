'use client'

/*
 * ★V8 統括のバナー生成（Pencil `B9ZAr` プロジェクト一覧・`W5Wxr` 画像ライブラリ）。
 * 窓：`W7Z57` プロジェクトを作る・`AnwtH` 画像を取り込む・画像の詳細（`rI5uh` と同じ窓）。
 *
 * v7 の画面（app/hq/banners/page.tsx と components/hq/banners/*）と、読み書きの口・
 * 失敗時の扱い・`?tab=` は同じ。見た目だけを絵どおりに一から組んだ：
 * 頭（型 ListPage）・左の「見る」の列（型のフォルダの列＋共通 FolderPanel）・数のカード4枚・
 * 案内の帯・タブ・道具の段・カード（プロジェクト）／画像のます（ライブラリ）・件数と次へ。
 */
import { CircleDot, Folder, Gauge, Inbox, Plus, Send, Sparkles, Star, Upload } from 'lucide-react'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ListPage } from '@/components/templates'
import Button from '@/components/shared/button'
import FilterChip from '@/components/shared/filter-chip'
import FolderPanel, { type FolderPanelRow } from '@/components/shared/folder-panel'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import Notice from '@/components/shared/notice'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import { Tabs } from '@/components/shared/tabs'
import { usePageTitle } from '@/components/shell/page-chrome'
import type { AccountWithStats } from '@/contexts/account-context'
import { api, ApiError } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import {
  SHAPE_FILTERS,
  nextMonthResetLabel,
  type BannerImage,
  type BannerPreset,
  type BannerProject,
  type BannerStats,
  type BannerUsage,
  type ShapeFilter,
} from '@/lib/hq-banners'
import { BannerImageDetailV8 } from './image-detail'
import { CreateProjectDialogV8, UploadDialogV8 } from './dialogs'
import BannerLimitNotice from './limit-notice'
import { bannerFailureMessage, monthDay, shortPresetLabel } from './words'
import styles from './list.module.css'

type Tab = 'projects' | 'library'
type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden'
type ProjectView = 'all' | 'favorite' | 'running' | 'archived'
type ProjectSort = 'updated' | 'created' | 'name'
type LibraryView = 'all' | 'favorite' | 'delivered' | 'unused'

const PROJECT_SORTS: Array<{ value: ProjectSort; label: string }> = [
  { value: 'updated', label: '並び：更新が新しい順' },
  { value: 'created', label: '並び：作成が新しい順' },
  { value: 'name', label: '並び：名前順' },
]

/** 画像ライブラリは 12 枚ずつ（絵 W5Wxr の「1–12 件 / 23 件」「次の 12 件」）。 */
const LIBRARY_PAGE = 12

export default function HqBannersListV8() {
  return (
    <Suspense fallback={null}>
      <BannersInner />
    </Suspense>
  )
}

function BannersInner() {
  usePageTitle('バナー生成')
  const router = useRouter()
  const params = useSearchParams()
  const tab: Tab = params.get('tab') === 'library' ? 'library' : 'projects'
  const role = useStaffRole()
  // 役割が読めるまでは押せる形を出さない（閲覧のみに押せないボタンを置かない）。
  const canManage = canManageRole(role)

  const [stats, setStats] = useState<BannerStats | null>(null)
  const [usage, setUsage] = useState<BannerUsage | null>(null)
  const [presets, setPresets] = useState<BannerPreset[]>([])
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [accounts, setAccounts] = useState<AccountWithStats[]>([])

  const loadSummary = useCallback(async () => {
    /* 形の違う応答は置かない（`stats.projects.active` で画面ごと落ちる。全ルート監査 A1）。数は「—」になる。 */
    setSummaryLoading(true)
    const [presetRes, statsRes] = await Promise.allSettled([api.hqBanners.presets(), api.hqBanners.stats()])
    if (presetRes.status === 'fulfilled' && presetRes.value.success) {
      const data = presetRes.value.data as { presets?: unknown; usage?: BannerUsage | null }
      if (Array.isArray(data?.presets)) setPresets(data.presets as BannerPreset[])
      const next = data?.usage
      setUsage(next && typeof next.month?.used === 'number' ? next : null)
    }
    if (statsRes.status === 'fulfilled' && statsRes.value.success) {
      const data = statsRes.value.data as { projects?: { active?: unknown } } | null
      if (data && typeof data.projects?.active === 'number') setStats(statsRes.value.data)
    }
    setSummaryLoading(false)
  }, [])

  useEffect(() => {
    void loadSummary()
    void api.lineAccounts.list().then((res) => {
      if (res.success) setAccounts(res.data as AccountWithStats[])
    }).catch(() => {
      // アカウントが取れなくても一覧は使える。渡す先の一覧だけ空になる。
    })
  }, [loadSummary])

  // タブの切り替えは `?tab=` で、履歴を積まない（v7 と同じ）。
  const changeTab = (next: Tab) => router.replace(next === 'library' ? '/hq/banners?tab=library' : '/hq/banners')

  const kpis = (
    <div className={styles.kpis} data-design="KPIs">
      <StatCard title="プロジェクト" icon={<Folder aria-hidden="true" />} value={stats ? stats.projects.active : null} unit="件" detail={stats ? `アーカイブ ${stats.projects.archived}` : '—'} loading={summaryLoading} />
      <StatCard title="今月の生成" icon={<Sparkles aria-hidden="true" />} value={usage ? usage.month.used : null} unit="枚" detail={usage ? `今日 ${usage.today.used}枚・1日の上限 ${usage.today.limit}枚` : '—'} loading={summaryLoading} />
      <StatCard title="今月の残り" icon={<Gauge aria-hidden="true" />} value={usage ? usage.month.remaining : null} unit="枚" detail={usage ? `上限 ${usage.month.limit}枚・${nextMonthResetLabel()} に戻る` : '—'} loading={summaryLoading} />
      <StatCard title="アカウントへ渡した画像" icon={<Send aria-hidden="true" />} value={stats ? stats.deliveredImages : null} unit="枚" detail={stats ? `${stats.deliveredAccounts}アカウント` : '—'} loading={summaryLoading} />
    </div>
  )

  const head = (
    <>
      {kpis}
      <NoteBar tone="info">
        作った画像は統括の登録メディアに保存されます。アカウントへ渡すと、そのアカウントの配信・リッチメニュー・回答フォームから選べるようになります。
      </NoteBar>
      <div className={styles.tabs}>
        <Tabs
          label="バナー生成の表示"
          items={[
            { label: 'プロジェクト一覧', current: tab === 'projects', onClick: () => changeTab('projects') },
            { label: '画像ライブラリ', current: tab === 'library', onClick: () => changeTab('library') },
          ]}
        />
      </div>
    </>
  )

  return tab === 'projects'
    ? <ProjectsView head={head} canManage={canManage} usage={usage} archivedCount={stats?.projects.archived ?? null} onChanged={() => void loadSummary()} />
    : <LibraryView head={head} canManage={canManage} presets={presets} accounts={accounts} onChanged={() => void loadSummary()} />
}

/**
 * 数のカード（絵の「数 プロジェクト」など）。絵はつながった帯ではなく、間 12 の別々のカード。
 * 数が取れないときは「—」（推測で埋めない）。読み込み中は数の所を「…」にする。
 */
function StatCard({ title, icon, value, unit, detail, loading }: {
  title: string
  icon: React.ReactNode
  value: number | null
  unit: string
  detail: string
  loading: boolean
}) {
  return (
    <div className={styles.stat} aria-busy={loading || undefined}>
      <p className={styles.statHead}><span className={styles.statIcon}>{icon}</span><span className={styles.statTitle} title={title}>{title}</span></p>
      <p className={styles.statValue}>
        <span className={styles.statNumber}>{loading ? '…' : value === null ? '—' : formatNumber(value)}</span>
        {!loading && value !== null ? <span className={styles.statUnit}>{unit}</span> : null}
      </p>
      <p className={styles.statDetail}>{loading ? '読み込んでいます' : detail}</p>
    </div>
  )
}

/* ───────── プロジェクト一覧（B9ZAr） ───────── */

function ProjectsView({ head, canManage, usage, archivedCount, onChanged }: {
  head: React.ReactNode
  canManage: boolean
  usage: BannerUsage | null
  archivedCount: number | null
  onChanged: () => void
}) {
  const router = useRouter()
  const [projects, setProjects] = useState<BannerProject[]>([])
  const [thumbnails, setThumbnails] = useState<Record<string, BannerImage[]>>({})
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [view, setView] = useState<ProjectView>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<ProjectSort>('updated')
  const [actionError, setActionError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [formBusy, setFormBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const requestRef = useRef(0)
  const archivedMode = view === 'archived'

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
          if (list.length < 3) list.push(image)
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
    return () => { requestRef.current += 1 }
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
      // M022：原文のまま出さず、共通の状態別案内へ渡す。窓は開いたまま送り直せる。
      setFormError(bannerFailureMessage(caught, 'プロジェクトの作成'))
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

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return projects
      .filter((p) => (q ? `${p.name}\n${p.description ?? ''}`.toLowerCase().includes(q) : true))
      .filter((p) => (view === 'favorite' ? p.isFavorite : view === 'running' ? p.runningCount > 0 : true))
      .sort((a, b) => {
        if (sort === 'name') return a.name.localeCompare(b.name, 'ja')
        if (sort === 'created') return b.createdAt.localeCompare(a.createdAt)
        return b.updatedAt.localeCompare(a.updatedAt)
      })
  }, [projects, query, view, sort])

  const ready = status === 'ready' && !archivedMode
  const rows: FolderPanelRow[] = [
    { id: 'all', label: 'すべて', count: ready ? projects.length : null, icon: <Inbox size={15} aria-hidden="true" /> },
    { id: 'favorite', label: 'お気に入り', count: ready ? projects.filter((p) => p.isFavorite).length : null, color: 'var(--color-status-info)' },
    { id: 'running', label: '生成中', count: ready ? projects.filter((p) => p.runningCount > 0).length : null, color: 'var(--color-accent)' },
    { id: 'archived', label: 'アーカイブ', count: archivedCount, color: 'var(--color-status-warn)' },
  ]

  const folders = (
    <div className={styles.folderInset}>
      <FolderPanel
        createAction={canManage ? (
          <Button variant="primary" onClick={() => { setFormError(''); setFormOpen(true) }} className={styles.full}>
            <Plus aria-hidden="true" className={styles.buttonIcon} />プロジェクトを作る
          </Button>
        ) : null}
        heading="見る"
        rows={rows}
        activeId={view}
        onSelect={(id) => setView(id as ProjectView)}
      />
    </div>
  )

  const body = status === 'loading' ? (
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
        description="案件やキャンペーンごとにプロジェクトを作り、その中で画像を生成します。作った画像はアカウントへ渡せます。"
        action={canManage ? (
          <Button variant="primary" onClick={() => setFormOpen(true)}>
            <Plus aria-hidden="true" className={styles.buttonIcon} />最初のプロジェクトを作る
          </Button>
        ) : undefined}
      />
    )
  ) : visible.length === 0 ? (
    // R605: 検索・絞り込みの結果が0件。条件を外す口を付ける（作る口は出さない）。
    <ListState kind="empty" emptyPreset="filtered" action={<Button onClick={() => { setQuery(''); setView('all') }}>条件を外す</Button>} />
  ) : (
    <div className={styles.projectGrid}>
      {visible.map((project) => (
        <ProjectCard
          key={project.id}
          project={project}
          thumbnails={thumbnails[project.id] ?? []}
          busy={busyId === project.id}
          canManage={canManage}
          onOpen={() => router.push(`/hq/banners/project?id=${encodeURIComponent(project.id)}`)}
          onToggleFavorite={() => void toggleFavorite(project)}
        />
      ))}
    </div>
  )

  return (
    <ListPage
      boardId="B9ZAr"
      title="バナー生成"
      description="配信やリッチメニューに使う画像を AI で作り、各アカウントの登録メディアへ渡します。"
      folders={folders}
    >
      <div className={styles.body}>
        {head}
        <BannerLimitNotice usage={usage} />
        <div className={styles.tools}>
          <div className={styles.projectSearch}>
            <SearchField
              placeholder="プロジェクト名・説明で探す"
              aria-label="プロジェクト名・説明で探す"
              value={query}
              onChange={setQuery}
              onClear={() => setQuery('')}
            />
          </div>
          <span className={styles.spacer} />
          <div className={styles.projectSort}>
            <Select aria-label="プロジェクトの並び順" value={sort} onChange={(value) => setSort(value as ProjectSort)} options={PROJECT_SORTS} />
          </div>
        </div>
        {actionError ? <Notice tone="danger" message={actionError} /> : null}
        {body}
      </div>
      <CreateProjectDialogV8
        open={formOpen}
        busy={formBusy}
        error={formError}
        onSubmit={(input) => void create(input)}
        onCancel={() => {
          if (formBusy) return
          setFormOpen(false)
          setFormError('')
        }}
      />
    </ListPage>
  )
}

/** プロジェクトのカード（絵の「プロジェクト 秋のキャンペーン」）。上に3枚、下に名前・説明・枚数と更新。 */
function ProjectCard({ project, thumbnails, busy, canManage, onOpen, onToggleFavorite }: {
  project: BannerProject
  thumbnails: BannerImage[]
  busy: boolean
  canManage: boolean
  onOpen: () => void
  onToggleFavorite: () => void
}) {
  const running = project.runningCount > 0
  const meta = running && project.imageCount === 0
    ? '— ・ いま作成中'
    : `${project.imageCount} 枚 ・ ${monthDay(project.updatedAt)} 更新`
  return (
    <article className={styles.projectCard} aria-label={project.name}>
      <button type="button" className={styles.mosaic} onClick={onOpen} aria-label={`${project.name} を開く`}>
        {[0, 1, 2].map((i) => <Thumb key={i} image={thumbnails[i] ?? null} />)}
      </button>
      <div className={styles.cardBody}>
        <div className={styles.cardTitleRow}>
          <button type="button" className={styles.cardTitle} onClick={onOpen} title={project.name}>{project.name}</button>
          {canManage ? (
            <button
              type="button"
              className={styles.star}
              onClick={onToggleFavorite}
              disabled={busy}
              aria-pressed={project.isFavorite}
              aria-label={project.isFavorite ? `${project.name} をお気に入りから外す` : `${project.name} をお気に入りにする`}
            >
              <Star aria-hidden="true" className={project.isFavorite ? styles.starOn : styles.starOff} />
            </button>
          ) : project.isFavorite ? <Star aria-label="お気に入り" className={`${styles.starStatic} ${styles.starOn}`} /> : null}
        </div>
        <p className={styles.cardDesc} title={project.description ?? undefined}>{project.description || '説明はまだありません'}</p>
        <div className={styles.cardMeta}>
          <span className={styles.metaText}>{meta}</span>
          {running ? <span className={`${styles.pill} ${styles.pillInfo}`}><span className={styles.dot} aria-hidden="true" />生成中</span> : null}
          {project.archivedAt ? <span className={`${styles.pill} ${styles.pillIdle}`}>アーカイブ</span> : null}
        </div>
      </div>
    </article>
  )
}

/** 画像の1枚。読めない画像は壊れた印を出さず、地の色のままにする。 */
function Thumb({ image }: { image: BannerImage | null }) {
  const [failed, setFailed] = useState(false)
  return (
    <span className={styles.thumb}>
      {image && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image.media.url} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : null}
    </span>
  )
}

/* ───────── 画像ライブラリ（W5Wxr） ───────── */

function LibraryView({ head, canManage, presets, accounts, onChanged }: {
  head: React.ReactNode
  canManage: boolean
  presets: BannerPreset[]
  accounts: AccountWithStats[]
  onChanged: () => void
}) {
  const router = useRouter()
  const [images, setImages] = useState<BannerImage[]>([])
  const [counts, setCounts] = useState<import('@line-crm/shared').HqBannerImageCounts | null>(null)
  const [projects, setProjects] = useState<Record<string, BannerProject>>({})
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [view, setView] = useState<LibraryView>('all')
  const [shape, setShape] = useState<ShapeFilter | null>(null)
  const [query, setQuery] = useState('')
  /** ページごとの「この日時より前」。1ページ目は null。 */
  const [cursors, setCursors] = useState<Array<string | null>>([null])
  const [nextBefore, setNextBefore] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [openImage, setOpenImage] = useState<BannerImage | null>(null)
  const [modalBusy, setModalBusy] = useState(false)
  const [modalError, setModalError] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const requestRef = useRef(0)
  const page = cursors.length - 1
  const before = cursors[page]

  const filters = useMemo(() => ({
    ...(query.trim() ? { q: query.trim() } : {}),
    ...(shape ? { shape } : {}),
    ...(view === 'delivered' || view === 'unused' ? { delivered: view === 'delivered' } : {}),
    favorite: view === 'favorite',
    withCounts: true,
  }), [query, shape, view])

  const load = useCallback(async () => {
    const requestId = ++requestRef.current
    setStatus('loading')
    setActionError('')
    try {
      const [imageRes, activeRes, archivedRes] = await Promise.all([
        api.hqBanners.images.list({ ...filters, limit: LIBRARY_PAGE, ...(before ? { before } : {}) }),
        api.hqBanners.projects.list(),
        api.hqBanners.projects.list({ archived: true }),
      ])
      if (requestId !== requestRef.current) return
      if (!imageRes.success) throw new Error(imageRes.error)
      setImages(imageRes.data)
      setCounts(imageRes.counts ?? null)
      setNextBefore(imageRes.nextBefore ?? null)
      const map: Record<string, BannerProject> = {}
      for (const p of [...(activeRes.success ? activeRes.data : []), ...(archivedRes.success ? archivedRes.data : [])]) map[p.id] = p
      setProjects(map)
      setStatus('ready')
    } catch (caught) {
      if (requestId !== requestRef.current) return
      setStatus(caught instanceof ApiError && caught.status === 403 ? 'forbidden' : 'error')
    }
  }, [filters, before])

  useEffect(() => {
    void load()
    return () => { requestRef.current += 1 }
  }, [load])

  // 条件を変えたら1ページ目へ戻す。
  const resetPage = () => setCursors([null])

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
      setModalError(bannerFailureMessage(caught, 'アカウントへの受け渡し'))
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
      setModalError(bannerFailureMessage(caught, '一覧からの削除'))
    } finally {
      setModalBusy(false)
    }
  }

  const ready = status === 'ready'
  const rows: FolderPanelRow[] = [
    { id: 'all', label: 'すべて', count: ready ? counts?.all ?? images.length : null, icon: <Inbox size={15} aria-hidden="true" /> },
    { id: 'favorite', label: 'お気に入り', count: ready ? counts?.favorite ?? null : null, color: 'var(--color-status-info)' },
    { id: 'delivered', label: '渡し済み', count: ready ? counts?.delivered ?? null : null, color: 'var(--color-accent)' },
    { id: 'unused', label: '未使用', count: ready ? counts?.unused ?? null : null, color: 'var(--color-status-warn)' },
  ]

  const folders = (
    <div className={styles.folderInset}>
      <FolderPanel
        createAction={canManage ? (
          <Button variant="primary" onClick={() => setUploadOpen(true)} className={styles.full}>
            <Upload aria-hidden="true" className={styles.buttonIcon} />画像を取り込む
          </Button>
        ) : null}
        heading="見る"
        rows={rows}
        activeId={view}
        onSelect={(id) => { setView(id as LibraryView); resetPage() }}
      />
    </div>
  )

  const total = counts ? (view === 'all' ? counts.all : counts[view]) : null
  const first = images.length === 0 ? 0 : page * LIBRARY_PAGE + 1
  const last = page * LIBRARY_PAGE + images.length

  const body = status === 'loading' ? (
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
    query || shape || view !== 'all'
      ? <ListState kind="empty" emptyPreset="filtered" action={<Button onClick={() => { setQuery(''); setShape(null); setView('all'); resetPage() }}>条件を外す</Button>} />
      : <ListState kind="empty" title="まだ画像がありません" description="プロジェクトの中で生成した画像と、取り込んだ画像がここに並びます。" />
  ) : (
    <>
      <div className={styles.imageGrid}>
        {images.map((image) => {
          const preset = image.generation ? presets.find((p) => p.key === image.generation?.presetKey) : null
          return (
            <article key={image.id} className={styles.tile}>
              <button type="button" className={styles.tileImage} onClick={() => { setModalError(''); setOpenImage(image) }} aria-label={`${projects[image.projectId]?.name ?? 'プロジェクト'} の画像を開く`}>
                <Thumb image={image} />
              </button>
              <div className={styles.tileMeta}>
                <span className={styles.metaText}>{image.source === 'upload' ? '取り込み' : shortPresetLabel(preset, image)}</span>
                <span className={styles.spacer} />
                {image.deliveredAccountIds.length > 0 ? <span className={`${styles.pill} ${styles.pillOk}`}><span className={styles.dot} aria-hidden="true" />渡し済み</span> : null}
                {canManage ? (
                  <button type="button" className={styles.star} onClick={() => void toggleFavorite(image)} aria-pressed={image.isFavorite} aria-label={image.isFavorite ? 'お気に入りから外す' : 'お気に入りにする'}>
                    <Star aria-hidden="true" className={image.isFavorite ? styles.starOn : styles.starOff} />
                  </button>
                ) : null}
              </div>
              <p className={styles.tileProject}>{projects[image.projectId]?.name ?? '—'}</p>
            </article>
          )
        })}
      </div>
      <div className={styles.pager}>
        <span className={styles.range}>{total === null ? `${first}–${last} 件` : `${first}–${last} 件 / ${total} 件`}</span>
        <span className={styles.spacer} />
        {page > 0 ? <Button onClick={() => setCursors((prev) => prev.slice(0, -1))}>{`前の ${LIBRARY_PAGE} 件`}</Button> : null}
        {nextBefore ? <Button onClick={() => setCursors((prev) => [...prev, nextBefore])}>{`次の ${LIBRARY_PAGE} 件`}</Button> : null}
      </div>
    </>
  )

  return (
    <ListPage
      boardId="W5Wxr"
      title="バナー生成"
      description="配信やリッチメニューに使う画像を AI で作り、各アカウントの登録メディアへ渡します。"
      folders={folders}
    >
      <div className={styles.body}>
        {head}
        <div className={styles.tools}>
          <div className={styles.librarySearch}>
            <SearchField
              placeholder="テキスト・指示で検索"
              aria-label="テキスト・指示で検索"
              value={query}
              onChange={(value) => { setQuery(value); resetPage() }}
              onClear={() => { setQuery(''); resetPage() }}
            />
          </div>
          <span className={styles.toolLabel}>用途</span>
          <div role="group" aria-label="用途で絞り込む" className={styles.chips}>
            <FilterChip selected={shape === null} icon={<CircleDot size={14} aria-hidden="true" />} onChange={() => { setShape(null); resetPage() }}>すべて</FilterChip>
            {SHAPE_FILTERS.map((item) => (
              <FilterChip key={item.key} selected={shape === item.key} icon={<Star size={14} aria-hidden="true" />} onChange={(on) => { setShape(on ? item.key : null); resetPage() }}>
                {item.label}
              </FilterChip>
            ))}
          </div>
          <span className={styles.spacer} />
          {/* 並びは「作成が新しい順」だけ。選べないので箱の形で示すだけにする（押しても変わらない口を置かない）。 */}
          <span className={styles.sortStatic}>並び：作成が新しい順</span>
        </div>
        {actionError ? <Notice tone="danger" message={actionError} /> : null}
        {body}
      </div>

      <UploadDialogV8
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onDone={(projectId) => {
          setUploadOpen(false)
          router.push(`/hq/banners/project?id=${encodeURIComponent(projectId)}`)
        }}
      />

      {openImage ? (
        <BannerImageDetailV8
          key={openImage.id}
          image={openImage}
          presets={presets}
          accounts={accounts}
          canManage={canManage}
          busy={modalBusy}
          error={modalError}
          onClose={() => { if (!modalBusy) setOpenImage(null) }}
          onToggleFavorite={() => void toggleFavorite(openImage)}
          onDeliver={(ids) => deliver(openImage, ids)}
          onRemove={() => remove(openImage)}
          onRegenerate={openImage.generation
            ? () => router.push(`/hq/banners/project?id=${encodeURIComponent(openImage.projectId)}&from=${encodeURIComponent(openImage.id)}`)
            : undefined}
        />
      ) : null}
    </ListPage>
  )
}
