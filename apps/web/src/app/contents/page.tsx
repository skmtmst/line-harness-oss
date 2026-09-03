'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  MediaDeleteImpact,
  MediaDeleteImpactReference,
  MediaItem,
  MediaUsage,
} from '@line-crm/shared'
import { LayoutGrid, List as ListIcon } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import {
  blockedReason,
  canDelete as canDeleteMedia,
  checkedAtText,
  dialogTitle,
  referenceKindText,
  referenceNameText,
  usageText,
} from './media-delete-impact'
import { mediaUsageKindText } from './media-usage-display'
import Pagination from '@/components/shared/pagination'
import FilterChip from '@/components/shared/filter-chip'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import { useAccount } from '@/contexts/account-context'

/**
 * 登録メディア一覧。
 *
 * Lステップの「コンテンツ ＞ 登録メディア一覧」と同じ形にしてある。
 * 上にドロップ枠と受け付ける形式の表、その下に種別の絞り込みと検索、
 * 本体は札（カード）を並べた格子、最後にページ送りとまとめて削除。
 *
 * 以前はこの画面が「コンテンツ」1枚で、メディアと共通情報をタブで
 * 切り替えていた。サイドバーから共通情報へ直接行けなかったので、
 * 画面を2つに分けて、共通情報は /contents/vars へ移した。
 */

type MediaSort = 'newest' | 'oldest' | 'name' | 'size' | 'usage'

const SORT_OPTIONS: Array<{ value: MediaSort; label: string }> = [
  { value: 'newest', label: '入れた日が新しい順' },
  { value: 'oldest', label: '入れた日が古い順' },
  { value: 'name', label: 'ファイル名順' },
  { value: 'size', label: '容量が大きい順' },
  { value: 'usage', label: '使われている順' },
]

const PAGE_SIZE_OPTIONS = [
  { value: '10', label: '10件表示' },
  { value: '20', label: '20件表示' },
  { value: '50', label: '50件表示' },
]

/**
 * 絞り込みの種別。保存できる kind は image / video / audio / file の4つ。
 * file はいま PDF だけなので、そのまま「PDF」と呼ぶ。
 */
const KINDS: Array<{ key: MediaItem['kind']; label: string }> = [
  { key: 'image', label: '画像' },
  { key: 'audio', label: '音声' },
  { key: 'video', label: '動画' },
  { key: 'file', label: 'PDF' },
]

/**
 * 受け付ける形式と上限。
 *
 * 数字は実装の実際の制限（worker の ALLOWED）に合わせる。設計は動画200MB・
 * PDF10MBだが、いまの実装は90MB・20MB。設計の数字を書くと、通らない
 * ファイルを「通る」と言うことになる。
 */
const LIMITS: Array<{ label: string; note: string }> = [
  { label: '画像', note: '10MBまで、jpg・png・gif・webp画像のみ可' },
  { label: '音声', note: '30MBまで、mp3・m4a音声のみ可' },
  { label: '動画', note: '90MBまで、mp4動画のみ可' },
  // 設計 `eXAJP` は PDF に「LINEでは直接送れないので、リンクとして使います」と
  // 添えている。これが無いと、PDFを入れたのに配信で選べない理由が分からない。
  { label: 'PDF', note: '20MBまで。LINEでは直接送れないので、リンクとして使います' },
]

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatMediaDetails(item: MediaItem): string {
  const format = item.mimeType.split('/').at(-1)?.replace('jpeg', 'jpg').toUpperCase() ?? ''
  const details = [format]
  if (item.width != null && item.height != null) {
    details.push(`${item.width}×${item.height}`)
  } else if (item.durationMs != null) {
    details.push(`${Math.round(item.durationMs / 1000)}秒`)
  }
  details.push(formatSize(item.sizeBytes))
  return details.filter(Boolean).join(' ／ ')
}

/** 使用先を取得でき、かつ0件と確定したメディアだけを削除候補にする。 */
function isKnownUnused(item: MediaItem): boolean {
  return item.usageCount === 0
}

/** 格子と一覧。**中身は同じ。並べ方だけを切り替える。** */
type MediaView = 'grid' | 'list'

export default function MediaLibraryPage() {
  const [view, setView] = useState<MediaView>('grid')
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const latestAccountRef = useRef(selectedAccountId)
  latestAccountRef.current = selectedAccountId
  const [items, setItems] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const [kinds, setKinds] = useState<Set<MediaItem['kind']>>(
    () => new Set(KINDS.map((k) => k.key)),
  )
  const [query, setQuery] = useState('')
  const [showUnusedOnly, setShowUnusedOnly] = useState(false)
  const [sort, setSort] = useState<MediaSort>('newest')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  /** 名前を直している札。null なら誰も直していない。 */
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null)
  const [usagesFor, setUsagesFor] = useState<{ id: string; items: MediaUsage[] } | null>(null)
  /*
    1件ずつの削除確認（設計 `YfTfJ`）。**窓を開けてから読む。**
    一覧を出すたびに全件ぶん読むと、消さない人にも7種類の走査が走る。
  */
  const [deleting, setDeleting] = useState<MediaItem | null>(null)
  const [impact, setImpact] = useState<MediaDeleteImpact | null>(null)
  const [impactPhase, setImpactPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  /*
    いま影響を読んでいる対象。遅れて返った別の結果を捨てるために持つ。

    **メディアIDだけでは足りない。** 同じメディアを開き直したときや、
    アカウントを変えたあとに前の要求の返事が届いたときを止められない。
    アカウント・メディア・読み込み回数の3つで照合する。
  */
  const impactRequestRef = useRef<{ accountId: string | null; mediaId: string | null; generation: number }>({
    accountId: null,
    mediaId: null,
    generation: 0,
  })
  /** 削除要求そのものも、アカウント切替や窓の閉鎖後に結果を映さない。 */
  const deleteRequestRef = useRef(0)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  /** まとめて削除の確認。ブラウザ標準の確認では戻せないことが伝わらない。 */
  const [bulkConfirm, setBulkConfirm] = useState<string[] | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  /** 大きく出している札。押した札の中身を原寸で見せる。 */
  const [preview, setPreview] = useState<MediaItem | null>(null)

  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    /*
      アカウントを切り替えた瞬間に、前の窓と読み込み・削除要求を無効にする。
      ref の accountId は要求開始時の値なので、世代も進めなければ前の返事が
      そのまま「現在」と判定される。
    */
    impactRequestRef.current = {
      accountId: selectedAccountId,
      mediaId: null,
      generation: impactRequestRef.current.generation + 1,
    }
    deleteRequestRef.current += 1
    setDeleting(null)
    setImpact(null)
    setImpactPhase('idle')
    setDeleteBusy(false)
    setDeleteError('')
    setBulkConfirm(null)
    setBulkBusy(false)
  }, [selectedAccountId])

  const load = useCallback(async () => {
    const accountAtRequest = selectedAccountId
    if (!accountAtRequest) {
      setItems([])
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadFailed(false)
    setError('')
    try {
      const res = await api.media.list(accountAtRequest)
      if (accountAtRequest !== latestAccountRef.current) return
      if (res.success) setItems(res.data)
    } catch {
      if (accountAtRequest === latestAccountRef.current) setLoadFailed(true)
    } finally {
      if (accountAtRequest === latestAccountRef.current) setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    if (accountLoading) return
    setSelected(new Set())
    setUsagesFor(null)
    setPreview(null)
    setPage(1)
    void load()
  }, [accountLoading, load])

  const upload = async (files: File[]) => {
    if (files.length === 0 || !selectedAccountId) return
    const accountAtRequest = selectedAccountId
    setUploading(true)
    setError('')
    try {
      for (const file of files) {
        // FileReader の結果は data: URL。サーバー側がその形も受け付ける。
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => reject(new Error('読み取りに失敗しました'))
          reader.readAsDataURL(file)
        })
        const res = await api.media.upload({
          accountId: accountAtRequest,
          filename: file.name,
          mimeType: file.type,
          data: dataUrl,
        })
        if (accountAtRequest !== latestAccountRef.current) return
        if (!res.success) {
          // 1枚でも弾かれたら、そこで止めて理由を出す。残りを黙って
          // 上げ続けると、どれが通ってどれが落ちたか分からなくなる。
          setError(`${file.name}: ${res.error}`)
          break
        }
      }
      void load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'アップロードに失敗しました')
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const rename = async () => {
    if (!renaming || !selectedAccountId) return
    const accountAtRequest = selectedAccountId
    const filename = renaming.value.trim()
    if (!filename) return
    setError('')
    try {
      const res = await api.media.update(renaming.id, accountAtRequest, { filename })
      if (accountAtRequest !== latestAccountRef.current) return
      if (!res.success) {
        setError(res.error)
        return
      }
      setRenaming(null)
      void load()
    } catch {
      setError('名前の変更に失敗しました')
    }
  }

  const showUsages = async (item: MediaItem) => {
    if (!selectedAccountId) return
    const accountAtRequest = selectedAccountId
    setError('')
    if (usagesFor?.id === item.id) {
      setUsagesFor(null)
      return
    }
    try {
      const res = await api.media.usages(item.id, accountAtRequest)
      if (accountAtRequest !== latestAccountRef.current) return
      if (res.success) setUsagesFor({ id: item.id, items: res.data })
    } catch {
      setError('使用箇所の読み込みに失敗しました')
    }
  }

  /** 選んだ札をまとめて消す。使用中はAPIでも必ず止める。 */
  const removeSelected = async () => {
    if (selected.size === 0 || !selectedAccountId) return
    const removableSelected = [...selected].filter((id) =>
      items.some((item) => item.id === id && isKnownUnused(item)),
    )
    if (removableSelected.length !== selected.size) {
      setSelected(new Set(removableSelected))
      setError('使用先を確認できないメディアは削除できません。状態を読み直して確認してください。')
      return
    }
    const accountAtRequest = selectedAccountId
    /*
      **ブラウザ標準の確認を使わない。** 何件消えるかは出るが、
      戻せないことも、どこにも使われていないと確かめた結果も出ない。
      画面の中の窓で読み合わせてから押させる。
    */
    setBulkConfirm(removableSelected)
  }

  async function runBulkDelete(ids: string[]) {
    const accountAtRequest = selectedAccountId
    if (!accountAtRequest) return
    setBulkBusy(true)
    setError('')
    for (const id of ids) {
      try {
        await api.media.delete(id, accountAtRequest)
        if (accountAtRequest !== latestAccountRef.current) return
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          const name = items.find((m) => m.id === id)?.filename ?? id
          setError(`${name}: ${e.message}`)
          continue
        }
        setError('削除に失敗しました')
      }
    }
    setSelected(new Set())
    setBulkConfirm(null)
    setBulkBusy(false)
    void load()
  }

  async function openDelete(item: MediaItem) {
    deleteRequestRef.current += 1
    setDeleting(item)
    setDeleteError('')
    setImpact(null)
    setImpactPhase('loading')
    if (!selectedAccountId) {
      setImpactPhase('error')
      return
    }
    /*
      **遅れて返った別のメディアの結果を映さない。** Aを読み込み中に窓を
      閉じてBを開くと、あとから返るAの結果がBの窓に出る。読んでいるものと
      押せるものが食い違う。
    */
    const generation = impactRequestRef.current.generation + 1
    const at = { accountId: selectedAccountId, mediaId: item.id, generation }
    impactRequestRef.current = at
    const isCurrent = () =>
      impactRequestRef.current.accountId === at.accountId
      && impactRequestRef.current.mediaId === at.mediaId
      && impactRequestRef.current.generation === at.generation
    try {
      const res = await api.media.deleteImpact(item.id, at.accountId)
      if (!isCurrent()) return
      if (!res.success) throw new Error('impact_failed')
      setImpact(res.data)
      setImpactPhase('ready')
    } catch {
      if (!isCurrent()) return
      /*
        使用先が読めないときは**消させない**。7種類のどれかに残ったまま
        消すと、その画面が壊れた画像を指す。
      */
      setImpactPhase('error')
    }
  }

  async function confirmDeleteOne() {
    if (!deleting || !selectedAccountId || deleteBusy) return
    const accountAtRequest = selectedAccountId
    const mediaIdAtRequest = deleting.id
    const deleteGeneration = deleteRequestRef.current + 1
    deleteRequestRef.current = deleteGeneration
    const isCurrentDelete = () =>
      deleteRequestRef.current === deleteGeneration
      && latestAccountRef.current === accountAtRequest
      && impactRequestRef.current.accountId === accountAtRequest
      && impactRequestRef.current.mediaId === mediaIdAtRequest
    setDeleteBusy(true)
    setDeleteError('')
    try {
      const res = await api.media.delete(mediaIdAtRequest, accountAtRequest)
      if (!isCurrentDelete()) return
      if (!res.success) throw new Error('delete_failed')
      setDeleting(null)
      setImpact(null)
      setImpactPhase('idle')
      setDeleteBusy(false)
      deleteRequestRef.current += 1
      void load()
    } catch (e) {
      if (!isCurrentDelete()) return
      if (e instanceof ApiError && e.status === 409) {
        /*
          **409 は「読んだあとに使われ始めた」。** 消せない理由が変わって
          いるので、影響を読み直してから見せる。
        */
        setDeleteError('いま使われ始めたため、削除できませんでした。使用先を読み直しました。')
        /* 読み直しの返事も、同じ3つで照合してから映す。 */
        const at = { ...impactRequestRef.current }
        try {
          const again = await api.media.deleteImpact(mediaIdAtRequest, accountAtRequest)
          const same =
            isCurrentDelete()
            && latestAccountRef.current === accountAtRequest
            && impactRequestRef.current.accountId === at.accountId
            && impactRequestRef.current.mediaId === at.mediaId
            && impactRequestRef.current.generation === at.generation
          if (same && again.success) setImpact(again.data)
        } catch {
          if (isCurrentDelete()) setImpactPhase('error')
        }
        return
      }
      setDeleteError('削除できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      if (isCurrentDelete()) setDeleteBusy(false)
    }
  }

  function closeDeleteDialog() {
    impactRequestRef.current = {
      accountId: selectedAccountId,
      mediaId: null,
      generation: impactRequestRef.current.generation + 1,
    }
    deleteRequestRef.current += 1
    setDeleting(null)
    setImpact(null)
    setImpactPhase('idle')
    setDeleteBusy(false)
    setDeleteError('')
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const next = items.filter(
      (item) =>
        kinds.has(item.kind) &&
        (!showUnusedOnly || item.usageCount === 0) &&
        (!needle || item.filename.toLowerCase().includes(needle)),
    )
    return next.toSorted((left, right) => {
      if (sort === 'oldest') return left.createdAt.localeCompare(right.createdAt)
      if (sort === 'name') return left.filename.localeCompare(right.filename, 'ja')
      if (sort === 'size') return right.sizeBytes - left.sizeBytes
      if (sort === 'usage') {
        if (left.usageCount == null) return right.usageCount == null ? 0 : 1
        if (right.usageCount == null) return -1
        return right.usageCount - left.usageCount
      }
      return right.createdAt.localeCompare(left.createdAt)
    })
  }, [items, kinds, query, showUnusedOnly, sort])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize],
  )

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  const removable = filtered.filter(isKnownUnused)
  const allSelected = removable.length > 0 && removable.every((item) => selected.has(item.id))

  return (
    <div data-design-node="g89Tc" data-media-design="v6">

      {!selectedAccountId && !accountLoading && (
        <ListState kind="empty" title="LINEアカウントを選択してください" description="登録メディアはLINEアカウントごとに管理します。" />
      )}

      {error && (
        <Notice tone="error" message={error} onClose={() => setError('')} className="mb-4" />
      )}

      {/* ドロップ枠と、受け付ける形式の表。Lステップと同じく左右に並べる。 */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          void upload([...e.dataTransfer.files])
        }}
        className={`rounded-card mb-4 grid gap-6 border border-dashed p-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] ${
          dragOver ? 'border-accent bg-accent-soft' : 'border-hairline bg-canvas'
        }`}
      >
        <div className="flex flex-col items-center justify-center gap-2 text-center">
          <p className="text-ink text-sm font-semibold">ここにファイルをドロップ</p>
          <p className="text-ink-faint text-xs">または</p>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,audio/mpeg,audio/mp4,application/pdf"
            onChange={(e) => void upload([...(e.target.files ?? [])])}
            className="hidden"
            id="media-upload"
          />
          {/* 設計 `g89Tc` の「アップロード」: 高さ40・角丸8・左右14・13px/700。 */}
          <label
            htmlFor="media-upload"
            className="bg-accent-deep text-on-accent hover:brightness-92 rounded-control inline-flex h-10 cursor-pointer items-center px-3.5 text-label font-bold transition-colors"
          >
            {uploading ? 'アップロード中...' : 'ファイルを選択する'}
          </label>
          <p className="text-danger text-xs leading-relaxed">
            ※ 公開リンクが作られるため、個人情報の取り扱いに注意してください
          </p>
        </div>

        {/*
          **上限には見出しを付ける。**
          設計 `eXAJP` は「LINEで送れる大きさ（超えると入れられません）」と書く。
          数字だけ並んでいると、目安なのか超えたら弾かれるのかが読めない。
          ただし言い方は設計そのままにしない。ここの数字は LINE の上限ではなく
          **この仕組みの上限**なので（上の注釈のとおり）、「LINEで送れる」は嘘になる。
        */}
        <h4 className="text-ink mt-4 mb-1 text-xs font-bold">入れられる大きさ（超えると入れられません）</h4>
        <dl className="text-xs">
          {LIMITS.map((limit) => (
            <div key={limit.label} className="flex gap-4 py-1">
              <dt className="text-ink-secondary w-24 shrink-0 font-medium">{limit.label}</dt>
              <dd className="text-ink-faint">{limit.note}</dd>
            </div>
          ))}
          <div className="flex gap-4 py-1">
            <dt className="text-ink-secondary w-24 shrink-0 font-medium">形式の確認</dt>
            <dd className="text-ink-faint">
              中身の形式とファイル名の拡張子が食い違うものは保存できません
            </dd>
          </div>
        </dl>
      </div>

      {/*
        **容量バーは作らない。**
        設計には使用量のバー（220×5）と実績（53×5）が描いてあるが、
        いまの `/api/media` はアカウントごとの保存容量も上限も返さない。
        作り物の帯を出すと、空いているように見えてしまう。
      */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-ink-secondary text-nano font-semibold">保存容量</span>
        <span className="text-ink-faint text-caption font-bold tabular-nums">—</span>
        <span className="text-ink-faint text-caption">
          まだ繋がっていません。保存容量が接続されると表示されます。
        </span>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SearchField
          value={query}
          onChange={(value) => {
            setQuery(value)
            setPage(1)
          }}
          onClear={() => {
            setQuery('')
            setPage(1)
          }}
          placeholder="ファイル名で検索"
          aria-label="ファイル名で検索"
          className="min-w-64 max-w-[420px] flex-1"
        />
        {/* 設計 `g89Tc` の表示切替: 枠 高さ40・角丸8、各44幅、アイコン16。 */}
        <div
          role="group"
          aria-label="並べ方"
          className="border-hairline rounded-control flex h-10 items-center overflow-hidden border"
        >
          {([
            ['grid', '格子で並べる', LayoutGrid],
            ['list', '一覧で並べる', ListIcon],
          ] as Array<[MediaView, string, typeof LayoutGrid]>).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              onClick={() => setView(value)}
              aria-pressed={view === value}
              aria-label={label}
              title={label}
              className={`flex h-full w-11 items-center justify-center ${
                view === value ? 'bg-accent-soft text-accent-deep' : 'text-ink-faint hover:bg-canvas-sunken'
              }`}
            >
              <Icon aria-hidden="true" size={16} />
            </button>
          ))}
        </div>
        <Select
          aria-label="並び順"
          value={sort}
          options={SORT_OPTIONS}
          onChange={(value) => {
            setSort(value as MediaSort)
            setPage(1)
          }}
        />
        <Select
          aria-label="表示件数"
          value={String(pageSize)}
          options={PAGE_SIZE_OPTIONS}
          onChange={(value) => {
            setPageSize(Number(value))
            setPage(1)
          }}
          size="page-size"
        />
      </div>

      {/* 種別と使用状態。選ぶと必ず1ページ目へ戻る。 */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {KINDS.map((kind) => (
          <label key={kind.key} className="text-ink-secondary flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={kinds.has(kind.key)}
              onChange={() => {
                setPage(1)
                setKinds((prev) => {
                  const next = new Set(prev)
                  if (next.has(kind.key)) next.delete(kind.key)
                  else next.add(kind.key)
                  return next
                })
              }}
              className="accent-green-500"
            />
            {kind.label}
          </label>
        ))}
        <FilterChip
          selected={showUnusedOnly}
          onChange={(selectedValue) => {
            setShowUnusedOnly(selectedValue)
            setPage(1)
          }}
        >
          使っていない
        </FilterChip>
      </div>

      {loading ? (
        <ListState kind="loading" title="メディアを読み込んでいます" />
      ) : loadFailed ? (
        <ListState
          kind="error"
          title="メディアを表示できませんでした"
          description="再読み込みしても直らない場合は、エラー報告へ連絡してください。"
          action={<Button variant="secondary" onClick={() => void load()}>登録メディアを再読み込み</Button>}
        />
      ) : current.length === 0 ? (
        <ListState
          kind="empty"
          title={items.length === 0 ? '登録メディアはまだありません' : '条件に合うメディアはありません'}
          description={items.length === 0 ? '上の枠へファイルを入れると、配信や公開画面で使えます。' : '種類または検索条件を変えてください。'}
        />
      ) : (
        <div
          className={
            view === 'grid'
              ? 'grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
              : 'flex flex-col gap-2'
          }
        >
          {current.map((item) => (
            <div
              key={item.id}
              className={`bg-canvas rounded-card border-hairline overflow-hidden border ${
                view === 'grid' ? 'flex flex-col' : 'flex flex-row items-center gap-3'
              }`}
            >
              <button
                onClick={() => setPreview(item)}
                title="プレビューを見る"
                className={`bg-canvas-sunken flex items-center justify-center overflow-hidden ${
                  view === 'grid' ? 'h-28' : 'h-14 w-20 shrink-0'
                }`}
              >
                {item.kind === 'image' ? (
                  // 静的書き出しのため next/image の最適化は使えない。
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.url} alt={item.filename} className="h-full w-full object-contain" />
                ) : (
                  <span className="text-ink-faint text-xs">
                    {item.kind === 'video' ? '動画' : item.kind === 'audio' ? '音声' : 'ファイル'}
                  </span>
                )}
              </button>

              <div className="flex min-w-0 flex-1 flex-col gap-1 p-2">
                {renaming?.id === item.id ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      autoFocus
                      value={renaming.value}
                      onChange={(e) => setRenaming({ id: item.id, value: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void rename()
                        if (e.key === 'Escape') setRenaming(null)
                      }}
                      aria-label="ファイル名"
                      className="border-accent rounded-control w-full border px-2 py-1 text-xs"
                    />
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => setRenaming(null)}
                        className="border-hairline text-ink-secondary rounded border px-2 py-1 text-[11px]"
                      >
                        キャンセル
                      </button>
                      <button
                        onClick={() => void rename()}
                        className="bg-accent-deep text-on-accent rounded px-2 py-1 text-[11px]"
                      >
                        保存
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <label className="flex items-start gap-1.5">
                      <input
                        type="checkbox"
                        checked={selected.has(item.id)}
                        disabled={!isKnownUnused(item)}
                        onChange={() =>
                          setSelected((prev) => {
                            const next = new Set(prev)
                            if (next.has(item.id)) next.delete(item.id)
                            else next.add(item.id)
                            return next
                          })
                        }
                        aria-label={`${item.filename}を選ぶ`}
                        title={
                          item.usageCount == null
                            ? '使用先を確認できないため選べません'
                            : item.usageCount > 0
                              ? '使用先から外すまで削除できません'
                              : undefined
                        }
                        className="accent-green-500 mt-0.5"
                      />
                      <span className="bg-ink-secondary text-on-accent rounded px-1 py-0.5 text-[10px] leading-none">
                        {KINDS.find((k) => k.key === item.kind)?.label ?? 'ファイル'}
                      </span>
                      <span className="text-ink min-w-0 flex-1 truncate text-caption font-bold" title={item.filename}>
                        {item.filename}
                      </span>
                    </label>
                    <p className="text-ink-faint text-nano font-semibold tabular-nums">
                      {formatMediaDetails(item)}
                    </p>
                    <p
                      className={`text-nano font-bold tabular-nums ${
                        item.usageCount === undefined
                          ? 'text-ink-faint'
                          : item.usageCount === 0
                            ? 'text-ink-faint'
                            : 'text-success'
                      }`}
                    >
                      <span className="sr-only">使用先：</span>
                      {item.usageCount === undefined
                        ? '使用先を確認できません'
                        : item.usageCount === 0
                          ? 'どこでも使っていない'
                          : `${item.usageCount}か所で使用中`}
                    </p>
                  </>
                )}

                <div className="mt-auto flex items-center justify-end gap-1 pt-1">
                  <button
                    onClick={() => void showUsages(item)}
                    title="使用箇所を見る"
                    aria-label={`${item.filename}の使用箇所`}
                    className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded border px-2 py-1 text-[11px]"
                  >
                    使用箇所
                  </button>
                  <button
                    onClick={() => setRenaming({ id: item.id, value: item.filename })}
                    title="名前を変える"
                    aria-label={`${item.filename}の名前を変える`}
                    className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded border px-2 py-1 text-[11px]"
                  >
                    編集
                  </button>
                  <a
                    href={item.url}
                    download={item.filename}
                    title="ダウンロード"
                    aria-label={`${item.filename}をダウンロード`}
                    className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded border px-2 py-1 text-[11px]"
                  >
                    保存
                  </a>
                  <Button
                    type="button"
                    onClick={() => void openDelete(item)}
                    data-qa-open="YfTfJ"
                    aria-label={`${item.filename}を削除`}
                  >
                    削除
                  </Button>
                </div>

                {usagesFor?.id === item.id && (
                  <div className="border-hairline mt-1 border-t pt-1">
                    {usagesFor.items.length === 0 ? (
                      <p className="text-ink-faint text-micro">
                        どこでも使われていません。
                        <br />
                        （本文の走査が済んだ時点の情報です）
                      </p>
                    ) : (
                      <ul className="space-y-0.5">
                        {usagesFor.items.map((u) => (
                          <li key={`${u.refKind}-${u.refId}`} className="text-ink-secondary text-[11px]">
                            {mediaUsageKindText(u.refKind)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/*
        1件ずつの削除確認（設計 `YfTfJ`）。**消せないときは「削除しますか？」と
        聞かない。** 聞いてから断るより、最初から消せないと言うほうが短い。
      */}
      <Dialog
        open={deleting !== null}
        tone="destructive"
        title={deleting ? dialogTitle(impact, deleting.filename) : ''}
        description="消すと、この画像・動画・ファイルそのものが無くなります。元に戻せません。"
        busy={deleteBusy}
        error={deleteError || undefined}
        onCancel={() => {
          if (deleteBusy) return
          closeDeleteDialog()
        }}
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-ink-faint text-micro">
              {impact && !impact.canDelete ? '使用先から外すと削除できます' : ''}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={closeDeleteDialog} disabled={deleteBusy}>
                閉じる
              </Button>
              {/* 消せないときは押し口ごと出さない。押せるように見えて何も起きない形にしない。 */}
              {canDeleteMedia({ impact, busy: deleteBusy }) ? (
                <Button type="button" variant="primary" onClick={() => void confirmDeleteOne()}>
                  {deleteBusy ? '処理中…' : '削除する'}
                </Button>
              ) : null}
            </div>
          </div>
        }
      >
        <div data-design-node="YfTfJ">
        {impactPhase === 'loading' ? (
          <p className="text-ink-faint text-xs">使われている場所を確認しています…</p>
        ) : impactPhase === 'error' ? (
          <p className="text-danger text-xs font-semibold" role="alert">
            使われている場所を確認できませんでした。読み直してから、もう一度お試しください。
          </p>
        ) : impact ? (
          <div className="space-y-3">
            <p className={impact.canDelete ? 'text-ink-secondary text-sm' : 'text-danger text-sm font-semibold'}>
              {usageText(impact)}
              {blockedReason(impact) ? ` ${blockedReason(impact)}` : ''}
            </p>

            {impact.references.length > 0 ? (
              <div>
                <p className="text-ink text-xs font-bold">使われている場所</p>
                <ul className="mt-1.5 space-y-1.5">
                  {impact.references.map((ref: MediaDeleteImpactReference, index: number) => (
                    <li
                      key={`${ref.kind}-${index}`}
                      className="border-hairline flex flex-wrap items-center justify-between gap-2 rounded-control border px-3 py-2 text-xs"
                    >
                      <span className="min-w-0">
                        <span className="text-ink font-semibold">{referenceKindText(ref.kind)}</span>
                        <span className="text-ink-secondary">「{referenceNameText(ref)}」</span>
                      </span>
                      {/* 開ける先があるときだけリンクにする。無い画面へ送らない。 */}
                      {ref.href ? (
                        <a href={ref.href} className="text-action shrink-0 font-semibold">ここを開く</a>
                      ) : (
                        <span className="text-ink-faint shrink-0">開けません</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/*
              設計は「別の画像に差し替える」も出すが、**差し替える口がまだ無い。**
              押しても何も起きない操作は置かず、いまできることだけを書く。
            */}
            <p className="text-ink-faint text-micro leading-5">
              使われている場所から外すと削除できます。まとめて差し替える操作は、まだ用意していません。
              <br />
              {checkedAtText(impact.checkedAt)} 時点で、テンプレート・一斉配信・リッチメニュー・シナリオ・コラム・イベント・ウェビナーの7種類を確認しました。
            </p>
          </div>
        ) : null}
        </div>
      </Dialog>

      <Dialog
        open={bulkConfirm !== null}
        tone="destructive"
        title={bulkConfirm ? `${bulkConfirm.length}件のメディアを削除しますか？` : ''}
        description="どこにも使われていないと確かめたものだけを消します。元に戻せません。"
        busy={bulkBusy}
        onCancel={() => {
          if (bulkBusy) return
          setBulkConfirm(null)
        }}
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" onClick={() => setBulkConfirm(null)} disabled={bulkBusy}>
              やめる
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={bulkBusy}
              onClick={() => void runBulkDelete(bulkConfirm ?? [])}
            >
              {bulkBusy ? '処理中…' : '削除する'}
            </Button>
          </div>
        }
      >
        <p className="text-ink-secondary text-sm">
          使われている場所があるものは、はじめから選べません。消したあとは元に戻せません。
        </p>
      </Dialog>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />

        <div className="flex flex-wrap items-center gap-3">
          <label className="text-ink-secondary flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() =>
                setSelected((prev) => {
                  if (allSelected) return new Set<string>()
                  const next = new Set(prev)
                  for (const item of removable) next.add(item.id)
                  return next
                })
              }
              className="accent-green-500"
            />
            すべてのメディアを選択
          </label>
          <button
            onClick={() => void removeSelected()}
            disabled={selected.size === 0}
            className="border-danger-bg text-danger hover:bg-danger-bg rounded-control border px-3 py-2 text-sm font-medium disabled:opacity-40"
          >
            選択したメディアを削除
            {selected.size > 0 && <span className="tabular-nums">（{selected.size}）</span>}
          </button>
        </div>
      </div>

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-6"
          role="dialog"
          aria-modal="true"
          aria-label={`${preview.filename}のプレビュー`}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPreview(null)
          }}
        >
          <button
            onClick={() => setPreview(null)}
            aria-label="プレビューを閉じる"
            className="text-on-accent absolute top-4 right-6 text-2xl leading-none"
          >
            ×
          </button>
          {preview.kind === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview.url}
              alt={preview.filename}
              className="max-h-full max-w-full object-contain"
            />
          ) : preview.kind === 'video' ? (
            <video src={preview.url} controls className="max-h-full max-w-full" />
          ) : preview.kind === 'audio' ? (
            <audio src={preview.url} controls />
          ) : (
            <div className="rounded-card bg-canvas p-6 text-center text-sm">
              <p className="text-ink font-medium">{preview.filename}</p>
              <a href={preview.url} target="_blank" rel="noreferrer" className="text-info mt-2 inline-block hover:underline">
                別のタブで開く
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
