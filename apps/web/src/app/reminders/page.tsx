'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import type { Folder, ReminderTriggerType } from '@line-crm/shared'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import ListKpis from '@/components/shared/list-kpis'
import FolderPanel from '@/components/shared/folder-panel'
import { PRESETS as LIST_STATE_PRESETS } from '@/components/shared/list-state'
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import { TableHeadRow, Th } from '@/components/shared/table'
import Button from '@/components/shared/button'
import Pagination from '@/components/shared/pagination'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { deleteReminderSelection } from './delete-reminder-selection'

/**
 * リマインダの一覧。
 *
 * Lステップの「リマインダ配信」（`/line/episode`）と同じ形にしてある。
 * 左にフォルダの縦パネル、右に表。列は リマインダ名 / 配信方式 / 登録日 で、
 * そこにこちらの持ち物（きっかけ・稼働）を足している。
 *
 * 以前は札（カード）の格子で、押すと下にステップが開く形だった。件数が増えると
 * 縦に伸びるだけで、どれがどの方式で動いているのか一覧では読めなかった。
 * ステップの追加・削除は `/reminders/edit` が持っているので、ここには置かない。
 * 一覧と編集の両方に置くと、片方だけ直したときに食い違ったまま気づけない
 * （作成画面で同じことが起きて、195 で入口を1つにまとめたばかり）。
 *
 * フォルダの帯は `['すべて','01_誕生日','02_定期便','未分類']` という
 * べた書きだった。156 で `reminders.folder_id` を足して、実データにしてある。
 */

interface Reminder {
  id: string
  name: string
  description: string | null
  isActive: boolean
  triggerType?: ReminderTriggerType
  /** 153: 'time'（ゴールの○日前の●時）か 'countdown'（残り時間）。 */
  deliveryMode?: 'time' | 'countdown'
  triggerOffsetMinutes?: number | null
  sendAtTime?: string | null
  targetTagId?: string | null
  /** 156: フォルダ。null は未分類。 */
  folderId?: string | null
  /** 送る内容の数。0 のときは、対象に加わっても何も届かない。 */
  stepCount?: number
  /** 161: 並び順。同じ値のときは登録日の新しい順。 */
  displayOrder?: number
  createdAt: string
  updatedAt: string
}

/** 「未分類」を表す絞り込みの値。空文字だと「すべて」と区別できない。 */
const UNFILED = '__unfiled__'

/** 1ページに出す件数。 */
const PER_PAGE = 20

const TRIGGER_LABELS: Record<ReminderTriggerType, string> = {
  manual: '手動で登録',
  booking: '予約',
  event: 'イベント',
  friend_field: '友だち情報欄の日付',
}

/**
 * 配信方式の呼び名。Lステップの一覧にも同じ列がある。
 * 作成後は変えられないので、一覧では読むだけ。
 */
const DELIVERY_MODE_LABELS: Record<string, string> = {
  time: '時刻で指定',
  countdown: '残り時間で指定',
}

/** 「-1440」→「1日前」。分での指定（countdown）のときに使う。 */
function formatOffset(minutes: number): string {
  const abs = Math.abs(minutes)
  const sign = minutes < 0 ? '' : '+'
  if (abs === 0) return '基準時刻'
  if (abs < 60) return `${sign}${minutes}分`
  if (abs % 1440 === 0) {
    const days = abs / 1440
    return minutes < 0 ? `${days}日前` : `${days}日後`
  }
  if (abs % 60 === 0) {
    const hours = abs / 60
    return minutes < 0 ? `${hours}時間前` : `${hours}時間後`
  }
  const hours = Math.floor(abs / 60)
  const mins = abs % 60
  const prefix = minutes < 0 ? '-' : '+'
  return `${prefix}${hours}時間${mins}分`
}

/** 「2026-08-20T01:23:45.678」→「2026/08/20」。列に収まる長さにする。 */
function formatDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return value
  return `${match[1]}/${match[2]}/${match[3]}`
}

export default function RemindersPage() {
  const { selectedAccountId } = useAccount()
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [nameQuery, setNameQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [folderFilter, setFolderFilter] = useState('')
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  /** いま掴んでいる行。落とした先と入れ替える。 */
  const [dragId, setDragId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const loadFolders = useCallback(async () => {
    try {
      const res = await api.folders.list('reminder')
      if (res.success) setFolders(res.data)
    } catch {
      // フォルダが読めなくても一覧は出す。絞り込みが効かないだけ。
    }
  }, [])

  const loadReminders = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.reminders.list({ accountId: selectedAccountId || undefined })
      if (res.success) {
        setReminders(res.data as unknown as Reminder[])
      } else {
        setError(res.error)
      }
    } catch {
      /*
        **失敗の言い方は共通部品にそろえる。** 画面ごとに書くと、同じ事故が
        画面によって違う言葉になる。`ListState` の `error` は
        「表示できませんでした」＋「再読み込みしても直らない場合は…」。
        「もう一度お試しください」だけだと、**押し直しても直らないときに
        次の手が無い。**
      */
      setError(`${LIST_STATE_PRESETS.error.title}。${LIST_STATE_PRESETS.error.description}`)
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    void loadReminders()
    void loadFolders()
  }, [loadReminders, loadFolders])

  const handleToggleActive = async (id: string, current: boolean) => {
    try {
      await api.reminders.update(id, { isActive: !current })
      void loadReminders()
    } catch {
      setError('稼働の切り替えに失敗しました')
    }
  }

  /** フォルダの付け替え。一覧から直せないと、20件あるときに20回開くことになる。 */
  const handleMoveFolder = async (id: string, folderId: string) => {
    try {
      await api.reminders.update(id, { folderId: folderId || null })
      void loadReminders()
    } catch {
      setError('フォルダの変更に失敗しました')
    }
  }

  /**
   * 掴んだリマインダを、落とした先の位置へ動かす。
   *
   * **いま見えている並びだけを送る。** フォルダや検索で隠れているものの順番は
   * 触らない。画面に無いものが勝手に動くと、戻すすべがない（タグ・シナリオと
   * 同じ考え方）。
   */
  const dropOn = async (targetId: string) => {
    const from = dragId
    setDragId(null)
    if (!from || from === targetId) return

    const order = filtered.map((r) => r.id)
    const fromIdx = order.indexOf(from)
    const toIdx = order.indexOf(targetId)
    if (fromIdx < 0 || toIdx < 0) return
    order.splice(toIdx, 0, ...order.splice(fromIdx, 1))

    // 画面はすぐ入れ替える。往復を待つと、掴んだ手応えが無い。
    const rank = new Map(order.map((id, i) => [id, i]))
    setReminders((prev) =>
      [...prev].sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9)),
    )
    try {
      const res = await api.reminders.reorder(order)
      if (!res.success) throw new Error(res.error)
    } catch {
      setError('並び順を保存できませんでした')
      void loadReminders()
    }
  }

  /*
   * **ブラウザの `confirm()` を使わない。**
   *
   * 見た目がブラウザ任せで設計の確認窓と違ううえ、画像比較にも写らない
   * （`Y0Sn3` の失敗状態が撮れなかったのはこれが理由）。何が消えるかを
   * 本文で読ませたいので、共通の `ConfirmDialog` へ移した。
   */
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const handleDeleteSelected = async () => {
    if (selected.size === 0 || deleting) return
    const targets = [...selected]
    setDeleting(true)
    setDeleteError('')
    try {
      const failed = await deleteReminderSelection(targets, async (id) => {
        const res = await api.reminders.delete(id)
        return res.success
      })
      if (failed.length > 0) {
        setSelected(new Set(failed))
        setDeleteError(
          failed.length === targets.length
            ? '選択したリマインダを削除できませんでした。状態を読み直してから、もう一度お試しください。'
            : `${failed.length}件のリマインダを削除できませんでした。削除できなかったものだけを残しています。`,
        )
        await loadReminders()
        return
      }
      setConfirmOpen(false)
      setSelected(new Set())
      await loadReminders()
    } finally {
      setDeleting(false)
    }
  }

  const filtered = useMemo(() => {
    const needle = nameQuery.trim().toLowerCase()
    return reminders.filter((r) => {
      if (folderFilter === UNFILED && r.folderId) return false
      if (folderFilter && folderFilter !== UNFILED && r.folderId !== folderFilter) return false
      if (!needle) return true
      return r.name.toLowerCase().includes(needle)
    })
  }, [reminders, folderFilter, nameQuery])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const current = useMemo(
    () => filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE),
    [filtered, page],
  )

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  const allOnPageSelected = current.length > 0 && current.every((r) => selected.has(r.id))

  return (
    <div>
      <div data-design="Head">
        <Header
          title="リマインダ"
          description="ゴール日時までのカウントダウン配信を作ります。予約・イベント・友だち情報欄の日付を起点にできます。"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Button
                disabled
                title="マニュアルは準備中です"
              >
                マニュアル
              </Button>
              {/* 並べ替えは表の左端を掴んで行う。ここはやり方の案内。
                  窓を開いて並べ替える形にすると、一覧と窓で同じ並びを
                  2か所に持つことになる。 */}
              <span
                className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm"
                title="表の左端の ⠿ を掴むと並べ替えられます"
              >
                ⇅ 並び替えは ⠿ を掴む
              </span>
              <Button
                onClick={() => setFolderDialogOpen(true)}
              >
                ＋ 新しいフォルダ
              </Button>
              <Button
                href="/reminders/new"
                variant="primary"
              >
                ＋ 新しいリマインダ
              </Button>
            </div>
          }
        />
      </div>

      {folderDialogOpen && (
        <FolderAddDialog
          kind="reminder"
          note="リマインダを分けてしまう箱です。消しても、入っていたリマインダは未分類として残ります。"
          placeholder="例: 01_誕生日"
          onClose={() => setFolderDialogOpen(false)}
          onAdded={() => void loadFolders()}
        />
      )}

      <div data-design="KPIs">
        <ListKpis
          variant="v6"
          titles={['リマインダ', '配信待ち', '稼働中', '今月の配信']}
          build={(s) => [
            { title: 'リマインダ', value: s.reminders.total, unit: '件', detail: `稼働中 ${s.reminders.active}` },
            { title: '配信待ち', value: s.reminders.waiting, unit: '人', detail: '登録済みで未完了' },
            { title: '稼働中', value: s.reminders.active, unit: '件', detail: '止めているものを除く' },
            { title: '今月の配信', value: s.reminders.sentThisMonth, unit: '通', detail: '今月ぶん' },
          ]}
        />
      </div>

      {error && (
        <div className="bg-danger-bg border-danger-bg text-danger mb-4 rounded-lg border p-4 text-sm">
          {error}
        </div>
      )}

      <div data-design="Body">
        <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <FolderPanel
            total={`${reminders.length} 件`}
            activeId={folderFilter}
            onSelect={(id) => {
              setFolderFilter(id)
              setPage(1)
            }}
            rows={[
              { id: '', label: 'すべて', count: reminders.length },
              ...folders.map((f) => ({
                id: f.id,
                label: f.name,
                count: reminders.filter((r) => r.folderId === f.id).length,
                color: f.color,
              })),
              {
                id: UNFILED,
                label: '未分類',
                count: reminders.filter((r) => !r.folderId).length,
              },
            ]}
          >
            <p className="text-ink-faint text-xs leading-relaxed">
              フォルダを消しても、入っていたリマインダは未分類として残ります。
            </p>
          </FolderPanel>

          <div>
            <div className="bg-canvas rounded-card border-hairline mb-3 flex flex-wrap items-center gap-2 border p-3">
              <input
                type="search"
                placeholder="リマインダ名で検索"
                aria-label="リマインダ名で検索"
                value={nameQuery}
                onChange={(e) => {
                  setNameQuery(e.target.value)
                  setPage(1)
                }}
                className="border-hairline rounded-control focus:ring-accent min-w-0 flex-1 border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
              />
              <span className="text-ink-faint text-xs whitespace-nowrap tabular-nums">
                {filtered.length} 件
              </span>
            </div>

            <div className="bg-canvas rounded-card border-hairline overflow-hidden border">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px]">
                  <thead>
                    <TableHeadRow>
                      <Th className="w-8" aria-label="並び替え" />
                      <Th className="w-10">
                        <input
                          type="checkbox"
                          checked={allOnPageSelected}
                          onChange={() =>
                            setSelected((prev) => {
                              const next = new Set(prev)
                              for (const r of current) {
                                if (allOnPageSelected) next.delete(r.id)
                                else next.add(r.id)
                              }
                              return next
                            })
                          }
                          aria-label="このページのリマインダをすべて選ぶ"
                          className="accent-green-500"
                        />
                      </Th>
                      <Th>
                        リマインダ名
                      </Th>
                      <Th>
                        配信方式
                      </Th>
                      <Th>
                        きっかけ
                      </Th>
                      <Th>
                        送る内容
                      </Th>
                      <Th>
                        フォルダ
                      </Th>
                      <Th>
                        稼働
                      </Th>
                      <Th>
                        登録日
                      </Th>
                    </TableHeadRow>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {loading ? (
                      <tr>
                        <td colSpan={9} className="text-ink-faint px-4 py-8 text-center text-sm">
                          読み込み中...
                        </td>
                      </tr>
                    ) : current.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="text-ink-faint px-4 py-8 text-center text-sm">
                          {/*
                            * 読み込みに失敗したときは「ありません」と言わない。
                            * 上に「読み込みに失敗しました」を出しているのに、ここで
                            * 「ありません。作成してください」と並ぶと、**登録済みの
                            * ものが消えたように読める**。
                            */}
                          {error
                            ? `${LIST_STATE_PRESETS.error.title}。上の案内をご覧ください。`
                            : reminders.length === 0
                              ? 'リマインダがありません。「＋ 新しいリマインダ」から作成してください。'
                              : 'この条件に合うリマインダはありません。'}
                        </td>
                      </tr>
                    ) : (
                      current.map((r) => (
                        <tr key={r.id} className="hover:bg-canvas-sunken align-top">
                          {/* 掴んで上下に入れ替える。掴める印が出ていないと、
                              並べ替えられることに気づけない。 */}
                          <td
                            className="text-ink-faint w-8 cursor-grab px-2 py-3 text-center select-none active:cursor-grabbing"
                            draggable
                            onDragStart={() => setDragId(r.id)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => void dropOn(r.id)}
                            aria-label={`${r.name} を並び替える`}
                            title="上下に動かして並び替え"
                          >
                            ⠿
                          </td>
                          <td className="px-3 py-3">
                            <input
                              type="checkbox"
                              checked={selected.has(r.id)}
                              onChange={() =>
                                setSelected((prev) => {
                                  const next = new Set(prev)
                                  if (next.has(r.id)) next.delete(r.id)
                                  else next.add(r.id)
                                  return next
                                })
                              }
                              aria-label={`${r.name}を選ぶ`}
                              className="accent-green-500"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <Link
                              href={`/reminders/edit?id=${r.id}`}
                              className="text-info text-sm font-medium hover:underline"
                            >
                              {r.name}
                            </Link>
                            {r.description && (
                              <p className="text-ink-faint mt-0.5 line-clamp-2 text-xs">
                                {r.description}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className="bg-canvas-sunken text-ink-secondary rounded-pill px-2 py-0.5 text-xs whitespace-nowrap">
                              {DELIVERY_MODE_LABELS[r.deliveryMode ?? 'countdown'] ?? r.deliveryMode}
                            </span>
                          </td>
                          <td className="text-ink-secondary px-4 py-3 text-xs">
                            {TRIGGER_LABELS[r.triggerType ?? 'manual']}
                            {r.sendAtTime && (
                              <span className="text-ink-faint block tabular-nums">{r.sendAtTime}</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs whitespace-nowrap">
                            {/* 0通のリマインダは、対象に加わっても何も届かない。
                                稼働中に見えるだけに、数字だけでなく警告として出す。 */}
                            {r.stepCount === 0 ? (
                              <span className="text-warning">0通（届きません）</span>
                            ) : (
                              <span className="text-ink-secondary tabular-nums">
                                {r.stepCount ?? '—'} 通
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <select
                              value={r.folderId ?? ''}
                              onChange={(e) => void handleMoveFolder(r.id, e.target.value)}
                              aria-label={`${r.name}のフォルダ`}
                              className="border-hairline rounded-control max-w-[9rem] border px-2 py-1 text-xs"
                            >
                              <option value="">未分類</option>
                              {folders.map((f) => (
                                <option key={f.id} value={f.id}>
                                  {f.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => void handleToggleActive(r.id, r.isActive)}
                              className={`rounded-pill px-2 py-0.5 text-xs font-medium ${
                                r.isActive
                                  ? 'bg-success-bg text-success'
                                  : 'bg-canvas-sunken text-ink-faint'
                              }`}
                              title={r.isActive ? '止める' : '動かす'}
                            >
                              {r.isActive ? '稼働中' : '停止中'}
                            </button>
                          </td>
                          <td className="text-ink-secondary px-4 py-3 text-xs tabular-nums whitespace-nowrap">
                            {formatDate(r.createdAt)}
                          </td>
                        </tr>
                      ))
                    )}

                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />

              <button
                onClick={() => { setDeleteError(''); setConfirmOpen(true) }}
                disabled={selected.size === 0}
                className="border-danger-bg text-danger hover:bg-danger-bg rounded-control border px-3 py-2 text-sm font-medium disabled:opacity-40"
              >
                選択したリマインダを削除
                {selected.size > 0 && <span className="tabular-nums">（{selected.size}）</span>}
              </button>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={`${selected.size}件のリマインダを削除しますか？`}
        description="登録済みの配信予定も一緒に消えます。すでに送ったぶんの記録は残ります。この操作は取り消せません。"
        confirmLabel="削除する"
        destructive
        busy={deleting}
        error={deleteError}
        onConfirm={() => void handleDeleteSelected()}
        onCancel={() => {
          if (deleting) return
          setConfirmOpen(false)
          setDeleteError('')
        }}
      />
    </div>
  )
}
