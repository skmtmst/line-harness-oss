'use client'

/*
 * ★V8-B 会員 › ライフタイム（zQ5vY）。
 *
 * 1枚のカードに「節目（ライフタイム）」の説明と右に合計、下に節目の表
 * （節目（累計）・称号・特典・到達した人・到達時の LINE 通知・行の「…」）。
 * 行の中身は「…」の「編集する」で開く窓で直し、下の中央の「保存して EC へ同期する」でまとめて保存する。
 */
import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import Toggle from '@/components/shared/toggle'
import { RowActions } from '@/components/shared/row-actions'
import { TextField } from '@/components/shared/text-field'
import { describeApiFailure } from '@/components/shared/api-error-message'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { formatNumber } from '@/lib/format'
import { nenRanksApi, type NenRankSettingsData } from '@/lib/nen-ranks-api'
import { parseYen, yen, type LoadStatus, type SavedHandler } from './parts'
import styles from './members.module.css'

type MilestoneDraft = { id: string | null; threshold: number; title: string; benefit: string | null; notify: boolean; reachedCount: number }

const MAX_MILESTONES = 12

const fromSettings = (next: NenRankSettingsData): MilestoneDraft[] =>
  next.milestones.map((m) => ({ id: m.id, threshold: m.thresholdYen, title: m.title, benefit: m.benefitNote, notify: m.notifyOnReach, reachedCount: m.reachedCount }))

export default function LifetimeV8({
  accountId,
  status,
  settings,
  onSaved,
  onRetry,
  readonly,
}: {
  accountId: string
  status: LoadStatus
  settings: NenRankSettingsData | null
  onSaved: SavedHandler
  onRetry: () => void
  readonly: boolean
}) {
  const [drafts, setDrafts] = useState<MilestoneDraft[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  /** 編集の窓。index は直す行（新しい行は drafts.length）。 */
  const [editing, setEditing] = useState<{ index: number; threshold: string; title: string; notify: boolean } | null>(null)
  const [editError, setEditError] = useState('')

  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy })

  useEffect(() => {
    if (!settings || dirty) return
    setDrafts(fromSettings(settings))
  }, [settings, dirty])

  const openEdit = (index: number) => {
    const row = drafts[index]
    setEditError('')
    setEditing(row
      ? { index, threshold: String(row.threshold), title: row.title, notify: row.notify }
      : { index, threshold: '', title: '', notify: true })
  }

  const applyEdit = () => {
    if (!editing) return
    const threshold = parseYen(editing.threshold)
    if (!Number.isFinite(threshold) || threshold <= 0) { setEditError('節目の金額は 1 円以上で入れてください。'); return }
    if (!editing.title.trim()) { setEditError('称号を入れてください。'); return }
    setDrafts((current) => {
      const next = [...current]
      const before = next[editing.index]
      const row: MilestoneDraft = before
        ? { ...before, threshold, title: editing.title.trim(), notify: editing.notify }
        : { id: null, threshold, title: editing.title.trim(), benefit: null, notify: editing.notify, reachedCount: 0 }
      next[editing.index] = row
      return next.sort((a, b) => a.threshold - b.threshold)
    })
    setDirty(true)
    setNotice('')
    setEditing(null)
  }

  const remove = (index: number) => {
    setDrafts((current) => current.filter((_, i) => i !== index))
    setDirty(true)
    setNotice('')
  }

  const save = async () => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const res = await nenRanksApi.saveMilestones(accountId, drafts.map((row) => ({
        id: row.id, thresholdYen: row.threshold, title: row.title.trim(), notifyOnReach: row.notify,
      })))
      if (!res.success) throw new Error(res.error)
      setDirty(false)
      onSaved(accountId, res.data)
      setNotice(res.data.sync?.status === 'synced' ? '節目を保存し、ECへ同期しました。' : '節目を保存しました。ECへの同期は失敗したので、ランク設定の「もう一度同期」で送り直せます。')
    } catch (caught) {
      setError(describeApiFailure(caught, '節目の保存', {
        forbidden: '節目を保存する権限がありません。権限を確認してください。',
      }))
    } finally {
      setBusy(false)
    }
  }

  if (status === 'loading' && !settings) return <ListState kind="loading" title="ライフタイムを読み込んでいます" />
  if (status === 'forbidden') return <ListState kind="forbidden" />
  if (status === 'error') return <ListState kind="error" title="ライフタイムを読み込めませんでした" description="通信の状態を確認して、もう一度お試しください。" onRetry={onRetry} />
  if (!settings) return <ListState kind="loading" title="ライフタイムを読み込んでいます" />

  const topThreshold = drafts.reduce((max, row) => Math.max(max, row.threshold), 0)

  return (
    <div className={styles.rankBody}>
      {notice || error ? (
        <div className={styles.messages}>
          {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
          {error ? <p className={styles.errorText} role="alert">{error}</p> : null}
        </div>
      ) : null}

      <section className={styles.card} aria-labelledby="nen-lifetime-title">
        <div className={styles.lifetimeHead}>
          <div className={styles.cardHead}>
            <h2 id="nen-lifetime-title" className={styles.cardTitle}>節目（ライフタイム）</h2>
            <p className={styles.cardDesc}>ライフタイムはこれまでの購入額の累計で、減りません。LINE 連携済みの会員の累計です</p>
          </div>
          <div className={styles.lifetimeTotal}>
            <span className={styles.lifetimeTotalLabel}>ライフタイム 合計</span>
            <span className={styles.lifetimeTotalValue}>{yen(settings.kpis.lifetimeTotalYen)}</span>
          </div>
        </div>

        <div className={styles.lifeTable} role="table" aria-label="節目">
          <div className={styles.lifeHeadRow} role="row">
            <span className={styles.lifeColThreshold} role="columnheader">節目（累計）</span>
            <span className={styles.lifeColTitle} role="columnheader">称号</span>
            <span className={styles.lifeColBenefit} role="columnheader">特典</span>
            <span className={styles.lifeColReached} role="columnheader">到達した人</span>
            <span className={styles.lifeColNotify} role="columnheader">到達時の LINE 通知</span>
            <span className={styles.lifeColAction} role="columnheader"><span className="sr-only">操作</span></span>
          </div>
          {drafts.length === 0 ? (
            <div className={styles.lifeEmpty} role="row">
              <span role="cell">まだ節目がありません。{readonly ? '' : '下の「節目を足す」から作れます。'}</span>
            </div>
          ) : drafts.map((row, index) => (
            <div key={row.id ?? `new-${index}`} className={styles.lifeRow} role="row">
              <span className={styles.lifeColThreshold} role="cell">{yen(row.threshold)}</span>
              <span className={styles.lifeColTitle} role="cell">
                <span className={row.threshold === topThreshold ? styles.lifeTitleTop : styles.lifeTitle} title={row.title}>{row.title}</span>
                {row.threshold === topThreshold && drafts.length > 1 ? <span className={styles.lifeTitleSub}>最上位</span> : null}
              </span>
              <span className={styles.lifeColBenefit} role="cell" title={row.benefit ?? ''}>{row.benefit ?? '未設定'}</span>
              <span className={styles.lifeColReached} role="cell">{formatNumber(row.reachedCount)} 人</span>
              <span className={styles.lifeColNotify} role="cell">{row.notify ? '通知する' : '通知しない'}</span>
              <span className={styles.lifeColAction} role="cell">
                {readonly ? null : (
                  <RowActions
                    subjectName={`節目「${row.title || yen(row.threshold)}」`}
                    menuItems={[{ id: 'edit', label: '編集する', onSelect: () => openEdit(index) }]}
                    destructiveItem={{ id: 'delete', label: '削除する', onSelect: () => remove(index) }}
                  />
                )}
              </span>
            </div>
          ))}
        </div>

        {readonly ? null : (
          <div className={styles.lifeAdd}>
            <button type="button" className={styles.textAction} disabled={drafts.length >= MAX_MILESTONES} onClick={() => openEdit(drafts.length)}>
              ＋ 節目を足す
            </button>
          </div>
        )}
      </section>

      {readonly ? null : (
        <div className={styles.saveRow}>
          <Button variant="secondary" onClick={() => { setDirty(false); setError(''); if (settings) setDrafts(fromSettings(settings)) }} disabled={busy || !dirty}>キャンセル</Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy || !dirty}>
            <Check size={15} aria-hidden="true" />保存して EC へ同期する
          </Button>
        </div>
      )}

      <Dialog
        open={editing !== null}
        designWidth={520}
        title={editing && drafts[editing.index] ? '節目を直す' : '節目を足す'}
        description="金額は、これまでの購入額の累計です。保存は下の「保存して EC へ同期する」でまとめて行います。"
        confirmLabel="決める"
        cancelLabel="キャンセル"
        error={editError}
        onConfirm={applyEdit}
        onCancel={() => setEditing(null)}
      >
        {editing ? (
          <div className={styles.editBody}>
            <label className={styles.removeField}>
              <span className={styles.removeLabel}>節目（累計の金額）</span>
              <TextField inputMode="numeric" placeholder="¥50,000" value={editing.threshold} onChange={(event) => setEditing({ ...editing, threshold: event.target.value })} />
            </label>
            <label className={styles.removeField}>
              <span className={styles.removeLabel}>称号</span>
              <TextField maxLength={30} placeholder="なかよし" value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} />
            </label>
            <div className={styles.editToggle}>
              <Toggle checked={editing.notify} onChange={(checked) => setEditing({ ...editing, notify: checked })} label={editing.notify ? '到達したら LINE で通知する' : '到達しても通知しない'} />
            </div>
          </div>
        ) : null}
      </Dialog>

      <UnsavedLeaveDialog open={leaveTarget !== null} subject="節目への変更" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </div>
  )
}
