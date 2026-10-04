'use client'

import { useCallback, useEffect, useState } from 'react'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Toggle from '@/components/shared/toggle'
import { notifyToast } from '@/components/shared/toast'
import { describeApiFailure } from '@/components/shared/api-error-message'
import { bookingAutoRulesApi, type BookingAutoRules } from '../lib/booking-auto-rules'
import { useV8TabEdit } from './v8-tab-edit'
import styles from './settings-v8.module.css'

type LoadStatus = 'loading' | 'ready' | 'error'

const ROWS: Array<{ field: keyof BookingAutoRules; label: string }> = [
  { field: 'excludeCalendarBlock', label: 'スタッフの Google カレンダーの予定がある時間は、LINE の予約受付から外す（いまの作り）' },
  { field: 'writeBackToCalendar', label: 'LINE で入った予約を、そのスタッフの Google カレンダーへ書き込む（ほかの予約サービスがカレンダーを読めば、そちらの枠も埋まる）' },
  { field: 'autoAssign', label: '指名なしの予約は、その時間に空いているスタッフへ自動で割り当てる' },
  { field: 'mergeDuplicates', label: '同じ予約が2回届いたら1件にまとめる（入り口と予約番号で見分ける）' },
]

const NOTICE_ROWS: Array<{ field: keyof BookingAutoRules; label: string }> = [
  { field: 'conflictNotify', label: '同じスタッフ・同じ時間に2件入ったら、すぐに知らせる（画面と担当の LINE）' },
  { field: 'unconnectedNotify', label: 'Google カレンダーにつながっていないスタッフに外の予約が入ったら、「つないでください」と知らせる' },
  { field: 'dailyLimitNotify', label: 'スタッフの1日の予約が上限に近づいたら、ほかの予約サービスで閉じるよう知らせる' },
]

/** 人の予約の自動で合わせるルール（wJYQb）。7つの切り替えと保存。 */
export default function AutoRulesTabV8({ accountId, canEdit }: { accountId: string; canEdit: boolean }) {
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<BookingAutoRules | null>(null)
  const [draft, setDraft] = useState<BookingAutoRules | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const load = useCallback(async () => {
    setStatus('loading')
    setError('')
    try {
      const res = await bookingAutoRulesApi.get(accountId)
      if (!res.success) throw new Error(res.error)
      setSaved(res.data)
      setDraft(res.data)
      setStatus('ready')
    } catch (e) {
      setError(describeApiFailure(e, 'ルールを読み込めませんでした。'))
      setStatus('error')
    }
  }, [accountId])

  useEffect(() => {
    void load()
  }, [load])

  const dirty = saved !== null && draft !== null && ROWS.concat(NOTICE_ROWS).some(({ field }) => saved[field] !== draft[field])

  const save = async () => {
    if (!draft) return
    setSaving(true)
    setSaveError('')
    try {
      const res = await bookingAutoRulesApi.save(accountId, draft)
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

  /* 書きかけは親の番兵へ載せる（保存帯は出さず、タブのボタンで保存）。 */
  useV8TabEdit({
    dirty,
    saving,
    subject: '予約経路への変更',
    saveDisabled: !canEdit,
    showBar: false,
    onSave: () => void save(),
    onReset: () => { if (saved) setDraft(saved) },
  })

  if (status === 'loading') return <ListState kind="loading" />
  if (status === 'error' || !draft) {
    return <ListState kind="error" title="ルールを読み込めませんでした" description={error} action={<Button onClick={() => void load()}>もう一度読む</Button>} />
  }

  const row = (field: keyof BookingAutoRules, label: string) => (
    <div key={field} className={styles.toggleRow}>
      <span className="text-sm text-ink">{label}</span>
      <Toggle label={label} checked={draft[field]} onChange={(next) => canEdit && setDraft({ ...draft, [field]: next })} />
    </div>
  )

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section className={styles.section} aria-label="外から予約が入ったとき">
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>外から予約が入ったとき</h2>
          <p className={styles.sectionDesc}>どの入り口から入っても、同じ決まりでスタッフの空きを合わせます。</p>
        </div>
        <div>{ROWS.map(({ field, label }) => row(field, label))}</div>
      </section>

      <section className={styles.section} aria-label="重なったとき・閉じ忘れの知らせ">
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>重なったとき・閉じ忘れの知らせ</h2>
          <p className={styles.sectionDesc}>Hot Pepper Beauty などの空き枠は、各サービスの管理画面でしか閉じられません。</p>
        </div>
        <div>{NOTICE_ROWS.map(({ field, label }) => row(field, label))}</div>
      </section>

      {saveError ? <p className="text-sm text-danger" role="alert">{saveError}</p> : null}
      <div className="flex items-center justify-center gap-2">
        <Button variant="secondary" onClick={() => saved && setDraft(saved)} disabled={saving || !dirty}>
          キャンセル
        </Button>
        <Button variant="primary" onClick={() => void save()} disabled={!canEdit || saving || !dirty} busy={saving} busyLabel="保存しています…">
          ✓ ルールを保存
        </Button>
      </div>
    </div>
  )
}
