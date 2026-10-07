'use client'

/*
 * ★V8 バナー生成・プロジェクトの中（Pencil `iMnph`・生成中 `p03ImY`・上限 `zOpMG`）。
 * 窓：画像の詳細 `rI5uh`・一覧から外す `B24oNg`・アーカイブ `I0w2e`・名前と説明を変える。
 *
 * v7 の画面（app/hq/banners/project/page.tsx）と、読み書きの口・1枚ずつ作る繰り返し・
 * 戻ったら続きから動く・失敗時の扱い・`?id=` `?from=` は同じ。見た目だけを絵どおりに一から組んだ：
 * 頭（型 ListPage：題・説明・画像を取り込む・アーカイブする・「…」）→ 左に札と画像のます、右に生成パネル。
 *
 * 右の生成パネルは共通の GenerationPanel をそのまま使う。絵（iMnph）は「用途の選ぶ欄・切り抜きの位置・
 * 色2つ・参照画像1枚」の古い形で、2026-10-06 のオーナーの決定（切り替えと切り抜きを置かない・出力サイズの小箱・
 * 色4つ・参照画像3枚・強調）と食い違うため、決定どおりの今のパネルを残した。参照画像を選ぶ窓（承認済み ★BG-C）も同じ。
 */
import { Archive, ArchiveRestore, Copy, Hourglass, LoaderCircle, MoreHorizontal, Pencil, Sparkles, Star, Upload } from 'lucide-react'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ListPage } from '@/components/templates'
import ActionMenu from '@/components/shared/action-menu'
import Button from '@/components/shared/button'
import FilterChip from '@/components/shared/filter-chip'
import IconButton from '@/components/shared/icon-button'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import StickyBar from '@/components/shared/sticky-bar'
import TargetMissing from '@/components/shared/target-missing'
import ExportSizeChip from '@/components/hq/banners/export-size-chip'
import GenerationPanel from '@/components/hq/banners/generation-panel'
import ReferencePickerDialog from '@/components/hq/banners/reference-picker-dialog'
import { usePageTitle } from '@/components/shell/page-chrome'
import type { AccountWithStats } from '@/contexts/account-context'
import { api, ApiError } from '@/lib/api'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import {
  BANNER_MAX_REFERENCE_IMAGES,
  EMPTY_GENERATION_INPUT,
  activeGeneration,
  exportSizeText,
  inputFromGeneration,
  packedTextLines,
  readFileAsBase64,
  usageRefusal,
  usageStatusText,
  validateGenerationInput,
  type BannerCropPosition,
  type BannerGeneration,
  type BannerGenerationInput,
  type BannerImage,
  type BannerPreset,
  type BannerProject,
  type BannerReference,
  type BannerReferenceMode,
  type BannerUsage,
} from '@/lib/hq-banners'
import { BannerImageDetailV8 } from './image-detail'
import { BANNER_UPLOAD_ACCEPT, BannerConfirmDialogV8, CreateProjectDialogV8, uploadRefusal } from './dialogs'
import { bannerLimitKind } from './limit-notice'
import { bannerFailureMessage, tileLabel } from './words'
import styles from './project.module.css'

type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden' | 'notfound' | 'missing'
type Filter = 'all' | 'favorite' | 'delivered'

export default function HqBannerProjectV8() {
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
  const role = useStaffRole()
  const canManage = canManageRole(role)

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
  // 用途寸法へ整形できなかった生成があった（binding の無い環境）。R120。
  const [sizeNotice, setSizeNotice] = useState(false)
  const [running, setRunning] = useState<BannerGeneration | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [openImage, setOpenImage] = useState<BannerImage | null>(null)
  const [modalBusy, setModalBusy] = useState(false)
  const [modalError, setModalError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [formBusy, setFormBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const [archiveConfirm, setArchiveConfirm] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  // 参照に選んだ画像の実体。他プロジェクトの画像も選べるので、この一覧に関係なく手元に置く。
  const [referencePool, setReferencePool] = useState<BannerImage[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [referenceBusy, setReferenceBusy] = useState(false)
  const [allProjects, setAllProjects] = useState<BannerProject[]>([])
  const cancelRef = useRef(false)
  const loopRef = useRef<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  usePageTitle(project?.name ?? null)

  const loadUsage = useCallback(async () => {
    const res = await api.hqBanners.usage().catch(() => null)
    if (res?.success) setUsage(res.data)
  }, [])

  const load = useCallback(async () => {
    if (!projectId) {
      setStatus('missing')
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

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    void api.lineAccounts.list().then((res) => {
      if (res.success) setAccounts(res.data as AccountWithStats[])
    }).catch(() => {
      // アカウントが取れなくても生成はできる。渡す先の一覧だけ空になる。
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
   * 1枚ずつ run を繰り返す（1回の呼び出しで1枚）。失敗したらそこで止め、理由を出す。成功分はサーバーに残る。
   * 切り抜き位置は保存していないので、作り始めたときの値をそのまま使う（戻った続きは中央。R120）。
   */
  const runLoop = useCallback(async (generation: BannerGeneration, crop: BannerCropPosition = 'center') => {
    if (loopRef.current === generation.id) return
    loopRef.current = generation.id
    cancelRef.current = false
    setCancelling(false)
    setRunning(generation)
    setGenerationError('')
    try {
      let current = generation
      while (!cancelRef.current) {
        const res = await api.hqBanners.generations.run(current.id, { gravity: crop })
        if (!res.success) throw new Error(res.error)
        current = res.data.generation
        setRunning(current)
        if (res.data.resized === false) setSizeNotice(true)
        if (res.data.image) {
          const image = res.data.image
          setImages((prev) => (prev.some((i) => i.id === image.id) ? prev : [image, ...prev]))
        }
        if (res.data.finished) break
      }
      void loadUsage()
    } catch (caught) {
      setGenerationError(caught instanceof Error && caught.message ? caught.message : '画像を作れませんでした。もう一度お試しください。')
      void loadUsage()
    } finally {
      // 先に最新の状態を読み直してから止める（順を逆にすると、古い「生成中」を見た再開がもう一度 run を呼ぶ）。
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
        // 空の行を落とすときは「強調」も同じ行と一緒に落とす。
        ...packedTextLines(input),
        customPrompt: input.customPrompt.trim(),
        freePrompt: input.freePrompt.trim(),
      })
      if (!res.success) throw new Error(res.error)
      setGenerations((prev) => [res.data, ...prev])
      void runLoop(res.data, input.cropPosition)
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
    setBusyAction('複製する')
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
      setModalError(bannerFailureMessage(caught, 'アカウントへの受け渡し'))
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
      setModalError(bannerFailureMessage(caught, '一覧からの削除'))
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

  /** 「画像を取り込む」。PNG・JPEG・WebP、10MB まで（手元で先に確かめる）。 */
  const takeIn = async (file: File | undefined) => {
    if (!file) return
    const refused = uploadRefusal(file)
    if (refused) return setActionError(refused)
    setUploading(true)
    setActionError('')
    try {
      const data = await readFileAsBase64(file)
      await upload({ filename: file.name, mimeType: file.type, data })
    } catch (caught) {
      setActionError(caught instanceof Error && caught.message ? caught.message : '画像を取り込めませんでした')
    } finally {
      setUploading(false)
    }
  }

  /** 参照画像に 1 枚足す（3 枚まで）。 */
  const addReference = (image: BannerImage, mode: BannerReferenceMode = 'inspire') => {
    if (input.references.some((reference) => reference.imageId === image.id)) return
    if (input.references.length >= BANNER_MAX_REFERENCE_IMAGES) {
      setGenerationError(`参照画像は ${BANNER_MAX_REFERENCE_IMAGES} 枚までです。入れ替えるときは、どれかを外してください。`)
      return
    }
    setReferencePool((prev) => [image, ...prev.filter((candidate) => candidate.id !== image.id)])
    setInput((cur) => ({ ...cur, references: [...cur.references, { imageId: image.id, mode }] }))
  }

  /** 参照画像の窓で選び終わったとき。選んだ実体を手元に置き、入力をそのまま置き換える。 */
  const applyReferences = (references: BannerReference[], picked: BannerImage[]) => {
    setReferencePool((prev) => [...picked, ...prev.filter((candidate) => !picked.some((image) => image.id === candidate.id))])
    setInput((cur) => ({ ...cur, references }))
    setPickerOpen(false)
  }

  /** 手元のファイルを参照にする：プロジェクトへ取り込んでから参照にする（画像はライブラリにも残る）。 */
  const uploadReference = async (file: File) => {
    const refused = uploadRefusal(file)
    if (refused) return setGenerationError(refused.replace('画像は', '参照画像は').replace('取り込めます', '使えます'))
    setReferenceBusy(true)
    setGenerationError('')
    try {
      const data = await readFileAsBase64(file)
      const uploaded = await upload({ filename: file.name, mimeType: file.type, data })
      if (uploaded) addReference(uploaded)
    } catch (caught) {
      setGenerationError(caught instanceof Error && caught.message ? caught.message : '画像を取り込めませんでした')
    } finally {
      setReferenceBusy(false)
    }
  }

  const openPicker = () => {
    setPickerOpen(true)
    if (allProjects.length === 0) {
      void api.hqBanners.projects.list().then((res) => { if (res.success) setAllProjects(res.data) }).catch(() => undefined)
    }
  }

  const referenceImages = useMemo(() => {
    const byId = new Map<string, BannerImage>()
    for (const image of referencePool) byId.set(image.id, image)
    for (const image of images) byId.set(image.id, image)
    return input.references.map((reference) => byId.get(reference.imageId)).filter((image): image is BannerImage => image !== undefined)
  }, [images, input.references, referencePool])

  const pendingCount = running ? Math.max(running.requestedCount - running.doneCount - running.failedCount, 0) : 0
  const visible = useMemo(
    () => images.filter((i) => (filter === 'favorite' ? i.isFavorite : filter === 'delivered' ? i.deliveredAccountIds.length > 0 : true)),
    [images, filter],
  )

  if (status === 'loading') return <ListState kind="loading" title="プロジェクトを読み込んでいます" />
  if (status === 'missing') {
    return <TargetMissing kind="unspecified" title="開くプロジェクトが指定されていません" description="一覧から、開きたいプロジェクトを選び直してください。" backHref="/hq/banners" backLabel="プロジェクト一覧へ戻る" />
  }
  if (status === 'notfound') {
    return <TargetMissing kind="not-found" title="プロジェクトが見つかりません" description="アーカイブされたか、別の統括のものかもしれません。一覧から選び直してください。" backHref="/hq/banners" backLabel="プロジェクト一覧へ戻る" />
  }
  if (status === 'forbidden') {
    return <ListState kind="forbidden" description="バナー生成は統括の管理者・オーナーだけが使えます。" action={<Button href="/hq/banners">プロジェクト一覧へ戻る</Button>} />
  }
  if (status === 'error' || !project) {
    return <TargetMissing kind="error" title="プロジェクトを読み込めませんでした" description="通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。" onRetry={() => void load()} />
  }

  const busy = busyAction !== null
  const archived = Boolean(project.archivedAt)
  const limited = bannerLimitKind(usage) !== null
  const boardId = running ? 'p03ImY' : limited ? 'zOpMG' : 'iMnph'
  const description = `${project.description ? `${project.description.replace(/。$/, '')}。` : ''}右で用途とテキストを決めて生成し、気に入った画像をアカウントへ渡します。`
  const favoriteCount = images.filter((i) => i.isFavorite).length
  const deliveredCount = images.filter((i) => i.deliveredAccountIds.length > 0).length
  const doneSoFar = running ? running.doneCount + running.failedCount : 0

  const actions = canManage ? (
    <div className={styles.headActions}>
      <span className={styles.menuBox}>
        <IconButton aria-label={`${project.name} のほかの操作`} title="ほかの操作" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)} disabled={busy}>
          <MoreHorizontal size={16} aria-hidden="true" />
        </IconButton>
        <ActionMenu
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          ariaLabel={`${project.name} のほかの操作`}
          items={[
            { id: 'favorite', label: project.isFavorite ? 'お気に入りから外す' : 'お気に入りにする', icon: <Star size={14} aria-hidden="true" />, onSelect: () => { setMenuOpen(false); void patchProject('お気に入り', { isFavorite: !project.isFavorite }) } },
            { id: 'duplicate', label: '複製する', icon: <Copy size={14} aria-hidden="true" />, onSelect: () => { setMenuOpen(false); void duplicate() } },
            { id: 'rename', label: '名前と説明を変える', icon: <Pencil size={14} aria-hidden="true" />, onSelect: () => { setMenuOpen(false); setFormError(''); setFormOpen(true) } },
          ]}
        />
      </span>
      <Button onClick={() => fileRef.current?.click()} disabled={busy || archived || uploading} busy={uploading} busyLabel="取り込み中…">
        <Upload aria-hidden="true" className={styles.icon} />画像を取り込む
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept={BANNER_UPLOAD_ACCEPT.join(',')}
        className={styles.hiddenInput}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => { void takeIn(event.target.files?.[0]); event.target.value = '' }}
      />
      {archived ? (
        <Button onClick={() => void patchProject('復元', { archived: false })} disabled={busy}>
          <ArchiveRestore aria-hidden="true" className={styles.icon} />復元
        </Button>
      ) : (
        <Button onClick={() => setArchiveConfirm(true)} disabled={busy || Boolean(running)}>
          <Archive aria-hidden="true" className={styles.icon} />アーカイブする
        </Button>
      )}
    </div>
  ) : undefined

  return (
    <ListPage boardId={boardId} title={project.name} description={description} actions={actions}>
      <div className={styles.body}>
        {actionError ? <Notice tone="danger" message={actionError} onClose={() => setActionError('')} /> : null}
        <div className={styles.split}>
          <section className={styles.gallery} aria-label="このプロジェクトの画像">
            <div className={styles.galleryTools}>
              <div role="group" aria-label="画像の絞り込み" className={styles.chips}>
                <FilterChip selected={filter === 'all'} icon={<Sparkles size={14} aria-hidden="true" />} onChange={() => setFilter('all')}>{`すべて ${images.length}`}</FilterChip>
                <FilterChip selected={filter === 'favorite'} icon={<Star size={14} aria-hidden="true" />} onChange={(on) => setFilter(on ? 'favorite' : 'all')}>{`お気に入り ${favoriteCount}`}</FilterChip>
                <FilterChip selected={filter === 'delivered'} icon={<Star size={14} aria-hidden="true" />} onChange={(on) => setFilter(on ? 'delivered' : 'all')}>{`アカウントへ渡し済み ${deliveredCount}`}</FilterChip>
              </div>
              <span className={styles.spacer} />
              <span className={styles.hint}>画像を押すと詳細・アカウントへ渡す</span>
            </div>

            {/*
              * 生成中の注記（承認済み `qIp42` の `k7sbSR`「注記 生成中のとき」）。
              * 止める操作は下の帯（`An26R` の `CzXI2`「生成をやめる」）だけに置く。
              * 同じ操作のボタンを2か所に出すと、どちらを押したか分からなくなる。
              */}
            {running ? (
              <div className={styles.runningBand} role="status" aria-live="polite">
                <LoaderCircle aria-hidden="true" className={`${styles.icon} ${styles.spin}`} />
                <span className={styles.runningText}>{`${Math.min(doneSoFar + 1, running.requestedCount)} / ${running.requestedCount} 枚目を作っています。この画面を閉じるとここで止まります（できた枚数は残ります）`}</span>
              </div>
            ) : null}
            {generationError ? <Notice tone="danger" message={generationError} onClose={() => setGenerationError('')} /> : null}
            {sizeNotice ? <Notice tone="info" message="大きさの調整は検証環境で確認してください。この画像は生成時の大きさのまま保存されています。" onClose={() => setSizeNotice(false)} /> : null}

            {images.length === 0 && pendingCount === 0 ? (
              <ListState
                kind="empty"
                title="まだ画像がありません"
                description="右の生成パネルで用途とテキストを決めて「画像を生成」を押すと、ここに並びます。手持ちの画像は「画像を取り込む」から入れられます。"
              />
            ) : visible.length === 0 && pendingCount === 0 ? (
              <ListState kind="empty" emptyPreset="filtered" action={<Button onClick={() => setFilter('all')}>条件を外す</Button>} />
            ) : (
              <div className={styles.grid}>
                {/* 絵 p03ImY：いま作っている生成でできた画像 → 作っている1枚 → 待っている枚 → それより前の画像。 */}
                {[...visible.filter((image) => running && image.generationId === running.id), ...(filter === 'all' ? Array.from({ length: pendingCount }, (_, i) => i) : []), ...visible.filter((image) => !(running && image.generationId === running.id))].map((item, index) => typeof item === 'number' ? (
                  <PendingTile key={`pending-${item}`} running={item === 0} label={tileLabel(presets.find((p) => p.key === running?.presetKey), { generation: running, source: 'generated' })} />
                ) : (() => { const image = item; return (
                  <article key={image.id} className={styles.tile}>
                    <button type="button" className={styles.tileImage} onClick={() => { setModalError(''); setOpenImage(image) }} aria-label={`画像 ${index + 1} を開く`}>
                      <Thumb image={image} />
                    </button>
                    <div className={styles.tileMeta}>
                      <span className={styles.metaText}>{tileLabel(presets.find((p) => p.key === image.generation?.presetKey), image)}</span>
                      <span className={styles.spacer} />
                      {image.deliveredAccountIds.length > 0 ? <span className={styles.pillOk}><span className={styles.dot} aria-hidden="true" />渡し済み</span> : null}
                      {canManage ? (
                        <button type="button" className={styles.star} onClick={() => void toggleImageFavorite(image)} aria-pressed={image.isFavorite} aria-label={image.isFavorite ? 'お気に入りから外す' : 'お気に入りにする'}>
                          <Star aria-hidden="true" className={image.isFavorite ? styles.starOn : styles.starOff} />
                        </button>
                      ) : null}
                    </div>
                  </article>
                ) })())}
              </div>
            )}
          </section>

          {canManage ? (
            <div ref={panelRef} className={styles.panel}>
              <GenerationPanel
                presets={presets}
                maxCount={maxCount}
                value={input}
                onChange={setInput}
                disabled={Boolean(running) || archived || !engineReady}
                referenceImages={referenceImages}
                onPickReference={openPicker}
                onUploadReference={(file) => void uploadReference(file)}
                referenceBusy={referenceBusy}
                usage={usage}
                onReloadUsage={loadUsage}
              />
            </div>
          ) : null}
        </div>

        {/*
          * 下の帯（承認済み ★BG-B `qIp42` → `X2oLn`「下部追従バー」）。
          * 左=残り枚数 `M118zK`／中=大きさの札 `WDJak`／
          * 右=`wCvLN`「条件をクリア」＋`abZle` 生成するボタン。
          * 生成中は `An26R`「帯（生成中）」——`CzXI2`「生成をやめる」＋
          * `q9hrn`「生成中（押せない）」。
          *
          * 2026-10-07: ここをパネルの中（全幅ボタン＋その下の行）に置いていたが、
          * 絵と配置が違っていた（差し戻し）。v7（app/hq/banners/project/page.tsx）と
          * 同じ並び・同じ札の部品にそろえた。生成の押し場所は帯だけにする。
          * 変えられない人（閲覧のみ）には押せないボタンを置かないので帯ごと出さない。
          */}
        {canManage ? (
          <StickyBar
            /*
             * 承認済み ★BG-B `qIp42` の帯 `X2oLn` は **枠線つき・高さ72・影なし**。
             * V8 の既定（★A/M10 の浮かせ）は**別の板**なので、この画面は板どおりに戻す。
             * 根拠は `docs/v8-design-rules.md` §1「画面ごとに、その板の絵のとおり」。
             */
            outlined
            status={
              running
                ? `${running.requestedCount}枚中 ${running.doneCount}枚できました・今月の残り ${usage?.month.remaining ?? '—'}枚`
                : blockedReason && input.presetKey
                  ? <span className={styles.warnText}>{blockedReason}</span>
                  : usageStatusText(usage, input.count)
            }
            info={
              exportSizeText(presets, input.presetKey) ? (
                <ExportSizeChip text={exportSizeText(presets, input.presetKey)} />
              ) : undefined
            }
            actions={
              running ? (
                <>
                  <Button onClick={() => void cancelGeneration()} disabled={cancelling} busy={cancelling} busyLabel="止めています…">生成をやめる</Button>
                  <Button variant="primary" disabled>
                    <LoaderCircle aria-hidden="true" className={`${styles.icon} ${styles.spin}`} />
                    生成中… 画面を離れても続きます
                  </Button>
                </>
              ) : (
                <>
                  <Button onClick={() => setInput({ ...EMPTY_GENERATION_INPUT, presetKey: presets[0]?.key ?? '' })} disabled={busy}>条件をクリア</Button>
                  <Button variant="primary" onClick={() => void startGeneration()} disabled={busy || Boolean(blockedReason)}>
                    <Sparkles aria-hidden="true" className={styles.icon} />
                    画像を生成（{input.count}枚）
                  </Button>
                </>
              )
            }
          />
        ) : null}
      </div>

      <CreateProjectDialogV8
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
        onCancel={() => { if (!formBusy) setFormOpen(false) }}
      />

      <BannerConfirmDialogV8
        open={archiveConfirm}
        title={`「${project.name}」をアーカイブしますか？`}
        description="一覧から見えなくなります。画像は消えず、アカウントへ渡した画像もそのまま使えます。「アーカイブを見る」からいつでも復元できます。"
        confirmLabel="アーカイブする"
        tone="primary"
        busy={busy}
        designNode="I0w2e"
        onConfirm={() => {
          void patchProject('アーカイブ', { archived: true }).then((updated) => {
            setArchiveConfirm(false)
            if (updated) router.push('/hq/banners')
          })
        }}
        onCancel={() => setArchiveConfirm(false)}
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
          onToggleFavorite={() => void toggleImageFavorite(openImage)}
          onDeliver={(ids) => deliver(openImage, ids)}
          onRemove={() => removeImage(openImage)}
          onRegenerate={openImage.generation ? () => {
            const generation = openImage.generation
            if (generation) setInput(inputFromGeneration(generation))
            setOpenImage(null)
            panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          } : undefined}
          onUseAsReference={() => {
            addReference(openImage)
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
        selected={input.references}
        onClose={() => setPickerOpen(false)}
        onPick={applyReferences}
        onUpload={(file) => { setPickerOpen(false); void uploadReference(file) }}
      />
    </ListPage>
  )
}

/** 作っている途中の1枚（絵 p03ImY の「作っています…」「待っています」）。 */
function PendingTile({ running, label }: { running: boolean; label: string }) {
  return (
    <article className={styles.tile} role="status" aria-live="polite">
      <div className={`${styles.tileImage} ${styles.pending}`}>
        {running ? <LoaderCircle aria-hidden="true" className={`${styles.pendingIcon} ${styles.spin}`} /> : <Hourglass aria-hidden="true" className={styles.pendingIcon} />}
        <span className={styles.pendingText}>{running ? '作っています…' : '待っています'}</span>
      </div>
      <div className={styles.tileMeta}><span className={styles.metaText}>{label}</span></div>
    </article>
  )
}

/** 画像の1枚。読めない画像は壊れた印を出さず、地の色のままにする。 */
function Thumb({ image }: { image: BannerImage }) {
  const [failed, setFailed] = useState(false)
  return (
    <span className={styles.thumb}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {!failed ? <img src={image.media.url} alt="" loading="lazy" onError={() => setFailed(true)} /> : null}
    </span>
  )
}
