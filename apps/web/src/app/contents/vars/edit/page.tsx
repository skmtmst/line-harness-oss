'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { CommonVar, CommonVarSchedule, Folder } from '@line-crm/shared'
import { api, ApiError, type CommonVarUsageImpact } from '@/lib/api'
import { VAR_TYPE_LABELS, formatStamp } from '@/lib/common-vars'
import { useAccount } from '@/contexts/account-context'
import SummaryCard from '@/components/shared/summary-card'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import { ActionCell, DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'

/**
 * 共通情報の編集。
 *
 * Lステップの「共通情報編集」と同じ形。名前・フォルダ・値を直し、下に
 * 「更新スケジュール」の表を置く。種別は登録後に変えられないので、
 * 直せない印を付けて出すだけにする。
 */

/** 「いま」より前は予約できない。入れた瞬間に当たって、予約に見えない。 */
function jstNowLocalInput(): { date: string; time: string } {
  const jst = new Date(Date.now() + 9 * 3600_000).toISOString()
  return { date: jst.slice(0, 10), time: jst.slice(11, 16) }
}

function EditCommonVarInner() {
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const latestAccountRef = useRef(selectedAccountId)
  latestAccountRef.current = selectedAccountId
  const router = useRouter()
  const params = useSearchParams()
  const id = params.get('id') ?? ''

  const [item, setItem] = useState<CommonVar | null>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  const [schedules, setSchedules] = useState<CommonVarSchedule[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [impact, setImpact] = useState<CommonVarUsageImpact | null>(null)
  const [impactLoading, setImpactLoading] = useState(false)

  const [name, setName] = useState('')
  const [folderId, setFolderId] = useState('')
  const [value, setValue] = useState('')

  /** 予約を足す窓。開いていない間は null。 */
  const [draft, setDraft] = useState<{ date: string; time: string; value: string } | null>(null)

  const load = useCallback(async () => {
    if (!id) {
      setLoading(false)
      setError('共通情報が指定されていません')
      return
    }
    const accountAtRequest = selectedAccountId
    if (!accountAtRequest) {
      setItem(null)
      setLoading(false)
      setError(accountLoading ? '' : 'LINEアカウントを選択してください')
      return
    }
    setLoading(true)
    setError('')
    try {
      const [vars, folderList, scheduleList] = await Promise.all([
        api.commonVars.list(accountAtRequest),
        api.folders.list('common_var'),
        api.commonVars.schedules(id, accountAtRequest),
      ])
      if (accountAtRequest !== latestAccountRef.current) return
      if (folderList.success) setFolders(folderList.data)
      if (scheduleList.success) setSchedules(scheduleList.data)
      const found = vars.success ? vars.data.find((v) => v.id === id) : undefined
      if (!found) {
        setError('この共通情報は見つかりませんでした')
        return
      }
      setItem(found)
      setName(found.name)
      setFolderId(found.folderId ?? '')
      setValue(found.value)
    } catch {
      if (accountAtRequest === latestAccountRef.current) setError('読み込みに失敗しました')
    } finally {
      if (accountAtRequest === latestAccountRef.current) setLoading(false)
    }
  }, [accountLoading, id, selectedAccountId])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    if (!item || saving || !selectedAccountId) return
    const accountAtRequest = selectedAccountId
    if (!name.trim()) {
      setError('共通情報名を入力してください')
      return
    }
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const res = await api.commonVars.update(item.id, accountAtRequest, {
        name: name.trim(),
        value,
        folderId: folderId || null,
      })
      if (accountAtRequest !== latestAccountRef.current) return
      if (!res.success) {
        setError(res.error)
        return
      }
      setImpact(null)
      setSaved(true)
      void load()
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const reviewBeforeSave = async () => {
    if (!item || saving || impactLoading || !selectedAccountId) return
    if (!name.trim()) {
      setError('共通情報名を入力してください')
      return
    }
    if (value === item.value) {
      await save()
      return
    }
    const accountAtRequest = selectedAccountId
    setImpactLoading(true)
    setError('')
    try {
      const res = await api.commonVars.impactPreview(item.id, accountAtRequest, value)
      if (accountAtRequest !== latestAccountRef.current) return
      if (!res.success) {
        setError(res.error)
        return
      }
      setImpact(res.data)
    } catch {
      setError('影響する場所を確認できませんでした。もう一度お試しください。')
    } finally {
      setImpactLoading(false)
    }
  }

  const remove = async () => {
    if (!item || !selectedAccountId) return
    if (
      !confirm(
        `「${item.name}」を削除しますか？\n` +
          `テンプレートに {{var.${item.varKey}}} が残っていると、その部分が空になります。`,
      )
    )
      return
    setError('')
    try {
      await api.commonVars.delete(item.id, selectedAccountId)
      router.push('/contents/vars')
    } catch {
      setError('削除に失敗しました')
    }
  }

  const addSchedule = async () => {
    if (!item || !draft || !selectedAccountId) return
    if (!draft.date) {
      setError('開始日を入れてください')
      return
    }
    setError('')
    try {
      const res = await api.commonVars.addSchedule(item.id, selectedAccountId, {
        effectiveFrom: `${draft.date}T${draft.time || '00:00'}`,
        value: draft.value,
      })
      if (!res.success) {
        setError(res.error)
        return
      }
      setDraft(null)
      void load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '予約に失敗しました')
    }
  }

  const removeSchedule = async (scheduleId: string) => {
    if (!item || !selectedAccountId) return
    setError('')
    try {
      await api.commonVars.deleteSchedule(item.id, scheduleId, selectedAccountId)
      void load()
    } catch {
      setError('予約の削除に失敗しました')
    }
  }

  if (item && impact) {
    const immediateCount = impact.items.filter(
      (usage) => usage.changesOnSave && !['下書き', '停止中'].includes(usage.status),
    ).length
    return (
      <div data-design-node="uNBlA" data-common-var-impact-state="ready">
        <Notice
          tone="validation"
          message={`「${item.name}」を直すと、使用中の${impact.blockingTotal.toLocaleString('ja-JP')}か所へ反映されます。内容を確認してから保存してください。`}
          className="mb-4"
        />

        <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            title="変わる場所"
            value={impact.blockingTotal}
            unit="か所"
            detail="下書き・配信予定・自動処理を含みます"
            variant="v6"
          />
          <SummaryCard
            title="すぐ効くもの"
            value={immediateCount}
            unit="か所"
            detail="保存後に使われる内容です"
            variant="v6"
          />
          <SummaryCard
            title="文字数の確認"
            value={null}
            unit="件"
            detail="送信先ごとの上限は未接続です"
            badge="要確認"
            badgeTone="danger"
            variant="v6"
          />
          <SummaryCard
            title="送信済みの文"
            value={impact.historicalTotal}
            unit="か所"
            detail="過去に送った内容は変わりません"
            variant="v6"
          />
        </div>

        <section className="bg-canvas rounded-card border-hairline overflow-hidden border">
          <div className="border-hairline flex items-center justify-between gap-3 border-b px-5 py-4">
            <div>
              <p className="text-ink text-sm font-semibold">変わる内容</p>
              <p className="text-ink-faint mt-1 text-xs">
                現在の文と保存後の文を、使われている場所ごとに並べています。
              </p>
            </div>
            <span className="text-ink-secondary text-sm">{impact.total.toLocaleString('ja-JP')}件</span>
          </div>
          {impact.unscopedFormTotal > 0 ? (
            <Notice
              tone="validation"
              message={`所属するLINEアカウントを確認できない回答フォームが${impact.unscopedFormTotal.toLocaleString('ja-JP')}件あります。内容を見せず、安全のため影響件数に含めています。`}
              className="m-4"
            />
          ) : null}
          {impact.items.length === 0 ? (
            <div className="text-ink-secondary px-5 py-10 text-center text-sm">
              {impact.unscopedFormTotal > 0
                ? '表示できる使用先はありません。回答フォームは所属確認後に内容を表示します。'
                : 'この共通情報を使っている場所はありません。'}
            </div>
          ) : (
            <DataTable>
              <thead>
                <TableHeadRow>
                  <Th className="w-32">使われる場所</Th>
                  <Th className="w-48">名前</Th>
                  <Th>現在の文</Th>
                  <Th>保存後の文</Th>
                  <Th className="w-36">状態</Th>
                  <Th className="w-24" align="right">操作</Th>
                </TableHeadRow>
              </thead>
              <tbody>
                {impact.items.map((usage) => (
                  <Tr key={`${usage.kind}:${usage.sourceId}`}>
                    <Td>{usage.kindLabel}</Td>
                    <Td>
                      <span className="block max-w-44 truncate" title={usage.name}>{usage.name}</span>
                    </Td>
                    <Td>
                      <span className="block max-w-72 truncate" title={usage.currentPreview}>
                        {usage.currentPreview}
                      </span>
                    </Td>
                    <Td>
                      {usage.nextPreview === null ? (
                        <span className="text-ink-faint">—</span>
                      ) : (
                        <span className="block max-w-72 truncate" title={usage.nextPreview}>
                          {usage.nextPreview}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <span className={usage.changesOnSave ? 'text-ink-secondary' : 'text-ink-faint'}>
                        {usage.status}
                      </span>
                    </Td>
                    <ActionCell>
                      <Link href={usage.href} className="text-info whitespace-nowrap hover:underline">
                        中身を見る
                      </Link>
                    </ActionCell>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </section>

        <div className="border-hairline bg-canvas sticky bottom-0 mt-4 flex items-center justify-center gap-3 border-t px-4 py-3">
          <Button variant="secondary" onClick={() => setImpact(null)} disabled={saving}>
            編集に戻る
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving}>
            {saving ? '保存中...' : 'この内容で保存する'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <nav className="text-ink-faint mb-3 text-xs">
        <Link href="/contents/vars" className="text-info hover:underline">
          共通情報一覧
        </Link>
        <span className="mx-1.5">›</span>
        <span>共通情報編集</span>
      </nav>

      {error && (
        <div className="bg-danger-bg border-danger-bg text-danger mb-4 max-w-3xl rounded-lg border p-4 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint max-w-3xl border p-8 text-center text-sm">
          読み込み中...
        </div>
      ) : !item ? (
        <p className="text-ink-secondary text-sm">
          <Link href="/contents/vars" className="text-info hover:underline">
            共通情報一覧へ戻る
          </Link>
        </p>
      ) : (
        <>
          <div className="bg-canvas rounded-card border-hairline max-w-3xl space-y-6 border p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="cv-name"
                  className="text-ink-secondary mb-1 block text-sm font-medium"
                >
                  共通情報名 <span className="text-danger">*</span>
                </label>
                <input
                  id="cv-name"
                  type="text"
                  maxLength={200}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="border-hairline rounded-control focus:ring-accent w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="cv-folder"
                  className="text-ink-secondary mb-1 block text-sm font-medium"
                >
                  フォルダ
                </label>
                <select
                  id="cv-folder"
                  value={folderId}
                  onChange={(e) => setFolderId(e.target.value)}
                  className="border-hairline rounded-control w-full border px-3 py-2 text-sm"
                >
                  <option value="">未分類</option>
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-ink-secondary mb-1 text-sm font-medium">差し込み名</p>
                <code className="bg-canvas-sunken text-ink block rounded px-2 py-2 text-sm">{`{{var.${item.varKey}}}`}</code>
                <p className="text-ink-faint mt-1 text-xs">
                  あとから変えられません。変えるとテンプレートの差し込みが空になります。
                </p>
              </div>
              <div>
                <p className="text-ink-secondary mb-1 text-sm font-medium">
                  種別{' '}
                  <span className="text-ink-faint text-xs font-normal">※変更できません。</span>
                </p>
                <span className="bg-canvas-sunken text-ink-secondary rounded-pill inline-block px-3 py-1 text-sm">
                  {VAR_TYPE_LABELS[item.type] ?? item.type}
                </span>
              </div>
            </div>

            <div>
              <label htmlFor="cv-value" className="text-ink-secondary mb-1 block text-sm font-medium">
                値
              </label>
              <input
                id="cv-value"
                type={item.type === 'number' ? 'number' : 'text'}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="border-hairline rounded-control w-full max-w-md border px-3 py-2 text-sm"
              />
            </div>

            {/* 更新スケジュール。Lステップと同じく、値の下に表で置く。 */}
            <section>
              <p className="text-ink text-sm font-semibold">
                更新スケジュール{' '}
                <span className="text-ink-faint text-xs font-normal">
                  予定を決めて自動で値を更新できます
                </span>
              </p>
              <div className="border-hairline mt-2 overflow-hidden rounded border">
                <table className="w-full">
                  <thead>
                    <tr className="bg-canvas-sunken border-hairline border-b">
                      <th className="text-ink-faint px-3 py-2 text-left text-xs font-semibold">
                        スケジュール
                      </th>
                      <th className="text-ink-faint px-3 py-2 text-left text-xs font-semibold">
                        更新内容
                      </th>
                      <th className="w-16 px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {schedules.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="text-ink-faint px-3 py-6 text-center text-sm">
                          スケジュールが設定されていません
                        </td>
                      </tr>
                    ) : (
                      schedules.map((s) => (
                        <tr key={s.id}>
                          <td className="text-ink-secondary px-3 py-2 text-sm">
                            {formatStamp(s.effectiveFrom)} 実行
                            {s.appliedAt && (
                              <span className="text-success ml-2 text-xs">反映済み</span>
                            )}
                          </td>
                          <td className="text-ink px-3 py-2 text-sm break-all">
                            {s.value || <span className="text-ink-faint">（空）</span>} を代入する
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              onClick={() => void removeSchedule(s.id)}
                              aria-label="この予約を消す"
                              className="text-danger hover:bg-danger-bg rounded px-2 py-1 text-xs"
                            >
                              削除
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
                <div className="border-hairline border-t">
                  <button
                    onClick={() => {
                      const now = jstNowLocalInput()
                      setDraft({ date: now.date, time: '00:00', value })
                    }}
                    className="text-accent hover:bg-accent-soft w-full py-2.5 text-sm font-medium"
                  >
                    ＋ 更新スケジュールを追加
                  </button>
                </div>
              </div>
              <p className="text-ink-faint mt-1 text-xs">
                過去の日時は指定できません。指定した時刻を過ぎると、自動で値が入れ替わります。
              </p>
            </section>

            {saved && <p className="text-success text-sm">保存しました。</p>}
          </div>

          <div className="border-hairline mt-4 flex max-w-3xl items-center justify-between gap-3 border-t pt-4">
            <div className="flex items-center gap-4">
              <Link href="/contents/vars" className="text-info text-sm hover:underline">
                共通情報一覧へ戻る
              </Link>
              <button
                onClick={() => void remove()}
                className="text-danger hover:bg-danger-bg rounded-control px-3 py-2 text-sm"
              >
                削除
              </button>
            </div>
            <button
              onClick={() => void reviewBeforeSave()}
              disabled={saving || impactLoading}
              className="bg-accent text-on-accent hover:bg-accent-hover rounded-control px-10 py-2 text-sm font-medium transition-colors disabled:opacity-40"
            >
              {saving ? '保存中...' : impactLoading ? '影響を確認中...' : '保存'}
            </button>
          </div>
        </>
      )}

      {draft && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="スケジュール設定"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDraft(null)
          }}
        >
          <div className="rounded-card bg-canvas w-full max-w-md space-y-4 p-6 shadow-xl">
            <p className="text-ink text-sm font-semibold">スケジュール設定</p>
            <div className="flex flex-wrap gap-3">
              <div>
                <label htmlFor="sc-date" className="text-ink-secondary mb-1 block text-xs font-medium">
                  開始日
                </label>
                <input
                  id="sc-date"
                  type="date"
                  value={draft.date}
                  min={jstNowLocalInput().date}
                  onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                  className="border-hairline rounded-control border px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label htmlFor="sc-time" className="text-ink-secondary mb-1 block text-xs font-medium">
                  開始時刻
                </label>
                <input
                  id="sc-time"
                  type="time"
                  value={draft.time}
                  onChange={(e) => setDraft({ ...draft, time: e.target.value })}
                  className="border-hairline rounded-control border px-2 py-1.5 text-sm"
                />
              </div>
            </div>
            <div>
              <label htmlFor="sc-value" className="text-ink-secondary mb-1 block text-xs font-medium">
                更新後の値
              </label>
              <input
                id="sc-value"
                type={item?.type === 'number' ? 'number' : 'text'}
                value={draft.value}
                onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                className="border-hairline rounded-control w-full border px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDraft(null)}
                className="border-hairline text-ink-secondary rounded-control border px-4 py-2 text-sm"
              >
                キャンセル
              </button>
              <button
                onClick={() => void addSchedule()}
                className="bg-accent text-on-accent rounded-control px-6 py-2 text-sm font-medium"
              >
                登録
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function EditCommonVarPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <EditCommonVarInner />
    </Suspense>
  )
}
