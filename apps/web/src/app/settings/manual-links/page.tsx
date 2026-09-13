'use client'

import { useEffect, useMemo, useState } from 'react'
import { ApiError, api, type ManualLink } from '@/lib/api'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import ListToolbar from '@/components/shared/list-toolbar'
import SelectField from '@/components/shared/select-field'
import StatusBadge from '@/components/shared/status-badge'
import { DataTable, Td, Th, TableHeadRow, Tr } from '@/components/shared/table'
import { usePageTitle } from '@/components/shell/page-chrome'
import {
  LINK_STATUS_LABEL,
  STATUS_FILTERS,
  VERIFY_SCHEDULE_NOTE,
  type StatusFilter,
  brokenNotice,
  canEditTable,
  checkedLabel,
  manualLinkRow,
  matchesQuery,
  matchesStatus,
  urlLabel,
} from './manual-link-view'
import styles from './manual-links.module.css'

/**
 * 設計 ★V6 34-4「マニュアルの正本表」（`f9oUm`、運営側）。
 *
 * **お客さまの組織からは見えない。** 統括だけが開ける。
 */
export default function ManualLinksPage() {
  /*
    トップバーの画面名。`/settings/` で始まるので、そのままだと
    メニューの「機能設定」が出てしまう。設計 `f9oUm` は「マニュアル」。
  */
  usePageTitle('マニュアルの正本表')
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

  useEffect(() => {
    let alive = true
    void Promise.all([api.staff.me(), api.manualLinks.list()])
      .then(([staffResponse, manualLinks]) => {
        if (!alive) return
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
      })
      .catch(() => {
        if (alive) setStatus('error')
      })
    return () => {
      alive = false
    }
  }, [])

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

  if (status !== 'ready') {
    return <ListState kind={status === 'error' ? 'error' : 'loading'} />
  }

  if (!canEditTable(staff)) {
    return (
      <ListState
        kind="forbidden"
        title="この表は運営だけが見られます"
        description="画面のトップバーにある「マニュアル」の行き先を決める表です。変えたいときは運営に頼んでください。"
      />
    )
  }

  return (
    <div className={styles.page}>
      <div role="note">
        <strong>この表を直せるのは運営だけです</strong>
        <span>画面のトップバーにある「マニュアル」は、ここで決めた行き先を開きます。表を直すと、その画面のマニュアルの行き先が変わります。お客さまの組織からは見えません。</span>
      </div>

      <ListToolbar
        searchPlaceholder="画面ID・画面名で検索"
        searchValue={query}
        onSearchChange={setQuery}
      >
        <SelectField
          aria-label="リンクの状態"
          value={filter}
          onChange={(event) => setFilter(event.target.value as StatusFilter)}
          options={STATUS_FILTERS.map((f) => ({ value: f.value, label: `状態：${f.label}` }))}
        />
        <Button disabled={checking} onClick={() => void checkAll()}>
          {checking ? '確かめています…' : 'いま全部を確かめる'}
        </Button>
      </ListToolbar>

      {actionError && (
        <p role="alert" className={styles.actionError}>
          {actionError}
        </p>
      )}

      <div data-manual-table-title>
        <strong>画面とマニュアルの対応 {total}件</strong>
        {notice ? <em>{notice}</em> : null}
      </div>

      {shown.length === 0 ? (
        <ListState
          kind="empty"
          title="当てはまる行がありません"
          description="検索の言葉か、状態の絞り込みを変えてください。"
        />
      ) : (
        <DataTable>
          <colgroup>
            <col style={{ width: '9%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '34%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '9%' }} />
          </colgroup>
          <thead>
            <TableHeadRow>
              <Th>画面ID</Th>
              <Th>画面名</Th>
              <Th>公式記事のURL</Th>
              <Th>最後に確かめた日</Th>
              <Th>リンクの状態</Th>
              <Th>操作</Th>
            </TableHeadRow>
          </thead>
          <tbody>
            {shown.map((row) => {
              const key = row.taskId ?? row.screenId
              const editing = editingKey === key
              return (
              <Tr key={key}>
                <Td>{row.screenId}</Td>
                <Td>{row.name}</Td>
                <Td>
                  {editing ? (
                    <input
                      style={{ width: '100%', minWidth: 0, padding: '7px 9px' }}
                      aria-label={`${row.name}の公式記事URL`}
                      value={editingUrl}
                      onChange={(event) => setEditingUrl(event.target.value)}
                    />
                  ) : (
                    <span className={row.url ? styles.url : styles.urlEmpty} title={row.url || undefined}>
                      {urlLabel(row.url)}
                    </span>
                  )}
                </Td>
                <Td>{checkedLabel(row.checkedAt)}</Td>
                <Td>
                  <StatusBadge
                    tone={row.status === 'ok' ? 'success' : row.status === 'broken' ? 'danger' : 'neutral'}
                    size="compact"
                  >
                    {LINK_STATUS_LABEL[row.status]}
                  </StatusBadge>
                </Td>
                <Td>
                  {editing ? (
                    <>
                      <Button disabled={saving} onClick={() => void saveEdit()}>保存</Button>
                      <Button disabled={saving} onClick={() => setEditingKey(null)}>やめる</Button>
                    </>
                  ) : (
                    <Button onClick={() => startEdit(key)}>直す</Button>
                  )}
                </Td>
              </Tr>
              )
            })}
          </tbody>
        </DataTable>
      )}

      <p className={styles.footNote}>
        {total > rows.length ? `ほか ${total - rows.length}件。` : ''}{VERIFY_SCHEDULE_NOTE}
      </p>
    </div>
  )
}
