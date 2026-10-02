'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Checkbox from '@/components/shared/checkbox'
import Select from '@/components/shared/select'
import Button from '@/components/shared/button'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import CreatePage, {
  AsideCard,
  ChoiceCard,
  Field,
  FormSection,
} from '@/components/shared/create-page'
import { TextInput } from '@/components/shared/form-controls'
import LinePreview from '@/components/shared/line-preview'
import DateField from '@/components/shared/date-field'
import ConditionBuilder, {
  pruneCondition,
  type SegmentCondition,
} from '@/components/shared/condition-builder'
import { api, ApiError, type MileageEarningRuleV6 } from '@/lib/api'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import {
  EARNING_RULE_EVENT_TYPES as EVENT_TYPES,
  EARNING_RULE_NOTIFY_TEMPLATE,
  earningRuleCancellationEvent,
} from '../rule-fields'

/**
 * たまる決めごとの下書きを編集する（R296: 一覧からの入口が無かった）。
 *
 * 直せるのは下書きの項目だけ。**動いている内容はここを保存しても変わらず、
 * 一覧の「公開して反映」でだけ変わる。**「1日の回数」「受け取る人」など
 * 下書きに無い設定は公開版をそのまま引き継ぐので、この画面には出さない
 * ——出すと、変えたつもりで保存されない欄になる。
 */

type LoadState = 'loading' | 'ready' | 'error' | 'missing'

function EditMileageRuleInner() {
  usePageTitle('たまる決めごとを編集')
  const ruleId = useSearchParams().get('id') ?? ''
  const { selectedAccountId } = useAccount()

  const [state, setState] = useState<LoadState>('loading')
  const [rule, setRule] = useState<MileageEarningRuleV6 | null>(null)
  const [name, setName] = useState('')
  const [eventType, setEventType] = useState('')
  const [source, setSource] = useState('')
  const [amount, setAmount] = useState('')
  const [initialStatus, setInitialStatus] = useState<'available' | 'pending'>('available')
  const [validFrom, setValidFrom] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [expiresAfterDays, setExpiresAfterDays] = useState('')
  const [reverseOnCancellation, setReverseOnCancellation] = useState(false)
  const [targetConditions, setTargetConditions] = useState<SegmentCondition | null>(null)
  const [notifyFriend, setNotifyFriend] = useState(true)
  const [messageTemplate, setMessageTemplate] = useState(EARNING_RULE_NOTIFY_TEMPLATE)
  /** 読み込み時の下書きの写し。「変わったか」の判定と離脱番兵に使う。 */
  const [originalDraft, setOriginalDraft] = useState('')

  const load = useCallback(async () => {
    if (!ruleId || !selectedAccountId) {
      setState(selectedAccountId ? 'missing' : 'loading')
      return
    }
    setState('loading')
    try {
      /*
       * 単体の取得口は無いので一覧口を頁で進めて探す。決めごとの一覧と
       * 同じ形で全件を順に読み、見つかったところで止める。
       */
      let found: MileageEarningRuleV6 | undefined
      let offset = 0
      while (!found) {
        const res = await api.mileage.earningRulesV6({ accountId: selectedAccountId, limit: 100, offset })
        if (!res.success) throw new Error(res.error)
        found = res.data.items.find((item) => item.id === ruleId)
        offset += res.data.items.length
        if (found || res.data.items.length === 0 || offset >= res.data.pagination.total) break
      }
      if (!found) {
        setState('missing')
        return
      }
      setRule(found)
      setName(found.draft.name)
      setEventType(found.draft.eventType)
      setSource(found.draft.source ?? '')
      setAmount(String(found.draft.amount))
      setInitialStatus(found.draft.initialStatus)
      setValidFrom(found.draft.validFrom ? found.draft.validFrom.slice(0, 10) : '')
      setValidUntil(found.draft.validUntil ? found.draft.validUntil.slice(0, 10) : '')
      setExpiresAfterDays(found.draft.expiresAfterDays == null ? '' : String(found.draft.expiresAfterDays))
      setReverseOnCancellation(found.draft.cancellationEventTypes.length > 0)
      setTargetConditions(found.draft.targetConditions ?? null)
      setNotifyFriend(found.draft.notification?.enabled ?? true)
      setMessageTemplate(found.draft.notification?.messageTemplate || EARNING_RULE_NOTIFY_TEMPLATE)
      /*
       * 「変わったか」の比較は、フォームの初期値と同じ形で組み立てた
       * 写しに対して行う。形がずれると触っていなくても番兵が出る。
       */
      const loadedCancellation = earningRuleCancellationEvent(found.draft.eventType)
      setOriginalDraft(JSON.stringify({
        name: found.draft.name.trim(),
        eventType: found.draft.eventType,
        source: found.draft.source ?? null,
        amount: found.draft.amount,
        initialStatus: found.draft.initialStatus,
        validFrom: found.draft.validFrom ? found.draft.validFrom.slice(0, 10) : null,
        validUntil: found.draft.validUntil ? found.draft.validUntil.slice(0, 10) : null,
        expiresAfterDays: found.draft.expiresAfterDays,
        cancellationEventTypes: found.draft.cancellationEventTypes.length > 0 && loadedCancellation
          ? [loadedCancellation]
          : [],
        targetConditions: pruneCondition(found.draft.targetConditions ?? null),
        sortOrder: found.draft.sortOrder,
        notification: {
          enabled: found.draft.notification?.enabled ?? true,
          messageTemplate: found.draft.notification?.messageTemplate || EARNING_RULE_NOTIFY_TEMPLATE,
        },
      }))
      setState('ready')
    } catch {
      setState('error')
    }
  }, [ruleId, selectedAccountId])

  useEffect(() => {
    void load()
  }, [load])

  const selected = EVENT_TYPES.find((t) => t.value === eventType)
  const value = Number(amount)
  const validAmount = Number.isInteger(value) && value >= 1
  const expiryDays = expiresAfterDays === '' ? null : Number(expiresAfterDays)
  const cancellationEvent = earningRuleCancellationEvent(eventType)

  /*
   * 送る下書き。sortOrder は画面に出さないので読んだ値をそのまま返す。
   * 「変わったか」の判定も同じ組み立てで比べる（読み込み時の写しを
   * originalDraft へ取ってある）ので、見た目と実判定がずれない。
   */
  const draftPayload = {
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
    sortOrder: rule?.draft.sortOrder ?? 0,
    notification: { enabled: notifyFriend, messageTemplate },
  }
  const dirty = state === 'ready' && JSON.stringify(draftPayload) !== originalDraft
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty })

  if (state === 'loading') return <ListState kind="loading" title="たまる決めごとを読み込んでいます" />
  if (state === 'missing') {
    return (
      <ListState
        kind="empty"
        emptyPreset="filtered"
        title="この決めごとが見つかりません"
        description="すでに削除されたか、別のLINEアカウントの決めごとです。一覧からもう一度開いてください。"
        action={<Button href="/mileage?tab=earning-rules">たまる決めごとへ戻る</Button>}
      />
    )
  }
  if (state === 'error' || !rule) {
    return (
      <ListState
        kind="error"
        title="たまる決めごとを読み込めませんでした"
        description="再読み込みしても直らない場合はエラー報告へ。"
        action={<Button onClick={() => void load()}>読み直す</Button>}
      />
    )
  }

  return (
    <>
      <CreatePage
        title="たまる決めごとを編集"
        description="下書きを直します。動いている内容は変わりません——一覧の「公開して反映」でだけ反映されます。"
        parent={['マイル', '/mileage?tab=earning-rules']}
        saveLabel="下書きを保存"
        showHeader={false}
        variant="v6"
        statusLabel={rule.publishedVersion == null
          ? 'まだ公開していません。保存しても動きはじめません。'
          : '下書きだけを更新します。動いている内容は「公開して反映」まで変わりません。'}
        validate={() => {
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
        }}
        onSave={async () => {
          try {
            const res = await api.mileage.saveEarningRuleDraft(ruleId, {
              accountId: selectedAccountId!,
              expectedVersion: rule.draftVersion,
              draft: draftPayload,
            })
            if (!res.success) throw new Error(res.error)
          } catch (error) {
            /*
             * 版がずれた=開いている間に誰かが直した。黙って上書きしないよう
             * 口が断るので、開き直してもらう文にする。
             */
            if (error instanceof ApiError && error.status === 409) {
              throw new Error('ほかの人が先にこの決めごとを直しました。一覧へ戻って開き直してから、もう一度直してください')
            }
            throw error
          }
          return ruleId
        }}
        aside={
          <>
            <AsideCard title="この設定だとこう貯まります">
              <p className="text-ink-secondary text-xs leading-relaxed">
                {source ? `${selected?.sources.find(([v]) => v === source)?.[1] ?? '経由'}で` : ''}
                {selected?.label ?? 'その他の行動'}とき、
                行動した本人に{' '}
                <strong className="text-ink">{validAmount ? value : '—'}マイル</strong> を付与します。
                {initialStatus === 'pending' ? '確定するまで使えません。' : ''}
              </p>
            </AsideCard>

            <LinePreview caption={`${selected?.label ?? 'この行動'}あと、すぐに届く想定です`}>
              <div className="rounded-card bg-canvas p-3 text-sm leading-6 text-ink">
                {messageTemplate}
              </div>
              <p className="mt-2 text-xs text-ink-faint">{'{awardedMiles}・{balance} は送信時に実際の数へ入れ替わります。'}</p>
              <Checkbox
                checked={notifyFriend}
                onCheckedChange={setNotifyFriend}
                className="mt-3"
              >マイルが付いたら、この内容を自動で知らせる</Checkbox>
            </LinePreview>
          </>
        }
      >
        <NoteBar>
          1日の回数・同じ対象の数えかた・受け取る人・倍率の設定は、今の内容がそのまま引き継がれます。
          動かす・止めるは一覧の操作から行います。
        </NoteBar>

        <FormSection step={1} label="どのルールか">
          <div className="grid gap-3 lg:grid-cols-3">
          <Field
            label="ルール名"
            htmlFor="sc-name"
            required
            note="一覧に表示される名前です。お客様には見えません。"
          >
            <TextInput
              id="sc-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <Field label="きっかけ" htmlFor="sc-event" required note={selected?.note ?? 'この画面で扱えない種類です。選び直すと元には戻せません。'}>
            <Select
              aria-label="きっかけ"
              id="sc-event"
              value={eventType}
              onChange={(value) => {
                setEventType(value)
                setSource('')
              }}
              options={[
                ...EVENT_TYPES.map((t) => ({ value: t.value, label: t.label })),
                ...(selected ? [] : [{ value: eventType, label: 'その他の行動（この画面では選び直せません）' }]),
              ]}
              size="full"
            />
          </Field>

          <Field
            label="出どころ"
            htmlFor="sc-source"
            note="同じ行動でも、経由した場所ごとに分けられます。"
          >
            <Select
              id="sc-source"
              value={source}
              onChange={(value) => setSource(value)}
              aria-label="行動の出どころ"
              size="full"
              options={[
                ...(selected?.sources.map(([value, label]) => ({ value, label })) ?? [{ value: '', label: 'すべて' }]),
                ...(source && !selected?.sources.some(([v]) => v === source)
                  ? [{ value: source, label: '今の出どころ（この画面では選び直せません）' }]
                  : []),
              ]}
            />
          </Field>
          </div>
        </FormSection>

        <FormSection step={2} label="何マイル付けるか">
          <div className="grid items-end gap-3 sm:grid-cols-2">
          <Field label="付与マイル" htmlFor="sc-amount" required note="1以上で入力してください。">
            <TextInput
              id="sc-amount"
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-32 tabular-nums"
            />
          </Field>

          <Field label="付与のされ方">
            <div className="grid gap-2 sm:grid-cols-2">
              <ChoiceCard
                selected={initialStatus === 'available'}
                onClick={() => setInitialStatus('available')}
                title="すぐ使える"
                note="その場で残高に入ります"
              />
              <ChoiceCard
                selected={initialStatus === 'pending'}
                onClick={() => setInitialStatus('pending')}
                title="確定待ち"
                note="確定するまで使えません"
              />
            </div>
          </Field>
          </div>
        </FormSection>

        <FormSection step={3} label="だれに付けるか" note="条件を付けない場合は全員が対象です。">
          <Field label="だれに付けるか（条件）">
            <ConditionBuilder value={targetConditions} onChange={setTargetConditions} label="利用対象の条件" />
          </Field>
        </FormSection>

        <FormSection step={4} label="期間・失効・取り消し">
          <div className="grid gap-3 lg:grid-cols-2">
            <Field label="開始日・終了日" note="空欄なら期限なしです。">
              <div className="flex items-center gap-2">
                <DateField value={validFrom} onChange={setValidFrom} aria-label="開始日" className="min-w-0 flex-1" />
                <span className="text-sm text-ink-faint">〜</span>
                <DateField value={validUntil} onChange={setValidUntil} aria-label="終了日" className="min-w-0 flex-1" />
              </div>
            </Field>
            <Field label="付いたマイルの有効期限" htmlFor="sc-expiry" note="空欄なら期限なしです。">
              <div className="flex items-center gap-2">
                <TextInput id="sc-expiry" type="number" min={1} max={3650} value={expiresAfterDays} onChange={(e) => setExpiresAfterDays(e.target.value)} className="max-w-32 tabular-nums" />
                <span className="whitespace-nowrap text-sm text-ink-secondary">日後</span>
              </div>
            </Field>
          </div>
          {cancellationEvent ? (
            <Checkbox
              checked={reverseOnCancellation}
              onCheckedChange={setReverseOnCancellation}
              description={`${eventType === 'booking_created' ? '予約の取り消し' : '注文の取り消し'}を同じ記録から追跡します。`}
              className="mt-3"
            >取り消されたら、付けたぶんを引く</Checkbox>
          ) : null}
        </FormSection>
      </CreatePage>

      <UnsavedLeaveDialog open={leaveTarget !== null} subject="下書きへの変更" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </>
  )
}

export default function EditMileageRulePage() {
  return (
    <Suspense fallback={<ListState kind="loading" title="たまる決めごとを読み込んでいます" />}>
      <EditMileageRuleInner />
    </Suspense>
  )
}
