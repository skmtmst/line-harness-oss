'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import Checkbox from '@/components/shared/checkbox'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import Pagination from '@/components/shared/pagination'
import Select from '@/components/shared/select'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import StickyBar from '@/components/shared/sticky-bar'
import { Tabs } from '@/components/shared/tabs'
import { TextArea, TextField } from '@/components/shared/text-field'
import { api, ApiError } from '@/lib/api'
import type { MediaItem } from '@line-crm/shared'
import { extractMediaMetadata, mediaAcceptForKind, putMediaFile, validateMediaFile } from '@/app/contents/media-direct-upload'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import {
  restaurantGoogleApi,
  type GooglePost,
  type GooglePostCtaType,
  type GooglePostDraftInput,
  type GooglePostFilter,
  type GooglePostKind,
} from '@/lib/restaurant-google-api'
import { errorMessage, formatDateTime } from './google-format'
import type { ProfileNav } from './google-profile'

/**
 * ★V6 Googleビジネス 第3段：投稿（最新情報・イベント・特典）。
 *
 * Pencil `Googleビジネス正本.pen`
 *  - GB-4  MAozg 投稿一覧
 *  - GB-5  fxNNJ 投稿作成・最新情報編集      - GB-6 sZEnK 投稿作成・イベント
 *  - GB-7  Z2XI3 投稿作成・特典              - GB-8 x3GFSa 登録メディアを選ぶ（この画面ではインラインパネル）
 *  - GB-14 jqSak 公開前の最終確認
 *
 * 第3段の範囲：「今すぐ公開」のみ。日時指定の予約投稿・繰り返し開催・投稿の編集（削除して作り直す）・
 * 動画は画面に見えるが押せない（Google側の実際の挙動が未検証のため次の段へ）。
 * 画面の遷移は URL（?tab=posts&view=new|edit|confirm&kind=&id=）で持つ。
 */

export const POSTS_DESIGN_NODES: Record<string, string> = {
  list: 'MAozg',
  'edit:standard': 'fxNNJ',
  'edit:event': 'sZEnK',
  'edit:offer': 'Z2XI3',
  confirm: 'jqSak',
}

const KIND_LABELS: Record<GooglePostKind, string> = { standard: '最新情報', event: 'イベント', offer: '特典', alert: 'お知らせ' }
const FILTER_LABELS: Record<GooglePostFilter, string> = { all: 'すべて', scheduled: '予約', draft: '下書き', published: '公開済み', attention: '要確認' }
const CTA_LABELS: Record<GooglePostCtaType, string> = { book: '予約する', order: '注文する', shop: '購入する', learn_more: '詳しく見る', sign_up: '申し込む', call: '電話する' }

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

// ---------- GB-4：投稿一覧 ----------

export function PostsTab({ accountId, go }: { accountId: string; go: ProfileNav }) {
  const [filter, setFilter] = useState<GooglePostFilter>('all')
  const [kind, setKind] = useState<'all' | GooglePostKind>('all')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<Awaited<ReturnType<typeof restaurantGoogleApi.posts>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<GooglePost | null>(null)
  const [actionError, setActionError] = useState('')

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

  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.perPage)) : 1

  return (
    <div data-design-node={POSTS_DESIGN_NODES.list}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">投稿</h2>
        <span className="text-ink-secondary text-sm">Googleに届ける最新情報・特典・イベント</span>
        <span className="grow" />
        <Button onClick={() => void sync()} disabled={syncing} busy={syncing} busyLabel="確認中…">Googleの状態を確認</Button>
        <Button variant="primary" onClick={() => go({ tab: 'posts', view: 'new', kind: 'standard' })}>投稿を作る</Button>
      </div>

      {syncError ? <NoteBar tone="warn" className="mb-3">{syncError}</NoteBar> : null}
      {actionError ? <NoteBar tone="danger" className="mb-3">{actionError}</NoteBar> : null}

      <Tabs
        className="mb-3"
        label="投稿の状態"
        items={(Object.keys(FILTER_LABELS) as GooglePostFilter[]).map((key) => ({
          label: FILTER_LABELS[key],
          current: filter === key,
          count: data?.counts[key],
          disabled: key === 'scheduled' && (data?.counts.scheduled ?? 0) === 0,
          onClick: () => { setFilter(key); setPage(1) },
        }))}
        actions={(
          <Select aria-label="種類で絞り込み" value={kind} onChange={(v) => { setKind(v as typeof kind); setPage(1) }} options={[{ value: 'all', label: '種類：すべて' }, ...(Object.keys(KIND_LABELS) as GooglePostKind[]).filter((k) => k !== 'alert').map((k) => ({ value: k, label: KIND_LABELS[k] }))]} />
        )}
      />

      {loading && !data ? <ListState kind="loading" title="投稿を読み込んでいます" /> : null}
      {loadError ? <ListState kind="error" title="投稿を表示できませんでした" description={loadError} onRetry={() => void load()} /> : null}
      {data && data.total === 0 && !loading ? (
        <ListState kind="empty" title={filter === 'all' ? 'まだ投稿がありません' : `${FILTER_LABELS[filter]}の投稿はありません`} description="「投稿を作成」から最新情報・イベント・特典を作れます。" emptyPreset="readonly" />
      ) : null}
      {data && data.posts.length > 0 ? (
        <>
          <div className="flex flex-col gap-3">
            {data.posts.map((post) => {
              const badge = statusBadge(post)
              const actionable = post.status === 'draft' || post.status === 'rejected' || post.status === 'failed'
              return (
                <Card key={post.id} padding="roomy">
                  <div className="flex flex-wrap items-center gap-4">
                    {post.media[0] ? (
                      <img src={post.media[0].sourceUrl} alt="" className="border-hairline h-16 w-16 shrink-0 rounded-control border object-cover" />
                    ) : (
                      <span className="border-hairline bg-canvas-sunken text-ink-faint flex h-16 w-16 shrink-0 items-center justify-center rounded-control border text-xs">画像なし</span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <StatusBadge tone="neutral">{KIND_LABELS[post.kind]}</StatusBadge>
                        <span className="truncate text-sm font-semibold">{post.title ?? post.summary}</span>
                      </div>
                      <p className="text-ink-secondary truncate text-xs">
                        {post.status === 'published' && post.publishedAt ? `${formatDateTime(post.publishedAt)} 公開` : post.status === 'draft' ? '未送信' : formatDateTime(post.updatedAt)}
                        {post.origin === 'google' ? '（Googleで作成）' : ''}
                      </p>
                    </div>
                    <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
                    <div className="flex shrink-0 gap-2">
                      {actionable ? <Button size="field" onClick={() => go({ tab: 'posts', view: 'edit', id: post.id })}>編集</Button> : null}
                      {post.status === 'published' && post.searchUrl ? <a href={post.searchUrl} target="_blank" rel="noreferrer" className="text-action inline-flex items-center gap-1 text-xs font-semibold">表示 <ExternalLink size={12} /></a> : null}
                      {post.status === 'draft' ? <Button size="field" onClick={() => void cancelDraft(post)} disabled={busyId === post.id}>取り消す</Button> : null}
                      {post.status === 'published' ? <Button size="field" onClick={() => setConfirmRemove(post)} disabled={busyId === post.id}>削除する</Button> : null}
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-ink-faint text-xs">{data.total}件・時刻はすべて日本時間（Asia/Tokyo）</span>
            <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
          </div>
        </>
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
    </div>
  )
}

// ---------- GB-5/6/7：投稿の作成・編集 ----------

interface PostForm {
  kind: GooglePostKind
  summary: string
  title: string
  startDate: string
  startTime: string
  endDate: string
  endTime: string
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
  return { kind, summary: '', title: '', startDate: '', startTime: '10:00', endDate: '', endTime: '18:00', ctaType: '', ctaUrl: '', couponCode: '', redeemOnlineUrl: '', termsConditions: '', mediaId: null, mediaFilename: null, mediaSourceUrl: null }
}

function formFromPost(post: GooglePost): PostForm {
  return {
    kind: post.kind === 'alert' ? 'standard' : post.kind,
    summary: post.summary,
    title: post.title ?? '',
    startDate: post.schedule?.startDate ?? '',
    startTime: post.schedule?.startTime ?? '10:00',
    endDate: post.schedule?.endDate ?? '',
    endTime: post.schedule?.endTime ?? '18:00',
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

function draftInputFrom(form: PostForm): GooglePostDraftInput {
  return {
    kind: form.kind,
    summary: form.summary.trim(),
    title: form.kind === 'standard' ? null : form.title.trim() || null,
    schedule: form.kind === 'standard' ? null : { startDate: form.startDate, startTime: form.startTime, endDate: form.endDate, endTime: form.endTime },
    cta: form.kind !== 'offer' && form.ctaType ? { type: form.ctaType, url: form.ctaType === 'call' ? null : form.ctaUrl.trim() || null } : null,
    offer: form.kind === 'offer' ? { couponCode: form.couponCode.trim() || null, redeemOnlineUrl: form.redeemOnlineUrl.trim() || null, termsConditions: form.termsConditions.trim() || null } : null,
    mediaId: form.mediaId,
  }
}

export function PostEditor({ accountId, kind: kindFromUrl, postId, go }: { accountId: string; kind: GooglePostKind; postId: string | null; go: ProfileNav }) {
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

  /** 端末（PC/スマホ）内のファイルをそのまま登録メディアへ登録し、投稿画像として選ぶ。 */
  const uploadFromDevice = async (file: File) => {
    const problem = validateMediaFile(file)
    if (problem) { setUpload({ busy: false, progress: 0, error: problem }); return }
    setUpload({ busy: true, progress: 0, error: '' })
    try {
      const metadata = await extractMediaMetadata(file)
      const prepared = await api.media.prepareUploads({ accountId, files: [{ filename: file.name, mimeType: file.type, sizeBytes: file.size, metadata }] })
      if (!prepared.success) throw new ApiError(500, prepared.error)
      const session = prepared.data.sessions[0]
      if (!session) throw new Error('送信の準備結果を確認できませんでした')
      const etag = await putMediaFile(session, file, (progress) => setUpload((current) => ({ ...current, progress })))
      const completion = await api.media.completeUpload(session.id, { accountId, etag })
      if (!completion.success) throw new ApiError(500, completion.error)
      const mediaId = completion.data.mediaId
      if (!mediaId) throw new Error('登録を完了できませんでした')
      const detail = await api.media.detail(mediaId, accountId)
      if (!detail.success) throw new ApiError(500, detail.error)
      setForm({ ...form, mediaId: detail.data.item.id, mediaFilename: detail.data.item.filename, mediaSourceUrl: detail.data.item.url })
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
      if (!form.startDate || !form.startTime || !form.endDate || !form.endTime) return '開始・終了の日時を入力してください。'
      if (`${form.endDate}T${form.endTime}` < `${form.startDate}T${form.startTime}`) return '終了日時は開始日時より後にしてください。'
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

  if (loading) return <ListState kind="loading" title="投稿を読み込んでいます" />
  if (loadError) return <ListState kind="error" title="投稿を表示できませんでした" description={loadError} action={<Button onClick={() => go({ tab: 'posts' })}>投稿一覧へ戻る</Button>} />

  const node = POSTS_DESIGN_NODES[`edit:${form.kind}`]

  return (
    <div data-design-node={node} className="text-ink flex min-w-0 flex-col gap-4">
      <div><Button onClick={() => go({ tab: 'posts' })}>投稿一覧へ戻る</Button></div>
      {!editable ? <NoteBar tone="warn">この投稿はもう編集できません（送信済み、または送信手続き中です）。</NoteBar> : null}

      {!postId ? (
        <div role="tablist" aria-label="投稿の種類" className="flex gap-2">
          {(Object.keys(KIND_LABELS) as GooglePostKind[]).filter((k) => k !== 'alert').map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={form.kind === k}
              onClick={() => go({ tab: 'posts', view: 'new', kind: k })}
              className={`h-9 rounded-control border px-3.5 text-sm font-semibold ${form.kind === k ? 'bg-accent-soft text-accent-deep' : 'bg-canvas text-ink'}`}
              style={{ borderColor: form.kind === k ? 'transparent' : 'var(--color-hairline)' }}
            >
              {KIND_LABELS[k]}
            </button>
          ))}
        </div>
      ) : (
        <StatusBadge tone="neutral">{KIND_LABELS[form.kind]}</StatusBadge>
      )}

      <div className="gb-post-edit-grid grid min-w-0 grid-cols-1 gap-6">
        <div className="flex min-w-0 flex-col gap-4">
          {form.kind !== 'standard' ? (
            <div className="flex flex-col gap-2">
              <label htmlFor="gb-post-title" className="text-label font-semibold">{form.kind === 'event' ? 'イベントタイトル' : '特典タイトル'}</label>
              <TextField id="gb-post-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} disabled={!editable} maxLength={100} />
            </div>
          ) : null}

          {form.kind !== 'standard' ? (
            <div className="flex flex-col gap-2">
              <span className="text-label font-semibold">開催・有効期間</span>
              <div className="flex flex-wrap gap-2">
                <TextField aria-label="開始日" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} disabled={!editable} />
                <TextField aria-label="開始時刻" type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} disabled={!editable} />
              </div>
              <div className="flex flex-wrap gap-2">
                <TextField aria-label="終了日" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} disabled={!editable} />
                <TextField aria-label="終了時刻" type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} disabled={!editable} />
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <label htmlFor="gb-post-summary" className="text-label font-semibold">本文</label>
            <TextArea id="gb-post-summary" rows={8} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} disabled={!editable} maxLength={1500} />
            <p className={`text-caption text-right ${form.summary.length > 1500 ? 'text-danger' : 'text-ink-faint'}`}>{form.summary.length} / 1,500</p>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-label font-semibold">画像</span>
              <span className="grow" />
              <input
                ref={fileInputRef}
                type="file"
                accept={mediaAcceptForKind('image')}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) void uploadFromDevice(file)
                }}
              />
              <Button size="field" onClick={() => fileInputRef.current?.click()} disabled={!editable || upload.busy}>{upload.busy ? `アップロード中… ${upload.progress}%` : '端末からアップロード'}</Button>
              <Button size="field" onClick={() => void openPicker()} disabled={!editable || picker.loading}>登録メディアから選ぶ</Button>
            </div>
            {upload.error ? <NoteBar tone="danger">{upload.error}</NoteBar> : null}
            {form.mediaSourceUrl ? (
              <figure className="border-hairline relative overflow-hidden rounded-control border" style={{ width: 120, height: 120 }}>
                <img src={form.mediaSourceUrl} alt={form.mediaFilename ?? ''} className="h-full w-full object-cover" />
                {editable ? <button type="button" onClick={() => setForm({ ...form, mediaId: null, mediaFilename: null, mediaSourceUrl: null })} className="bg-canvas text-danger absolute right-1.5 bottom-1.5 rounded-mini px-1.5 text-micro font-semibold" aria-label="画像を外す">外す</button> : null}
              </figure>
            ) : null}
            <p className="text-ink-faint text-caption">画像は4:3推奨・1枚まで。動画はAPI対応確認後に有効化します。</p>
            {picker.open ? (
              <div className="border-hairline bg-canvas flex flex-col gap-3 rounded-control border p-3" role="group" aria-label="登録メディアから画像を選ぶ">
                <div className="flex items-center gap-3"><span className="text-sm font-semibold">登録メディアの画像</span><span className="grow" /><Button size="field" onClick={() => setPicker({ ...picker, open: false })}>閉じる</Button></div>
                {picker.loading ? <ListState kind="loading" title="登録メディアを読み込んでいます" /> : null}
                {picker.error ? <NoteBar tone="danger">{picker.error}</NoteBar> : null}
                {!picker.loading && !picker.error && picker.items.length === 0 ? <p className="text-ink-secondary text-sm">このLINEアカウントの登録メディアに画像がありません。先に「登録メディア」で画像を追加してください。</p> : null}
                <div className="flex flex-wrap gap-2">
                  {picker.items.map((m) => (
                    <button key={m.id} type="button" onClick={() => { setForm({ ...form, mediaId: m.id, mediaFilename: m.filename, mediaSourceUrl: m.url }); setPicker({ ...picker, open: false }) }} className="hover:border-accent overflow-hidden rounded-control border" style={{ width: 100, height: 100, borderColor: 'var(--color-hairline)' }} title={m.filename} aria-label={`${m.filename} を選ぶ`}>
                      <img src={m.url} alt="" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {form.kind === 'offer' ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <label htmlFor="gb-post-coupon" className="text-label font-semibold">クーポンコード（任意）</label>
                <TextField id="gb-post-coupon" value={form.couponCode} onChange={(e) => setForm({ ...form, couponCode: e.target.value })} disabled={!editable} maxLength={40} />
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="gb-post-redeem" className="text-label font-semibold">特典の利用リンク（任意）</label>
                <TextField id="gb-post-redeem" type="url" placeholder="https://" value={form.redeemOnlineUrl} onChange={(e) => setForm({ ...form, redeemOnlineUrl: e.target.value })} disabled={!editable} maxLength={200} />
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="gb-post-terms" className="text-label font-semibold">利用条件（任意）</label>
                <TextArea id="gb-post-terms" rows={3} value={form.termsConditions} onChange={(e) => setForm({ ...form, termsConditions: e.target.value })} disabled={!editable} maxLength={300} />
              </div>
              <p className="text-ink-faint text-caption">特典のボタンはGoogle側の仕様に従います。通常のCTAは設定しません。</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <span className="text-label font-semibold">ボタン（任意）</span>
                <Select aria-label="ボタンの種類" value={form.ctaType} onChange={(v) => setForm({ ...form, ctaType: v as GooglePostCtaType | '' })} options={[{ value: '', label: 'なし' }, ...(Object.keys(CTA_LABELS) as GooglePostCtaType[]).map((k) => ({ value: k, label: CTA_LABELS[k] }))]} disabled={!editable} />
              </div>
              {form.ctaType && form.ctaType !== 'call' ? (
                <div className="flex flex-col gap-2">
                  <label htmlFor="gb-post-cta-url" className="text-label font-semibold">リンク先</label>
                  <TextField id="gb-post-cta-url" type="url" placeholder="https://" value={form.ctaUrl} onChange={(e) => setForm({ ...form, ctaUrl: e.target.value })} disabled={!editable} maxLength={500} />
                </div>
              ) : null}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-label font-semibold">公開方法</span>
            <div className="flex gap-2">
              <span className="bg-accent-soft text-accent-deep rounded-control px-3 py-1.5 text-sm font-semibold">今すぐ</span>
              <span className="border-hairline text-ink-faint cursor-not-allowed rounded-control border px-3 py-1.5 text-sm" aria-disabled="true" title="日時を指定した投稿は次の段で対応します">日時を指定</span>
            </div>
            <p className="text-ink-faint text-caption">日時を指定した投稿は、Google側の対応状況を確認してから次の段で対応します。</p>
          </div>

          {actionError ? <NoteBar tone="danger">{actionError}</NoteBar> : null}
        </div>

        <aside className="flex min-w-0 flex-col gap-3" aria-label="表示イメージ">
          <Card padding="roomy">
            <p className="text-ink-faint mb-3 text-xs font-semibold">表示イメージ</p>
            {form.mediaSourceUrl ? <img src={form.mediaSourceUrl} alt="" className="mb-3 h-32 w-full rounded-control object-cover" /> : null}
            {form.title ? <p className="mb-1 text-sm font-bold">{form.title}</p> : null}
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{form.summary || '本文を入力すると、ここに表示イメージが出ます。'}</p>
            {form.kind !== 'offer' && form.ctaType ? <span className="border-hairline mt-3 inline-block rounded-control border px-3 py-1.5 text-sm font-semibold">{CTA_LABELS[form.ctaType]}</span> : null}
            {form.kind === 'offer' && form.couponCode ? <p className="text-ink-secondary mt-2 text-xs">コード：{form.couponCode}</p> : null}
            <p className="text-ink-faint mt-3 text-caption">実際の表示はGoogle側で変わることがあります。</p>
          </Card>
        </aside>
      </div>

      {editable ? (
        <StickyBar actions={<><Button onClick={() => void saveDraft()} disabled={busy !== null} busy={busy === 'save'}>下書きを保存する</Button><Button variant="primary" onClick={() => void openConfirm()} disabled={busy !== null} busy={busy === 'confirm'} busyLabel="確認中…">公開内容を確認</Button></>} />
      ) : null}
      <UnsavedLeaveDialog open={leaveTarget !== null} onConfirm={confirmLeave} onCancel={cancelLeave} />
    </div>
  )
}

// ---------- GB-14：公開前の最終確認 ----------

export function PostConfirmScreen({ accountId, id, go }: { accountId: string; id: string; go: ProfileNav }) {
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

  if (loading) return <ListState kind="loading" title="投稿を読み込んでいます" />
  if (loadError || !post) return <ListState kind="error" title="投稿を表示できませんでした" description={loadError} onRetry={() => void load()} action={<Button onClick={() => go({ tab: 'posts' })}>投稿一覧へ戻る</Button>} />

  const done = post.status === 'published' || post.status === 'accepted' || post.status === 'rejected'
  const canPress = canPublish && writeEnabled && checked && !busy && !done && post.status !== 'cancelled'

  return (
    <div data-design-node={POSTS_DESIGN_NODES.confirm} className="text-ink flex min-w-0 flex-col gap-4">
      <div><Button onClick={() => go({ tab: 'posts', view: 'edit', id })} disabled={busy || done}>編集に戻る</Button></div>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-heading font-bold">{done ? 'この投稿をGoogleに送信しました' : 'この投稿を予約しますか？'}</h2>
      </div>
      <p className="text-ink-secondary text-sm">Googleに公開される内容と日時を確認してください。</p>

      {sent ? <NoteBar>{sent.alreadyPublished ? 'この内容はすでにGoogleに届いていました。送信はしていません。' : post.status === 'published' ? 'Googleに投稿を送信し、公開を確認しました。' : 'Googleに投稿を送信しました。反映を確認できるまで「審査中」と表示します。'}</NoteBar> : null}
      {post.status === 'rejected' ? <NoteBar tone="danger">Googleの審査で公開されませんでした。内容を見直して作り直してください。</NoteBar> : null}
      {post.status === 'pending_confirm' && !sent ? <NoteBar tone="warn">前回の送信結果を確認できていません。「この内容で予約する」を押すと、先にGoogle側の状態を照合してから送信します。</NoteBar> : null}
      {!writeEnabled ? <NoteBar tone="warn">この環境ではGoogleへの投稿が許可されていません。内容の確認まではできます。</NoteBar> : null}
      {writeEnabled && !canPublish ? <NoteBar tone="warn">Googleへの投稿は店舗管理者以上が行います。この下書きは保存されているので、管理者が確認して投稿できます。</NoteBar> : null}
      {actionError ? <NoteBar tone="danger">{actionError}</NoteBar> : null}

      <section className="border-hairline bg-canvas flex flex-col gap-4 rounded-card border p-5">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <dt className="text-ink-secondary">投稿先</dt><dd className="font-semibold">{storeName}</dd>
          <dt className="text-ink-secondary">種類</dt><dd className="font-semibold">{KIND_LABELS[post.kind]}</dd>
          <dt className="text-ink-secondary">公開予定</dt><dd className="font-semibold">今すぐ（日本時間）</dd>
        </dl>
        <div className="border-hairline rounded-card border p-4">
          <p className="text-ink-secondary mb-2 text-xs font-semibold">本文</p>
          {post.title ? <p className="mb-1 text-sm font-bold">{post.title}</p> : null}
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{post.summary}</p>
        </div>
        {post.cta ? <p className="text-sm">ボタン：{CTA_LABELS[post.cta.type]}{post.cta.url ? ` → ${post.cta.url}` : ''}</p> : null}
        {post.media[0] ? <p className="text-sm">画像：{post.media[0].filename}</p> : null}
      </section>

      {!done && post.status !== 'cancelled' ? (
        <section className="border-hairline bg-canvas flex flex-col gap-3 rounded-card border p-5">
          <Checkbox checked={checked} onCheckedChange={setChecked} description={null}>
            <span className="text-sm font-semibold">公開先・本文・画像・リンク・日時を確認しました</span>
          </Checkbox>
          <p className="text-ink-secondary text-label">予約後も編集・取消できます。送信後はGoogleの状態を取得し、予約済み・公開済み・不承認を区別します。</p>
          <p className="text-ink-faint text-caption">通信結果が不明な場合は、重複投稿を避けるため先にGoogle側の状態を確認します。</p>
        </section>
      ) : null}

      {done || post.status === 'cancelled' ? (
        <StickyBar actions={<Button variant="primary" onClick={() => go({ tab: 'posts' })}>投稿一覧へ戻る</Button>} />
      ) : (
        <StickyBar actions={<><Button onClick={() => go({ tab: 'posts', view: 'edit', id })} disabled={busy}>修正する</Button><Button variant="primary" onClick={() => void publish()} disabled={!canPress} busy={busy} busyLabel="送信中…">この内容で予約する</Button></>} />
      )}
    </div>
  )
}
