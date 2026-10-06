'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowRight, ChevronLeft } from 'lucide-react'
import { CreatePage } from '@/components/templates'
import type { FriendField, ReminderDraftSettings, ReminderDraftStep } from '@line-crm/shared'
import { api, type EventListItem } from '@/lib/api'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import DetailPanel from '@/components/shared/detail-panel'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import Notice from '@/components/shared/notice'
import { notifyToast } from '@/components/shared/toast'
import { usePageTitle } from '@/components/shell/page-chrome'
import {
  EMPTY_BASICS,
  basicsBaseSummary,
  basicsToDraft,
  reminderTemplatesV8,
  ReminderBasicsFormV8,
  type BasicsValue,
  type ReminderTemplateV8,
} from '../basics-form-v8'
import { SummaryCardV8, WizardFooterV8, ReminderV8Stepper } from '../wizard-v8-ui'
import styles from '../wizard-v8.module.css'
import { humanizeErrorText } from '@/components/shared/human-error-text'

/**
 * ★V8 リマインダを作る・手順1「基本設定」（板 VE1u5）。
 * 保存したら手順2（対象者と止める条件）へ進む。保存せず進むことはない——
 * 手順2以降は下書きの id が要るため。
 */
export default function NewReminderV8() {
  usePageTitle('リマインダを作成・基本設定')
  const router = useRouter()
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [previewOpen, setPreviewOpen] = useState(false)
  const [value, setValue] = useState<BasicsValue>(EMPTY_BASICS)
  const [appliedTemplateId, setAppliedTemplateId] = useState<string | null>(null)
  const [pendingTemplate, setPendingTemplate] = useState<ReminderTemplateV8 | null>(null)
  const [pendingFieldMatch, setPendingFieldMatch] = useState<string | null>(null)
  const [dateFields, setDateFields] = useState<FriendField[]>([])
  const [events, setEvents] = useState<EventListItem[]>([])
  const [fieldsState, setFieldsState] = useState<'loading' | 'ready' | 'error'>('ready')
  const [eventsState, setEventsState] = useState<'loading' | 'ready' | 'error'>('ready')
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const [error, setError] = useState('')
  // 一度保存したら下書きの id を持ち、続けて押したときは上書き保存にする。
  const [savedId, setSavedId] = useState<string | null>(null)

  const dirty = Boolean(
    value.name.trim() ||
      value.description.trim() ||
      value.triggerFieldId ||
      value.triggerEventId ||
      value.repeatYearly ||
      appliedTemplateId,
  )
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: saving === 'saving' })

  const appliedTemplate = reminderTemplatesV8.find((template) => template.id === appliedTemplateId) ?? null

  function requestTemplate(template: ReminderTemplateV8) {
    const hasInputsToReplace =
      (appliedTemplateId !== null && appliedTemplateId !== template.id) ||
      value.triggerFieldId !== '' ||
      value.triggerEventId !== '' ||
      value.repeatYearly
    if (hasInputsToReplace) setPendingTemplate(template)
    else applyTemplate(template)
  }

  function applyTemplate(template: ReminderTemplateV8) {
    setAppliedTemplateId(template.id)
    setValue((current) => ({
      ...current,
      triggerType: template.triggerType,
      repeatYearly: Boolean(template.repeatYearly),
      triggerFieldId: '',
      triggerEventId: '',
    }))
    setPendingFieldMatch(template.triggerType === 'friend_field' ? template.fieldNameMatch ?? null : null)
  }

  // 起点カードを手で選び直したら、ひな形の適用を外す。
  function handleChange(next: BasicsValue) {
    if (appliedTemplate && appliedTemplate.triggerType !== next.triggerType) setAppliedTemplateId(null)
    if (next.triggerType !== 'friend_field') setPendingFieldMatch(null)
    setValue(next)
  }

  const onFieldsReady = useCallback((fields: FriendField[], state: 'loading' | 'ready' | 'error') => {
    setDateFields(fields)
    setFieldsState(state)
  }, [])
  const onEventsReady = useCallback((items: EventListItem[], state: 'loading' | 'ready' | 'error') => {
    setEvents(items)
    setEventsState(state)
  }, [])

  // 今のアカウントの候補が確定するまで次へ進ませない。
  const candidatesPending =
    (value.triggerType === 'friend_field' && fieldsState !== 'ready') ||
    (value.triggerType === 'event' && eventsState !== 'ready')

  function validate(): string | null {
    if (accountLoading || !selectedAccountId) return 'LINEアカウントを選んでください'
    if (!value.name.trim()) return 'リマインダ名を入力してください'
    if (value.triggerType === 'friend_field' && !value.triggerFieldId) return '基準日に使う友だち情報欄を選んでください'
    if (value.triggerType === 'event' && !value.triggerEventId) return '基準日にするイベントを選んでください'
    return null
  }

  /** 下書きを保存する。作成済みなら上書きする。成功したら下書きの id を返す。 */
  async function save(): Promise<string | null> {
    const message = validate()
    if (message) {
      setError(message)
      return null
    }
    setSaving('saving')
    setError('')
    try {
      if (savedId) {
        const current = await api.reminders.getDraft(savedId)
        if (!current.success) throw new Error(current.error)
        const res = await api.reminders.saveDraft(savedId, basicsToDraft(current.data.settings, value))
        if (!res.success) throw new Error(res.error)
        setSaving('saved')
        notifyToast('下書きを保存しました')
        return savedId
      }
      /*
       * REMINDER-07: ひな形なしでは空の1通目を作らない。下書きは通知0件を
       * 許すので、通知は手順3で足す。空本文のまま公開・送信はできない。
       */
      const firstStep: ReminderDraftStep | null = appliedTemplate
        ? {
            stableStepId: crypto.randomUUID(),
            offsetMinutes: appliedTemplate.step.offsetMinutes,
            offsetDays: appliedTemplate.step.offsetDays,
            sendAtTime: appliedTemplate.step.sendAtTime,
            messageType: 'text',
            messageContent: appliedTemplate.step.messageContent,
          }
        : null
      const settings: ReminderDraftSettings = {
        name: value.name.trim(),
        description: value.description.trim() || null,
        lineAccountId: selectedAccountId!,
        folderId: value.folderId || null,
        triggerType: value.triggerType,
        deliveryMode: 'time',
        triggerFieldId: value.triggerType === 'friend_field' ? value.triggerFieldId || null : null,
        triggerEventId: value.triggerType === 'event' ? value.triggerEventId || null : null,
        repeatYearly: value.triggerType === 'friend_field' ? value.repeatYearly : false,
        leapYearPolicy: value.leapYearPolicy,
        triggerOffsetMinutes: null,
        sendAtTime: appliedTemplate?.step.sendAtTime ?? null,
        targetTagId: null,
        targetCondition: null,
        stopConditions: { bookingCancelled: true, supportMarkCompleted: true, daysAfterTarget: 7, friendBlocked: true },
        steps: firstStep ? [firstStep] : [],
      }
      const res = await api.reminders.createDraft(settings)
      if (!res.success) throw new Error(res.error)
      setSavedId(res.data.reminderId)
      setSaving('saved')
      notifyToast('下書きを保存しました')
      return res.data.reminderId
    } catch (caught) {
      setSaving('failed')
      // 機械の文（API error: 500）は出さず、何が起きた・どうすればよいかを出す（動きの点検 7 番）。
      setError(caught instanceof Error ? humanizeErrorText(caught.message) : '下書きを保存できませんでした')
      return null
    }
  }

  async function next() {
    const id = await save()
    if (id) router.push(`/reminders/edit?id=${encodeURIComponent(id)}&stage=target`)
  }

  const preview = <>
          <SummaryCardV8
            rows={[
              { key: '基準日', value: basicsBaseSummary(value, dateFields, events) },
              { key: '対象者', value: '手順2で決める' },
              { key: '通知', value: appliedTemplate ? `1通（${appliedTemplate.timingLabel}）` : '手順3で作る' },
              { key: '状態', value: saving === 'saved' ? '下書き' : saving === 'failed' ? '保存失敗' : '下書き' },
            ]}
          />
          <p className={styles.sideHint}>
            LINEでの見え方は、届けるメッセージを決める手順から右に出ます。
          </p>
        </>

  return (
    <>
    <CreatePage
      boardId="VE1u5"
      title="リマインダを作る"
      description="いまは下書きとして作ります。最後の「確認」で有効にします。"
      identity={<Link href="/reminders" className={styles.backLink}><ChevronLeft size={14} aria-hidden="true" />リマインダへ</Link>}
      steps={<ReminderV8Stepper current="basics" reminderId={savedId} />}
      preview={preview}
      previewToggle={<Button onClick={() => setPreviewOpen(true)}>設定内容を見る</Button>}
      footerActions={
        <WizardFooterV8 embedded
        onCancel={() => router.push('/reminders')}
        cancelDisabled={saving === 'saving'}
        onDraft={() => void save()}
        draftBusy={saving === 'saving'}
        nextLabel="次へ：対象者と止める条件"
        nextIcon={<ArrowRight size={15} aria-hidden="true" />}
        onNext={() => void next()}
        nextDisabled={candidatesPending || saving === 'saving'}
        />
      }
    >
      {error ? <Notice tone="danger" message={error} /> : null}

          <ReminderBasicsFormV8
            value={value}
            onChange={handleChange}
            appliedTemplateId={appliedTemplateId}
            onRequestTemplate={requestTemplate}
            pendingFieldMatch={pendingFieldMatch}
            onFieldMatchHandled={() => setPendingFieldMatch(null)}
            onFieldsReady={onFieldsReady}
            onEventsReady={onEventsReady}
          />



      <ConfirmDialog
        open={pendingTemplate !== null}
        title="ひな形の内容で上書きしますか？"
        description="いま選んでいる基準日や繰り返しの設定は、ひな形の内容に置き換わります。"
        confirmLabel="このひな形を使う"
        onConfirm={() => {
          if (pendingTemplate) applyTemplate(pendingTemplate)
          setPendingTemplate(null)
        }}
        onCancel={() => setPendingTemplate(null)}
      />
      <UnsavedLeaveDialog open={leaveTarget !== null} subject="基本設定への変更" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </CreatePage>
    <DetailPanel open={previewOpen} title="設定内容" onClose={() => setPreviewOpen(false)}>{preview}</DetailPanel>
    </>
  )
}
