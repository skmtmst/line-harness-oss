'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { CommonVar, CommonVarDeleteImpact, CommonVarSchedule, Folder } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import { VAR_TYPE_LABELS, formatStamp } from '@/lib/common-vars'
import { useAccount } from '@/contexts/account-context'
import { NOT_AVAILABLE, STATE_TEXT } from '@/components/shared/not-connected'
import { checkedAtText } from '../delete-impact'
import {
  changePreviewNotConnected,
  changeSummaryText,
  hiddenText,
  historicalText,
  immediateItems,
  impactStateFromError,
  impactStateText,
  saveErrorText,
  type ChangeImpactState,
} from '../change-impact'
import ConfirmDialog from '@/components/shared/confirm-dialog'

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

  const [name, setName] = useState('')
  const [folderId, setFolderId] = useState('')
  const [value, setValue] = useState('')

  /** 予約を足す窓。開いていない間は null。 */
  const [draft, setDraft] = useState<{ date: string; time: string; value: string } | null>(null)
  /*
    削除の確認（設計 `yPkWe` と同じ確認窓）。**ブラウザの `confirm()` を使わない。**
    差し込み記号がどこで空になるかを本文で読ませられず、画像比較にも写らない。
  */
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  /**
   * 変える前の影響確認（設計 `uNBlA`）。
   *
   * 本体の読み込みとは別に持つ。使用先が読めなくても、名前や値の編集は
   * 続けられるべきだからである。**読めなかったことを0か所として描かない。**
   */
  const [impact, setImpact] = useState<CommonVarDeleteImpact | null>(null)
  const [impactState, setImpactState] = useState<ChangeImpactState>('loading')

  const loadImpact = useCallback(async (varId: string, accountId: string) => {
    setImpactState('loading')
    try {
      const res = await api.commonVars.deleteImpact(varId, accountId)
      if (accountId !== latestAccountRef.current) return
      if (!res.success) {
        setImpact(null)
        setImpactState('error')
        return
      }
      setImpact(res.data)
      setImpactState('ready')
    } catch (e) {
      if (accountId !== latestAccountRef.current) return
      setImpact(null)
      setImpactState(impactStateFromError(e))
    }
  }, [])

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
      void loadImpact(found.id, accountAtRequest)
    } catch {
      if (accountAtRequest === latestAccountRef.current) setError('読み込みに失敗しました')
    } finally {
      if (accountAtRequest === latestAccountRef.current) setLoading(false)
    }
  }, [accountLoading, id, loadImpact, selectedAccountId])

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
      setSaved(true)
      void load()
    } catch (e) {
      // `fetchApi` は2xx以外を投げる。ここで一言にまとめてしまうと、
      // 権限が無いのか対象が消えたのかが運用者に届かない。
      setError(saveErrorText(e))
    } finally {
      setSaving(false)
    }
  }

  /*
    `common_var_schedules` は共通情報に `ON DELETE CASCADE` で繋がっているので、
    まだ反映していない次回予約も一緒に消える。テンプレート・配信・フォルダ・
    友だちは消えないが、差し込み記号だけが残って空欄で送られ続ける。
  */
  const remove = async () => {
    if (!item || !selectedAccountId || deleting) return
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await api.commonVars.delete(item.id, selectedAccountId)
      if (!res.success) throw new Error(res.error)
      setConfirmingDelete(false)
      router.push('/contents/vars')
    } catch {
      setDeleteError('共通情報を削除できませんでした。時間をおいて、もう一度お試しください。')
    } finally {
      setDeleting(false)
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

            {/*
              変える前の影響確認（設計 `uNBlA` 14-1-B）。
              **節は必ず出す。** 読めないものは `—` と理由にする。
            */}
            <section data-design-node="uNBlA">
              <p className="text-ink text-sm font-semibold">
                影響確認{' '}
                <span className="text-ink-faint text-xs font-normal">
                  保存すると、この値を差し込んでいる場所がすぐ変わります
                </span>
              </p>

              {impactState !== 'ready' || !impact ? (
                <div className="border-hairline mt-2 rounded border p-4" data-impact-state={impactState}>
                  <p className="text-ink text-sm">
                    {NOT_AVAILABLE}
                    <span className="text-ink-secondary ml-2">{impactStateText(impactState)}</span>
                  </p>
                  {impactState === 'error' && (
                    <button
                      onClick={() => {
                        if (item && selectedAccountId) void loadImpact(item.id, selectedAccountId)
                      }}
                      className="text-info mt-2 text-sm hover:underline"
                    >
                      {STATE_TEXT.retry}
                    </button>
                  )}
                </div>
              ) : (
                <div className="border-hairline mt-2 rounded border">
                  <div className="border-hairline border-b p-3">
                    <p className="text-ink text-sm">{changeSummaryText(impact)}</p>
                    {historicalText(impact) && (
                      <p className="text-ink-secondary mt-1 text-xs">{historicalText(impact)}</p>
                    )}
                    {hiddenText(impact) && (
                      <p className="text-ink-secondary mt-1 text-xs">
                        名前を確認できない使用先：{hiddenText(impact)}
                      </p>
                    )}
                  </div>

                  {immediateItems(impact).length > 0 && (
                    <ul className="divide-hairline divide-y">
                      {immediateItems(impact).map((usage) => (
                        <li key={`${usage.kind}-${usage.href}-${usage.name}`} className="p-3">
                          <p className="text-ink-faint text-xs">
                            {usage.kindLabel}・{usage.status}
                          </p>
                          <Link href={usage.href} className="text-info text-sm hover:underline">
                            {usage.name}
                          </Link>
                          <p className="text-ink-secondary mt-1 text-xs break-all">
                            いまの文：{usage.currentPreview}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="border-hairline border-t p-3">
                    <p className="text-ink-secondary text-xs">変更後の文と文字数の検査</p>
                    <p className="text-ink mt-1 text-sm">
                      {NOT_AVAILABLE}
                      <span className="text-ink-secondary ml-2 text-xs">
                        {changePreviewNotConnected()}
                      </span>
                    </p>
                  </div>

                  <p className="text-ink-faint border-hairline border-t px-3 py-2 text-xs">
                    {checkedAtText(impact.checkedAt)} 時点で確かめました。
                  </p>
                </div>
              )}
            </section>

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
                onClick={() => { setDeleteError(''); setConfirmingDelete(true) }}
                className="text-danger hover:bg-danger-bg rounded-control px-3 py-2 text-sm"
              >
                削除
              </button>
            </div>
            <button
              onClick={() => void save()}
              disabled={saving}
              className="bg-accent text-on-accent hover:bg-accent-hover rounded-control px-10 py-2 text-sm font-medium transition-colors disabled:opacity-40"
            >
              {saving ? '保存中...' : '保存'}
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

      <ConfirmDialog
        open={confirmingDelete}
        title={`「${item?.name ?? ''}」を削除しますか？`}
        description={`この共通情報と、登録値・まだ反映していない次回予約を削除します。テンプレート、配信、フォルダ、友だちは削除しません。ただしテンプレートに {{var.${item?.varKey ?? ''}}} が残っていると、その部分が空欄のまま送られ続けます。この操作は元に戻せません。`}
        confirmLabel="削除する"
        destructive
        busy={deleting}
        error={deleteError}
        onConfirm={() => void remove()}
        onCancel={() => {
          if (deleting) return
          setDeleteError('')
          setConfirmingDelete(false)
        }}
      />
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
