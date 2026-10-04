'use client'

/*
 * ★V8-B マイル「たまる決めごとを作る」（板 `ctLwT`、競合 `BnrQp`）。
 *
 * 入力欄と保存の口は v7（earning-rules/new/page.tsx）と同じ。
 * 違いは置き場と見せ方——左に「どのルールか・何マイル付けるか・
 * 受け取る人・使えるまで・付けすぎを防ぐ」の段、右に試算と
 * 気をつけること、下に追従の帯（キャンセル・保存して続けて作る・
 * 保存して動かす）。欄は1つも落とさない（倍率・通知・取り消し・
 * すぐ動かすは「詳しい設定」に残す）。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'
import Link from 'next/link'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import type { Tag } from '@line-crm/shared'
import { ApiError, api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import Button from '@/components/shared/button'
import Disclosure from '@/components/shared/disclosure'
import StickyBar from '@/components/shared/sticky-bar'
import Checkbox from '@/components/shared/checkbox'
import Select from '@/components/shared/select'
import DateField from '@/components/shared/date-field'
import ConditionBuilder, {
  pruneCondition,
  type SegmentCondition,
} from '@/components/shared/condition-builder'
import { TextInput } from '@/components/shared/form-controls'
import Notice from '@/components/shared/notice'
import {
  EARNING_RULE_EVENT_TYPES as EVENT_TYPES,
  EARNING_RULE_NOTIFY_TEMPLATE,
  earningRuleCancellationEvent,
} from '../rule-fields'
import { formatMileageNumber } from '../../mileage-display'
import { formatNumber } from '@/lib/format'
import formStyles from './v8-create-form.module.css'

const DAILY_CAPS = [
  ['', '制限なし'],
  ['1', '1日1回まで'],
  ['2', '1日2回まで'],
  ['3', '1日3回まで'],
  ['5', '1日5回まで'],
  ['10', '1日10回まで'],
]

export default function V8EarningRuleNew() {
  const [formNumber, setFormNumber] = useState(0)
  return <EarningRuleForm key={formNumber} focusName={formNumber > 0} onContinue={() => setFormNumber((number) => number + 1)} />
}

function EarningRuleForm({ focusName, onContinue }: { focusName: boolean; onContinue: () => void }) {
  const router = useRouter()
  const nameRef = useRef<HTMLInputElement>(null)
  const { selectedAccountId } = useAccount()
  const [name, setName] = useState('')
  const [eventType, setEventType] = useState<string>('booking_created')
  const [source, setSource] = useState('')
  const [amount, setAmount] = useState('')
  const [grantStyle] = useState('決まった数')
  const [initialStatus, setInitialStatus] = useState<'available' | 'pending'>('available')
  const [ignoreMultiplier, setIgnoreMultiplier] = useState(false)
  const [dailyCap, setDailyCap] = useState('')
  const [uniqueMode, setUniqueMode] = useState<'' | 'subject' | 'subjectPerDay'>('')
  const [beneficiary, setBeneficiary] = useState<'actor' | 'referrer'>('actor')
  const [validFrom, setValidFrom] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [expiresAfterDays, setExpiresAfterDays] = useState('365')
  const [reverseOnCancellation, setReverseOnCancellation] = useState(true)
  const [showConditions, setShowConditions] = useState(false)
  const [targetConditions, setTargetConditions] = useState<SegmentCondition | null>(null)
  const [isActive, setIsActive] = useState(true)
  const [notifyFriend, setNotifyFriend] = useState(true)
  const [tags, setTags] = useState<Tag[]>([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [conflict, setConflict] = useState(false)
  /* 試算（この設定だとこう貯まります）。 */
  const [trialBusy, setTrialBusy] = useState(false)
  const [trialError, setTrialError] = useState('')
  const [trial, setTrial] = useState<{ matchedFriends: number; estimatedTotalMiles: number } | null>(null)
  const createKeyRef = useRef<{ fingerprint: string; key: string } | null>(null)

  useEffect(() => {
    if (focusName) nameRef.current?.focus()
  }, [focusName])

  useEffect(() => {
    let cancelled = false
    void api.tags.list(selectedAccountId ? { accountId: selectedAccountId } : undefined).then((res) => {
      if (!cancelled && res.success) setTags(res.data)
    }).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [selectedAccountId])

  const selected = EVENT_TYPES.find((t) => t.value === eventType) ?? EVENT_TYPES[0]
  const value = Number(amount)
  const validAmount = Number.isInteger(value) && value >= 1
  const expiryDays = expiresAfterDays === '' ? null : Number(expiresAfterDays)
  const cancellationEvent = earningRuleCancellationEvent(eventType)

  const multiplierTags = useMemo(
    () =>
      tags
        .filter((t) => t.mileageMultiplierBps != null)
        .sort((a, b) => (b.mileageMultiplierPriority ?? 0) - (a.mileageMultiplierPriority ?? 0)),
    [tags],
  )

  const dirty = Boolean(
    name || eventType !== 'booking_created' || source ||
    amount || initialStatus !== 'available' || ignoreMultiplier || dailyCap ||
    uniqueMode || beneficiary !== 'actor' || validFrom || validUntil ||
    expiresAfterDays !== '365' || !reverseOnCancellation || targetConditions !== null ||
    !isActive || !notifyFriend,
  )
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: saving })

  const validate = () => {
    if (!name.trim()) return 'ルール名を入力してください'
    if (!validAmount) return '付与マイルは1以上の整数で入力してください'
    if (!selectedAccountId) return 'LINEアカウントを選択してください'
    if (expiryDays !== null && (!Number.isInteger(expiryDays) || expiryDays < 1 || expiryDays > 3650)) {
      return '有効期限は1〜3650日で入力してください'
    }
    if (validFrom && validUntil && validFrom > validUntil) {
      return '終了日は開始日より後にしてください'
    }
    return null
  }

  const buildPayload = () => ({
    name: name.trim(),
    eventType,
    source: source || null,
    amount: value,
    initialStatus,
    lineAccountId: selectedAccountId!,
    conditions: {
      ...(dailyCap ? { dailyCapActions: Number(dailyCap) } : {}),
      ...(uniqueMode === 'subject' ? { uniquePerSubject: true } : {}),
      ...(uniqueMode === 'subjectPerDay' ? { uniquePerSubjectPerDay: true } : {}),
      ...(ignoreMultiplier ? { ignoreMultiplier: true } : {}),
      ...(beneficiary === 'referrer' ? { beneficiary: 'referrer' as const } : {}),
    },
    validFrom: validFrom || null,
    validUntil: validUntil || null,
    isActive,
  })

  const save = async (continueAfter: boolean) => {
    const problem = validate()
    if (problem) {
      setSaveError(problem)
      return
    }
    setSaving(true)
    setSaveError('')
    setConflict(false)
    try {
      const payload = buildPayload()
      const fingerprint = JSON.stringify(payload)
      if (createKeyRef.current?.fingerprint !== fingerprint) {
        createKeyRef.current = { fingerprint, key: crypto.randomUUID() }
      }
      const res = await api.mileage.createRule(payload, { idempotencyKey: createKeyRef.current.key })
      if (!res.success) throw new Error(res.error)
      const draftResponse = await api.mileage.saveEarningRuleDraft(res.data.id, {
        accountId: selectedAccountId!,
        expectedVersion: 0,
        draft: {
          name: name.trim(),
          eventType,
          source: source || null,
          amount: value,
          initialStatus,
          validFrom: validFrom || null,
          validUntil: validUntil || null,
          expiresAfterDays: expiryDays,
          cancellationEventTypes: reverseOnCancellation && cancellationEvent ? [cancellationEvent] : [],
          targetConditions: pruneCondition(targetConditions),
          sortOrder: 0,
          notification: {
            enabled: notifyFriend,
            messageTemplate: EARNING_RULE_NOTIFY_TEMPLATE,
          },
        },
      })
      if (!draftResponse.success) {
        const deleted = await api.mileage.deleteRule(res.data.id).catch(() => null)
        if (!deleted?.success) {
          await api.mileage.updateRule(res.data.id, { isActive: false }).catch(() => undefined)
          throw new Error(`${draftResponse.error}(作りかけの決めごとが残っているかもしれません。一覧で確認してください)`)
        }
        throw new Error(draftResponse.error)
      }
      if (continueAfter) {
        onContinue()
      } else {
        router.push('/mileage?tab=earning-rules')
      }
    } catch (caught) {
      /* BnrQp：同時に作られた・版がずれたときは競合の帯で知らせる。 */
      if (caught instanceof ApiError && caught.status === 409) {
        setConflict(true)
        setSaveError('')
      } else {
        setSaveError(caught instanceof Error ? caught.message : '保存できませんでした。もう一度お試しください。')
      }
    } finally {
      setSaving(false)
    }
  }

  const runTrial = async () => {
    if (!selectedAccountId || trialBusy) return
    const problem = validate()
    if (problem) {
      setTrialError(problem)
      return
    }
    setTrialBusy(true)
    setTrialError('')
    try {
      const response = await api.mileage.testEarningRule(selectedAccountId, {
        name: name.trim(),
        eventType,
        source: source || null,
        amount: value,
        initialStatus,
        validFrom: validFrom || null,
        validUntil: validUntil || null,
        expiresAfterDays: expiryDays,
        cancellationEventTypes: reverseOnCancellation && cancellationEvent ? [cancellationEvent] : [],
        targetConditions: pruneCondition(targetConditions),
        sortOrder: 0,
      })
      if (!response.success) throw new Error(response.error)
      setTrial({
        matchedFriends: response.data.matchedFriends,
        estimatedTotalMiles: response.data.estimatedTotalMiles,
      })
    } catch (caught) {
      setTrial(null)
      setTrialError(caught instanceof Error ? caught.message : '試算できませんでした。もう一度お試しください。')
    } finally {
      setTrialBusy(false)
    }
  }

  return (
    <div data-design-node={conflict ? "BnrQp" : "ctLwT"} className={formStyles.page}>
      <div className={formStyles.head}>
        <Link className={formStyles.back} href="/mileage?tab=earning-rules">← マイルへ</Link>
        <h1 className={formStyles.title}>たまる決めごとを作る</h1>
        <p className={formStyles.description}>どの行動で・何マイル・だれに付けるかを決めます。作った日からの行動に付きます（さかのぼらない）。</p>
      </div>

      {conflict ? (
        <div className={formStyles.conflict} role="alert">
          <p className={formStyles.conflictTitle}>ほかの人が先にこの決めごとを変えました</p>
          <p className={formStyles.conflictText}>
            開いている間に内容が変わっています。そのまま保存すると上書きになります。
            一覧で最新の内容を確かめてから、もう一度作り直してください。
          </p>
          <div className={formStyles.conflictActions}>
            <Button href="/mileage?tab=earning-rules">最新の内容を読み込んで続ける</Button>
            <Button variant="primary" onClick={() => void save(false)} disabled={saving} busy={saving} busyLabel="保存しています">
              比べてから保存
            </Button>
          </div>
        </div>
      ) : null}
      {saveError ? <Notice tone="danger" message={saveError} /> : null}

      <div className={formStyles.columns}>
        <div className={formStyles.main}>
          <section className={formStyles.card} aria-label="どのルールか">
            <h2 className={formStyles.cardTitle}>どのルールか</h2>
            <p className={formStyles.cardNote}>きっかけになる行動を選びます</p>
            <label className={formStyles.field}>
              <span className={formStyles.label}>名前 <span className={formStyles.required}>必須</span></span>
              <TextInput
                ref={nameRef}
                id="sc-name"
                aria-label="名前"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例：リンクをクリック"
              />
            </label>
            <div className={formStyles.grid2}>
              <label className={formStyles.field}>
                <span className={formStyles.label}>きっかけ <span className={formStyles.required}>必須</span></span>
                <Select
                  aria-label="きっかけ"
                  value={eventType}
                  onChange={(next) => {
                    setEventType(next)
                    setSource('')
                  }}
                  options={EVENT_TYPES.map((t) => ({ value: t.value, label: t.label }))}
                  size="full"
                />
                <span className={formStyles.hint}>{selected.note}</span>
              </label>
              <label className={formStyles.field}>
                <span className={formStyles.label}>行動の出どころ</span>
                <Select
                  aria-label="行動の出どころ"
                  value={source}
                  onChange={(next) => setSource(next)}
                  size="full"
                  options={selected.sources.map(([optionValue, label]) => ({ value: optionValue, label }))}
                />
              </label>
            </div>
            <button type="button" className={formStyles.linkButton} onClick={() => setShowConditions((v) => !v)} aria-expanded={showConditions}>
              ＋ 条件を足す（タグ・友だち情報など）
            </button>
            {showConditions ? (
              <div className={formStyles.conditionBox}>
                <ConditionBuilder value={targetConditions} onChange={setTargetConditions} label="利用対象の条件" />
                <p className={formStyles.hint}>条件を付けない場合は全員が対象です。</p>
              </div>
            ) : null}
          </section>

          <section className={formStyles.card} aria-label="何マイル付けるか">
            <h2 className={formStyles.cardTitle}>何マイル付けるか</h2>
            <div className={formStyles.grid2}>
              <label className={formStyles.field}>
                <span className={formStyles.label}>マイル <span className={formStyles.required}>必須</span></span>
                <TextInput
                  type="number"
                  min={1}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <label className={formStyles.field}>
                <span className={formStyles.label}>付け方</span>
                <Select
                  aria-label="付け方"
                  value={grantStyle}
                  onChange={() => {}}
                  size="full"
                  options={[{ value: '決まった数', label: '決まった数' }]}
                  disabled
                />
              </label>
            </div>
          </section>

          <section className={formStyles.card} aria-label="受け取る人・使えるまで">
            <h2 className={formStyles.cardTitle}>受け取る人・使えるまで</h2>
            <RadioCardGroup legend="受け取る人" className={formStyles.grid2}>
              {([
                { value: 'actor' as const, title: '行動した本人', note: 'そのまま本人の残高に' },
                { value: 'referrer' as const, title: '紹介した人', note: 'この人を紹介した相手に' },
              ]).map((option) => (
                <RadioCard key={option.value} name="beneficiary" value={option.value}
                  checked={beneficiary === option.value} onChange={() => setBeneficiary(option.value)}
                  title={option.title} note={option.note} />
              ))}
            </RadioCardGroup>
            <div className={formStyles.choiceGroup}>
            <RadioCardGroup legend="使えるまで" className={formStyles.grid2}>
              {([
                { value: 'available' as const, title: 'すぐ使える', note: 'その場で残高に入る' },
                { value: 'pending' as const, title: '確定待ち', note: '確定するまで使えない' },
              ]).map((option) => (
                <RadioCard key={option.value} name="initial-status" value={option.value}
                  checked={initialStatus === option.value} onChange={() => setInitialStatus(option.value)}
                  title={option.title} note={option.note} />
              ))}
            </RadioCardGroup>
            </div>
          </section>

          <section className={formStyles.card} aria-label="付けすぎを防ぐ">
            <h2 className={formStyles.cardTitle}>付けすぎを防ぐ</h2>
            <div className={formStyles.grid2}>
              <label className={formStyles.field}>
                <span className={formStyles.label}>1日に数える回数</span>
                <Select
                  aria-label="1日に数える回数"
                  value={dailyCap}
                  onChange={(next) => setDailyCap(next)}
                  size="full"
                  options={DAILY_CAPS.map(([optionValue, label]) => ({ value: optionValue, label }))}
                />
              </label>
              <label className={formStyles.field}>
                <span className={formStyles.label}>同じ対象の数えかた</span>
                <Select
                  aria-label="同じ対象の数えかた"
                  value={uniqueMode}
                  onChange={(next) => setUniqueMode(next as typeof uniqueMode)}
                  size="full"
                  options={[
                    { value: '', label: '何度でも数える' },
                    { value: 'subject', label: '同じ対象は1回' },
                    { value: 'subjectPerDay', label: '同じURLは1回' },
                  ]}
                />
              </label>
            </div>
            <div className={formStyles.grid2}>
              <label className={formStyles.field}>
                <span className={formStyles.label}>開始日</span>
                <DateField value={validFrom} onChange={setValidFrom} aria-label="開始日" />
              </label>
              <label className={formStyles.field}>
                <span className={formStyles.label}>終了日 <span className={formStyles.optional}>任意</span></span>
                <DateField value={validUntil} onChange={setValidUntil} aria-label="終了日" />
              </label>
            </div>
            <Disclosure title="詳しい設定（倍率・通知・取り消し・公開）" size="compact">
              <div className={formStyles.detailsBody}>
                <label className={formStyles.field}>
                  <span className={formStyles.label}>付いたマイルの有効期限</span>
                  <span className={formStyles.inlineRow}>
                    <TextInput type="number" min={1} max={3650} value={expiresAfterDays} onChange={(e) => setExpiresAfterDays(e.target.value)} aria-label="有効期限の日数" />
                    <span className={formStyles.hint}>日後（空欄なら期限なし）</span>
                  </span>
                </label>
                <Checkbox
                  checked={ignoreMultiplier}
                  onCheckedChange={setIgnoreMultiplier}
                  description="誰でも同じ額にしたいときに選びます。"
                >
                  会員ランクの倍率をかけない
                </Checkbox>
                {cancellationEvent ? (
                  <Checkbox
                    checked={reverseOnCancellation}
                    onCheckedChange={setReverseOnCancellation}
                    description={`${eventType === 'booking_created' ? '予約の取り消し' : '注文の取り消し'}を同じ記録から追跡します。`}
                  >
                    取り消されたら、付けたぶんを引く
                  </Checkbox>
                ) : null}
                <Checkbox
                  checked={notifyFriend}
                  onCheckedChange={setNotifyFriend}
                >
                  マイルが付いたら、この内容を自動で知らせる
                </Checkbox>
                <Checkbox
                  checked={isActive}
                  onCheckedChange={setIsActive}
                  description="オフにすると停止中で保存します。"
                >
                  作成したらすぐ動かす
                </Checkbox>
              </div>
            </Disclosure>
          </section>
        </div>

        <aside className={formStyles.aside}>
          <section className={formStyles.card} aria-label="この設定だとこう貯まります">
            <h2 className={formStyles.cardTitle}>この設定だとこう貯まります</h2>
            <p className={formStyles.hint}>この30日に当てはめた見込み</p>
            {trialError ? <Notice tone="danger" message={trialError} /> : null}
            <dl className={formStyles.trialRows}>
              <div className={formStyles.trialRow}>
                <dt>当てはまる人</dt>
                <dd>{trialBusy ? '数えています…' : trial ? `${formatNumber(trial.matchedFriends)}人` : '—'}</dd>
              </div>
              <div className={formStyles.trialRow}>
                <dt>付くマイル</dt>
                <dd>{trialBusy ? '数えています…' : trial ? formatMileageNumber(trial.estimatedTotalMiles) : '—'}</dd>
              </div>
              <div className={formStyles.trialRow}>
                <dt>1人あたり</dt>
                <dd>
                  {validAmount ? formatMileageNumber(value) : '—'}
                  {dailyCap ? `（1日${dailyCap}回まで）` : ''}
                </dd>
              </div>
            </dl>
            <Button onClick={() => void runTrial()} disabled={trialBusy} busy={trialBusy} busyLabel="数えています">
              この条件で試算
            </Button>
            {multiplierTags.length > 0 && !ignoreMultiplier ? (
              <p className={formStyles.hint}>
                倍率はタグ側の設定で決まります。優先度がいちばん高いタグ1枚だけが効きます。
              </p>
            ) : null}
          </section>

          <section className={formStyles.card} aria-label="気をつけること">
            <h2 className={formStyles.cardTitle}>気をつけること</h2>
            <ul className={formStyles.cautionList}>
              <li>付けたマイルはあとから消せません（減らすで取り消しの明細を足します）</li>
              <li>確定待ちは、確定の日まで残高に入りません</li>
            </ul>
          </section>
        </aside>
      </div>

      <StickyBar actions={<>
        <Button variant="secondary" href="/mileage?tab=earning-rules">キャンセル</Button>
        <Button variant="secondary" onClick={() => void save(true)} disabled={saving} busy={saving} busyLabel="保存しています">
          保存して続けて作る
        </Button>
        <Button variant="primary" onClick={() => void save(false)} disabled={saving} busy={saving} busyLabel="保存しています">
          <Check size={14} aria-hidden="true" /> 保存して動かす
        </Button>
      </>} />

      <UnsavedLeaveDialog open={leaveTarget !== null} subject="入力した決めごと" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </div>
  )
}
