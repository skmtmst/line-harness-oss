'use client'

/*
 * ★V8 登録メディア一覧（Pencil `O7hUt7`）。
 *
 * 型（ListPage）に、数の帯（登録メディア・どこでも使っていない・使っている容量・アーカイブ）、
 * 左のフォルダの列（上に「メディアを登録する」）、案内の帯と道具の段、札の格子、表の下の範囲とページ送り、
 * 選んだときの一括バーをはめる。データの口・確かめの窓は今の V8（src/app/contents/list-v8.tsx）から写した。
 * 札の名前の前にフォルダの色の丸（2026-10-07 オーナー）。札の操作は「…」へ集める。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  Folder,
  MediaDeleteImpact,
  MediaDeleteImpactReference,
  MediaItem,
} from '@line-crm/shared'
import { Archive, Eye, EyeOff, HardDrive, Images, LayoutGrid, List as ListIcon, Plus } from 'lucide-react'
import { api, ApiError, type MediaQuota } from '@/lib/api'
import Button from '@/components/shared/button'
import EmptyList from '@/components/shared/empty-list'
import Checkbox from '@/components/shared/checkbox'
import ListToolbar from '@/components/shared/list-toolbar'
import { RowMenu } from '@/components/shared/row-actions'
import { formatMediaSize } from './media-usage-display'
import MediaPreviewOverlay from './media-preview-overlay'
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
import FolderPanel from '@/components/shared/folder-panel'
import { FolderDot, type FolderDotFolder } from '@/components/shared/folder-dot'
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import BulkBar from '@/components/shared/bulk-bar'
import { classifyApiFailure } from '@/components/shared/api-error-message'
import { notifyToast } from '@/components/shared/toast'
import { RequiredBadge } from '@/components/shared/form-controls'
import Select from '@/components/shared/select'
import { useAccount } from '@/contexts/account-context'
import { formatNumber } from '@/lib/format'
import MediaDetailDialog from './media-detail-dialog'
import FileScanStoppedBanner from './file-scan-stopped-banner'
import { MediaQuotaGuidance } from './media-quota-guidance'
import MediaReplacementDialog from './media-replacement-dialog'
import { folderById, folderCreator } from '@/components/shared/folder-select'
import MediaUploadDialog from './media-upload-dialog'
import { ListPage } from '@/components/templates'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import styles from './list.module.css'

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
type MediaDetailFailure = 'missing' | 'denied' | 'retryable'

function mediaDetailIdFromLocation(): string | null {
  if (typeof window === 'undefined') return null
  const id = new URLSearchParams(window.location.search).get('id')?.trim()
  return id || null
}

/** 数の帯の4マス。失敗・未取得は null（「—」表示）にする。 */
type MediaKpis = {
  known: boolean
  total: number | null
  kindTotals: Record<MediaItem['kind'], number | null>
  unusedTotal: number | null
  archivedTotal: number | null
}

const EMPTY_KPIS: MediaKpis = {
  known: false,
  total: null,
  kindTotals: { image: null, audio: null, video: null, file: null },
  unusedTotal: null,
  archivedTotal: null,
}

export default function MediaLibraryListV8() {
  const [view, setView] = useState<MediaView>('grid')
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const latestAccountRef = useRef(selectedAccountId)
  latestAccountRef.current = selectedAccountId
  const [items, setItems] = useState<MediaItem[]>([])
  const [total, setTotal] = useState(0)
  /*
    R38: `total` は絞り込み後の件数。フォルダ欄の「すべて」には絞り込み前の
    総数を出すため、同じ棚（アーカイブの扱い）で数えた総数を別に持つ。
  */
  const [overallTotal, setOverallTotal] = useState<number | null>(null)
  /*
    m26m: 一覧の総数が「分かっている」かどうか。初期値の total=0 や
    失敗時の残留値をそのまま出すと、実在する件を0件と誤案内する。
    成功したときだけ真にし、フォルダ欄の「すべて」と表の下の件数は
    真のときだけ出す（vars 側の listFailed と同じ約束）。
  */
  const [listKnown, setListKnown] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [quota, setQuota] = useState<MediaQuota | null>(null)
  const [quotaFailed, setQuotaFailed] = useState(false)
  /* 数の帯の4マス。種別・未使用・アーカイブの件数は1件だけ取って数を読む。 */
  const [kpis, setKpis] = useState<MediaKpis>(EMPTY_KPIS)
  const [error, setError] = useState('')
  const [folders, setFolders] = useState<Folder[]>([])
  // #721: 未分類の件数は GET /api/folders の unfiledCount をそのまま出す。
  // kind=media は件数未対応のため来ない。来ないときは null（「—」表示）。
  const [unfiledCount, setUnfiledCount] = useState<number | null>(null)
  /* カードの名前の前の丸は、左のフォルダの列と同じフォルダ（同じ色）を引く。無ければ未分類の輪。 */
  const folderDotOf = (folderId: string | null | undefined): FolderDotFolder | null => {
    const folder = folderId ? folders.find((f) => f.id === folderId) : undefined
    return folder ? { name: folder.name, color: folder.color } : null
  }
  /*
    R587: フォルダの取得失敗は一覧・容量と切り分ける。フォルダだけ503でも
    取得済みのメディアと容量は見せ、フォルダ欄だけ失敗と再試行を示す。
  */
  const [folderFailure, setFolderFailure] = useState<unknown>(null)
  const [folderReloading, setFolderReloading] = useState(false)
  const [folderFilter, setFolderFilter] = useState('')
  const [addingFolder, setAddingFolder] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [savingFolder, setSavingFolder] = useState(false)
  /*
    R37: フォルダの名前変更・削除を FolderPanel の「…」へ接続する。
    追加だけあって直し・消しが無いと、整理し直す手段が無い。
  */
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null)
  const [deletingFolder, setDeletingFolder] = useState<Folder | null>(null)
  const [folderBusy, setFolderBusy] = useState(false)
  const [folderError, setFolderError] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  /* 札の操作は「…」へ集める。行末にボタンは1つも置かない。 */
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
  /* フォルダへ移す窓。移し先だけを選び、確定で PATCH する。 */
  const [moveTarget, setMoveTarget] = useState<MediaItem | null>(null)
  const [moveFolderId, setMoveFolderId] = useState('')
  const [moveBusy, setMoveBusy] = useState(false)
  const [moveError, setMoveError] = useState('')
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
  const [detailFailure, setDetailFailure] = useState<MediaDetailFailure | null>(null)
  const [detailRetry, setDetailRetry] = useState(0)
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
    setDetailFailure(null)
    if (!detailId) {
      setDetailPhase('idle')
      return
    }
    if (!selectedAccountId) {
      setDetailPhase('unavailable')
      setDetailFailure('missing')
      return
    }
    const accountAtRequest = selectedAccountId
    setDetailPhase('loading')
    void api.media.detail(detailId, accountAtRequest).then((response) => {
      if (detailRequestRef.current !== request || latestAccountRef.current !== accountAtRequest) return
      if (!response.success) {
        setDetailPhase('unavailable')
        // R588: 原因不明の失敗を「存在しない」と断定しない。読み直せる側に倒す。
        setDetailFailure('retryable')
        return
      }
      setDetailsFor(response.data.item)
      setDetailFolderName(response.data.folderName)
      setDetailPhase('ready')
    }).catch((caught) => {
      if (detailRequestRef.current === request && latestAccountRef.current === accountAtRequest) {
        setDetailPhase('unavailable')
        // R588: 404は対象なし、403は権限案内、それ以外は通信失敗として再試行させる。
        setDetailFailure(
          caught instanceof ApiError && caught.status === 404
            ? 'missing'
            : caught instanceof ApiError && caught.status === 403
              ? 'denied'
              : 'retryable',
        )
      }
    })
    return () => {
      if (detailRequestRef.current === request) detailRequestRef.current += 1
    }
  }, [accountLoading, detailId, detailRetry, selectedAccountId, setDetailUrl, urlReady])

  /** R588: 通信失敗の詳細は同じIDで読み直す。URLは変えない。 */
  const retryDetail = useCallback(() => {
    if (!detailId) return
    setDetailFailure(null)
    setDetailPhase('loading')
    setDetailRetry((count) => count + 1)
  }, [detailId])

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
    setMoveTarget(null)
    setMoveError('')
  }, [selectedAccountId])

  /*
    R587: フォルダは一覧・容量と独立して読む。フォルダだけ503でも
    取得済みのメディアと容量は見せたままにする。
  */
  const loadFolders = useCallback(async () => {
    const accountAtRequest = selectedAccountId
    if (!accountAtRequest) {
      setFolders([])
      setUnfiledCount(null)
      setFolderFailure(null)
      return
    }
    setFolderReloading(true)
    setFolderFailure(null)
    try {
      // #730: 選択中の1件に閉じた母集団で数える。
      const folderResponse = await api.folders.list('media', accountAtRequest)
      if (accountAtRequest !== latestAccountRef.current) return
      if (folderResponse.success) {
        setFolders(folderResponse.data)
        setUnfiledCount(folderResponse.unfiledCount ?? null)
      } else {
        setFolderFailure(new ApiError(500, folderResponse.error))
      }
    } catch (caught) {
      if (accountAtRequest === latestAccountRef.current) setFolderFailure(caught)
    } finally {
      if (accountAtRequest === latestAccountRef.current) setFolderReloading(false)
    }
  }, [selectedAccountId])

  /*
    WEB097: 同じアカウントの中でも、検索・絞り込み・ページを変えるたびに新しい要求を出す。
    遅い検索 A の返事が速い検索 B の結果を上書きしないよう、最後に出した要求の世代だけを反映する。
    失敗の表示と「読み込み中」の解除も最新の要求だけが行う。
  */
  const listSeqRef = useRef(0)
  const summarySeqRef = useRef(0)

  const loadList = useCallback(async () => {
    const accountAtRequest = selectedAccountId
    const seq = ++listSeqRef.current
    const isLatest = () => seq === listSeqRef.current && accountAtRequest === latestAccountRef.current
    if (!accountAtRequest) {
      setItems([])
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadFailed(false)
    setError('')
    try {
      const res = await api.media.list(accountAtRequest, {
        kind: kinds.size === 1 ? [...kinds][0] : undefined,
        folderId: folderFilter || undefined,
        query: query.trim() || undefined,
        unusedOnly: showUnusedOnly,
        nearLimitOnly: showNearLimitOnly,
        archived: showArchivedOnly ? 'only' : undefined,
        sort,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      }).catch(() => null)
      if (!isLatest()) return
      if (res?.success) {
        setItems(res.data.items)
        setTotal(res.data.total)
        setListKnown(true)
      } else {
        setLoadFailed(true)
        setListKnown(false)
      }
    } catch {
      if (isLatest()) {
        setLoadFailed(true)
        setListKnown(false)
      }
    } finally {
      if (isLatest()) setLoading(false)
    }
  }, [folderFilter, kinds, page, pageSize, query, selectedAccountId, showArchivedOnly, showNearLimitOnly, showUnusedOnly, sort])

  /*
    WEB098: 容量と「すべて」の総数は検索・ページ送り・種別では変わらない。
    アカウントとアーカイブの表示を変えたとき、または変えた後（load）だけ読み直す。
    R587: 一覧の失敗で容量まで隠さない（別々に成否を決める）。
  */
  const loadSummary = useCallback(async () => {
    const accountAtRequest = selectedAccountId
    const seq = ++summarySeqRef.current
    if (!accountAtRequest) {
      setQuota(null)
      return
    }
    setQuotaFailed(false)
    const [quotaResponse, overallResponse] = await Promise.all([
      api.media.quota(accountAtRequest).catch(() => null),
      // R38: フォルダ欄の「すべて」は絞り込み前の総数。1件だけ取って数を読む。
      api.media.list(accountAtRequest, {
        archived: showArchivedOnly ? 'only' : undefined,
        limit: 1,
        offset: 0,
      }).catch(() => null),
    ])
    if (seq !== summarySeqRef.current || accountAtRequest !== latestAccountRef.current) return
    if (overallResponse?.success) setOverallTotal(overallResponse.data.total)
    if (quotaResponse?.success) setQuota(quotaResponse.data)
    else {
      setQuota(null)
      setQuotaFailed(true)
    }
  }, [selectedAccountId, showArchivedOnly])

  /** 変えた後の読み直し。一覧と容量・総数の両方を読む（フォルダ・数の帯は呼ぶ側が決める）。 */
  const load = useCallback(async () => {
    await Promise.all([loadList(), loadSummary()])
  }, [loadList, loadSummary])

  /*
    数の帯の4マス。絞り込み・ページ送りが変わっても数は変わらないので、
    一覧の読み直しとは別に読む。1件だけ取って総数を読む（実データのみ）。
    失敗したマスは null のまま「—」で出す（偽ゼロを置かない）。
  */
  const loadKpis = useCallback(async () => {
    const accountAtRequest = selectedAccountId
    if (!accountAtRequest) {
      setKpis(EMPTY_KPIS)
      return
    }
    const [kindResponses, unusedResponse, archivedResponse] = await Promise.all([
      Promise.all(KINDS.map((kind) =>
        api.media.list(accountAtRequest, { kind: kind.key, limit: 1, offset: 0 }).catch(() => null),
      )),
      api.media.list(accountAtRequest, { unusedOnly: true, limit: 1, offset: 0 }).catch(() => null),
      api.media.list(accountAtRequest, { archived: 'only', limit: 1, offset: 0 }).catch(() => null),
    ])
    if (accountAtRequest !== latestAccountRef.current) return
    const kindTotals: Record<MediaItem['kind'], number | null> = {
      image: null,
      audio: null,
      video: null,
      file: null,
    }
    let anyKindKnown = false
    KINDS.forEach((kind, index) => {
      const response = kindResponses[index]
      if (response?.success) {
        kindTotals[kind.key] = response.data.total
        anyKindKnown = true
      }
    })
    setKpis({
      known: anyKindKnown || unusedResponse?.success === true || archivedResponse?.success === true,
      total: null,
      kindTotals,
      unusedTotal: unusedResponse?.success ? unusedResponse.data.total : null,
      archivedTotal: archivedResponse?.success ? archivedResponse.data.total : null,
    })
  }, [selectedAccountId])

  useEffect(() => {
    if (accountLoading) return
    setSelected(new Set())
    setDetailsFor(null)
    setReplacementFor(null)
    setPreview(null)
    setPage(1)
    // m26m: 別アカウントの総数を残さない。読み直すまで「すべて」は未知。
    setListKnown(false)
    setOverallTotal(null)
    setKpis(EMPTY_KPIS)
  }, [accountLoading, selectedAccountId])

  /*
    WEB098: 一覧・容量と総数・フォルダは変わる時が違うので、別々に読む。
    検索・ページ送りで読み直すのは一覧だけ。
  */
  useEffect(() => {
    if (!accountLoading && urlReady && !detailId) void loadList()
  }, [accountLoading, detailId, loadList, urlReady])

  useEffect(() => {
    if (!accountLoading && urlReady && !detailId) void loadSummary()
  }, [accountLoading, detailId, loadSummary, urlReady])

  useEffect(() => {
    // R587: フォルダの成否は一覧・容量と切り分ける。
    if (!accountLoading && urlReady && !detailId) void loadFolders()
  }, [accountLoading, detailId, loadFolders, urlReady])

  /*
    数の帯は絞り込み・ページ送りでは変わらない。アカウントが変わったときと、
    変えたあと（削除・退避・登録の確定で loadKpis を呼ぶ）だけ読み直す。
  */
  useEffect(() => {
    if (!accountLoading && urlReady && !detailId) {
      void loadKpis()
    }
  }, [accountLoading, detailId, loadKpis, urlReady])

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

  /** R37: フォルダを消す。中身は消えず未分類に戻る。消した先を選んでいたら「すべて」へ戻す。 */
  async function removeFolder() {
    if (!deletingFolder || !selectedAccountId || folderBusy) return
    const accountAtRequest = selectedAccountId
    setFolderBusy(true)
    setFolderError('')
    try {
      const response = await api.folders.delete(deletingFolder.id, accountAtRequest)
      if (!response.success) throw new Error(response.error)
      if (accountAtRequest !== latestAccountRef.current) return
      setDeletingFolder(null)
      if (folderFilter === deletingFolder.id) setFolderFilter('')
      void load()
      void loadFolders()
    } catch {
      if (accountAtRequest === latestAccountRef.current) setFolderError('フォルダを削除できませんでした。')
    } finally {
      setFolderBusy(false)
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
    if (result.tone === 'success') notifyToast(result.message)
    else setError(result.message)
    void load()
    void loadKpis()
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
      void loadKpis()
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
      notifyToast(mode === 'archive'
        ? `「${item.filename}」をアーカイブしました。使っている場所はそのまま動き、一覧と新規選択からだけ外れます。`
        : `「${item.filename}」を一覧へ戻しました。`)
      void load()
      void loadKpis()
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

  /**
   * フォルダへ移す確定。未分類へ戻すときは null を渡す。
   * 二重押しは止め、競合（409）は一覧を読み直して最新の見え方に合わせる。
   */
  async function confirmMove() {
    if (!moveTarget || !selectedAccountId || moveBusy) return
    const accountAtRequest = selectedAccountId
    const { id, filename } = moveTarget
    setMoveBusy(true)
    setMoveError('')
    try {
      const res = await api.media.update(id, accountAtRequest, {
        folderId: moveFolderId || null,
      })
      if (accountAtRequest !== latestAccountRef.current) return
      if (!res.success) {
        setMoveError(`移動できませんでした。${res.error}`)
        return
      }
      setMoveTarget(null)
      notifyToast(`「${filename}」を${moveFolderId ? 'フォルダへ移しました。' : '未分類へ移しました。'}`)
      void load()
      void loadFolders()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setMoveError('直前に誰かが変えたため、移動できませんでした。一覧を読み直しました。')
        void load()
        return
      }
      setMoveError('移動に失敗しました。もう一度お試しください。')
    } finally {
      setMoveBusy(false)
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const current = items

  /*
    R38: 絞り込みが1つでも効いているか。「すべて」の選び方・0件表示・
    フォルダ欄の件数を使い分ける。
  */
  const hasFilter = query.trim() !== ''
    || folderFilter !== ''
    || kinds.size !== KINDS.length
    || showUnusedOnly
    || showNearLimitOnly
    || showArchivedOnly

  /** R38: 「条件に合うものがありません」の次に置く、条件を外す口。 */
  const clearFilters = () => {
    setQuery('')
    setFolderFilter('')
    setKinds(new Set(KINDS.map((kind) => kind.key)))
    setShowUnusedOnly(false)
    setShowNearLimitOnly(false)
    setShowArchivedOnly(false)
    setPage(1)
  }

  /** 数の帯の押し口。帯のマスを選ぶと対応する絞り込みになる。 */
  const applyUnusedFilter = () => {
    setShowUnusedOnly(true)
    setShowNearLimitOnly(false)
    setShowArchivedOnly(false)
    setKinds(new Set(KINDS.map((kind) => kind.key)))
    setPage(1)
  }
  const applyNearLimitFilter = () => {
    setShowNearLimitOnly(true)
    setShowUnusedOnly(false)
    setShowArchivedOnly(false)
    setKinds(new Set(KINDS.map((kind) => kind.key)))
    setPage(1)
  }
  const applyArchivedFilter = () => {
    setShowArchivedOnly(true)
    setShowUnusedOnly(false)
    setShowNearLimitOnly(false)
    setKinds(new Set(KINDS.map((kind) => kind.key)))
    setPage(1)
  }

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  // まとめて削除の候補は未使用かつ一覧にいるものだけ。退避済みは選ばない。
  const removable = items.filter((item) => isKnownUnused(item) && !item.archivedAt)
  const allSelected = removable.length > 0 && removable.every((item) => selected.has(item.id))
  /** R587: フォルダ欄の失敗は403（権限）とそれ以外（通信）で案内を分ける。 */
  const folderForbidden = folderFailure != null && classifyApiFailure(folderFailure) === 'forbidden'

  /* 数の帯の文言。失敗・未取得は「—」で出し、偽ゼロを置かない。 */
  const kpiTotalText = !listKnown || loadFailed ? '—' : formatNumber(overallTotal ?? total)
  const kindBreakdown = KINDS
    .map((kind) => (kpis.kindTotals[kind.key] == null ? null : `${kind.label}${formatNumber(kpis.kindTotals[kind.key] as number)}`))
    .filter((text): text is string => text !== null)
    .join('・')
  const unusedText = kpis.unusedTotal == null ? '—' : formatNumber(kpis.unusedTotal)
  const archivedText = kpis.archivedTotal == null ? '—' : formatNumber(kpis.archivedTotal)
  const quotaPercent = quota && quota.limitBytes > 0
    ? Math.round((quota.usageBytes / quota.limitBytes) * 100)
    : null

  if (!urlReady || (detailId && (detailPhase === 'idle' || detailPhase === 'loading'))) {
    return <ListState kind="loading" title="メディアの詳細を読み込んでいます" />
  }

  if (detailId && (detailPhase === 'unavailable' || !detailsFor)) {
    // R588: 403は権限案内にする。押しても直らない再試行は出さない。
    if (detailFailure === 'denied') {
      return (
        <ListState
          kind="forbidden"
          title="メディアの詳細を見る権限がありません"
          description="見るには権限が要ります。オーナーか管理者に追加を依頼してください。"
          action={<Button type="button" onClick={() => setDetailUrl(null)}>登録メディア一覧へ戻る</Button>}
        />
      )
    }
    // R588: 503などの通信失敗は通信失敗と言い、同じIDで読み直せるようにする。
    if (detailFailure === 'retryable') {
      return (
        <ListState
          kind="error"
          title="表示できませんでした"
          description="通信が切れたか、サーバが応えませんでした。登録した内容は消えていません。"
          onRetry={retryDetail}
          action={<Button type="button" onClick={() => setDetailUrl(null)}>登録メディア一覧へ戻る</Button>}
        />
      )
    }
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
          notifyToast(message)
          void load()
          void loadKpis()
        }}
        onItemUpdated={(updated) => setDetailsFor(updated)}
      />
    )
  }

  /* 種類と状態の絞り込みのうち、絵の札（画像・どこでも使っていない）に無いものは「ほかの絞り込み」から選ぶ。 */
  const otherFilterValue = showArchivedOnly ? 'archived' : showNearLimitOnly ? 'near-limit'
    : kinds.size === 1 && !kinds.has('image') ? [...kinds][0] : ''
  const applyOtherFilter = (value: string) => {
    if (value === 'archived') applyArchivedFilter()
    else if (value === 'near-limit') applyNearLimitFilter()
    else if (value === 'video' || value === 'audio' || value === 'file') {
      setKinds(new Set([value as MediaItem['kind']]))
      setShowUnusedOnly(false)
      setShowNearLimitOnly(false)
      setShowArchivedOnly(false)
      setPage(1)
    } else {
      clearFilters()
    }
  }
  const kpiCards = [
    { key: 'total', title: '登録メディア', icon: Images, value: kpiTotalText === '—' ? null : (overallTotal ?? total), unit: '件', detail: kindBreakdown || '—（未取得）' },
    { key: 'unused', title: 'どこでも使っていない', icon: EyeOff, value: kpis.unusedTotal ?? null, unit: '件', detail: '消してよいか確かめられます' },
    { key: 'usage', title: '使っている容量', icon: HardDrive, value: null, valueText: quota ? formatMediaSize(quota.usageBytes) : undefined, unit: '', detail: quota && quotaPercent != null ? `上限 ${formatMediaSize(quota.limitBytes)} の ${quotaPercent}%` : '—（未取得）' },
    { key: 'archived', title: 'アーカイブ', icon: Archive, value: kpis.archivedTotal ?? null, unit: '件', detail: '一覧と新規選択から外したもの' },
  ]

  /* 登録と取得は担当者も使える（今と同じ）。消す・移す・名前を変えるは管理者だけ。 */
  const uploadButton = (
    <Button type="button" variant="primary" className="v8-folder-create w-full" onClick={() => setUploadOpen(true)}>
      <Plus size={15} aria-hidden="true" />メディアを登録する
    </Button>
  )
  const selectFolder = (id: string) => {
    setFolderFilter(id)
    setPage(1)
  }
  const mediaFolderRows = [
    // R38: 「すべて」は絞り込み前の総数。絞り込み後の件数を
    // 入れると「すべて0・未分類2」のように母集団が混ざる。
    // m26m: 一覧が読めていない（初回・失敗・別アカウント切替直後）の
    // total=0 は偽ゼロなので数えない（null は数を出さない約束）。
    { id: '', label: 'すべて', count: listKnown && !loadFailed ? (overallTotal ?? total) : null },
    ...folders.map((folder) => ({
      id: folder.id,
      label: folder.name,
      // #721: フォルダ件数はAPI(itemCount)をそのまま出す。kind=media
      // は件数未対応で来ないため「—」になる。読み込み済み範囲だけを
      // 数える計算は、黙って別の母集団にすり替わるため廃止。
      count: folder.itemCount ?? null,
      color: folder.color,
      // R37: 名前変更・削除を「…」へ接続する。権限の無い人には
      // 押して失敗する口を見せない。
      onEdit: canManageMedia ? () => setEditingFolder(folder) : undefined,
      onDelete: canManageMedia ? () => { setFolderError(''); setDeletingFolder(folder) } : undefined,
      deleteNote: '削除しても、中のメディアは未分類に残ります。',
    })),
    { id: UNGROUPED, label: '未分類', count: unfiledCount },
  ]

  return (
    <ListPage
      boardId="O7hUt7"
      headingSize="regular"
      title="登録メディア一覧"
      description="配信で使う画像・動画・音声・ファイルの置き場です。LINE アカウントごとに管理します。"
      tabs={!canManageMedia ? (
        <p className={styles.roBand} role="note">
          <Eye size={16} aria-hidden="true" />
          <span>{`閲覧のみで見ています。${managementPermissionReason}。`}</span>
        </p>
      ) : undefined}
      stats={(
        <KpiBand className={styles.kpiStrip} aria-label="登録メディアの集計">
          {kpiCards.map((card) => (
            <KpiCard
              key={card.key}
              presentation="band"
              title={card.title}
              icon={<card.icon size={13} aria-hidden="true" />}
              value={card.value}
              valueText={card.valueText}
              unit={card.value == null ? '' : card.unit}
              detail={card.detail}
            />
          ))}
        </KpiBand>
      )}
      folders={(
        <>
          {uploadButton}
          <FolderPanel
            /* m18s: 見出しの総数は「すべて」の行と同じ数なので出さない（回答フォーム #m18k と同じ形）。絞り込み後の件数は一覧側の ListRange に出す。 */
            activeId={folderFilter}
            onSelect={selectFolder}
            /* 閲覧のみ：フォルダを追加は置かない（理由は上の閲覧のみの帯で伝える。2026-10-06 オーナー決定）。 */
            onAddFolder={canManageMedia ? () => setAddingFolder(true) : undefined}
            rows={mediaFolderRows}
          >
            {folderFailure ? (
              <div role="alert">
                <p>
                  {folderForbidden
                    ? 'フォルダを見る権限がありません。オーナーか管理者に追加を依頼してください。'
                    : 'フォルダを読み込めませんでした。登録したメディアは消えていません。'}
                </p>
                {folderForbidden ? null : (
                  <Button type="button" onClick={() => void loadFolders()} disabled={folderReloading}>
                    {folderReloading ? '読み込んでいます' : 'もう一度読み込む'}
                  </Button>
                )}
              </div>
            ) : null}
            {folderError ? <p role="alert">{folderError}</p> : null}
            {addingFolder ? (
              <div>
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
                />
                <div>
                  <Button type="button" onClick={() => setAddingFolder(false)}>キャンセル</Button>
                  <Button type="button" variant="primary" onClick={() => void addFolder()} disabled={!folderName.trim() || savingFolder}>追加する</Button>
                </div>
              </div>
            ) : (
              <p>フォルダを消しても、中のメディアは未分類に残ります。</p>
            )}
          </FolderPanel>
        </>
      )}
      folderNav={{ rows: mediaFolderRows, activeId: folderFilter, onSelect: selectFolder, createAction: uploadButton }}
      toolbar={(
        <>
          <div className={styles.noticeRow}>
            <Notice tone="info">使っているメディアは消せません。いらなくなったら「アーカイブ」にすると一覧と新規選択から外れます（使っている場所や過去の配信はそのまま動きます）。</Notice>
            {error ? <Notice tone="danger" message={error} onClose={() => setError('')} /> : null}
            {!error && selectedAccountId ? <FileScanStoppedBanner accountId={selectedAccountId} /> : null}
            {/* 容量は数の帯に出す。案内は 80% を超えたとき・満杯・読めなかったときだけ（いつも出すと道具の段を押し下げる）。 */}
            {(quota && quota.state !== 'normal') || (!quota && quotaFailed) ? (
              <MediaQuotaGuidance quota={quota} failed={quotaFailed} onShowNearLimit={() => { applyNearLimitFilter() }} />
            ) : null}
          </div>
          <ListToolbar
            search={{
              placeholder: 'ファイル名で探す',
              label: 'ファイル名で探す',
              width: 258,
              value: query,
              onChange: (value) => {
                setQuery(value)
                setPage(1)
              },
            }}
            filters={(
              <div role="group" aria-label="種類と使い方で絞り込む" className={styles.chipGroup}>
                <FilterChip
                  selected={kinds.size === 1 && kinds.has('image') && !showArchivedOnly}
                  onChange={(selectedValue) => {
                    if (selectedValue) {
                      setKinds(new Set(['image']))
                      setShowNearLimitOnly(false)
                      setShowArchivedOnly(false)
                    } else {
                      setKinds(new Set(KINDS.map((kind) => kind.key)))
                    }
                    setPage(1)
                  }}
                >
                  {`画像${kpis.kindTotals.image == null ? '' : ` ${formatNumber(kpis.kindTotals.image as number)}`}`}
                </FilterChip>
                <FilterChip
                  selected={showUnusedOnly}
                  onChange={(selectedValue) => {
                    setShowUnusedOnly(selectedValue)
                    setShowNearLimitOnly(false)
                    setShowArchivedOnly(false)
                    setPage(1)
                  }}
                >
                  {`どこでも使っていない${kpis.unusedTotal == null ? '' : ` ${formatNumber(kpis.unusedTotal)}`}`}
                </FilterChip>
              </div>
            )}
            trailing={(
              <>
                <div className={styles.otherBox}>
                  <Select
                    aria-label="よく使う絞り込み"
                    value={otherFilterValue}
                    options={[
                      { value: '', label: 'よく使う絞り込み' },
                      ...KINDS.filter((kind) => kind.key !== 'image').map((kind) => ({ value: kind.key, label: `${kind.label}だけ` })),
                      { value: 'near-limit', label: '上限に近いものだけ' },
                      { value: 'archived', label: 'アーカイブ済みだけ' },
                      ...SORT_OPTIONS.map((option) => ({ value: `sort:${option.value}`, label: `並び：${option.label}${sort === option.value ? '（いま）' : ''}` })),
                    ]}
                    onChange={(value) => {
                      if (value.startsWith('sort:')) {
                        setSort(value.slice(5) as MediaSort)
                        setPage(1)
                        return
                      }
                      applyOtherFilter(value)
                    }}
                  />
                </div>
                <div role="group" aria-label="並べ方" className={styles.viewToggle}>
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
                      className={view === value ? `${styles.viewButton} ${styles.viewButtonActive}` : styles.viewButton}
                    >
                      <Icon aria-hidden="true" size={16} />
                    </button>
                  ))}
                </div>
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
              </>
            )}
          />
        </>
      )}
      pagination={(
        <div className={styles.footBlock}>
          <p className={styles.helpNote}>
            「…」から プレビュー・使用箇所を見る・名前を変える・フォルダへ移す・ダウンロード・アーカイブ・削除（使っているものは消せません）。
          </p>
          {listKnown && !loadFailed ? (
            <div className={styles.foot}>
              <div className={styles.footLeft}>
                <ListRange total={total} first={total === 0 ? 0 : (page - 1) * pageSize + 1} last={Math.min(page * pageSize, total)} />
                <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
                {canManageMedia ? (
                  <label className={styles.selectAll}>
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={() =>
                        setSelected((prev) => {
                          if (allSelected) return new Set<string>()
                          const next = new Set(prev)
                          for (const item of removable) next.add(item.id)
                          return next
                        })
                      }
                    />
                    すべてのメディアを選択
                  </label>
                ) : (
                  <span>{managementPermissionReason}。</span>
                )}
              </div>
            </div>
          ) : null}
          {canManageMedia ? (
            <BulkBar
              count={selected.size}
              hint="対象を確認してから操作を選んでください"
            >
              <Button type="button" variant="secondary" onClick={() => setSelected(new Set())}>
                選択を外す
              </Button>
              <Button type="button" variant="danger" onClick={() => void removeSelected()}>
                選択したメディアを削除
                {selected.size > 0 && <span>（{selected.size}）</span>}
              </Button>
            </BulkBar>
          ) : null}
        </div>
      )}
      overlays={(
        <>
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
          <div>
            <p>
              {impact && !impact.canDelete ? '使用先から外すと削除できます' : ''}
            </p>
            <div>
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
                <Button type="button" variant="primary" onClick={() => void confirmDeleteOne()} busy={deleteBusy} busyLabel="処理中…">削除する
                </Button>
              ) : null}
            </div>
          </div>
        }
      >
        <div data-design-node="YfTfJ">
        {impactPhase === 'loading' ? (
          <p>使われている場所を確認しています…</p>
        ) : impactPhase === 'error' ? (
          <div>
            <p role="alert">
              使われている場所を確認できませんでした。読み直してから、もう一度お試しください。
            </p>
            {/* R34: 詳細と同じように、確認時刻と読み直しを一覧でも出す。 */}
            <Button type="button" onClick={() => { if (deleting) void openDelete(deleting) }}>読み直す</Button>
          </div>
        ) : impact ? (
          <div>
            <p>
              {usageText(impact)}
              {blockedReason(impact) ? ` ${blockedReason(impact)}` : ''}
            </p>
            {impact.verified === false ? (
              <div>
                <Button type="button" onClick={() => { if (deleting) void openDelete(deleting) }}>読み直す</Button>
              </div>
            ) : null}

            {impact.references.length > 0 ? (
              <div>
                <p>使われている場所</p>
                <ul>
                  {impact.references.map((ref: MediaDeleteImpactReference, index: number) => (
                    <li key={`${ref.kind}-${index}`}>
                      <span>
                        <span>{referenceKindText(ref.kind)}</span>
                        <span>「{referenceNameText(ref)}」</span>
                      </span>
                      {/* 開ける先があるときだけリンクにする。無い画面へ送らない。 */}
                      {ref.href ? (
                        <a href={ref.href}>ここを開く</a>
                      ) : (
                        <span>開けません</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <p>
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
          <div>
            <Button type="button" onClick={() => setBulkConfirm(null)} disabled={bulkBusy}>
              キャンセル
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={bulkBusy}
              onClick={() => void runBulkDelete(bulkConfirm ?? [])} busy={bulkBusy} busyLabel="処理中…">削除する
            </Button>
          </div>
        }
      >
        <p>
          使われている場所があるものは、はじめから選べません。消したあとは元に戻せません。
        </p>
        {bulkBusy && bulkProgress ? (
          <p aria-live="polite">
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
          <div>
            <Button type="button" onClick={() => setArchiveTarget(null)} disabled={archiveBusy}>
              キャンセル
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={archiveBusy || !archiveReason.trim()}
              onClick={() => void confirmArchiveChange()} busy={archiveBusy} busyLabel="処理中…">
              {archiveTarget?.mode === 'archive' ? 'アーカイブする' : '一覧へ戻す'}
            </Button>
          </div>
        }
      >
        <label>
          <span>理由<RequiredBadge /><span>（あとから履歴で確認できます）</span></span>
          <input
            type="text"
            autoFocus
            value={archiveReason}
            onChange={(event) => setArchiveReason(event.target.value)}
            placeholder={archiveTarget?.mode === 'archive' ? '例：古いキャンペーンの素材のため' : '例：再び使うため'}
            aria-label="理由"
          />
        </label>
      </Dialog>

      {/*
        フォルダへ移す窓。移し先だけを選ぶ。未分類へ戻すときは空を選ぶ。
        二重押しは止め、確定するまで窓は閉じない。
      */}
      <Dialog
        open={moveTarget !== null}
        title={moveTarget ? `「${moveTarget.filename}」をフォルダへ移しますか？` : ''}
        description="中のメディアはそのまま残り、しまう場所だけが変わります。"
        busy={moveBusy}
        error={moveError || undefined}
        onCancel={() => {
          if (moveBusy) return
          setMoveTarget(null)
        }}
        footer={
          <div>
            <Button type="button" onClick={() => setMoveTarget(null)} disabled={moveBusy}>
              キャンセル
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={moveBusy}
              onClick={() => void confirmMove()} busy={moveBusy} busyLabel="処理中…">
              移す
            </Button>
          </div>
        }
      >
        <div className={styles.moveField}>
          <span className={styles.moveLabel}>移し先のフォルダ</span>
          <Select
            aria-label="移し先のフォルダ"
            value={moveFolderId}
            options={[
              { value: '', label: '未分類' },
              ...folders.map((folder) => ({ value: folder.id, label: folder.name })),
            ]}
            onChange={(value) => setMoveFolderId(value)}
          />
        </div>
      </Dialog>

      <MediaUploadDialog
        open={uploadOpen}
        accountId={selectedAccountId}
        folders={folders}
        initialFolderId={folderFilter}
        // 左の列の「フォルダを追加」と同じ口・同じ権限。作ったフォルダは左の列にも足す。
        onCreateFolder={canManageMedia
          ? folderCreator((name, color) => api.folders.create({ kind: 'media', name, color }), folderById, (created) => setFolders((current) => [...current, created]))
          : undefined}
        onClose={() => setUploadOpen(false)}
        onComplete={() => {
          notifyToast('登録できたメディアを一覧へ反映しました。')
          void load()
          void loadKpis()
        }}
      />

      <MediaReplacementDialog
        source={replacementFor}
        accountId={selectedAccountId}
        onClose={() => setReplacementFor(null)}
        onComplete={(message) => {
          setReplacementFor(null)
          notifyToast(message)
          void load()
        }}
      />

      {editingFolder && (
        <FolderAddDialog
          kind="media"
          folder={editingFolder}
          accountId={selectedAccountId}
          note="メディアを分けてしまう箱です。削除しても、中のメディアは未分類に残ります。"
          placeholder="例: 01_商品写真"
          onClose={() => setEditingFolder(null)}
          onAdded={() => { setEditingFolder(null); void load() }}
        />
      )}

      {/*
        R37: 消す前に、中身がどうなるかを本文で読ませる。
        「中身は未分類に戻ります」の確認を ConfirmDialog で行う。
      */}
      <ConfirmDialog
        open={deletingFolder !== null}
        title={`フォルダ「${deletingFolder?.name ?? ''}」を削除しますか？`}
        description={deletingFolder?.itemCount != null
          ? `削除しても、中のメディアは未分類に残ります。いまこのフォルダに入っているのは${deletingFolder.itemCount}件です。`
          : '削除しても、中のメディアは未分類に残ります。'}
        confirmLabel="削除する"
        destructive
        busy={folderBusy}
        error={folderError || undefined}
        onCancel={() => { if (!folderBusy) { setDeletingFolder(null); setFolderError('') } }}
        onConfirm={() => void removeFolder()}
      />

      {preview && (
        <MediaPreviewOverlay
          filename={preview.filename}
          kind={preview.kind}
          src={displaySrc(preview)}
          onClose={() => setPreview(null)}
        />
      )}
        </>
      )}
    >
      {!selectedAccountId && !accountLoading ? (
        <ListState kind="empty" title="LINEアカウントを選択してください" description="登録メディアはLINEアカウントごとに管理します。" />
      ) : null}
          {listKnown && !loadFailed && total > 200 ? (
            <p className={styles.moreNote}>200件を超えるメディアも、ページを移動してすべて確認できます。</p>
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
            <div>
              {/*
                R38: まだ1件も無いときと、絞り込みで0件のときを分ける。
                `total` は絞り込み後の件数のため、絞り込みの有無も見る。
                絞り込みの0件に作る口を出すと、保存済みが消えたと誤読される。
                代わりに「条件を外す」を置く。
              */}
              <EmptyList
                icon={<Images aria-hidden="true" />}
                title="まだメディアがありません"
                description="配信で使う画像・動画・音声・ファイルを置いておきます。"
                create={{ label: '最初のメディアを登録する', onClick: () => setUploadOpen(true) }}
                filtered={hasFilter}
                onClearFilters={clearFilters}
                filteredDescription="種類、フォルダ、検索を外すと、すべて出ます"
              />
            </div>
          ) : (
            <div className={view === 'grid' ? styles.cards : styles.rows}>
              {current.map((item) => (
                <MediaCardV8
                  key={item.id}
                  item={item}
                  view={view}
                  displaySrc={displaySrc(item)}
                  kindLabel={KINDS.find((k) => k.key === item.kind)?.label ?? 'ファイル'}
                  folder={folderDotOf(item.folderId)}
                  canManageMedia={canManageMedia}
                  managementPermissionReason={managementPermissionReason}
                  selected={selected.has(item.id)}
                  downloading={downloadingIds.has(item.id)}
                  menuOpen={openMenuId === item.id}
                  renaming={renaming?.id === item.id ? renaming : null}
                  renamingBusy={renamingBusy}
                  renameError={renameError}
                  onToggleSelect={() =>
                    setSelected((prev) => {
                      const next = new Set(prev)
                      if (next.has(item.id)) next.delete(item.id)
                      else next.add(item.id)
                      return next
                    })
                  }
                  onPreview={() => setPreview(item)}
                  onToggleMenu={() => setOpenMenuId((currentId) => (currentId === item.id ? null : item.id))}
                  onCloseMenu={() => setOpenMenuId(null)}
                  onDetail={() => setDetailUrl(item.id)}
                  onDownload={() => { void downloadItem(item) }}
                  onRenameStart={() => { setRenameError(''); setRenaming({ id: item.id, value: item.filename }) }}
                  onRenameCancel={() => setRenaming(null)}
                  onRenameChange={(value) => setRenaming({ id: item.id, value })}
                  onRenameConfirm={() => { void rename() }}
                  onMoveStart={() => { setMoveError(''); setMoveFolderId(item.folderId ?? ''); setMoveTarget(item) }}
                  onArchiveStart={() => { setArchiveError(''); setArchiveReason(''); setArchiveTarget({ item, mode: item.archivedAt ? 'restore' : 'archive' }) }}
                  onDeleteStart={() => { void openDelete(item) }}
                  onReplaceStart={() => {
                    closeDeleteDialog()
                    setReplacementFor(item)
                  }}
                />
              ))}
            </div>
          )}
    </ListPage>
  )
}

type MediaCardV8Props = {
  item: MediaItem
  view: MediaView
  displaySrc: string
  kindLabel: string
  /** 名前の前の丸に出すフォルダ（左のフォルダの列と同じもの）。未分類は null。 */
  folder: FolderDotFolder | null
  canManageMedia: boolean
  managementPermissionReason: string
  selected: boolean
  downloading: boolean
  menuOpen: boolean
  renaming: { id: string; value: string } | null
  renamingBusy: boolean
  renameError: string
  onToggleSelect: () => void
  onPreview: () => void
  onToggleMenu: () => void
  onCloseMenu: () => void
  onDetail: () => void
  onDownload: () => void
  onRenameStart: () => void
  onRenameCancel: () => void
  onRenameChange: (value: string) => void
  onRenameConfirm: () => void
  onMoveStart: () => void
  onArchiveStart: () => void
  onDeleteStart: () => void
  onReplaceStart: () => void
}

/*
 * ★V8 の札1枚。載せる中身は v6 の札と同じ（縮小画像・種別の札・退避の札・
 * ファイル名・形式と容量・使用先・名前の直し）。
 * 操作は「…」の中へ集める。使うものは消せない約束も v6 と同じ。
 * 退避済みは編集・削除の押し口を出さず、戻す口だけを残す。
 * 読み取り専用の人にも「…」でプレビューとダウンロードを渡す。
 */
function MediaCardV8({
  item,
  view,
  displaySrc,
  kindLabel,
  folder,
  canManageMedia,
  managementPermissionReason,
  selected,
  downloading,
  menuOpen,
  renaming,
  renamingBusy,
  renameError,
  onToggleSelect,
  onPreview,
  onToggleMenu,
  onCloseMenu,
  onDetail,
  onDownload,
  onRenameStart,
  onRenameCancel,
  onRenameChange,
  onRenameConfirm,
  onMoveStart,
  onArchiveStart,
  onDeleteStart,
  onReplaceStart,
}: MediaCardV8Props) {
  const selectTitle = item.archivedAt
    ? '退避済みは削除できません。一覧へ戻してから削除してください'
    : item.usageCount == null
      ? '使用先を確認できないため選べません'
      : item.usageCount > 0
        ? '使用先から外すまで削除できません'
        : undefined
  return (
    <div className={view === 'grid' ? styles.card : styles.row}>
      <button
        onClick={onPreview}
        title="プレビューを見る"
        aria-label={`${item.filename}のプレビューを見る`}
        className={view === 'grid' ? styles.thumbButton : `${styles.thumbButton} ${styles.thumbNarrow}`}
      >
        {item.kind === 'image' ? (
          <MediaThumbV8 src={displaySrc} alt={item.filename} />
        ) : (
          <span className={styles.thumbLabel}>
            {item.kind === 'video' ? '動画' : item.kind === 'audio' ? '音声' : 'ファイル'}
          </span>
        )}
      </button>

      <div className={view === 'grid' ? styles.cardBody : styles.rowBody}>
        {renaming ? (
          <div className={styles.renameBox}>
            <input
              type="text"
              autoFocus
              value={renaming.value}
              onChange={(e) => onRenameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onRenameConfirm()
                if (e.key === 'Escape') onRenameCancel()
              }}
              aria-label="ファイル名"
              className={styles.renameInput}
            />
            {renameError && (
              <p className={styles.renameError} role="alert">{renameError}</p>
            )}
            <div className={styles.renameActions}>
              <Button variant="secondary" onClick={onRenameCancel} disabled={renamingBusy}>
                キャンセル
              </Button>
              <Button variant="primary" onClick={onRenameConfirm} disabled={renamingBusy}>
                {renamingBusy ? '保存中…' : '保存する'}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <span className={styles.nameRow}>
              {canManageMedia ? (
                <Checkbox
                  checked={selected}
                  disabled={!isKnownUnused(item) || !!item.archivedAt}
                  onCheckedChange={onToggleSelect}
                  aria-label={`${item.filename}を選ぶ`}
                  title={selectTitle}
                />
              ) : null}
              {item.archivedAt ? (
                <span
                  className={styles.archivedBadge}
                  title={item.archiveReason ? `退避の理由：${item.archiveReason}` : '退避済み'}
                >
                  退避済み
                </span>
              ) : null}
              <span className={styles.nameDot}>
                <FolderDot folder={folder} />
              </span>
              <span className={styles.fileName} title={item.filename}>
                {item.filename}
              </span>
            </span>
            <p className={styles.meta} title={formatMediaDetails(item)}>
              {`${kindLabel}・${formatMediaSize(item.sizeBytes)}`}
            </p>
            <p className={item.usageCount === undefined || item.usageCount === 0 ? `${styles.usage} ${styles.usageIdle}` : `${styles.usage} ${styles.usageUsed}`}>
              {item.usageCount === undefined
                ? '使用先：確かめられません'
                : item.usageCount === 0
                  ? '使用先：どこでも使っていない'
                  : `使用先：${item.usageCount} か所`}
            </p>
          </>
        )}

        <div className={styles.cardFoot}>
          <span className={styles.menuWrap} title={canManageMedia ? undefined : managementPermissionReason}>
            <RowMenu
              appearance="plain"
              label={`${item.filename}のその他操作`}
              menuLabel={`${item.filename}の操作`}
              open={menuOpen}
              onOpenChange={(next) => (next ? onToggleMenu() : onCloseMenu())}
              triggerProps={{ 'data-qa-open': 'YfTfJ' }}
              items={[
                {
                  id: 'preview',
                  label: 'プレビュー',
                  onSelect: onPreview,
                },
                ...(canManageMedia
                  ? [{ id: 'detail', label: '使用箇所を見る', onSelect: onDetail }]
                  : []),
                ...(canManageMedia && !item.archivedAt
                  ? [{ id: 'rename', label: '名前を変える', onSelect: onRenameStart }]
                  : []),
                ...(canManageMedia && !item.archivedAt
                  ? [{ id: 'move', label: 'フォルダへ移す', onSelect: onMoveStart }]
                  : []),
                {
                  id: 'download',
                  label: downloading ? '取得中…' : 'ダウンロード',
                  disabled: downloading,
                  disabledReason: downloading ? 'ファイルを取り出しています' : undefined,
                  onSelect: onDownload,
                },
                ...(canManageMedia
                  ? [{ id: 'archive', label: item.archivedAt ? '一覧へ戻す' : 'アーカイブ', onSelect: onArchiveStart }]
                  : []),
                // 削除確認の窓の撮影は「…」→この項目の2手で開ける。
                ...(canManageMedia && !item.archivedAt
                  ? [{ id: 'delete', label: '削除する', tone: 'danger' as const, dividerBefore: true, qaOpen: 'YfTfJ', onSelect: onDeleteStart }]
                  : []),
                ...(canManageMedia && !item.archivedAt
                  ? [{ id: 'replace', label: '別のメディアに差し替える', onSelect: onReplaceStart }]
                  : []),
              ]}
            />
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * 一覧の縮小画像。読み込めないとき、ブラウザの壊れた画像の印と
 * ファイル名（代替文字）が枠からはみ出さないよう種類の文字に切り替える。
 */
function MediaThumbV8({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <span className={styles.thumbLabel}>画像を表示できません</span>
  // 静的書き出しのため next/image の最適化は使えない。
  // 一覧20件の同時取得を避けるため遅延読み込みにする。
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} className={styles.thumbImage} />
}
