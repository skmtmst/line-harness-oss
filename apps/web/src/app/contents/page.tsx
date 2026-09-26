'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  Folder,
  MediaDeleteImpact,
  MediaDeleteImpactReference,
  MediaItem,
} from '@line-crm/shared'
import { LayoutGrid, List as ListIcon, Trash2 } from 'lucide-react'
import { api, ApiError, type MediaQuota } from '@/lib/api'
import FeatureGate from '@/components/feature-gate'
import Button from '@/components/shared/button'
import IconButton from '@/components/shared/icon-button'
import ActionMenu from '@/components/shared/action-menu'
import { MoreAction } from '@/components/shared/row-actions'
import { formatMediaSize } from './media-usage-display'
import Dialog from '@/components/shared/dialog'
import {
  blockedReason,
  canDelete as canDeleteMedia,
  checkedAtText,
  dialogTitle,
  referenceKindText,
  referenceNameText,
  summarizeBulkDeleteResult,
  usageText,
} from './media-delete-impact'
import Pagination from '@/components/shared/pagination'
import ListRange from '@/components/ui/list-range'
import FilterChip from '@/components/shared/filter-chip'
import FolderPanel, { FOLDER_RAIL_STYLE } from '@/components/shared/folder-panel'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import SearchField from '@/components/shared/search-field'
import { RequiredBadge } from '@/components/shared/form-controls'
import Select from '@/components/shared/select'
import { useAccount } from '@/contexts/account-context'
import MediaDetailDialog from './media-detail-dialog'
import FileScanStoppedBanner from './file-scan-stopped-banner'
import { MediaQuotaGuidance } from './media-quota-guidance'
import MediaReplacementDialog from './media-replacement-dialog'
import MediaUploadDialog from './media-upload-dialog'

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
const UNGROUPED = '__ungrouped__'

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

/*
 * #670 15: 札の操作5個は同じ寸法で並べる。素の小ボタンと共通 Button が
 * 混ざると高さ・枠・角丸がばらつき、折返しで積み方がずれる。札内では
 * compact 1種(下の5個と同字)にそろえる。共通 Button の40pxは札の脚には
 * 大きい。字面をそのまま書く(design-debt の unresolved-classname を増やさない)。
 */

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

function formatMediaDetails(item: MediaItem): string {
  const format = item.mimeType.split('/').at(-1)?.replace('jpeg', 'jpg').toUpperCase() ?? ''
  const details = [format]
  if (item.width != null && item.height != null) {
    details.push(`${item.width}×${item.height}`)
  } else if (item.durationMs != null) {
    details.push(`${Math.round(item.durationMs / 1000)}秒`)
  }
  details.push(formatMediaSize(item.sizeBytes))
  return details.filter(Boolean).join(' ／ ')
}

/** 使用先を取得でき、かつ0件と確定したメディアだけを削除候補にする。 */
function isKnownUnused(item: MediaItem): boolean {
  return item.usageCount === 0
}

/** 格子と一覧。**中身は同じ。並べ方だけを切り替える。** */
type MediaView = 'grid' | 'list'
type MediaManagementPermission = 'loading' | 'allowed' | 'denied' | 'error'
type MediaDetailPhase = 'idle' | 'loading' | 'ready' | 'unavailable'

function mediaDetailIdFromLocation(): string | null {
  if (typeof window === 'undefined') return null
  const id = new URLSearchParams(window.location.search).get('id')?.trim()
  return id || null
}

export default function MediaLibraryPage() {
  // 直URLでも登録メディアオフのaccountには画面を出さない。
  return (
    <FeatureGate feature="media">
      <MediaLibraryInner />
    </FeatureGate>
  )
}

function MediaLibraryInner() {
  const [view, setView] = useState<MediaView>('grid')
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const latestAccountRef = useRef(selectedAccountId)
  latestAccountRef.current = selectedAccountId
  const [items, setItems] = useState<MediaItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [quota, setQuota] = useState<MediaQuota | null>(null)
  const [quotaFailed, setQuotaFailed] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [folders, setFolders] = useState<Folder[]>([])
  // #721: 未分類の件数は GET /api/folders の unfiledCount をそのまま出す。
  // kind=media は件数未対応のため来ない。来ないときは null（「—」表示）。
  const [unfiledCount, setUnfiledCount] = useState<number | null>(null)
  const [folderFilter, setFolderFilter] = useState('')
  const [addingFolder, setAddingFolder] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [savingFolder, setSavingFolder] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  /* ★V7: 札の操作を並べない。「使用箇所＋ダウンロード＋…」の1行に収め、削除の印は残す。取得は読取権限でも使うので「…」に隠さない。 */
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

  const [kinds, setKinds] = useState<Set<MediaItem['kind']>>(
    () => new Set(KINDS.map((k) => k.key)),
  )
  const [query, setQuery] = useState('')
  const [showUnusedOnly, setShowUnusedOnly] = useState(false)
  const [showNearLimitOnly, setShowNearLimitOnly] = useState(false)
  /** 退避済みだけを見る棚。普段の一覧には出ない。 */
  const [showArchivedOnly, setShowArchivedOnly] = useState(false)
  /*
    退避・一覧への復帰はどちらも理由が必須（あとから「なぜ」を追えるように）。
    押し口を開いた札と向きを持ち、確定時に同じ窓で理由を聞く。
  */
  const [archiveTarget, setArchiveTarget] = useState<{ item: MediaItem; mode: 'archive' | 'restore' } | null>(null)
  const [archiveReason, setArchiveReason] = useState('')
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [archiveError, setArchiveError] = useState('')
  const [sort, setSort] = useState<MediaSort>('newest')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  /** 名前を直している札。null なら誰も直していない。 */
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null)
  // 名前変更の多重押し防ぎと、札のそばに出す失敗文。一覧全体の欄には出さない。
  const [renamingBusy, setRenamingBusy] = useState(false)
  const [renameError, setRenameError] = useState('')
  /** 取得中の札。保存URLへ直接行かず、認証と監査を通る口から受け取る。 */
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set())

  /**
   * 管理画面の表示は認証付きの口だけを使う。item.url は配信用の公開URL
   * （配信本文に埋めてLINEが取りに行く）で、画面の表示には使わない。
   * 札はアカウントを選んだときだけ並ぶので、空のときは出さない。
   */
  const displaySrc = (item: MediaItem): string =>
    selectedAccountId ? api.media.contentUrl(item.id, selectedAccountId) : ''
  const [urlReady, setUrlReady] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailsFor, setDetailsFor] = useState<MediaItem | null>(null)
  const [detailFolderName, setDetailFolderName] = useState<string | null>(null)
  const [detailPhase, setDetailPhase] = useState<MediaDetailPhase>('idle')
  const detailRequestRef = useRef(0)
  const detailAccountRef = useRef<string | null | undefined>(undefined)
  const [replacementFor, setReplacementFor] = useState<MediaItem | null>(null)
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
  /** まとめて削除の進み具合。件数が多いときに止まっているように見せない。 */
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null)
  /** 大きく出している札。押した札の中身を原寸で見せる。 */
  const [preview, setPreview] = useState<MediaItem | null>(null)
  /*
    名前変更・削除・フォルダ追加は管理者（owner/admin）だけ（N-197）。
    staff には押して失敗する口を見せず、理由を添えて無効化する。
    一覧・ダウンロード・登録・版追加は staff も使えるので混同しない。
  */
  const [mediaManagementPermission, setMediaManagementPermission] = useState<MediaManagementPermission>('loading')

  const setDetailUrl = useCallback((id: string | null, mode: 'push' | 'replace' = 'push') => {
    const url = new URL(window.location.href)
    if (id) url.searchParams.set('id', id)
    else url.searchParams.delete('id')
    const nextUrl = `${url.pathname}${url.search}${url.hash}`
    if (mode === 'replace') window.history.replaceState(window.history.state, '', nextUrl)
    else window.history.pushState(window.history.state, '', nextUrl)
    setDetailId(id)
  }, [])

  useEffect(() => {
    const syncFromUrl = () => setDetailId(mediaDetailIdFromLocation())
    syncFromUrl()
    setUrlReady(true)
    window.addEventListener('popstate', syncFromUrl)
    return () => window.removeEventListener('popstate', syncFromUrl)
  }, [])

  useEffect(() => {
    let active = true
    void api.staff.me().then((response) => {
      if (!active) return
      if (!response.success) {
        setMediaManagementPermission('error')
        return
      }
      setMediaManagementPermission(
        response.data.role === 'owner' || response.data.role === 'admin' ? 'allowed' : 'denied',
      )
    }).catch(() => {
      if (active) setMediaManagementPermission('error')
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!urlReady || accountLoading) return
    const previousAccount = detailAccountRef.current
    detailAccountRef.current = selectedAccountId
    if (previousAccount !== undefined && previousAccount !== selectedAccountId) {
      detailRequestRef.current += 1
      setDetailsFor(null)
      setDetailFolderName(null)
      setDetailPhase('idle')
      if (detailId) setDetailUrl(null, 'replace')
      return
    }
    const request = detailRequestRef.current + 1
    detailRequestRef.current = request
    setDetailsFor(null)
    setDetailFolderName(null)
    if (!detailId) {
      setDetailPhase('idle')
      return
    }
    if (!selectedAccountId) {
      setDetailPhase('unavailable')
      return
    }
    const accountAtRequest = selectedAccountId
    setDetailPhase('loading')
    void api.media.detail(detailId, accountAtRequest).then((response) => {
      if (detailRequestRef.current !== request || latestAccountRef.current !== accountAtRequest) return
      if (!response.success) {
        setDetailPhase('unavailable')
        return
      }
      setDetailsFor(response.data.item)
      setDetailFolderName(response.data.folderName)
      setDetailPhase('ready')
    }).catch(() => {
      if (detailRequestRef.current === request && latestAccountRef.current === accountAtRequest) {
        setDetailPhase('unavailable')
      }
    })
    return () => {
      if (detailRequestRef.current === request) detailRequestRef.current += 1
    }
  }, [accountLoading, detailId, selectedAccountId, setDetailUrl, urlReady])

  const canManageMedia = mediaManagementPermission === 'allowed'
  const managementPermissionReason = mediaManagementPermission === 'loading'
    ? '操作権限を確認しています'
    : mediaManagementPermission === 'error'
      ? '操作権限を確認できないため、安全のため管理操作を止めています'
      : '使用箇所の確認・名前の変更・削除・フォルダの追加は管理者だけができます'

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
    setBulkProgress(null)
    setArchiveTarget(null)
    setArchiveError('')
  }, [selectedAccountId])

  const load = useCallback(async () => {
    const accountAtRequest = selectedAccountId
    if (!accountAtRequest) {
      setItems([])
      setQuota(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadFailed(false)
    setQuotaFailed(false)
    setError('')
    try {
      const [res, folderResponse, quotaResponse] = await Promise.all([
        api.media.list(accountAtRequest, {
          kind: kinds.size === 1 ? [...kinds][0] : undefined,
          folderId: folderFilter || undefined,
          query: query.trim() || undefined,
          unusedOnly: showUnusedOnly,
          nearLimitOnly: showNearLimitOnly,
          archived: showArchivedOnly ? 'only' : undefined,
          sort,
          limit: pageSize,
          offset: (page - 1) * pageSize,
        }),
        // #730: 選択中の1件に閉じた母集団で数える。
        api.folders.list('media', accountAtRequest),
        api.media.quota(accountAtRequest).catch(() => null),
      ])
      if (accountAtRequest !== latestAccountRef.current) return
      if (res.success) {
        setItems(res.data.items)
        setTotal(res.data.total)
      }
      if (folderResponse.success) {
        setFolders(folderResponse.data)
        setUnfiledCount(folderResponse.unfiledCount ?? null)
      }
      if (quotaResponse?.success) setQuota(quotaResponse.data)
      else {
        setQuota(null)
        setQuotaFailed(true)
      }
    } catch {
      if (accountAtRequest === latestAccountRef.current) setLoadFailed(true)
    } finally {
      if (accountAtRequest === latestAccountRef.current) setLoading(false)
    }
  }, [folderFilter, kinds, page, pageSize, query, selectedAccountId, showArchivedOnly, showNearLimitOnly, showUnusedOnly, sort])

  useEffect(() => {
    if (accountLoading) return
    setSelected(new Set())
    setDetailsFor(null)
    setReplacementFor(null)
    setPreview(null)
    setPage(1)
  }, [accountLoading, selectedAccountId])

  useEffect(() => {
    if (!accountLoading && urlReady && !detailId) void load()
  }, [accountLoading, detailId, load, urlReady])

  const rename = async () => {
    if (!renaming || !selectedAccountId || renamingBusy) return
    const accountAtRequest = selectedAccountId
    const filename = renaming.value.trim()
    if (!filename) return
    setRenamingBusy(true)
    setRenameError('')
    try {
      const res = await api.media.update(renaming.id, accountAtRequest, { filename })
      if (accountAtRequest !== latestAccountRef.current) return
      if (!res.success) {
        setRenameError(`「${renaming.value}」に変更できませんでした。${res.error}`)
        return
      }
      setRenaming(null)
      void load()
    } catch {
      setRenameError('名前の変更に失敗しました。もう一度お試しください。')
    } finally {
      setRenamingBusy(false)
    }
  }

  async function addFolder() {
    const name = folderName.trim()
    if (!name || savingFolder) return
    setSavingFolder(true)
    setError('')
    try {
      const response = await api.folders.create({ kind: 'media', name })
      if (!response.success) throw new Error(response.error)
      setFolders((current) => [...current, response.data])
      setFolderFilter(response.data.id)
      setFolderName('')
      setAddingFolder(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'フォルダを追加できませんでした')
    } finally {
      setSavingFolder(false)
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
    setBulkProgress({ done: 0, total: ids.length })
    setError('')
    setSuccessMessage('')
    let deleted = 0
    const failedNames: string[] = []
    for (const id of ids) {
      const name = items.find((m) => m.id === id)?.filename ?? id
      try {
        await api.media.delete(id, accountAtRequest)
      } catch {
        /*
          409（読み直したら使われ始めていた）も通信失敗も、ここでは
          名前だけ残して次へ進む。件ごとに文を出すと最後の1件しか残らない。
        */
        failedNames.push(name)
        setBulkProgress({ done: deleted + failedNames.length, total: ids.length })
        continue
      }
      if (accountAtRequest !== latestAccountRef.current) {
        /*
          アカウントが変わったら、前の窓のままにしない。処理中の表示を
          戻して抜ける（結果文は古いアカウントのものになるので出さない）。
        */
        setBulkBusy(false)
        setBulkConfirm(null)
        setBulkProgress(null)
        return
      }
      deleted += 1
      setBulkProgress({ done: deleted + failedNames.length, total: ids.length })
    }
    const result = summarizeBulkDeleteResult(deleted, failedNames)
    setSelected(new Set())
    setBulkConfirm(null)
    setBulkBusy(false)
    setBulkProgress(null)
    if (result.tone === 'success') setSuccessMessage(result.message)
    else setError(result.message)
    void load()
  }

  /**
   * 札のダウンロード。保存URL（認証なし）へ直接リンクせず、
   * 権限確認と監査を通る口から受け取って保存させる。
   */
  async function downloadItem(item: MediaItem) {
    const accountAtRequest = selectedAccountId
    if (!accountAtRequest || downloadingIds.has(item.id)) return
    setDownloadingIds((current) => new Set(current).add(item.id))
    try {
      const blob = await api.media.download(item.id, accountAtRequest)
      const href = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.download = item.filename
      anchor.click()
      URL.revokeObjectURL(href)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ダウンロードできませんでした')
    } finally {
      setDownloadingIds((current) => {
        const next = new Set(current)
        next.delete(item.id)
        return next
      })
    }
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

  /**
   * 退避・復帰の確定。両方とも理由が必須。409（直前に誰かが同じ操作を
   * 済ませた）は一覧を読み直して最新の見え方に合わせる。
   */
  async function confirmArchiveChange() {
    if (!archiveTarget || !selectedAccountId || archiveBusy) return
    const reason = archiveReason.trim()
    if (!reason) return
    const accountAtRequest = selectedAccountId
    const { item, mode } = archiveTarget
    setArchiveBusy(true)
    setArchiveError('')
    try {
      const res = mode === 'archive'
        ? await api.media.archive(item.id, accountAtRequest, reason)
        : await api.media.restore(item.id, accountAtRequest, reason)
      if (accountAtRequest !== latestAccountRef.current) return
      if (!res.success) {
        setArchiveError(`処理できませんでした。${res.error}`)
        void load()
        return
      }
      setArchiveTarget(null)
      setSuccessMessage(mode === 'archive'
        ? `「${item.filename}」をアーカイブしました。使っている場所はそのまま動き、一覧と新規選択からだけ外れます。`
        : `「${item.filename}」を一覧へ戻しました。`)
      void load()
    } catch (e) {
      /*
        fetchApi は 2xx 以外で ApiError を投げる。409（直前に誰かが
        同じ操作を済ませた）は汎用エラーで止めず、一覧を読み直して
        最新の見え方に合わせる。
      */
      if (e instanceof ApiError && e.status === 409) {
        setArchiveError(mode === 'archive'
          ? 'このメディアは既にアーカイブ済みです。一覧を読み直しました。'
          : 'このメディアは既に一覧へ戻っています。一覧を読み直しました。')
        void load()
        return
      }
      setArchiveError('処理に失敗しました。もう一度お試しください。')
    } finally {
      setArchiveBusy(false)
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const current = items

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  // まとめて削除の候補は未使用かつ一覧にいるものだけ。退避済みは選ばない。
  const removable = items.filter((item) => isKnownUnused(item) && !item.archivedAt)
  const allSelected = removable.length > 0 && removable.every((item) => selected.has(item.id))

  if (!urlReady || (detailId && (detailPhase === 'idle' || detailPhase === 'loading'))) {
    return <ListState kind="loading" title="メディアの詳細を読み込んでいます" />
  }

  if (detailId && (detailPhase === 'unavailable' || !detailsFor)) {
    return (
      <ListState
        kind="empty"
        title="メディアの詳細を開けません"
        description="メディアが存在しないか、このLINEアカウントでは表示できません。"
        action={<Button type="button" onClick={() => setDetailUrl(null)}>登録メディア一覧へ戻る</Button>}
      />
    )
  }

  if (detailsFor) {
    return (
      <MediaDetailDialog
        item={detailsFor}
        accountId={selectedAccountId}
        folderName={detailsFor.folderId ? detailFolderName ?? '—（未取得）' : '未分類'}
        canManage={canManageMedia}
        onClose={() => setDetailUrl(null)}
        onOpenReplacement={(item) => {
          setDetailUrl(null)
          setReplacementFor(item)
        }}
        onVersionCreated={(message) => {
          setDetailUrl(null)
          setSuccessMessage(message)
          void load()
        }}
        onItemUpdated={(updated) => setDetailsFor(updated)}
      />
    )
  }

  return (
    <div data-design-node="g89Tc" data-media-design="v6" className="flex flex-col gap-4">
      {/* カード同士の縦の間隔はこの親の gap-4（16px）だけで作る。子ごとの mb/mt は付けない。 */}

      {!selectedAccountId && !accountLoading && (
        <div className="bg-canvas rounded-card border-hairline border">
          <ListState kind="empty" title="LINEアカウントを選択してください" description="登録メディアはLINEアカウントごとに管理します。" />
        </div>
      )}

      {error && (
        <Notice tone="error" message={error} onClose={() => setError('')} />
      )}
      {!error && selectedAccountId ? (
        <div className="mb-4">
          <FileScanStoppedBanner accountId={selectedAccountId} />
        </div>
      ) : null}
      {successMessage && (
        <Notice tone="success" message={successMessage} onClose={() => setSuccessMessage('')} />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="primary" onClick={() => setUploadOpen(true)}>ファイルを入れる</Button>
        </div>
        <div className="w-full max-w-xs text-right">
          <p className="text-ink-secondary text-nano font-semibold">
            使っている容量 <span className="text-ink ml-1">{quota ? `${formatMediaSize(quota.usageBytes)} / ${formatMediaSize(quota.limitBytes)}` : '—（未取得）'}</span>
          </p>
          <MediaQuotaGuidance
            quota={quota}
            failed={quotaFailed}
            onShowNearLimit={() => {
              setShowNearLimitOnly(true)
              setShowUnusedOnly(false)
              setKinds(new Set(KINDS.map((kind) => kind.key)))
              setPage(1)
            }}
          />
        </div>
      </div>

      <div style={FOLDER_RAIL_STYLE} className="grid gap-4 lg:grid-cols-[var(--folder-rail-width)_minmax(0,1fr)]">
        <div className="min-w-0">
        <FolderPanel
          total={`${total} 件`}
          activeId={folderFilter}
          onSelect={(id) => {
            setFolderFilter(id)
            setPage(1)
          }}
          onAddFolder={() => setAddingFolder(true)}
          addFolderDisabled={!canManageMedia}
          addFolderTitle={canManageMedia ? undefined : managementPermissionReason}
          addFolderNote={canManageMedia ? undefined : (
            <p className="text-ink-faint text-xs">{managementPermissionReason}。</p>
          )}
          rows={[
            { id: '', label: 'すべて', count: total },
            ...folders.map((folder) => ({
              id: folder.id,
              label: folder.name,
              // #721: フォルダ件数はAPI(itemCount)をそのまま出す。kind=media
              // は件数未対応で来ないため「—」になる。読み込み済み範囲だけを
              // 数える計算は、黙って別の母集団にすり替わるため廃止。
              count: folder.itemCount ?? null,
              color: folder.color,
            })),
            { id: UNGROUPED, label: '未分類', count: unfiledCount },
          ]}
        >
          {addingFolder ? (
            <div className="space-y-2">
              <input
                type="text"
                autoFocus
                value={folderName}
                onChange={(event) => setFolderName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void addFolder()
                  if (event.key === 'Escape') setAddingFolder(false)
                }}
                placeholder="フォルダ名を入力"
                aria-label="フォルダ名"
                className="border-hairline rounded-control focus:ring-accent w-full border px-2 py-1.5 text-sm focus:ring-2 focus:outline-none"
              />
              <div className="flex justify-end gap-2">
                <Button type="button" onClick={() => setAddingFolder(false)}>キャンセル</Button>
                <Button type="button" variant="primary" onClick={() => void addFolder()} disabled={!folderName.trim() || savingFolder}>追加する</Button>
              </div>
            </div>
          ) : (
            <p className="text-ink-faint text-xs leading-5">フォルダを消しても、中のメディアは未分類に残ります。</p>
          )}
        </FolderPanel>
        </div>

        <div className="min-w-0">

      {/*
        検索は独立した全幅の行にする（U016）。表示切替・並び順・件数と
        同じ行に押し込むと、狭い幅で入力文が読めないほど潰れる。
      */}
      <div data-search-row className="mb-3">
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
          className="w-full"
        />
      </div>

      {/* 種別と使用状態。選ぶと必ず1ページ目へ戻る。 */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <FilterChip
          selected={kinds.size === KINDS.length && !showUnusedOnly && !showArchivedOnly}
          onChange={() => {
            setKinds(new Set(KINDS.map((kind) => kind.key)))
            setShowUnusedOnly(false)
            setShowNearLimitOnly(false)
            setShowArchivedOnly(false)
            setPage(1)
          }}
        >
          すべて
        </FilterChip>
        {KINDS.map((kind) => (
          <FilterChip
            key={kind.key}
            selected={kinds.size === 1 && kinds.has(kind.key) && !showArchivedOnly}
            onChange={() => {
              setKinds(new Set([kind.key]))
              setShowUnusedOnly(false)
              setShowNearLimitOnly(false)
              setShowArchivedOnly(false)
              setPage(1)
            }}
          >
            {kind.label}
          </FilterChip>
        ))}
        <FilterChip
          selected={showUnusedOnly}
          onChange={(selectedValue) => {
            setShowUnusedOnly(selectedValue)
            setShowNearLimitOnly(false)
            setShowArchivedOnly(false)
            if (selectedValue) setKinds(new Set(KINDS.map((kind) => kind.key)))
            setPage(1)
          }}
        >
          使っていない
        </FilterChip>
        <FilterChip
          selected={showNearLimitOnly}
          onChange={(selectedValue) => {
            setShowNearLimitOnly(selectedValue)
            setShowUnusedOnly(false)
            setShowArchivedOnly(false)
            if (selectedValue) setKinds(new Set(KINDS.map((kind) => kind.key)))
            setPage(1)
          }}
        >
          上限に近い
        </FilterChip>
        <FilterChip
          selected={showArchivedOnly}
          onChange={(selectedValue) => {
            setShowArchivedOnly(selectedValue)
            setShowUnusedOnly(false)
            setShowNearLimitOnly(false)
            if (selectedValue) setKinds(new Set(KINDS.map((kind) => kind.key)))
            setPage(1)
          }}
        >
          アーカイブ済み
        </FilterChip>
      </div>

      {/*
        表示の切り替え・並び順・件数は結果の見出し側へまとめる（U016）。
        検索と同じ行にすると、狭い幅で検索欄が潰れる。
      */}
      <div className="mb-3 flex flex-wrap items-center justify-end gap-3">
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

      <div data-design-node="h8pBZr" className="flex flex-col gap-4">
      {total > 200 ? (
        <p className="text-ink-faint text-xs">200件を超えるメディアも、ページを移動してすべて確認できます。</p>
      ) : null}
      {loading ? (
        <ListState kind="loading" title="読み込んでいます" description="このまま少しお待ちください。" />
      ) : loadFailed ? (
        <ListState
          kind="error"
          title="表示できませんでした"
          description="再読み込みしても直らないときは、エラー報告へお知らせください。"
          action={<Button variant="secondary" onClick={() => void load()}>もう一度読み込む</Button>}
        />
      ) : current.length === 0 ? (
        <div className="bg-canvas rounded-card border-hairline border">
          <ListState
            kind="empty"
            title={total === 0 && !query && !folderFilter ? 'まだメディアがありません' : '条件に合うメディアはありません'}
            description={total === 0 && !query && !folderFilter ? '配信で使う画像・動画・音声・ファイルの置き場です。' : '種類、フォルダ、または検索条件を変えてください。'}
            action={total === 0 && !query && !folderFilter ? <Button variant="primary" onClick={() => setUploadOpen(true)}>メディアを登録</Button> : undefined}
          />
        </div>
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
                aria-label={`${item.filename}のプレビューを見る`}
                className={`bg-canvas-sunken flex items-center justify-center overflow-hidden ${
                  view === 'grid' ? 'h-28' : 'h-14 w-20 shrink-0'
                }`}
              >
                {item.kind === 'image' ? (
                  <MediaThumb src={displaySrc(item)} alt={item.filename} />
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
                    {renameError && (
                      <p className="text-danger text-xs" role="alert">{renameError}</p>
                    )}
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => setRenaming(null)}
                        disabled={renamingBusy}
                        className="border-hairline text-ink-secondary rounded border px-2 py-1 text-[11px]"
                      >
                        キャンセル
                      </button>
                      <button
                        onClick={() => void rename()}
                        disabled={renamingBusy}
                        className="bg-accent-deep text-on-accent rounded px-2 py-1 text-[11px] disabled:opacity-50"
                      >
                        {renamingBusy ? '保存中…' : '保存'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <label className="flex items-start gap-1.5">
                      {canManageMedia ? (
                        <input
                          type="checkbox"
                          checked={selected.has(item.id)}
                          disabled={!isKnownUnused(item) || !!item.archivedAt}
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
                            item.archivedAt
                              ? '退避済みは削除できません。一覧へ戻してから削除してください'
                              : item.usageCount == null
                                ? '使用先を確認できないため選べません'
                                : item.usageCount > 0
                                  ? '使用先から外すまで削除できません'
                                  : undefined
                          }
                          className="accent-green-500 mt-0.5"
                        />
                      ) : null}
                      <span className="bg-ink-secondary text-on-accent rounded px-1 py-0.5 text-[10px] leading-none">
                        {KINDS.find((k) => k.key === item.kind)?.label ?? 'ファイル'}
                      </span>
                      {item.archivedAt ? (
                        <span
                          className="bg-canvas-sunken text-ink-secondary rounded px-1 py-0.5 text-[10px] leading-none"
                          title={item.archiveReason ? `退避の理由：${item.archiveReason}` : '退避済み'}
                        >
                          退避済み
                        </span>
                      ) : null}
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

                <div className="mt-auto flex flex-wrap items-center justify-end gap-1 pt-1">
                  <button
                    onClick={() => setDetailUrl(item.id)}
                    disabled={!canManageMedia}
                    title={canManageMedia ? '使用箇所を見る' : managementPermissionReason}
                    aria-label={`${item.filename}の使用箇所`}
                    className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control border px-2.5 py-1 text-xs whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    使用箇所
                  </button>
                  {/*
                    取得は読取権限でも使う操作なので「…」に隠さず、見えるボタンで出す。
                    読み上げ名は「＜ファイル名＞をダウンロード」のまま保つ。
                  */}
                  <button
                    onClick={() => void downloadItem(item)}
                    disabled={downloadingIds.has(item.id)}
                    title={downloadingIds.has(item.id) ? 'ファイルを取り出しています' : 'ダウンロード'}
                    aria-label={`${item.filename}をダウンロード`}
                    className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control border px-2.5 py-1 text-xs whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {downloadingIds.has(item.id) ? '取得中…' : 'ダウンロード'}
                  </button>
                  {canManageMedia ? (
                  <span className="relative inline-flex items-center">
                    <MoreAction
                      label={`${item.filename}のその他操作`}
                      aria-expanded={openMenuId === item.id}
                      onClick={() => setOpenMenuId((current) => (current === item.id ? null : item.id))}
                    />
                    <ActionMenu
                      open={openMenuId === item.id}
                      ariaLabel={`${item.filename}の操作`}
                      onClose={() => setOpenMenuId(null)}
                      items={[
                        ...(!item.archivedAt ? [{ id: 'rename', label: '編集', onSelect: () => { setRenameError(''); setRenaming({ id: item.id, value: item.filename }) } }] : []),
                        { id: 'archive', label: item.archivedAt ? '一覧へ戻す' : 'アーカイブ', onSelect: () => { setArchiveError(''); setArchiveReason(''); setArchiveTarget({ item, mode: item.archivedAt ? 'restore' : 'archive' }) } },
                      ]}
                    />
                  </span>
                  ) : null}
                  {/*
                    退避は消去ではない。使用中でも止めないが、理由を必ず聞く。
                    退避済みは編集・削除の押し口を出さず、戻す口だけを残す。
                    ★V7：札の操作は「使用箇所＋ダウンロード＋…」の1行。編集・
                    アーカイブは「…」の中、削除はゴミ箱の印のまま残す。
                    権限のない人には「…」自体を出さない（空の飾りにしない）。
                  */}
                  {canManageMedia && !item.archivedAt ? (
                  <IconButton
                    onClick={() => void openDelete(item)}
                    data-qa-open="YfTfJ"
                    aria-label={`${item.filename}を削除`}
                    title="削除"
                  >
                    <Trash2 aria-hidden />
                  </IconButton>
                  ) : null}
                </div>

              </div>
            </div>
          ))}
        </div>
      )}
      </div>

      {/*
        1件ずつの削除確認（設計 `YfTfJ`）。**消せないときは「削除しますか？」と
        聞かない。** 聞いてから断るより、最初から消せないと言うほうが短い。
      */}
      <Dialog
        open={deleting !== null}
        designNode="YfTfJ"
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
              {deleting && impact && impact.usageCount > 0 ? (
                <Button
                  type="button"
                  variant="primary"
                  disabled={deleteBusy}
                  onClick={() => {
                    const source = deleting
                    closeDeleteDialog()
                    setReplacementFor(source)
                  }}
                >
                  別のメディアに差し替える
                </Button>
              ) : null}
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

            <p className="text-ink-faint text-micro leading-5">
              使われている場所から外すと削除できます。別のメディアを選ぶと、使用先をまとめて差し替えられます。
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
        {bulkBusy && bulkProgress ? (
          <p className="text-ink-secondary mt-2 text-sm tabular-nums" aria-live="polite">
            処理中…（{bulkProgress.done}/{bulkProgress.total}件）
          </p>
        ) : null}
      </Dialog>

      {/*
        退避・復帰の理由を聞く窓。監査に残すため理由なしでは確定できない。
        退避しても本文・過去配信からの参照は切れない旨を先に伝える。
      */}
      <Dialog
        open={archiveTarget !== null}
        title={archiveTarget?.mode === 'archive'
          ? `「${archiveTarget.item.filename}」をアーカイブしますか？`
          : archiveTarget ? `「${archiveTarget.item.filename}」を一覧へ戻しますか？` : ''}
        description={archiveTarget?.mode === 'archive'
          ? '一覧と新規選択から外れます。使っている場所や過去の配信はそのまま動きます。'
          : '一覧と新規選択へ戻ります。'}
        busy={archiveBusy}
        error={archiveError || undefined}
        onCancel={() => {
          if (archiveBusy) return
          setArchiveTarget(null)
        }}
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" onClick={() => setArchiveTarget(null)} disabled={archiveBusy}>
              やめる
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={archiveBusy || !archiveReason.trim()}
              onClick={() => void confirmArchiveChange()}
            >
              {archiveBusy
                ? '処理中…'
                : archiveTarget?.mode === 'archive' ? 'アーカイブする' : '一覧へ戻す'}
            </Button>
          </div>
        }
      >
        <label className="block space-y-1.5">
          <span className="text-ink text-xs font-bold">理由<RequiredBadge /><span className="font-normal text-ink-faint">（あとから履歴で確認できます）</span></span>
          <input
            type="text"
            autoFocus
            value={archiveReason}
            onChange={(event) => setArchiveReason(event.target.value)}
            placeholder={archiveTarget?.mode === 'archive' ? '例：古いキャンペーンの素材のため' : '例：再び使うため'}
            aria-label="理由"
            className="border-hairline rounded-control focus:ring-accent w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
          />
        </label>
      </Dialog>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <ListRange total={total} first={total === 0 ? 0 : (page - 1) * pageSize + 1} last={Math.min(page * pageSize, total)} />
          <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {canManageMedia ? (
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
          ) : null}
          {canManageMedia ? (
            <button
              onClick={() => void removeSelected()}
              disabled={selected.size === 0}
              className="border-danger-bg text-danger hover:bg-danger-bg rounded-control border px-3 py-2 text-sm font-medium disabled:opacity-40"
            >
              選択したメディアを削除
              {selected.size > 0 && <span className="tabular-nums">（{selected.size}）</span>}
            </button>
          ) : (
            <p className="text-ink-faint text-xs">{managementPermissionReason}。</p>
          )}
        </div>
      </div>
        </div>
      </div>

      <MediaUploadDialog
        open={uploadOpen}
        accountId={selectedAccountId}
        folders={folders}
        initialFolderId={folderFilter}
        onClose={() => setUploadOpen(false)}
        onComplete={() => {
          setSuccessMessage('登録できたメディアを一覧へ反映しました。')
          void load()
        }}
      />

      <MediaReplacementDialog
        source={replacementFor}
        accountId={selectedAccountId}
        onClose={() => setReplacementFor(null)}
        onComplete={(message) => {
          setReplacementFor(null)
          setSuccessMessage(message)
          void load()
        }}
      />

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
              src={displaySrc(preview)}
              alt={preview.filename}
              className="max-h-full max-w-full object-contain"
            />
          ) : preview.kind === 'video' ? (
            <video src={displaySrc(preview)} controls className="max-h-full max-w-full" />
          ) : preview.kind === 'audio' ? (
            <audio src={displaySrc(preview)} controls />
          ) : (
            <div className="rounded-card bg-canvas p-6 text-center text-sm">
              <p className="text-ink font-medium">{preview.filename}</p>
              <a href={displaySrc(preview)} target="_blank" rel="noreferrer" className="text-info mt-2 inline-block hover:underline">
                別のタブで開く
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 一覧の縮小画像。★V7：読み込めないとき、ブラウザの壊れた画像の印と
 * ファイル名（代替文字）が枠からはみ出していた。種類の文字に切り替える。
 */
function MediaThumb({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <span className="text-ink-faint text-xs">画像を表示できません</span>
  // 静的書き出しのため next/image の最適化は使えない。
  // 一覧20件の同時取得を避けるため遅延読み込みにする。
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} className="h-full w-full object-contain" />
}
