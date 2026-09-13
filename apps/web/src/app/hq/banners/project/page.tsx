'use client'

import { Archive, ArchiveRestore, Copy, LoaderCircle, Pencil, Sparkles, Star } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import GenerationPanel from '@/components/hq/banners/generation-panel'
import ImageDetailModal from '@/components/hq/banners/image-detail-modal'
import ImageTile, { PendingTile } from '@/components/hq/banners/image-tile'
import ProjectFormDialog from '@/components/hq/banners/project-form-dialog'
import ReferencePickerDialog from '@/components/hq/banners/reference-picker-dialog'
import UploadButton from '@/components/hq/banners/upload-button'
import Breadcrumb from '@/components/shared/breadcrumb'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import FilterChip from '@/components/shared/filter-chip'
import ListState from '@/components/shared/list-state'
import StickyBar from '@/components/shared/sticky-bar'
import { usePageTitle } from '@/components/shell/page-chrome'
import type { AccountWithStats } from '@/contexts/account-context'
import { api, ApiError } from '@/lib/api'
import {
  EMPTY_GENERATION_INPUT,
  activeGeneration,
  inputFromGeneration,
  progressBadgeText,
  readFileAsBase64,
  usageRefusal,
  usageStatusText,
  validateGenerationInput,
  type BannerGeneration,
  type BannerGenerationInput,
  type BannerImage,
  type BannerPreset,
  type BannerProject,
  type BannerUsage,
} from '@/lib/hq-banners'

type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden' | 'notfound'
type Filter = 'all' | 'favorite' | 'delivered'

/**
 * プロジェクト詳細と生成。★V6 35-2（`g1WVyR`）と 35-2-A 生成中（`QGiQI`）。
 *
 * D 詳細型: パンくずと操作 → 本体（左の画像一覧＋右390の生成パネル）→ 下部追従バー。
 * 生成は「条件を登録」→「1枚ずつ run」を画面が繰り返す。1枚ごとにサーバーへ保存されるので、
 * 途中で画面を離れても成功分は残り、戻ると続きから動く。
 */
export default function HqBannerProjectPage() {
  return (
    <Suspense fallback={null}>
      <ProjectInner />
    </Suspense>
  )
}

function ProjectInner() {
  const router = useRouter()
  const params = useSearchParams()
  const projectId = params.get('id') ?? ''
  const fromImageId = params.get('from')

  const [status, setStatus] = useState<LoadStatus>('loading')
  const [project, setProject] = useState<BannerProject | null>(null)
  const [images, setImages] = useState<BannerImage[]>([])
  const [generations, setGenerations] = useState<BannerGeneration[]>([])
  const [presets, setPresets] = useState<BannerPreset[]>([])
  const [maxCount, setMaxCount] = useState(4)
  const [usage, setUsage] = useState<BannerUsage | null>(null)
  const [engineReady, setEngineReady] = useState(true)
  const [accounts, setAccounts] = useState<AccountWithStats[]>([])
  const [input, setInput] = useState<BannerGenerationInput>(EMPTY_GENERATION_INPUT)
  const [filter, setFilter] = useState<Filter>('all')
  const [actionError, setActionError] = useState('')
  const [generationError, setGenerationError] = useState('')
  const [running, setRunning] = useState<BannerGeneration | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [openImage, setOpenImage] = useState<BannerImage | null>(null)
  const [modalBusy, setModalBusy] = useState(false)
  const [modalError, setModalError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [formBusy, setFormBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const [archiveConfirm, setArchiveConfirm] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  // 参照画像（★V6 35-2 / 35-2-B）。実体は一覧かライブラリから引く。他プロジェクトの画像はここに置く。
  const [referenceImage, setReferenceImage] = useState<BannerImage | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [referenceBusy, setReferenceBusy] = useState(false)
  const [allProjects, setAllProjects] = useState<BannerProject[]>([])
  const cancelRef = useRef(false)
  const loopRef = useRef<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  usePageTitle(project?.name ?? null)

  const loadUsage = useCallback(async () => {
    const res = await api.hqBanners.usage().catch(() => null)
    if (res?.success) setUsage(res.data)
  }, [])

  const load = useCallback(async () => {
    if (!projectId) {
      setStatus('notfound')
      return
    }
    setStatus('loading')
    try {
      const [detailRes, presetRes] = await Promise.all([api.hqBanners.projects.get(projectId), api.hqBanners.presets()])
      if (!detailRes.success) throw new Error(detailRes.error)
      setProject(detailRes.data.project)
      setImages(detailRes.data.images)
      setGenerations(detailRes.data.generations)
      if (presetRes.success) {
        setPresets(presetRes.data.presets)
        setMaxCount(presetRes.data.maxCount)
        setUsage(presetRes.data.usage)
        setEngineReady(presetRes.data.engineReady)
        setInput((cur) => (cur.presetKey ? cur : { ...cur, presetKey: presetRes.data.presets[0]?.key ?? '' }))
      }
      setStatus('ready')
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) setStatus('notfound')
      else if (caught instanceof ApiError && caught.status === 403) setStatus('forbidden')
      else setStatus('error')
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void api.lineAccounts.list().then((res) => {
      if (res.success) setAccounts(res.data as AccountWithStats[])
    }).catch(() => {
      // 店舗が取れなくても生成はできる。渡す先の一覧だけ空になる。
    })
  }, [])

  // 「同じ設定でもう一度生成」で戻ってきたとき、その画像の条件をパネルへ入れる。
  useEffect(() => {
    if (!fromImageId || status !== 'ready') return
    void api.hqBanners.images.get(fromImageId).then((res) => {
      if (res.success && res.data.generation) setInput(inputFromGeneration(res.data.generation))
    }).catch(() => {
      // 元の画像が無くても、空のパネルから作れる。
    })
  }, [fromImageId, status])

  /**
   * 1枚ずつ run を繰り返す。1回の呼び出しで1枚。
   * 失敗したらそこで止め、理由を出す。成功分はサーバーに残っている。
   */
  const runLoop = useCallback(async (generation: BannerGeneration) => {
    if (loopRef.current === generation.id) return
    loopRef.current = generation.id
    cancelRef.current = false
    setCancelling(false)
    setRunning(generation)
    setGenerationError('')
    try {
      let current = generation
      while (!cancelRef.current) {
        const res = await api.hqBanners.generations.run(current.id)
        if (!res.success) throw new Error(res.error)
        current = res.data.generation
        setRunning(current)
        if (res.data.image) {
          const image = res.data.image
          setImages((prev) => (prev.some((i) => i.id === image.id) ? prev : [image, ...prev]))
        }
        if (res.data.finished) break
      }
      void loadUsage()
    } catch (caught) {
      const message = caught instanceof Error && caught.message ? caught.message : '画像を作れませんでした。もう一度お試しください。'
      setGenerationError(message)
      void loadUsage()
    } finally {
      // 先に最新の状態を読み直してから止める。順を逆にすると、古い「生成中」の
      // 記録を見た再開の処理が、もう一度 run を呼んでしまう。
      const res = await api.hqBanners.projects.get(generation.projectId).catch(() => null)
      if (res?.success) {
        setProject(res.data.project)
        setImages(res.data.images)
        setGenerations(res.data.generations)
      }
      loopRef.current = null
      setRunning(null)
    }
  }, [loadUsage])

  // 画面を離れて戻ってきたとき、途中の生成があれば続きから動かす。
  useEffect(() => {
    if (status !== 'ready' || running) return
    const pending = activeGeneration(generations)
    if (pending && loopRef.current !== pending.id) void runLoop(pending)
  }, [status, generations, running, runLoop])

  const validation = validateGenerationInput(input, maxCount)
  const refusal = usageRefusal(usage, input.count)
  const blockedReason = !engineReady
    ? '画像生成の接続設定がまだありません。運営にお問い合わせください'
    : project?.archivedAt
      ? 'アーカイブ済みのプロジェクトでは生成できません。復元してからお試しください'
      : validation ?? refusal

  const startGeneration = async () => {
    if (!project || blockedReason || running) return
    setGenerationError('')
    setActionError('')
    try {
      const res = await api.hqBanners.projects.createGeneration(project.id, {
        ...input,
        textLines: input.textLines.map((l) => l.trim()).filter(Boolean),
        customPrompt: input.customPrompt.trim(),
        freePrompt: input.freePrompt.trim(),
      })
      if (!res.success) throw new Error(res.error)
      setGenerations((prev) => [res.data, ...prev])
      void runLoop(res.data)
    } catch (caught) {
      setGenerationError(caught instanceof Error && caught.message ? caught.message : '生成を始められませんでした。')
      void loadUsage()
    }
  }

  const cancelGeneration = async () => {
    if (!running) return
    cancelRef.current = true
    setCancelling(true)
    try {
      await api.hqBanners.generations.cancel(running.id)
    } catch {
      // 止められなくても、次の run で finished が返る。
    }
  }

  const patchProject = async (label: string, patch: { name?: string; description?: string | null; isFavorite?: boolean; archived?: boolean }) => {
    if (!project) return null
    setBusyAction(label)
    setActionError('')
    try {
      const res = await api.hqBanners.projects.update(project.id, patch)
      if (!res.success) throw new Error(res.error)
      setProject(res.data)
      return res.data
    } catch (caught) {
      setActionError(caught instanceof Error && caught.message ? caught.message : `${label}できませんでした。もう一度お試しください。`)
      return null
    } finally {
      setBusyAction(null)
    }
  }

  const duplicate = async () => {
    if (!project) return
    setBusyAction('複製')
    setActionError('')
    try {
      const res = await api.hqBanners.projects.duplicate(project.id)
      if (!res.success) throw new Error(res.error)
      router.push(`/hq/banners/project?id=${encodeURIComponent(res.data.id)}`)
    } catch {
      setActionError('複製できませんでした。もう一度お試しください。')
    } finally {
      setBusyAction(null)
    }
  }

  const replaceImage = (next: BannerImage) => {
    setImages((prev) => prev.map((i) => (i.id === next.id ? next : i)))
    setOpenImage((cur) => (cur?.id === next.id ? next : cur))
  }

  const toggleImageFavorite = async (image: BannerImage) => {
    setModalError('')
    try {
      const res = await api.hqBanners.images.update(image.id, { isFavorite: !image.isFavorite })
      if (!res.success) throw new Error(res.error)
      replaceImage(res.data)
    } catch {
      setActionError('お気に入りを変更できませんでした。もう一度お試しください。')
    }
  }

  const deliver = async (image: BannerImage, ids: string[]) => {
    setModalBusy(true)
    setModalError('')
    try {
      const res = await api.hqBanners.images.deliver(image.id, ids)
      if (!res.success) throw new Error(res.error)
      replaceImage(res.data.image)
    } catch (caught) {
      setModalError(caught instanceof Error && caught.message ? caught.message : '店舗へ渡せませんでした。もう一度お試しください。')
    } finally {
      setModalBusy(false)
    }
  }

  const removeImage = async (image: BannerImage) => {
    setModalBusy(true)
    setModalError('')
    try {
      const res = await api.hqBanners.images.remove(image.id)
      if (!res.success) throw new Error(res.error)
      setImages((prev) => prev.filter((i) => i.id !== image.id))
      setOpenImage(null)
      setProject((p) => (p ? { ...p, imageCount: Math.max(p.imageCount - 1, 0) } : p))
    } catch (caught) {
      setModalError(caught instanceof Error && caught.message ? caught.message : '一覧から外せませんでした。もう一度お試しください。')
    } finally {
      setModalBusy(false)
    }
  }

  const upload = async (file: { filename: string; mimeType: string; data: string }) => {
    if (!project) return
    const res = await api.hqBanners.projects.upload(project.id, file)
    if (!res.success) throw new Error(res.error)
    setImages((prev) => [res.data, ...prev])
    setProject((p) => (p ? { ...p, imageCount: p.imageCount + 1 } : p))
    return res.data
  }

  /** 参照画像として使う。実体を手元に置き、パネルの入力に ID を入れる。 */
  const applyReference = (image: BannerImage) => {
    setReferenceImage(image)
    setInput((cur) => ({ ...cur, referenceImageId: image.id }))
    setPickerOpen(false)
  }

  /** 手元のファイルを参照にする: プロジェクトへ取り込んでから参照にする（画像はライブラリにも残る）。 */
  const uploadReference = async (file: File) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setGenerationError('参照画像は PNG・JPEG・WebP のみ使えます')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setGenerationError('ファイルが大きすぎます（上限 10MB）')
      return
    }
    setReferenceBusy(true)
    setGenerationError('')
    try {
      const data = await readFileAsBase64(file)
      const uploaded = await upload({ filename: file.name, mimeType: file.type, data })
      if (uploaded) applyReference(uploaded)
    } catch (caught) {
      setGenerationError(caught instanceof Error && caught.message ? caught.message : '画像を取り込めませんでした')
    } finally {
      setReferenceBusy(false)
    }
  }

  const openPicker = () => {
    setPickerOpen(true)
    if (allProjects.length === 0) {
      void api.hqBanners.projects.list().then((res) => {
        if (res.success) setAllProjects(res.data)
      }).catch(() => undefined)
    }
  }

  // 入力の参照 ID に合う実体。一覧に無ければ（他プロジェクト）手元の実体を使う。ID が消えたら実体も消す。
  const reference = input.referenceImageId
    ? images.find((i) => i.id === input.referenceImageId) ?? (referenceImage?.id === input.referenceImageId ? referenceImage : null)
    : null

  const pendingCount = running ? Math.max(running.requestedCount - running.doneCount - running.failedCount, 0) : 0
  const visible = useMemo(
    () =>
      images.filter((i) =>
        filter === 'favorite' ? i.isFavorite : filter === 'delivered' ? i.deliveredAccountIds.length > 0 : true,
      ),
    [images, filter],
  )

  if (status === 'loading') {
    return <ListState kind="loading" title="プロジェクトを読み込んでいます" />
  }
  if (status === 'notfound') {
    return (
      <ListState
        kind="empty"
        title="プロジェクトが見つかりません"
        description="アーカイブされたか、別の統括のものかもしれません。"
        action={<Button href="/hq/banners">プロジェクト一覧へ</Button>}
      />
    )
  }
  if (status === 'forbidden') {
    return <ListState kind="forbidden" description="バナー生成は統括の管理者・オーナーだけが使えます。" />
  }
  if (status === 'error' || !project) {
    return (
      <ListState
        kind="error"
        title="プロジェクトを読み込めませんでした"
        description="通信の状態を確認して、もう一度お試しください。"
        onRetry={() => void load()}
      />
    )
  }

  const busy = busyAction !== null

  return (
    <div data-design-node={running ? 'QGiQI' : 'g1WVyR'} className="flex flex-col gap-4">
      <div data-design-node="G6NIIg" className="flex flex-wrap items-center gap-2">
        <Breadcrumb items={[{ label: 'プロジェクト一覧', href: '/hq/banners' }, { label: project.name }]} />
        <span className="flex-1" />
        <UploadButton
          disabled={busy || Boolean(project.archivedAt)}
          onUpload={async (file) => {
            await upload(file)
          }}
          onError={setActionError}
        />
        <Button
          onClick={() => void patchProject('お気に入り', { isFavorite: !project.isFavorite })}
          disabled={busy}
          aria-pressed={project.isFavorite}
        >
          <Star aria-hidden="true" className={project.isFavorite ? 'h-4 w-4 fill-status-warn text-status-warn' : 'h-4 w-4'} />
          お気に入り
        </Button>
        <Button onClick={() => void duplicate()} disabled={busy}>
          <Copy aria-hidden="true" className="h-4 w-4" />
          複製
        </Button>
        <Button onClick={() => setFormOpen(true)} disabled={busy}>
          <Pencil aria-hidden="true" className="h-4 w-4" />
          名前と説明を変える
        </Button>
        {project.archivedAt ? (
          <Button onClick={() => void patchProject('復元', { archived: false })} disabled={busy}>
            <ArchiveRestore aria-hidden="true" className="h-4 w-4" />
            復元
          </Button>
        ) : (
          <Button onClick={() => setArchiveConfirm(true)} disabled={busy || Boolean(running)}>
            <Archive aria-hidden="true" className="h-4 w-4" />
            アーカイブ
          </Button>
        )}
      </div>

      {actionError ? <p className="text-label text-status-danger" role="alert">{actionError}</p> : null}
      {project.description ? <p className="text-caption text-ink-faint">{project.description}</p> : null}

      <div data-design-node="H2eb7f" className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <section data-design-node="ZwrHR" className="flex min-w-0 flex-1 flex-col rounded-card border border-hairline bg-canvas">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3">
            <h2 className="text-body font-bold text-ink">このプロジェクトの画像</h2>
            <span className="text-caption text-ink-faint">{images.length}枚</span>
            {running ? (
              <span className="inline-flex h-5 items-center gap-1 rounded-pill bg-status-info-soft px-2 text-nano font-bold text-status-info" role="status">
                <LoaderCircle aria-hidden="true" className="h-3 w-3 animate-spin" />
                {progressBadgeText(running)}
              </span>
            ) : null}
            <span className="flex-1" />
            <FilterChip selected={filter === 'all'} onChange={() => setFilter('all')}>すべて</FilterChip>
            <FilterChip selected={filter === 'favorite'} onChange={(on) => setFilter(on ? 'favorite' : 'all')}>お気に入り</FilterChip>
            <FilterChip selected={filter === 'delivered'} onChange={(on) => setFilter(on ? 'delivered' : 'all')}>店舗へ渡し済み</FilterChip>
          </div>
          <div className="border-t border-hairline" />
          {generationError ? (
            <div className="mx-4 mt-4 rounded-card bg-status-danger-soft px-4 py-3 text-label text-status-danger" role="alert">
              {generationError}
            </div>
          ) : null}
          <div data-design-node="TyPEb" className="p-4">
            {images.length === 0 && pendingCount === 0 ? (
              <ListState
                kind="empty"
                title="まだ画像がありません"
                description="右の生成パネルで用途とテキストを決めて「生成する」を押すと、ここに並びます。手持ちの画像は「画像を取り込む」から入れられます。"
              />
            ) : visible.length === 0 && pendingCount === 0 ? (
              <ListState kind="empty" />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {filter === 'all'
                  ? Array.from({ length: pendingCount }, (_, i) => (
                      <PendingTile key={`pending-${i}`} index={(running?.doneCount ?? 0) + (running?.failedCount ?? 0) + i + 1} running={i === 0} />
                    ))
                  : null}
                {visible.map((image) => (
                  <ImageTile
                    key={image.id}
                    image={image}
                    presets={presets}
                    variant="project"
                    onOpen={() => {
                      setModalError('')
                      setOpenImage(image)
                    }}
                    onToggleFavorite={() => void toggleImageFavorite(image)}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        <div ref={panelRef} className="w-full shrink-0 xl:w-auto">
          <GenerationPanel
            presets={presets}
            maxCount={maxCount}
            value={input}
            onChange={setInput}
            disabled={Boolean(running) || Boolean(project.archivedAt) || !engineReady}
            reference={reference}
            onPickReference={openPicker}
            onUploadReference={(file) => void uploadReference(file)}
            referenceBusy={referenceBusy}
          />
        </div>
      </div>

      <div data-design-node={running ? 'Kg13T' : 'SIT0Z'} className="sticky bottom-0 z-10">
        <StickyBar
          status={
            running ? (
              `${running.requestedCount}枚中 ${running.doneCount}枚できました・今月の残り ${usage?.month.remaining ?? '—'}枚`
            ) : blockedReason && input.presetKey ? (
              <span className="text-status-warn-deep">{blockedReason}</span>
            ) : (
              usageStatusText(usage, input.count)
            )
          }
          actions={
            running ? (
              <>
                <Button onClick={() => void cancelGeneration()} disabled={cancelling}>
                  {cancelling ? '止めています…' : '残りをやめる'}
                </Button>
                <Button variant="primary" disabled>
                  <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
                  生成中… 画面を離れても続きます
                </Button>
              </>
            ) : (
              <>
                <Button
                  onClick={() => setInput({ ...EMPTY_GENERATION_INPUT, presetKey: presets[0]?.key ?? '' })}
                  disabled={busy}
                >
                  条件をクリア
                </Button>
                <Button variant="primary" onClick={() => void startGeneration()} disabled={busy || Boolean(blockedReason)}>
                  <Sparkles aria-hidden="true" className="h-4 w-4" />
                  生成する（{input.count}枚）
                </Button>
              </>
            )
          }
        />
      </div>

      <ProjectFormDialog
        open={formOpen}
        project={project}
        busy={formBusy}
        error={formError}
        onSubmit={(next) => {
          setFormBusy(true)
          setFormError('')
          void patchProject('名前と説明の変更', { name: next.name, description: next.description || null }).then((updated) => {
            setFormBusy(false)
            if (updated) setFormOpen(false)
            else setFormError('保存できませんでした。もう一度お試しください。')
          })
        }}
        onCancel={() => {
          if (formBusy) return
          setFormOpen(false)
        }}
      />

      {archiveConfirm ? (
        <ConfirmDialog
          open
          title={`「${project.name}」をアーカイブしますか？`}
          description="一覧から見えなくなります。画像は消えず、店舗へ渡した画像もそのまま使えます。「アーカイブを見る」からいつでも復元できます。"
          confirmLabel="アーカイブする"
          destructive
          busy={busy}
          onConfirm={() => {
            void patchProject('アーカイブ', { archived: true }).then((updated) => {
              setArchiveConfirm(false)
              if (updated) router.push('/hq/banners')
            })
          }}
          onCancel={() => setArchiveConfirm(false)}
        />
      ) : null}

      {openImage ? (
        <ImageDetailModal
          image={openImage}
          presets={presets}
          accounts={accounts}
          projectName={project.name}
          sequenceLabel={openImage.generation ? `${openImage.sequence}枚目` : undefined}
          busy={modalBusy}
          error={modalError}
          onClose={() => {
            if (modalBusy) return
            setOpenImage(null)
          }}
          onToggleFavorite={() => void toggleImageFavorite(openImage)}
          onDeliver={(ids) => deliver(openImage, ids)}
          onRemove={() => removeImage(openImage)}
          onRegenerate={
            openImage.generation
              ? () => {
                  const generation = openImage.generation
                  if (generation) setInput(inputFromGeneration(generation))
                  setOpenImage(null)
                  panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
              : undefined
          }
          onUseAsReference={() => {
            applyReference(openImage)
            setOpenImage(null)
            panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }}
        />
      ) : null}

      <ReferencePickerDialog
        open={pickerOpen}
        projectId={project.id}
        presets={presets}
        projects={allProjects.length > 0 ? allProjects : [project]}
        selectedId={input.referenceImageId}
        onClose={() => setPickerOpen(false)}
        onPick={applyReference}
        onUpload={(file) => {
          setPickerOpen(false)
          void uploadReference(file)
        }}
      />
    </div>
  )
}
