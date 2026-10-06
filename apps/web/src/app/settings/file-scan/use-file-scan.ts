'use client'

import { useCallback, useDeferredValue, useEffect, useState } from 'react'
import { ApiError, api, type FileScanConfig, type FileScanItem } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'

/** 一覧の1ページの件数。先頭50件固定だった監査 R132 の名残を残さない。 */
export const FILE_SCAN_PAGE_SIZE = 50

export type FileScanPhase = 'loading' | 'ready' | 'error' | 'forbidden'

/**
 * ファイルの検査（B-2）の状態と操作。V7・V8 のどちらの描画からも同じ口で使う。
 * 権限・一覧・戻す・消す・外の検査の設定はここに1つだけ置く。
 */
export function useFileScan() {
  const { selectedAccountId } = useAccount()
  const [phase, setPhase] = useState<FileScanPhase>('loading')
  const [items, setItems] = useState<FileScanItem[]>([])
  const [total, setTotal] = useState(0)
  const [statusFilter, setStatusFilter] = useState('quarantined')
  /** 板 `PfA4o` の札の件数。検索語を含めた今の条件での総数。 */
  const [counts, setCounts] = useState({ quarantined: 0, pending: 0, released: 0 })
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [page, setPage] = useState(1)
  const [actionError, setActionError] = useState('')
  const [actionDone, setActionDone] = useState('')
  const [releaseTarget, setReleaseTarget] = useState<FileScanItem | null>(null)
  const [releaseReason, setReleaseReason] = useState('')
  const [releaseBusy, setReleaseBusy] = useState(false)
  /* 監査 D017: 確認窓の中で起きた失敗は窓の中に出す。ページ最上部の帯は
   * 暗転の後ろに隠れて読めないため、ConfirmDialog の error へ渡す。 */
  const [releaseError, setReleaseError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<FileScanItem | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [config, setConfig] = useState<FileScanConfig | null>(null)
  const [configOpen, setConfigOpen] = useState(false)
  const [provider, setProvider] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [secretRef, setSecretRef] = useState('')
  const [configBusy, setConfigBusy] = useState(false)
  const [stopExternal, setStopExternal] = useState(false)
  const [stopError, setStopError] = useState('')

  // 外の検査の設定が保存前なら離脱の番兵を出す。
  const configDirty = configOpen && (
    (provider.trim() || null) !== (config?.externalProvider ?? null)
    || (endpoint.trim() || null) !== (config?.externalEndpointUrl ?? null)
    || (secretRef.trim() || null) !== (config?.externalSecretRef ?? null)
  )
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty: configDirty, busy: configBusy })

  const load = useCallback(async () => {
    if (!selectedAccountId) {
      setPhase('ready')
      setItems([])
      setTotal(0)
      setCounts({ quarantined: 0, pending: 0, released: 0 })
      return
    }
    setPhase('loading')
    setActionError('')
    try {
      const trimmedQuery = deferredQuery.trim() || undefined
      const [me, list, configRes, quarantinedRes, pendingRes, releasedRes] = await Promise.all([
        api.staff.me(),
        api.fileScan.list(selectedAccountId, {
          status: statusFilter,
          q: trimmedQuery,
          limit: FILE_SCAN_PAGE_SIZE,
          offset: (page - 1) * FILE_SCAN_PAGE_SIZE,
        }),
        api.fileScan.getConfig(selectedAccountId),
        api.fileScan.list(selectedAccountId, { status: 'quarantined', q: trimmedQuery, limit: 1 }),
        api.fileScan.list(selectedAccountId, { status: 'pending', q: trimmedQuery, limit: 1 }),
        api.fileScan.list(selectedAccountId, { status: 'released', q: trimmedQuery, limit: 1 }),
      ])
      if (!me.success || !list.success || !configRes.success) {
        setPhase('error')
        return
      }
      setCounts({
        quarantined: quarantinedRes.success ? quarantinedRes.data.total : 0,
        pending: pendingRes.success ? pendingRes.data.total : 0,
        released: releasedRes.success ? releasedRes.data.total : 0,
      })
      if (me.data.role !== 'owner' && me.data.role !== 'admin') {
        setPhase('forbidden')
        return
      }
      setItems(list.data.items)
      setTotal(list.data.total)
      /* 消す・戻すで今のページが空になったら1ページ目へ戻す（監査 R132）。 */
      if (list.data.items.length === 0 && page > 1) setPage(1)
      setConfig(configRes.data.config)
      setProvider(configRes.data.config?.externalProvider ?? '')
      setEndpoint(configRes.data.config?.externalEndpointUrl ?? '')
      setSecretRef(configRes.data.config?.externalSecretRef ?? '')
      setPhase('ready')
    } catch {
      setPhase('error')
    }
  }, [selectedAccountId, statusFilter, deferredQuery, page])

  useEffect(() => {
    void load()
  }, [load])

  async function release() {
    if (!selectedAccountId || !releaseTarget) return
    /* 監査 D018: 必須の理由が空なら送らず、窓の中で理由を促す。 */
    if (!releaseReason.trim()) {
      setReleaseError('理由を入力してください')
      return
    }
    setReleaseBusy(true)
    setReleaseError('')
    try {
      const res = await api.fileScan.release(releaseTarget.id, selectedAccountId, releaseReason.trim())
      if (!res.success) {
        setReleaseError('戻せませんでした。通信状態を確認して、もう一度お試しください。')
        return
      }
      setReleaseTarget(null)
      setReleaseReason('')
      setReleaseError('')
      setActionDone(`${releaseTarget.filename} を使えるように戻しました。`)
      await load()
    } catch (caught) {
      setReleaseError(caught instanceof ApiError && caught.status === 409
        ? 'しまったファイルだけ戻せます。一覧を読み直してください。'
        : '戻せませんでした。通信状態を確認して、もう一度お試しください。')
    } finally {
      setReleaseBusy(false)
    }
  }

  async function remove() {
    if (!selectedAccountId || !deleteTarget) return
    setDeleteBusy(true)
    setDeleteError('')
    try {
      const res = await api.fileScan.remove(deleteTarget.id, selectedAccountId)
      if (!res.success) {
        setDeleteError('消せませんでした。通信状態を確認して、もう一度お試しください。')
        return
      }
      setDeleteTarget(null)
      setDeleteError('')
      setActionDone(`${deleteTarget.filename} を消しました。`)
      await load()
    } catch (caught) {
      setDeleteError(caught instanceof ApiError && caught.status === 409
        ? 'しまった・使えないファイルだけ消せます。一覧を読み直してください。'
        : '消せませんでした。通信状態を確認して、もう一度お試しください。')
    } finally {
      setDeleteBusy(false)
    }
  }

  async function saveConfig() {
    if (!selectedAccountId) return
    setConfigBusy(true)
    setActionError('')
    try {
      const res = await api.fileScan.saveConfig(selectedAccountId, {
        externalProvider: provider.trim() || null,
        externalEndpointUrl: endpoint.trim() || null,
        externalSecretRef: secretRef.trim() || null,
      })
      if (!res.success) {
        setActionError('設定を保存できませんでした。')
        return
      }
      setConfigOpen(false)
      setActionDone('外の検査の設定を保存しました。')
      await load()
    } catch (caught) {
      setActionError(caught instanceof ApiError && caught.status === 400
        ? '宛先は https にし、提供元と宛先の両方を入れてください。'
        : '設定を保存できませんでした。通信状態を確認して、もう一度お試しください。')
    } finally {
      setConfigBusy(false)
    }
  }

  /*
   * 監査 R133: 「止める」は表示を畳むのではなく、保存済みの設定を
   * 実際に消す。空に保存すると送信は止まる（部分だけの空はAPIが弾く）。
   */
  async function stopExternalConfig() {
    if (!selectedAccountId) return
    setConfigBusy(true)
    setStopError('')
    try {
      const res = await api.fileScan.saveConfig(selectedAccountId, {
        externalProvider: null,
        externalEndpointUrl: null,
        externalSecretRef: null,
      })
      if (!res.success) {
        setStopError('設定を消せませんでした。')
        return
      }
      setStopExternal(false)
      setStopError('')
      setConfigOpen(false)
      setActionDone('外の検査サービスへの送信を止めました。内蔵の簡易検査は続きます。')
      await load()
    } catch {
      setStopError('設定を消せませんでした。通信状態を確認して、もう一度お試しください。')
    } finally {
      setConfigBusy(false)
    }
  }

  /* 開き直す時は保存済みの値へ戻す。編集中の置き去りを残さない。 */
  function toggleConfigOpen() {
    if (!configOpen) {
      setProvider(config?.externalProvider ?? '')
      setEndpoint(config?.externalEndpointUrl ?? '')
      setSecretRef(config?.externalSecretRef ?? '')
    }
    setConfigOpen(!configOpen)
  }

  function changeQuery(next: string) {
    setQuery(next)
    setPage(1)
  }

  function changeStatusFilter(next: string) {
    setStatusFilter(next)
    setPage(1)
  }

  return {
    selectedAccountId,
    phase,
    items,
    total,
    counts,
    statusFilter,
    query,
    page,
    setPage,
    actionError,
    actionDone,
    releaseTarget,
    setReleaseTarget,
    releaseReason,
    setReleaseReason,
    releaseBusy,
    releaseError,
    setReleaseError,
    deleteTarget,
    setDeleteTarget,
    deleteBusy,
    deleteError,
    setDeleteError,
    config,
    configOpen,
    provider,
    setProvider,
    endpoint,
    setEndpoint,
    secretRef,
    setSecretRef,
    configBusy,
    stopExternal,
    setStopExternal,
    stopError,
    setStopError,
    leaveTarget,
    confirmLeave,
    cancelLeave,
    load,
    release,
    remove,
    saveConfig,
    stopExternalConfig,
    toggleConfigOpen,
    changeQuery,
    changeStatusFilter,
  }
}
