'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { CommonVar, CommonVarSchedule, Folder } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import { VAR_TYPE_LABELS, formatStamp } from '@/lib/common-vars'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import Breadcrumb from '@/components/shared/breadcrumb'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import SelectField from '@/components/shared/select-field'
import StickyBar from '@/components/shared/sticky-bar'
import { TextField } from '@/components/shared/text-field'
import {
  CSV_BLOCKED_REASON,
  DELETE_MOVED_NOTE,
  IMPACT_CARDS,
  IMPACT_LIST_COUNT_TEXT,
  IMPACT_LIST_REASON,
  NOT_CONNECTED_VALUE,
  saveBlockedReason,
} from './change-impact'
import styles from './common-var-edit-v6.module.css'

/**
 * 共通情報の編集（設計 `uNBlA` 14-1-B「変える前に影響を見る」）。
 *
 * **共通情報は1か所直すと、差し込んでいる配信すべてが同時に変わる。**
 * だから設計は、保存の前に「影響の要約」と「影響の一覧」を置いている。
 * その中身を取る口はまだ無いので、節だけ置いて `—` と理由を出す
 * （`change-impact.ts` に理由と、要る口を書いた）。
 *
 * 保存・戻るは下部追従バーにだけ置く（V6 §1-6）。**削除はここに置かない。**
 * 使用先を確かめる削除確認は一覧側（設計 `yPkWe`）にある。
 */

/** 「いま」より前は予約できない。入れた瞬間に当たって、予約に見えない。 */
function jstNowLocalInput(): { date: string; time: string } {
  const jst = new Date(Date.now() + 9 * 3600_000).toISOString()
  return { date: jst.slice(0, 10), time: jst.slice(11, 16) }
}

/** 画面ぜんたいの状態。**読込中・取得失敗・権限不足・見つからないを混ぜない。** */
type Phase = 'loading' | 'ready' | 'missing' | 'error' | 'forbidden'

function EditCommonVarInner() {
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const latestAccountRef = useRef(selectedAccountId)
  latestAccountRef.current = selectedAccountId
  const params = useSearchParams()
  const id = params.get('id') ?? ''

  const [item, setItem] = useState<CommonVar | null>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  const [schedules, setSchedules] = useState<CommonVarSchedule[]>([])
  const [phase, setPhase] = useState<Phase>('loading')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const [name, setName] = useState('')
  const [folderId, setFolderId] = useState('')
  const [value, setValue] = useState('')

  /** 予約を足す窓。開いていない間は null。 */
  const [draft, setDraft] = useState<{ date: string; time: string; value: string } | null>(null)

  usePageTitle('共通情報を編集')

  const load = useCallback(async () => {
    if (!id) {
      setPhase('missing')
      return
    }
    const accountAtRequest = selectedAccountId
    if (!accountAtRequest) {
      setItem(null)
      // アカウントを読んでいる最中と、選べていない状態を混ぜない。
      setPhase(accountLoading ? 'loading' : 'forbidden')
      return
    }
    setPhase('loading')
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
        setPhase('missing')
        return
      }
      setItem(found)
      setName(found.name)
      setFolderId(found.folderId ?? '')
      setValue(found.value)
      setPhase('ready')
    } catch (e) {
      if (accountAtRequest !== latestAccountRef.current) return
      // 権限不足を「読み込めませんでした」に混ぜると、直しようが無い。
      setPhase(e instanceof ApiError && e.status === 403 ? 'forbidden' : 'error')
    }
  }, [accountLoading, id, selectedAccountId])

  useEffect(() => {
    void load()
  }, [load])

  const saveBlocked = saveBlockedReason({ item, accountId: selectedAccountId, name, saving })

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
      setError(
        e instanceof ApiError && e.status === 403
          ? '操作する権限がありません'
          : '保存に失敗しました',
      )
    } finally {
      setSaving(false)
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
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 403
          ? '操作する権限がありません'
          : '予約の削除に失敗しました',
      )
    }
  }

  return (
    <div className={styles.screen} data-design-node="uNBlA">
      <div className={styles.crumbRow}>
        <Breadcrumb
          items={[{ label: '共通情報一覧', href: '/contents/vars' }, { label: '共通情報を編集' }]}
        />
        {/*
          設計の「CSVで書き出す」。書き出す中身は下の「変わる場所」そのもので、
          その口がまだ無い。**押せる形で置かない。**
        */}
        <button type="button" className={styles.csvButton} disabled aria-describedby="cv-csv-reason">
          CSVで書き出す
        </button>
      </div>
      <p id="cv-csv-reason" className={styles.sectionReason}>
        {CSV_BLOCKED_REASON}
      </p>

      {error && (
        <div
          className="bg-danger-bg border-danger-bg text-danger rounded-lg border p-4 text-sm"
          role="alert"
        >
          {error}
        </div>
      )}

      {phase === 'loading' ? (
        <ListState kind="loading" title="読み込んでいます" />
      ) : phase === 'forbidden' ? (
        <ListState
          kind="forbidden"
          title="見る権限がありません"
          description="この共通情報を扱えるLINEアカウントへ切り替えるか、オーナーか管理者に権限の追加を依頼してください。"
        />
      ) : phase === 'error' ? (
        <ListState
          kind="error"
          title="読み込めませんでした"
          description="通信が途切れたか、応答がありませんでした。"
          action={
            <Button onClick={() => void load()} variant="secondary">
              再読み込み
            </Button>
          }
        />
      ) : phase === 'missing' || !item ? (
        <ListState
          kind="empty"
          title="この共通情報は見つかりませんでした"
          description="すでに削除されたか、別のLINEアカウントのものかもしれません。"
          action={
            <Button href="/contents/vars" variant="secondary">
              共通情報一覧へ戻る
            </Button>
          }
        />
      ) : (
        <>
          {/* 影響の要約（設計 `uNBlA`）。 */}
          <section className={styles.section} aria-labelledby="cv-impact-summary">
            <div className={styles.sectionHead}>
              <h2 id="cv-impact-summary" className={styles.sectionTitle}>
                変えるとどこに効くか
              </h2>
            </div>
            <div className={styles.summaryGrid}>
              {IMPACT_CARDS.map((card) => (
                <div key={card.key} className={styles.summaryCard} data-impact-card={card.key}>
                  <p className={styles.summaryLabel}>{card.title}</p>
                  <p className={styles.summaryValue}>{NOT_CONNECTED_VALUE}</p>
                  <p className={styles.summaryNote}>{card.note}</p>
                </div>
              ))}
            </div>
          </section>

          {/* 編集本体。設計 r10 / padding18。 */}
          <div className={styles.editCard}>
            <div className={styles.fieldGrid}>
              <div>
                <label htmlFor="cv-name" className={styles.fieldLabel}>
                  共通情報名 <span className="text-danger">*</span>
                </label>
                <TextField
                  id="cv-name"
                  maxLength={200}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="cv-folder" className={styles.fieldLabel}>
                  フォルダ
                </label>
                <SelectField
                  id="cv-folder"
                  className="w-full"
                  value={folderId}
                  onChange={(e) => setFolderId(e.target.value)}
                  options={[
                    { value: '', label: '未分類' },
                    ...folders.map((folder) => ({ value: folder.id, label: folder.name })),
                  ]}
                />
              </div>
            </div>

            <div className={styles.fieldGrid}>
              <div>
                <p className={styles.fieldLabel}>差し込み名</p>
                <code className={styles.keyChip}>{`{{var.${item.varKey}}}`}</code>
                <p className={styles.fieldNote}>
                  あとから変えられません。変えるとテンプレートの差し込みが空になります。
                </p>
              </div>
              <div>
                <p className={styles.fieldLabel}>種別</p>
                <span className={styles.typeChip}>{VAR_TYPE_LABELS[item.type] ?? item.type}</span>
                <p className={styles.fieldNote}>登録したあとは変えられません。</p>
              </div>
            </div>

            <div>
              <label htmlFor="cv-value" className={styles.fieldLabel}>
                値
              </label>
              <TextField
                id="cv-value"
                type={item.type === 'number' ? 'number' : 'text'}
                className="max-w-md"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>

            {/* 更新スケジュール。設計 `uNBlA` には無いが、口があり動いている。 */}
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
                          0件（更新の予定はありません）
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
          </div>

          {/* 影響の一覧（設計 `uNBlA`）。1件ずつ、いまの文と変わったあとの文を並べる節。 */}
          <section className={styles.section} aria-labelledby="cv-impact-list">
            <div className={styles.sectionHead}>
              <h2 id="cv-impact-list" className={styles.sectionTitle}>
                変わる場所
              </h2>
              <span className={styles.sectionCount}>{IMPACT_LIST_COUNT_TEXT}</span>
            </div>
            <p className={styles.impactList}>{IMPACT_LIST_REASON}</p>
          </section>

          <StickyBar
            status={
              <span className={styles.barNote}>
                {saved ? '保存しました。' : (saveBlocked ?? DELETE_MOVED_NOTE)}
              </span>
            }
            actions={
              <div className={styles.barActions}>
                <Button href="/contents/vars" variant="secondary">
                  戻る
                </Button>
                <Button onClick={() => void save()} disabled={saveBlocked !== null} variant="primary">
                  {saving ? '保存中...' : '保存'}
                </Button>
              </div>
            }
          />
        </>
      )}

      {draft && item && (
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
                <label htmlFor="sc-date" className={styles.fieldLabel}>
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
                <label htmlFor="sc-time" className={styles.fieldLabel}>
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
              <label htmlFor="sc-value" className={styles.fieldLabel}>
                更新後の値
              </label>
              <TextField
                id="sc-value"
                type={item.type === 'number' ? 'number' : 'text'}
                value={draft.value}
                onChange={(e) => setDraft({ ...draft, value: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setDraft(null)} variant="secondary">
                キャンセル
              </Button>
              <Button onClick={() => void addSchedule()} variant="primary">
                登録
              </Button>
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
    <Suspense fallback={<ListState kind="loading" title="読み込んでいます" />}>
      <EditCommonVarInner />
    </Suspense>
  )
}
