'use client'

/*
 * ★V8 Googleビジネス 投稿（一覧 `Cfed0`・投稿を作る `T1j2Sw`）と公開前の確認。
 * 口（一覧・状態の確認・下書きの保存・取消・削除・公開）は今の画面と同じ。
 * 端末からの画像のアップロードは、入口の page.tsx が渡す道具（mediaUpload）で行う
 * （src/v8 から @/app を読まないため）。渡されないときは登録メディアから選ぶだけ。
 */
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { ImageIcon, MoreHorizontal, Plus, RefreshCw, Send } from 'lucide-react'
import type { MediaItem } from '@line-crm/shared'
import { api, ApiError, type MediaUploadSession } from '@/lib/api'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import IconButton from '@/components/shared/icon-button'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Pagination from '@/components/shared/pagination'
import Select from '@/components/shared/select'
import type { StatusBadgeTone } from '@/components/shared/status-badge'
import { TextField } from '@/components/shared/text-field'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import {
  restaurantGoogleApi,
  type GooglePost,
  type GooglePostCtaType,
  type GooglePostDraftInput,
  type GooglePostFilter,
  type GooglePostKind,
  type GooglePostListData,
} from '@/lib/restaurant-google-api'
import { errorMessage, formatShortDay, formatShortStamp } from './format'
import type { GoogleNav } from './google'
import styles from './google.module.css'

/** 端末からのアップロードの道具（今の画面の app/contents/media-direct-upload を入口が渡す）。 */
export interface MediaUploadHelpers {
  accept: string
  validate: (file: File) => string
  extractMetadata: (file: File) => Promise<{ width?: number; height?: number; durationMs?: number; pageCount?: number; codec?: string }>
  put: (session: MediaUploadSession, file: File, onProgress: (progress: number) => void) => Promise<string>
}

export const KIND_LABELS: Record<GooglePostKind, string> = { standard: '最新情報', event: 'イベント', offer: '特典', alert: 'お知らせ' }
const FILTER_OPTIONS: Array<{ value: GooglePostFilter; label: string }> = [
  { value: 'all', label: '状態：すべて' },
  { value: 'scheduled', label: '状態：予約' },
  { value: 'draft', label: '状態：下書き' },
  { value: 'published', label: '状態：公開済み' },
  { value: 'attention', label: '状態：要確認' },
]
const CTA_LABELS: Record<GooglePostCtaType, string> = { book: '予約', order: '注文', shop: '購入', learn_more: '詳細', sign_up: '申し込み', call: '電話' }

function statusBadge(post: GooglePost): { label: string; tone: StatusBadgeTone } {
  switch (post.status) {
    case 'draft': return { label: '下書き', tone: 'neutral' }
    case 'scheduled': return { label: '予約済み', tone: 'info' }
    case 'pending_confirm': return { label: '送信確認中', tone: 'warning' }
    case 'accepted': return { label: '審査中', tone: 'info' }
    case 'published': return { label: '公開済み', tone: 'success' }
    case 'rejected': return { label: 'Googleで不承認', tone: 'danger' }
    case 'failed': return { label: '送信失敗', tone: 'danger' }
    case 'cancelled': return { label: '取消済み', tone: 'neutral' }
    case 'deleted': return { label: '削除済み', tone: 'neutral' }
  }
}

function KindChip({ kind }: { kind: GooglePostKind }) {
  return <span className={`${styles.kindChip} ${kind === 'offer' ? styles.kindOffer : kind === 'event' ? styles.kindEvent : styles.kindStandard}`}>{KIND_LABELS[kind]}</span>
}

function postWhen(post: GooglePost): string {
  if (post.status === 'published' && post.publishedAt) return `${formatShortDay(post.publishedAt)} 公開`
  if (post.status === 'draft') return '未送信'
  return formatShortStamp(post.updatedAt)
}

export function PostsBoard({ accountId, go }: { accountId: string; go: GoogleNav }) {
  const [filter, setFilter] = useState<GooglePostFilter>('all')
  const [kind, setKind] = useState<'all' | GooglePostKind>('all')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<GooglePostListData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<GooglePost | null>(null)
  const [actionError, setActionError] = useState('')
  const [menuFor, setMenuFor] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      setData(await restaurantGoogleApi.posts(accountId, { filter, kind, page, perPage: 20 }))
    } catch (err) {
      setData(null)
      setLoadError(errorMessage(err, '投稿を読み込めませんでした。'))
    } finally {
      setLoading(false)
    }
  }, [accountId, filter, kind, page])

  useEffect(() => { void load() }, [load])

  const sync = async () => {
    setSyncing(true)
    setSyncError('')
    try {
      await restaurantGoogleApi.syncPosts(accountId)
      await load()
    } catch (err) {
      setSyncError(errorMessage(err, 'Googleから投稿の状態を確認できませんでした。'))
    } finally {
      setSyncing(false)
    }
  }

  const cancelDraft = async (post: GooglePost) => {
    setBusyId(post.id)
    setActionError('')
    try {
      await restaurantGoogleApi.cancelPost(accountId, post.id)
      await load()
    } catch (err) {
      setActionError(errorMessage(err, '取り消せませんでした。'))
    } finally {
      setBusyId(null)
    }
  }

  const removePost = async () => {
    if (!confirmRemove) return
    setBusyId(confirmRemove.id)
    setActionError('')
    try {
      await restaurantGoogleApi.removePost(accountId, confirmRemove.id)
      setConfirmRemove(null)
      await load()
    } catch (err) {
      setActionError(errorMessage(err, '削除できませんでした。'))
    } finally {
      setBusyId(null)
    }
  }

  const menuItems = (post: GooglePost): ActionMenuItem[] => {
    const actionable = post.status === 'draft' || post.status === 'rejected' || post.status === 'failed'
    const items: ActionMenuItem[] = [
      { id: 'open', label: actionable ? '編集' : '中身を見る', onSelect: () => go({ tab: 'posts', view: 'edit', id: post.id }) },
    ]
    if (post.status === 'published' && post.searchUrl) items.push({ id: 'google', label: 'Googleで表示', external: true, onSelect: () => window.open(post.searchUrl ?? '', '_blank', 'noopener') })
    if (post.status === 'draft') items.push({ id: 'cancel', label: '取り消す', disabled: busyId === post.id, onSelect: () => void cancelDraft(post) })
    if (post.status === 'published') items.push({ id: 'remove', label: 'Google から削除', tone: 'danger', dividerBefore: true, disabled: busyId === post.id, onSelect: () => setConfirmRemove(post) })
    return items
  }

  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.perPage)) : 1

  return (
    <>
      <div className={styles.toolbar}>
        <p className={styles.toolbarText}>Google に出す投稿（最新情報・イベント・特典・お知らせ）</p>
        <Select aria-label="状態で絞り込み" width={150} value={filter} onChange={(value) => { setFilter(value as GooglePostFilter); setPage(1) }} options={FILTER_OPTIONS.map((option) => ({ ...option, disabled: option.value === 'scheduled' && (data?.counts.scheduled ?? 0) === 0 }))} />
        <Select aria-label="種類で絞り込み" width={150} value={kind} onChange={(value) => { setKind(value as typeof kind); setPage(1) }} options={[{ value: 'all', label: '種類：すべて' }, ...(['standard', 'event', 'offer'] as GooglePostKind[]).map((k) => ({ value: k, label: `種類：${KIND_LABELS[k]}` }))]} />
        <Button onClick={() => void sync()} disabled={syncing} busy={syncing} busyLabel="確認中…"><RefreshCw aria-hidden className={styles.icon15} />Googleの状態を確認</Button>
        <Button variant="primary" onClick={() => go({ tab: 'posts', view: 'new', kind: 'standard' })}><Plus aria-hidden className={styles.icon15} />投稿を作る</Button>
      </div>
      {syncError ? <Notice tone="warn">{syncError}</Notice> : null}
      {actionError ? <Notice tone="danger">{actionError}</Notice> : null}
      {loading && !data ? <div className={styles.stateBox}><ListState kind="loading" title="投稿を読み込んでいます" /></div> : null}
      {loadError ? <div className={styles.stateBox}><ListState kind="error" title="投稿を表示できませんでした" description={loadError} onRetry={() => void load()} /></div> : null}
      {data ? (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>{`投稿 ${data.total} 件`}</h2>
          {data.total === 0 && !loading ? (
            <ListState kind="empty" title={filter === 'all' ? 'まだ投稿がありません' : 'その状態の投稿はありません'} description="「投稿を作る」から最新情報・イベント・特典を作れます。" emptyPreset="readonly" />
          ) : (
            <div className={styles.postList}>
              {data.posts.map((post) => {
                const badge = statusBadge(post)
                const name = post.title ?? post.summary
                return (
                  <div key={post.id} className={styles.postRow}>
                    <KindChip kind={post.kind} />
                    <span className={styles.postTitle} title={name}>{name}</span>
                    {post.origin === 'google' ? <span className={styles.postMeta}>Googleで作成</span> : null}
                    <span className={styles.postMeta}>{postWhen(post)}</span>
                    <span className={`${styles.kindChip} ${badge.tone === 'success' ? styles.kindOffer : badge.tone === 'warning' ? styles.kindEvent : badge.tone === 'danger' ? styles.chipDanger : badge.tone === 'info' ? styles.chipInfo : styles.kindStandard}`}>{badge.label}</span>
                    <span className={styles.menuBox}>
                      <IconButton aria-label={`投稿「${name}」の操作`} title={`投稿「${name}」の操作`} aria-expanded={menuFor === post.id} onClick={() => setMenuFor((current) => (current === post.id ? null : post.id))}>
                        <MoreHorizontal aria-hidden className={styles.icon16} />
                      </IconButton>
                      <ActionMenu open={menuFor === post.id} onClose={() => setMenuFor(null)} ariaLabel={`投稿「${name}」の操作`} items={menuItems(post)} />
                    </span>
                  </div>
                )
              })}
            </div>
          )}
          {data.total > 0 && pageCount > 1 ? (
            <div className={styles.pager}>
              <span className={styles.pagerNote}>{`${data.total}件・時刻はすべて日本時間（Asia/Tokyo）`}</span>
              <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
            </div>
          ) : null}
          <p className={styles.grayNote}>{`行の「…」から 中身を見る・Google から削除。削除は元に戻せません（確認の小窓が出ます）。${data.writeEnabled ? '' : '検証環境では Google へは送りません。'}`}</p>
        </section>
      ) : null}
      <ConfirmDialog
        open={confirmRemove !== null}
        title="この投稿をGoogleから削除しますか？"
        description="削除すると元に戻せません。もう一度公開するには、新しく投稿を作り直してください。"
        confirmLabel="削除する"
        destructive
        busy={busyId === confirmRemove?.id}
        onConfirm={() => void removePost()}
        onCancel={() => setConfirmRemove(null)}
      />
    </>
  )
}

interface PostForm {
  kind: GooglePostKind
  summary: string
  title: string
  start: string
  end: string
  ctaType: GooglePostCtaType | ''
  ctaUrl: string
  couponCode: string
  redeemOnlineUrl: string
  termsConditions: string
  mediaId: string | null
  mediaFilename: string | null
  mediaSourceUrl: string | null
}

function emptyForm(kind: GooglePostKind): PostForm {
  return { kind, summary: '', title: '', start: '', end: '', ctaType: '', ctaUrl: '', couponCode: '', redeemOnlineUrl: '', termsConditions: '', mediaId: null, mediaFilename: null, mediaSourceUrl: null }
}

function formFromPost(post: GooglePost): PostForm {
  const join = (date?: string, time?: string) => (date ? `${date}T${time || '00:00'}` : '')
  return {
    kind: post.kind === 'alert' ? 'standard' : post.kind,
    summary: post.summary,
    title: post.title ?? '',
    start: join(post.schedule?.startDate, post.schedule?.startTime),
    end: join(post.schedule?.endDate, post.schedule?.endTime),
    ctaType: post.cta?.type ?? '',
    ctaUrl: post.cta?.url ?? '',
    couponCode: post.offer?.couponCode ?? '',
    redeemOnlineUrl: post.offer?.redeemOnlineUrl ?? '',
    termsConditions: post.offer?.termsConditions ?? '',
    mediaId: post.media[0]?.mediaId ?? null,
    mediaFilename: post.media[0]?.filename ?? null,
    mediaSourceUrl: post.media[0]?.sourceUrl ?? null,
  }
}

/** 送る形は今の画面と同じ（日時は「日付」と「時刻」に分けて送る）。 */
function draftInputFrom(form: PostForm): GooglePostDraftInput {
  const [startDate = '', startTime = ''] = form.start.split('T')
  const [endDate = '', endTime = ''] = form.end.split('T')
  return {
    kind: form.kind,
    summary: form.summary.trim(),
    title: form.kind === 'standard' ? null : form.title.trim() || null,
    schedule: form.kind === 'standard' ? null : { startDate, startTime, endDate, endTime },
    cta: form.kind !== 'offer' && form.ctaType ? { type: form.ctaType, url: form.ctaType === 'call' ? null : form.ctaUrl.trim() || null } : null,
    offer: form.kind === 'offer' ? { couponCode: form.couponCode.trim() || null, redeemOnlineUrl: form.redeemOnlineUrl.trim() || null, termsConditions: form.termsConditions.trim() || null } : null,
    mediaId: form.mediaId,
  }
}

/** 欄の見出し。入力欄（htmlFor あり）は 13/500/20、選ぶ欄・本文は 12/600（T1j2Sw の2種類）。 */
function Field({ label, htmlFor, input = false, grow = false, children }: { label: string; htmlFor?: string; input?: boolean; grow?: boolean; children: ReactNode }) {
  return (
    <div className={`${styles.field} ${grow ? styles.grow : ''}`}>
      {htmlFor ? <label htmlFor={htmlFor} className={input ? styles.inputLabel : styles.fieldLabel}>{label}</label> : <span className={input ? styles.inputLabel : styles.fieldLabel}>{label}</span>}
      {children}
    </div>
  )
}

/** 投稿を作る・直す（T1j2Sw）。 */
export function PostEditor({ accountId, kind: kindFromUrl, postId, go, mediaUpload }: { accountId: string; kind: GooglePostKind; postId: string | null; go: GoogleNav; mediaUpload?: MediaUploadHelpers }) {
  const [form, setForm] = useState<PostForm>(emptyForm(kindFromUrl))
  const [initial, setInitial] = useState<PostForm>(emptyForm(kindFromUrl))
  const [loading, setLoading] = useState(Boolean(postId))
  const [loadError, setLoadError] = useState('')
  const [editable, setEditable] = useState(true)
  const [picker, setPicker] = useState<{ open: boolean; items: MediaItem[]; loading: boolean; error: string }>({ open: false, items: [], loading: false, error: '' })
  const [busy, setBusy] = useState<'save' | 'confirm' | null>(null)
  const [actionError, setActionError] = useState('')
  const [upload, setUpload] = useState<{ busy: boolean; progress: number; error: string }>({ busy: false, progress: 0, error: '' })
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!postId) { setForm(emptyForm(kindFromUrl)); setInitial(emptyForm(kindFromUrl)); setLoading(false); return }
    let alive = true
    setLoading(true)
    restaurantGoogleApi.post(accountId, postId)
      .then((response) => {
        if (!alive) return
        const next = formFromPost(response.post)
        setForm(next)
        setInitial(next)
        setEditable(response.post.status === 'draft')
      })
      .catch((err) => { if (alive) setLoadError(errorMessage(err, '投稿を読み込めませんでした。')) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [accountId, postId, kindFromUrl])

  const dirty = JSON.stringify(form) !== JSON.stringify(initial)
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: busy !== null })

  const openPicker = async () => {
    setPicker({ open: true, items: [], loading: true, error: '' })
    try {
      const response = await api.media.list(accountId, { kind: 'image', limit: 60, sort: 'newest' })
      if (!response.success) throw new ApiError(500, response.error)
      setPicker({ open: true, items: response.data.items, loading: false, error: '' })
    } catch (err) {
      setPicker({ open: true, items: [], loading: false, error: errorMessage(err, '登録メディアを読み込めませんでした。') })
    }
  }

  /** 端末（PC/スマホ）内のファイルをそのまま登録メディアへ登録し、投稿画像として選ぶ（今の画面と同じ手順）。 */
  const uploadFromDevice = async (file: File) => {
    if (!mediaUpload) return
    const problem = mediaUpload.validate(file)
    if (problem) { setUpload({ busy: false, progress: 0, error: problem }); return }
    setUpload({ busy: true, progress: 0, error: '' })
    try {
      const metadata = await mediaUpload.extractMetadata(file)
      const prepared = await api.media.prepareUploads({ accountId, files: [{ filename: file.name, mimeType: file.type, sizeBytes: file.size, metadata }] })
      if (!prepared.success) throw new ApiError(500, prepared.error)
      const session = prepared.data.sessions[0]
      if (!session) throw new Error('送信の準備結果を確認できませんでした')
      const etag = await mediaUpload.put(session, file, (progress) => setUpload((current) => ({ ...current, progress })))
      const completion = await api.media.completeUpload(session.id, { accountId, etag })
      if (!completion.success) throw new ApiError(500, completion.error)
      const mediaId = completion.data.mediaId
      if (!mediaId) throw new Error('登録を完了できませんでした')
      const detail = await api.media.detail(mediaId, accountId)
      if (!detail.success) throw new ApiError(500, detail.error)
      setForm((current) => ({ ...current, mediaId: detail.data.item.id, mediaFilename: detail.data.item.filename, mediaSourceUrl: detail.data.item.url }))
      setPicker({ open: false, items: [], loading: false, error: '' })
      setUpload({ busy: false, progress: 100, error: '' })
    } catch (err) {
      setUpload({ busy: false, progress: 0, error: errorMessage(err, 'アップロードできませんでした。') })
    }
  }

  const validationError = (): string | null => {
    if (!form.summary.trim()) return '本文を入力してください。'
    if (form.summary.length > 1500) return '本文は1,500文字までです。'
    if (form.kind !== 'standard') {
      if (!form.title.trim()) return `${form.kind === 'event' ? 'イベントタイトル' : '特典タイトル'}を入力してください。`
      if (!form.start || !form.end) return '期間のはじめ・おわりの日時を入力してください。'
      if (form.end < form.start) return '期間のおわりは、はじめより後にしてください。'
    }
    return null
  }

  const save = async (): Promise<string | null> => {
    const problem = validationError()
    if (problem) { setActionError(problem); return null }
    setBusy('save')
    setActionError('')
    try {
      const input = draftInputFrom(form)
      const response = postId ? await restaurantGoogleApi.savePost(accountId, postId, input) : await restaurantGoogleApi.createPost(accountId, input)
      setInitial(form)
      return response.post.id
    } catch (err) {
      setActionError(errorMessage(err, '下書きを保存できませんでした。'))
      return null
    } finally {
      setBusy(null)
    }
  }

  const saveDraft = async () => {
    const id = await save()
    if (id && !postId) go({ tab: 'posts', view: 'edit', id })
  }

  const openConfirm = async () => {
    setBusy('confirm')
    const id = await save()
    setBusy(null)
    if (id) go({ tab: 'posts', view: 'confirm', id })
  }

  if (loading) return <div className={styles.stateBox}><ListState kind="loading" title="投稿を読み込んでいます" /></div>
  if (loadError) return <ListState kind="error" title="投稿を表示できませんでした" description={loadError} action={<Button onClick={() => go({ tab: 'posts' })}>投稿一覧へ戻る</Button>} />

  const withPeriod = form.kind !== 'standard'
  const set = (patch: Partial<PostForm>) => setForm((current) => ({ ...current, ...patch }))

  return (
    <>
      {!editable ? <Notice tone="warn">この投稿はもう編集できません（送信済み、または送信手続き中です）。</Notice> : null}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>{postId ? '投稿を直す' : '投稿を作る'}</h2>
        <Field label="種類">
          <Select
            aria-label="投稿の種類"
            size="full"
            value={form.kind}
            disabled={Boolean(postId) || !editable}
            onChange={(value) => go({ tab: 'posts', view: 'new', kind: value })}
            options={(['standard', 'event', 'offer'] as GooglePostKind[]).map((k) => ({ value: k, label: KIND_LABELS[k] }))}
          />
        </Field>
        {withPeriod ? (
          <div className={styles.fieldGroup}>
            <Field label="タイトル（特典・イベントのとき）" htmlFor="gb-post-title" input>
              <TextField id="gb-post-title" value={form.title} onChange={(e) => set({ title: e.target.value })} disabled={!editable} maxLength={100} />
            </Field>
            <div className={styles.fieldPair}>
              <Field label="期間 はじめ" htmlFor="gb-post-start" input grow>
                <TextField id="gb-post-start" type="datetime-local" value={form.start} onChange={(e) => set({ start: e.target.value })} disabled={!editable} />
              </Field>
              <Field label="期間 おわり" htmlFor="gb-post-end" input grow>
                <TextField id="gb-post-end" type="datetime-local" value={form.end} onChange={(e) => set({ end: e.target.value })} disabled={!editable} />
              </Field>
            </div>
          </div>
        ) : null}
        <Field label="本文" htmlFor="gb-post-summary">
          <textarea id="gb-post-summary" className={styles.summaryInput} value={form.summary} onChange={(e) => set({ summary: e.target.value })} disabled={!editable} maxLength={1500} aria-describedby="gb-post-summary-count" />
          <span id="gb-post-summary-count" className="sr-only">{`${form.summary.length} / 1,500 文字`}</span>
        </Field>
        <div className={styles.imageRow}>
          <Button onClick={() => (picker.open ? setPicker({ ...picker, open: false }) : void openPicker())} disabled={!editable || picker.loading || upload.busy} aria-expanded={picker.open}>
            <ImageIcon aria-hidden className={styles.icon15} />{upload.busy ? `アップロード中… ${upload.progress}%` : '画像を選ぶ'}
          </Button>
          <span className={styles.imageName}>{form.mediaFilename ? `${form.mediaFilename}・4:3` : '画像なし'}</span>
          {form.mediaId && editable ? <button type="button" className={styles.textButton} onClick={() => set({ mediaId: null, mediaFilename: null, mediaSourceUrl: null })}>画像を外す</button> : null}
        </div>
        {upload.error ? <Notice tone="danger">{upload.error}</Notice> : null}
        {picker.open ? (
          <div className={styles.picker} role="group" aria-label="画像を選ぶ">
            <div className={styles.pickerHead}>
              <span className={styles.fieldLabel}>登録メディアの画像</span>
              <span className={styles.spacer} aria-hidden="true" />
              {mediaUpload ? (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={mediaUpload.accept}
                    className="sr-only"
                    tabIndex={-1}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (file) void uploadFromDevice(file)
                    }}
                  />
                  <Button onClick={() => fileInputRef.current?.click()} disabled={upload.busy}>端末からアップロード</Button>
                </>
              ) : null}
              <Button onClick={() => setPicker({ ...picker, open: false })}>閉じる</Button>
            </div>
            {picker.loading ? <ListState kind="loading" title="登録メディアを読み込んでいます" /> : null}
            {picker.error ? <Notice tone="danger">{picker.error}</Notice> : null}
            {!picker.loading && !picker.error && picker.items.length === 0 ? <p className={styles.muted}>このLINEアカウントの登録メディアに画像がありません。先に「登録メディア」で画像を追加してください。</p> : null}
            <div className={styles.pickerGrid}>
              {picker.items.map((m) => (
                <button key={m.id} type="button" className={styles.pickerItem} title={m.filename} aria-label={`${m.filename} を選ぶ`} onClick={() => { set({ mediaId: m.id, mediaFilename: m.filename, mediaSourceUrl: m.url }); setPicker({ ...picker, open: false }) }}>
                  <img src={m.url} alt="" className={styles.pickerImage} />
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <p className={styles.grayNote}>画像は4:3推奨・1枚まで。</p>
        {form.kind === 'offer' ? (
          <div className={styles.fieldGroup}>
            <div className={styles.fieldPair}>
              <Field label="クーポンコード（任意）" htmlFor="gb-post-coupon" input grow>
                <TextField id="gb-post-coupon" value={form.couponCode} onChange={(e) => set({ couponCode: e.target.value })} disabled={!editable} maxLength={40} />
              </Field>
              <Field label="特典の利用リンク（任意）" htmlFor="gb-post-redeem" input grow>
                <TextField id="gb-post-redeem" type="url" placeholder="https://" value={form.redeemOnlineUrl} onChange={(e) => set({ redeemOnlineUrl: e.target.value })} disabled={!editable} maxLength={200} />
              </Field>
            </div>
            <Field label="利用条件（任意）" htmlFor="gb-post-terms" input>
              <TextField id="gb-post-terms" value={form.termsConditions} onChange={(e) => set({ termsConditions: e.target.value })} disabled={!editable} maxLength={300} />
            </Field>
          </div>
        ) : null}
        <div className={styles.fieldPair}>
          <Field label="ボタン（任意）" grow>
            <Select
              aria-label="ボタンの種類"
              size="full"
              value={form.kind === 'offer' ? '' : form.ctaType}
              onChange={(v) => set({ ctaType: v as GooglePostCtaType | '' })}
              options={[{ value: '', label: form.kind === 'offer' ? 'なし（特典は Google の決まりで付けられません）' : 'なし' }, ...(Object.keys(CTA_LABELS) as GooglePostCtaType[]).map((k) => ({ value: k, label: CTA_LABELS[k] }))]}
              disabled={!editable || form.kind === 'offer'}
            />
          </Field>
          <Field label="リンク先" htmlFor="gb-post-cta-url" input grow>
            <TextField id="gb-post-cta-url" type="url" placeholder="https://" value={form.ctaUrl} onChange={(e) => set({ ctaUrl: e.target.value })} disabled={!editable || form.kind === 'offer' || !form.ctaType || form.ctaType === 'call'} maxLength={500} />
          </Field>
        </div>
        <Field label="公開方法">
          <Select
            aria-label="公開方法"
            size="full"
            value="now"
            onChange={() => {}}
            options={[{ value: 'now', label: '今すぐ' }, { value: 'scheduled', label: '日時を指定（Google側の対応を確かめてから使えます）', disabled: true }]}
            disabled={!editable}
          />
        </Field>
        {actionError ? <Notice tone="danger">{actionError}</Notice> : null}
        {editable ? (
          <>
            <div className={styles.infoBand}>
              <p className={styles.infoBandText}>「公開内容を確認」で、Google に出る形を確かめてから公開します。途中は「下書きを保存する」。</p>
              <Button onClick={() => void saveDraft()} disabled={busy !== null} busy={busy === 'save'}>下書きを保存する</Button>
            </div>
            <div className={styles.formActions}>
              <Button onClick={() => go({ tab: 'posts' })} disabled={busy !== null}>キャンセル</Button>
              <Button variant="primary" onClick={() => void openConfirm()} disabled={busy !== null} busy={busy === 'confirm'} busyLabel="確認中…"><Send aria-hidden className={styles.icon15} />公開内容を確認</Button>
            </div>
          </>
        ) : (
          <div className={styles.formActions}><Button onClick={() => go({ tab: 'posts' })}>投稿一覧へ戻る</Button></div>
        )}
      </section>
      <UnsavedLeaveDialog open={leaveTarget !== null} onConfirm={confirmLeave} onCancel={cancelLeave} />
    </>
  )
}

/** 公開前の最終確認（今の画面 jqSak と同じ動き。V8 の絵はまだ無い）。 */
export function PostConfirm({ accountId, id, go }: { accountId: string; id: string; go: GoogleNav }) {
  const [post, setPost] = useState<GooglePost | null>(null)
  const [storeName, setStoreName] = useState('')
  const [writeEnabled, setWriteEnabled] = useState(true)
  const [canPublish, setCanPublish] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [sent, setSent] = useState<{ alreadyPublished: boolean } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const response = await restaurantGoogleApi.post(accountId, id)
      setPost(response.post)
      setStoreName(response.store.name)
      setWriteEnabled(response.writeEnabled)
      setCanPublish(response.canPublish)
    } catch (err) {
      setLoadError(errorMessage(err, '投稿を読み込めませんでした。'))
    } finally {
      setLoading(false)
    }
  }, [accountId, id])

  useEffect(() => { void load() }, [load])

  const publish = async () => {
    setBusy(true)
    setActionError('')
    try {
      const response = await restaurantGoogleApi.publishPost(accountId, id)
      setPost(response.post)
      setSent({ alreadyPublished: response.alreadyPublished })
    } catch (err) {
      if (err instanceof ApiError && err.status === 502) {
        setActionError('Googleへの送信結果を確認できませんでした。重複を防ぐため、次に「この内容で予約する」を押したときはGoogle側の状態を照合してから送ります。')
        await load()
      } else {
        setActionError(errorMessage(err, 'Googleへの投稿に失敗しました。'))
      }
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className={styles.stateBox}><ListState kind="loading" title="投稿を読み込んでいます" /></div>
  if (loadError || !post) return <ListState kind="error" title="投稿を表示できませんでした" description={loadError} onRetry={() => void load()} action={<Button onClick={() => go({ tab: 'posts' })}>投稿一覧へ戻る</Button>} />

  const done = post.status === 'published' || post.status === 'accepted' || post.status === 'rejected'
  const canPress = canPublish && writeEnabled && checked && !busy && !done && post.status !== 'cancelled'

  return (
    <section className={styles.card} data-design-node="jqSak">
      <h2 className={styles.cardTitle}>{done ? 'この投稿をGoogleに送信しました' : 'この投稿を予約しますか？'}</h2>
      <p className={styles.muted}>Googleに公開される内容と日時を確認してください。</p>
      {sent ? <Notice tone="success">{sent.alreadyPublished ? 'この内容はすでにGoogleに届いていました。送信はしていません。' : post.status === 'published' ? 'Googleに投稿を送信し、公開を確認しました。' : 'Googleに投稿を送信しました。反映を確認できるまで「審査中」と表示します。'}</Notice> : null}
      {post.status === 'rejected' ? <Notice tone="danger">Googleの審査で公開されませんでした。内容を見直して作り直してください。</Notice> : null}
      {post.status === 'pending_confirm' && !sent ? <Notice tone="warn">前回の送信結果を確認できていません。「この内容で予約する」を押すと、先にGoogle側の状態を照合してから送信します。</Notice> : null}
      {!writeEnabled ? <Notice tone="warn">この環境ではGoogleへの投稿が許可されていません。内容の確認まではできます。</Notice> : null}
      {writeEnabled && !canPublish ? <Notice tone="warn">Googleへの投稿は店舗管理者以上が行います。この下書きは保存されているので、管理者が確認して投稿できます。</Notice> : null}
      {actionError ? <Notice tone="danger">{actionError}</Notice> : null}
      <dl className={styles.facts}>
        <div className={styles.factRow}><dt className={styles.factKey}>投稿先</dt><dd className={styles.factValue}>{storeName}</dd></div>
        <div className={styles.factRow}><dt className={styles.factKey}>種類</dt><dd className={styles.factValue}>{KIND_LABELS[post.kind]}</dd></div>
        <div className={styles.factRow}><dt className={styles.factKey}>公開予定</dt><dd className={styles.factValue}>今すぐ（日本時間）</dd></div>
        {post.cta ? <div className={styles.factRow}><dt className={styles.factKey}>ボタン</dt><dd className={styles.factValue}>{`${CTA_LABELS[post.cta.type]}${post.cta.url ? ` → ${post.cta.url}` : ''}`}</dd></div> : null}
        {post.media[0] ? <div className={styles.factRow}><dt className={styles.factKey}>画像</dt><dd className={styles.factValue}>{post.media[0].filename}</dd></div> : null}
      </dl>
      {post.title ? <p className={styles.cardTitle}>{post.title}</p> : null}
      <p className={styles.preText}>{post.summary}</p>
      {!done && post.status !== 'cancelled' ? (
        <>
          <Checkbox checked={checked} onCheckedChange={setChecked}>公開先・本文・画像・リンク・日時を確認しました</Checkbox>
          <p className={styles.grayNote}>予約後も編集・取消できます。送信後はGoogleの状態を取得し、予約済み・公開済み・不承認を区別します。通信結果が不明な場合は、重複投稿を避けるため先にGoogle側の状態を確認します。</p>
          <div className={styles.formActions}>
            <Button onClick={() => go({ tab: 'posts', view: 'edit', id })} disabled={busy}>修正する</Button>
            <Button variant="primary" onClick={() => void publish()} disabled={!canPress} busy={busy} busyLabel="送信中…">この内容で予約する</Button>
          </div>
        </>
      ) : (
        <div className={styles.formActions}><Button variant="primary" onClick={() => go({ tab: 'posts' })}>投稿一覧へ戻る</Button></div>
      )}
    </section>
  )
}
