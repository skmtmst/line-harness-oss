'use client'

import { useCallback, useEffect, useState } from 'react'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Select from '@/components/shared/select'
import Toggle from '@/components/shared/toggle'
import { notifyToast } from '@/components/shared/toast'
import { describeApiFailure } from '@/components/shared/api-error-message'
import { storeAutoRulesApi, type StoreAutoAction, type StoreAutoRules } from '../lib/store-auto-rules'
import { Panel } from './shell'
import styles from './store-auto-rules.module.css'

type LoadStatus = 'loading' | 'ready' | 'error'

const ACTION_OPTIONS = [
  { value: 'stop', label: '止める' },
  { value: 'reduce', label: '減らす' },
  { value: 'keep', label: '変えない' },
]

/** 予約枠・在庫の自動で合わせるルール（nGcY1・店ごと）。書きかけは親の番兵へ報告する。 */
export default function StoreAutoRulesTab({ storeId, accountId, onDirtyChange }: { storeId: string | null; accountId: string; onDirtyChange?: (dirty: boolean) => void }) {
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<StoreAutoRules | null>(null)
  const [draft, setDraft] = useState<StoreAutoRules | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const load = useCallback(async () => {
    if (!storeId) {
      setStatus('ready')
      return
    }
    setStatus('loading')
    setError('')
    try {
      const res = await storeAutoRulesApi.get(storeId, accountId)
      if (!res.success) throw new Error(res.error)
      setSaved(res.data)
      setDraft(res.data)
      setStatus('ready')
    } catch (e) {
      setError(describeApiFailure(e, 'ルールを読み込めませんでした。'))
      setStatus('error')
    }
  }, [storeId, accountId])

  useEffect(() => {
    setSaved(null)
    setDraft(null)
    void load()
  }, [load])

  const dirty = saved !== null && draft !== null && (
    saved.autoTableAssign !== draft.autoTableAssign
    || saved.recountSeats !== draft.recountSeats
    || saved.mergeDuplicates !== draft.mergeDuplicates
    || saved.lowSeatThreshold !== draft.lowSeatThreshold
    || saved.lineAction !== draft.lineAction
    || saved.walkinAction !== draft.walkinAction
    || saved.closeBanner !== draft.closeBanner
    || saved.lineNotifyManager !== draft.lineNotifyManager
    || saved.conflictNotify !== draft.conflictNotify
  )

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  const save = async () => {
    if (!storeId || !draft) return
    setSaving(true)
    setSaveError('')
    try {
      const res = await storeAutoRulesApi.save(storeId, accountId, draft)
      if (!res.success) throw new Error(res.error)
      setSaved(res.data)
      setDraft(res.data)
      notifyToast('ルールを保存しました。')
    } catch (e) {
      setSaveError(describeApiFailure(e, '保存できませんでした。'))
    } finally {
      setSaving(false)
    }
  }

  if (!storeId) {
    return <ListState kind="empty" title="店舗を選んでください" description="上の店舗選びで店舗を選ぶと、その店のルールが出ます。" emptyPreset="readonly" />
  }
  if (status === 'loading') return <ListState kind="loading" />
  if (status === 'error' || !draft) {
    return <ListState kind="error" title="ルールを読み込めませんでした" description={error} action={<Button onClick={() => void load()}>もう一度読む</Button>} />
  }

  const set = (patch: Partial<StoreAutoRules>) => setDraft({ ...draft, ...patch })
  const row = (field: 'autoTableAssign' | 'recountSeats' | 'mergeDuplicates' | 'closeBanner' | 'lineNotifyManager' | 'conflictNotify', label: string) => (
    <div key={field} className={styles.toggleRow}>
      <Toggle label={label} checked={draft[field]} onChange={(next) => set({ [field]: next })} />
      <span>{label}</span>
    </div>
  )
  const action = (field: 'lineAction' | 'walkinAction', label: string) => (
    <label className={styles.field}>{label}
      <Select
        aria-label={label}
        value={draft[field]}
        options={ACTION_OPTIONS}
        onChange={(value) => set({ [field]: value as StoreAutoAction })}
      />
    </label>
  )

  return (
    <div className={styles.stack}>
      <Panel title="予約が入ったとき" description="どの経路から入っても、同じ決まりで台帳と予約枠を合わせます。">
        <div>
          {row('autoTableAssign', '卓を自動で割り当てる（座席・卓管理の自動配置ルール）')}
          {row('recountSeats', '時間帯の残り席を数え直す（取消は席を戻す）')}
          {row('mergeDuplicates', '同じ予約が2回届いたら1件にまとめる（媒体と予約番号で見分ける）')}
        </div>
      </Panel>

      <Panel title="残りが少なくなったとき（自社の受付は自動で変える）" description="LINE と当日の受付は musubo が持っているので、自動で減らしたり止めたりできます。">
        <div className={styles.fields}>
          <label className={styles.field}>残り席がこの数以下で
            <input
              type="number"
              min={0}
              aria-label="残り席がこの数以下で"
              value={draft.lowSeatThreshold}
              onChange={(event) => set({ lowSeatThreshold: Math.max(0, Number(event.target.value) || 0) })}
              className={styles.numberInput}
            />
          </label>
          {action('lineAction', 'LINE の受付')}
          {action('walkinAction', '当日（ウォークイン）枠')}
        </div>
        <p className={styles.note}>例：19:00 の残りが 4 席になったら、LINE からの 19:00 の予約を止め、当日枠を 6 → 3 にします。席が戻ったら（取消など）元に戻します。</p>
      </Panel>

      <Panel title="媒体の受付を閉じる知らせ（媒体へは自動で書き戻さない）" description="Hot Pepper・食べログなどの空き枠は、各媒体の管理画面でしか閉じられません。満席・残りわずかになったら、担当に知らせます。">
        <div>
          {row('closeBanner', '画面の上に「閉じてください」の帯を出す')}
          {row('lineNotifyManager', '担当に LINE で知らせる（店長・当日の責任者）')}
          {row('conflictNotify', '重なった予約（同じ卓に2件）が入ったら、すぐに知らせる')}
        </div>
        <p className={styles.note}>将来、媒体の空き枠をまとめて変えられる仕組み（サイトコントローラー）とつなげば、ここを自動にできます。</p>
      </Panel>

      {saveError ? <p className={styles.saveError} role="alert">{saveError}</p> : null}
      <div className={styles.saveRow}>
        <Button onClick={() => saved && setDraft(saved)} disabled={saving || !dirty}>
          キャンセル
        </Button>
        <Button variant="primary" onClick={() => void save()} disabled={saving || !dirty} busy={saving} busyLabel="保存しています…">
          ✓ ルールを保存
        </Button>
      </div>
    </div>
  )
}
