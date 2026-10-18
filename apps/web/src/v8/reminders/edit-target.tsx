'use client'

import { StageFrame } from './edit-model'

import { reminderTriggerLabel,renderReminderBodySample } from '@/components/reminders/reminder-labels'
import Button from '@/components/shared/button'
import { SettingCheckbox } from '@/components/shared/checkbox'
import ConditionBuilder,{ pruneCondition,type SegmentCondition } from '@/components/shared/condition-builder'
import Dialog from '@/components/shared/dialog'
import { emptyValue } from '@/components/shared/empty-value'
import { SaveErrorField } from '@/components/shared/save-form-errors'
import { CreatePage } from '@/components/templates'
import { useAccount } from '@/contexts/account-context'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import {
type ReminderDraftSettings,
type ReminderValidationResult
} from '@line-crm/shared'
import {
ArrowRight,
Filter,
RefreshCw,
Users
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect,useState } from 'react'
import { countLabel,reminderAudienceCounts } from './edit-model'
import styles from './edit.module.css'
import { ChoiceCardV8,PhoneV8,SummaryCardV8,WizardFooterV8 } from './ui'

/* ---------------- 手順2：対象者と止める条件（YChR6） ---------------- */
export function TargetStageV8({
  frame,
  notice,
  reminderId,
  settings,
  validation,
  validationFailed = false,
  onRetryValidation,
  onChange,
  busy,
  onNext,
  onSaveDraft,
  onCancel,
}: {
  frame: StageFrame
  notice: ReactNode
  reminderId: string
  settings: ReminderDraftSettings
  validation: ReminderValidationResult | null
  validationFailed?: boolean
  onRetryValidation?: () => void
  onChange: (value: ReminderDraftSettings) => void
  busy: boolean
  onNext: () => void
  onSaveDraft: () => void
  onCancel: () => void
}) {
  const { selectedAccount } = useAccount()
  const stop = settings.stopConditions
  const condition = (settings.targetCondition ?? null) as SegmentCondition | null
  const mode = condition !== null ? 'condition' : 'all'

  // 保存前の条件で数え直した人数。条件が空なら保存済みの検査結果を出す。
  const [recount, setRecount] = useState<{ matched: number; excluded: number; sample: Array<{ id: string; displayName: string }> } | null>(null)
  const [counting, setCounting] = useState(false)
  const [recountError, setRecountError] = useState('')
  const [recountRetryToken, setRecountRetryToken] = useState(0)
  const [facesOpen, setFacesOpen] = useState(false)
  const [faces, setFaces] = useState<{ loading: boolean; error: string; sample: Array<{ id: string; displayName: string }>; matched: number | null } | null>(null)

  useEffect(() => {
    const pruned = pruneCondition(condition)
    if (!pruned) {
      setRecount(null)
      setRecountError('')
      setCounting(false)
      return
    }
    setCounting(true)
    setRecountError('')
    let active = true
    const timer = setTimeout(() => {
      void api.reminders.audience(reminderId, pruned).then((response) => {
        if (!active) return
        setCounting(false)
        if (response.success) setRecount(response.data)
        else setRecountError(response.error)
      }).catch(() => {
        if (!active) return
        setCounting(false)
        setRecountError('対象者を数え直せませんでした。')
      })
    }, 400)
    return () => {
      active = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reminderId, JSON.stringify(condition), recountRetryToken])

  const savedAudience = reminderAudienceCounts(validation)
  const matched = recount ? recount.matched : savedAudience.matched
  const total = recount ? recount.matched + recount.excluded : savedAudience.total
  const excluded = recount ? recount.excluded : savedAudience.excluded

  function openFaces() {
    if (recount) {
      setFaces({ loading: false, error: '', sample: recount.sample, matched: recount.matched })
    } else {
      setFaces({ loading: true, error: '', sample: [], matched: null })
      void api.reminders.audience(reminderId).then((response) => {
        if (response.success) setFaces({ loading: false, error: '', sample: response.data.sample, matched: response.data.matched })
        else setFaces({ loading: false, error: response.error, sample: [], matched: null })
      }).catch(() => setFaces({ loading: false, error: '対象者を確認できませんでした。', sample: [], matched: null }))
    }
    setFacesOpen(true)
  }

  const allLabel = settings.triggerType === 'friend_field' ? '基準日が入っている人すべて' : '予約がある人すべて'
  const allNote = settings.triggerType === 'friend_field' ? '情報欄に日付が入った人' : '予約日時が入った人'
  const audienceNote = settings.triggerType === 'friend_field' ? '基準日が入っている友だちに送ります' : '予約日時が入っている友だちに送ります'
  const firstStep = settings.steps[0] ?? null

  const stopRows: Array<{ key: string; title: string; note: string; label: string; checked: boolean; locked?: boolean; onChange?: (next: boolean) => void }> = [
    { key: 'cancel', title: '予約がキャンセルされた', note: 'すぐ止める', label: '予約がキャンセルされたら止める', checked: stop.bookingCancelled, onChange: (next) => onChange({ ...settings, stopConditions: { ...stop, bookingCancelled: next } }) },
    { key: 'done', title: '対応マークが「完了」になった', note: '残りを止める', label: '対応マークが完了になったら止める', checked: stop.supportMarkCompleted, onChange: (next) => onChange({ ...settings, stopConditions: { ...stop, supportMarkCompleted: next } }) },
    { key: 'days', title: '基準日を7日過ぎた', note: '自動で終わる', label: '基準日を7日過ぎたら自動で終わる', checked: stop.daysAfterTarget != null, onChange: (next) => onChange({ ...settings, stopConditions: { ...stop, daysAfterTarget: next ? 7 : null } }) },
    // ブロックは LINE 側で止まる。切っても届かないので、変えられない入口として出す。
    { key: 'block', title: '友だちがブロックした', note: 'すぐ止める（変えられません）', label: '友だちがブロックしたら止める', checked: true, locked: true },
  ]

  return (
    <CreatePage
      {...frame}
      preview={(
        <>
          <SummaryCardV8
            rows={[
              { key: '基準日', value: reminderTriggerLabel(settings.triggerType) },
              { key: '対象者', value: matched == null ? emptyValue('unknown') : `${formatNumber(matched)}人に送る予定` },
              { key: '通知', value: settings.steps.length > 0 ? `${settings.steps.length}通` : '手順3で作る' },
              { key: '状態', value: '下書き' },
            ]}
          />
          <PhoneV8
            accountName={selectedAccount?.name ?? 'LINE公式アカウント'}
            chip={firstStep ? '1通目の通知' : '通知は手順3で作ります'}
            empty={!firstStep}
            message={firstStep ? renderReminderBodySample(firstStep.messageContent || '本文はまだありません') : undefined}
          />
        </>
      )}
      footerActions={(
        <WizardFooterV8
          onCancel={onCancel}
          cancelDisabled={busy}
          onDraft={onSaveDraft}
          draftBusy={busy}
          nextLabel="次へ：通知の中身"
          nextIcon={<ArrowRight size={15} aria-hidden="true" />}
          onNext={onNext}
          nextDisabled={busy}
        />
      )} dirty={false}
    >
      {notice}
      <section className={styles.card} aria-labelledby="rm-target-title">
        <div className={styles.cardHead}>
          <h2 id="rm-target-title" className={styles.cardTitle}>対象者</h2>
          <p className={styles.cardNote}>{audienceNote}</p>
        </div>
        <div className={styles.choiceRow} role="radiogroup" aria-label="対象者">
          <SaveErrorField names={["reminder-v8-audience","mode"]}><ChoiceCardV8
            name="reminder-v8-audience"
            value="all"
            checked={mode === 'all'}
            onChange={() => onChange({ ...settings, targetCondition: null })}
            icon={<Users size={18} />}
            title={allLabel}
            note={allNote}
          /></SaveErrorField>
          <SaveErrorField names={["reminder-v8-audience","mode"]}><ChoiceCardV8
            name="reminder-v8-audience"
            value="condition"
            checked={mode === 'condition'}
            onChange={() => onChange({ ...settings, targetCondition: condition ?? { operator: 'AND', rules: [], groups: [] } })}
            icon={<Filter size={18} />}
            title="条件に合う人だけ"
            note="タグ・友だち情報などで絞る"
          /></SaveErrorField>
        </div>
        {mode === 'condition' ? (
          <ConditionBuilder value={condition} showCount={false} onChange={(next) => onChange({ ...settings, targetCondition: next })} />
        ) : null}
        <div className={styles.countBand} aria-label={`対象人数：当てはまる ${countLabel(total, '人')}・送る予定 ${countLabel(matched, '人')}・除く ${countLabel(excluded, '人')}`}>
          <div className={styles.countItem}>
            <span className={styles.countLabel}>当てはまる人</span>
            <strong className={styles.countValue}>{`${counting ? '…' : total == null ? emptyValue('unknown') : formatNumber(total)} 人`}</strong>
          </div>
          <div className={styles.countItem}>
            <span className={styles.countLabel}>送る予定（ブロックを除く）</span>
            <strong className={styles.countValue}>{`${counting ? '…' : matched == null ? emptyValue('unknown') : formatNumber(matched)} 人`}</strong>
          </div>
          <span className={styles.spacer} aria-hidden="true" />
          <Button type="button" variant="text" onClick={openFaces} disabled={counting}>
            <Users size={15} aria-hidden="true" />顔ぶれを見る
          </Button>
          <Button
            type="button"
            variant="text"
            disabled={counting}
            onClick={() => (mode === 'condition' ? setRecountRetryToken((value) => value + 1) : onRetryValidation?.())}
          >
            <RefreshCw size={15} aria-hidden="true" />数え直す
          </Button>
          <span className={styles.countNote} title="数え直しにかかる時間：数秒〜1分（1,000人ごとに約10秒）">数秒〜1分</span>
        </div>
        {recountError ? <p className={styles.fieldNote}>対象者を数え直せませんでした。保存済みの人数を表示しています。</p> : null}
        {validationFailed ? <p className={styles.fieldNote}>公開前チェックを実行できませんでした。人数は未取得のままです。</p> : null}
        <p className={styles.cardNote}>基準日が登録・変更されたときに、対象かどうかを自動で見直します。</p>
      </section>

      <section className={styles.card} aria-labelledby="rm-stop-title">
        <div className={styles.cardHead}>
          <h2 id="rm-stop-title" className={styles.cardTitle}>止める条件</h2>
          <p className={styles.cardNote}>当てはまったら、その人への残りの通知を止めます</p>
        </div>
        <div className={styles.stopList}>
          {stopRows.map((row, saveFieldIndex) => (
            <div key={row.key} className={styles.stopRow}>
              <span className={styles.stopText}>
                <span className={styles.stopTitle}>{row.title}</span>
                <span className={styles.stopNote}>{row.note}</span>
              </span>
              {row.locked
                ? <SettingCheckbox label={row.label} checked locked />
                : <SaveErrorField names={[`stopRows.${saveFieldIndex}.checked`,"checked","row.checked"]}><SettingCheckbox label={row.label} checked={row.checked} onChange={(next) => row.onChange?.(next)} /></SaveErrorField>}
            </div>
          ))}
        </div>
      </section>

      <section className={styles.card} aria-labelledby="rm-rule-title">
        <div className={styles.cardHead}>
          <h2 id="rm-rule-title" className={styles.cardTitle}>いつも守る決まり</h2>
          <p className={styles.ruleText}>
            ・基準日が空欄の人には始めない<br />
            ・過去の日時になった通知は送らない<br />
            ・同じ時刻に重なった通知は1通にまとめる
          </p>
        </div>
      </section>

      <Dialog
        open={facesOpen}
        title="対象者を確認"
        description={faces?.matched != null ? `送る予定 ${countLabel(faces.matched, '人')}の先頭${faces.sample.length} 人です。` : undefined}
        onCancel={() => setFacesOpen(false)}
      >
        {!faces || faces.loading
          ? <p className={styles.fieldNote}>数えています…</p>
          : faces.error
            ? <p className={styles.fieldNote}>{faces.error}</p>
            : faces.sample.length === 0
              ? <p className={styles.fieldNote}>条件に当てはまる人がまだいません。条件をゆるめるとここに出ます。</p>
              : <ul className={styles.diffList}>{faces.sample.map((friend) => <li key={friend.id}>{friend.displayName}</li>)}</ul>}
      </Dialog>
    </CreatePage>
  )
}
