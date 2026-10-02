'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ApiError, api, type ManualLink } from '@/lib/api'
import {
  STATUS_FILTERS,
  brokenNotice,
  canEditTable,
  manualLinkRow,
  matchesQuery,
  matchesStatus,
  type StatusFilter,
} from './manual-link-view'

/**
 * マニュアルの正本表の状態と操作。V7・V8 のどちらの描画からも同じ口で使う。
 * 権限の判定・確かめる・直す・保存はここに1つだけ置く。
 */
export function useManualLinks() {
  const [staff, setStaff] = useState<{ id: string; role: string | null; permissionKeys: string[] } | null>(null)
  const [links, setLinks] = useState<ManualLink[]>([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [checking, setChecking] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editingUrl, setEditingUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<StatusFilter>('all')
  /** 「確かめる」「保存」の失敗。無言にせず、やり直しの手がかりと一緒に残す。 */
  const [actionError, setActionError] = useState('')

  /*
   * #975 U071: 初回の読み込み失敗にも再試行を付ける。
   * useEffect からもエラー状態のボタンからも同じ入口で読み直す。
   */
  const loadInitial = useCallback(async (alive: () => boolean) => {
    setStatus('loading')
    try {
      const [staffResponse, manualLinks] = await Promise.all([api.staff.me(), api.manualLinks.list()])
      if (!alive()) return
      if (!staffResponse.success || !manualLinks.success) {
        setStatus('error')
        return
      }
      setStaff({
        id: staffResponse.data?.id ?? '',
        role: staffResponse.data?.role ?? null,
        permissionKeys: staffResponse.data?.permissionKeys ?? [],
      })
      setLinks(manualLinks.data.items)
      setTotal(manualLinks.data.total)
      setStatus('ready')
    } catch {
      if (alive()) setStatus('error')
    }
  }, [])

  useEffect(() => {
    let alive = true
    void loadInitial(() => alive)
    return () => {
      alive = false
    }
  }, [loadInitial])

  const rows = useMemo(() => links.map(manualLinkRow), [links])
  const shown = rows.filter((r) => matchesStatus(r, filter) && matchesQuery(r, query))
  const notice = brokenNotice(rows)

  const checkAll = async () => {
    if (checking) return
    setChecking(true)
    setActionError('')
    try {
      const result = await api.manualLinks.check()
      if (!result.success) {
        setActionError(result.error)
        return
      }
      const refreshed = await api.manualLinks.list()
      if (refreshed.success) {
        setLinks(refreshed.data.items)
        setTotal(refreshed.data.total)
      } else {
        setActionError(refreshed.error)
      }
    } catch {
      setActionError('確かめられませんでした。通信状態を確認して、もう一度お試しください。')
    } finally {
      setChecking(false)
    }
  }

  const startEdit = (key: string) => {
    const link = links.find((item) => item.key === key)
    if (!link) return
    setEditingKey(key)
    setEditingUrl(link.url ?? '')
  }

  const saveEdit = async () => {
    if (!editingKey || saving) return
    const current = links.find((item) => item.key === editingKey)
    if (!current) return
    setSaving(true)
    setActionError('')
    try {
      const result = await api.manualLinks.update(editingKey, {
        url: editingUrl.trim() || null,
        expectedVersion: current.version,
      })
      if (!result.success) {
        setActionError(result.error)
        return
      }
      setLinks((items) => items.map((item) => item.key === editingKey ? result.data : item))
      setEditingKey(null)
    } catch (error) {
      // ほかの人が先に変えたときは編集中身を残し、最新を読み直す。
      if (error instanceof ApiError && error.status === 409) {
        setActionError('ほかの人が先に変更しました。最新の内容を読み直したので、確認してもう一度保存してください。')
        try {
          const refreshed = await api.manualLinks.list()
          if (refreshed.success) {
            setLinks(refreshed.data.items)
            setTotal(refreshed.data.total)
          }
        } catch {
          // 読み直しに失敗しても編集中身は残す。
        }
        return
      }
      if (error instanceof ApiError && error.status === 403) {
        setActionError('この表を直す権限がありません。運営に依頼してください。')
        return
      }
      setActionError('保存できませんでした。通信状態を確認して、もう一度お試しください。')
    } finally {
      setSaving(false)
    }
  }

  return {
    staff,
    rows,
    shown,
    total,
    status,
    checking,
    editingKey,
    editingUrl,
    setEditingUrl,
    saving,
    query,
    setQuery,
    filter,
    setFilter,
    actionError,
    notice,
    canEdit: canEditTable(staff),
    loadInitial,
    checkAll,
    startEdit,
    cancelEdit: () => setEditingKey(null),
    saveEdit,
    statusFilters: STATUS_FILTERS,
  }
}
