'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Folder, FriendField, ReminderDraftSettings, ReminderDraftStep, ReminderTriggerType } from '@line-crm/shared'
import { api, eventsApi, type EventListItem } from '@/lib/api'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import SelectField from '@/components/shared/select-field'
import { TextArea, TextInput } from '@/components/shared/form-controls'
import { TableHeadRow, Th } from '@/components/shared/table'
import { useAccount } from '@/contexts/account-context'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import { Field, LinePreview, ReminderFooter, ReminderPanel, ReminderWizard, ReminderWorkspace, SummaryCard } from '@/components/reminders/reminder-v6-ui'
import { usePageTitle } from '@/components/shell/page-chrome'
import styles from './page.module.css'

const inputClass = 'border-hairline rounded-control focus:ring-accent block w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none'

/*
 * #996 DEEP-06/07: ひな形。選んだときだけ用途に合う基準日・タイミング・本文を
 * まとめて入れる。未選択のときは本文も時刻も空欄にし、誕生日などの
 * 予約以外の起点に Meet の文面・前日18時を勝手に確定させない。
 * fieldNameMatch は friend_field 起点のとき、候補の名前に含まれていれば
 * その情報欄を自動で選ぶ目印（例: 「誕生日」）。
 */
interface ReminderTemplate {
  id: string
  title: string
  note: string
  baseLabel: string
  timingLabel: string
  triggerType: ReminderTriggerType
  fieldNameMatch?: string
  repeatYearly?: boolean
  step: Pick<ReminderDraftStep, 'offsetDays' | 'offsetMinutes' | 'sendAtTime' | 'messageContent'>
}

const reminderTemplates: ReminderTemplate[] = [
  {
    id: 'booking-day-before',
    title: '予約の前日案内',
    note: '無断キャンセルを減らす',
    baseLabel: '予約日時',
    timingLabel: '1日前 18:00',
    triggerType: 'booking',
    step: {
      offsetDays: -1,
      offsetMinutes: 0,
      sendAtTime: '18:00',
      messageContent: '明日のGoogle Meet相談のご案内です。',
    },
  },
  {
    id: 'booking-just-before',
    title: '予約の直前リマインド',
    note: '開始前に気づいてもらう',
    baseLabel: '予約日時',
    timingLabel: '1時間前',
    triggerType: 'booking',
    step: {
      offsetDays: null,
      offsetMinutes: -60,
      sendAtTime: null,
      messageContent: 'まもなくご予約のお時間です。',
    },
  },
  {
    id: 'contract-renewal',
    title: '契約更新のお知らせ',
    note: '更新の検討時間をつくる',
    baseLabel: '契約終了日（友だち情報欄）',
    timingLabel: '30日前 10:00',
    triggerType: 'friend_field',
    fieldNameMatch: '契約',
    step: {
      offsetDays: -30,
      offsetMinutes: 0,
      sendAtTime: '10:00',
      messageContent: '契約更新の時期が近づいています。引き続きのご利用についてご案内します。',
    },
  },
  {
    id: 'birthday',
    title: '誕生日のお祝い',
    note: '来店・購入のきっかけに',
    baseLabel: '誕生日（友だち情報欄）',
    timingLabel: '当日 10:00',
    triggerType: 'friend_field',
    fieldNameMatch: '誕生日',
    repeatYearly: true,
    step: {
      offsetDays: 0,
      offsetMinutes: 0,
      sendAtTime: '10:00',
      messageContent: 'お誕生日おめでとうございます。いつもありがとうございます。',
    },
  },
]

type SaveState = 'unsaved' | 'saving' | 'saved' | 'failed'

export default function NewReminderPage() {
  usePageTitle('リマインダを作成・基本設定')
  const router = useRouter()
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [folderId, setFolderId] = useState('')
  const [triggerType, setTriggerType] = useState<ReminderTriggerType>('booking')
  const [triggerFieldId, setTriggerFieldId] = useState('')
  const [triggerEventId, setTriggerEventId] = useState('')
  const [repeatYearly, setRepeatYearly] = useState(false)
  // N-068: 2月29日が基準日のときの平年の扱い。要件の既定は 2/28。
  const [leapYearPolicy, setLeapYearPolicy] = useState<'feb28' | 'mar1' | 'skip'>('feb28')
  const [dateFields, setDateFields] = useState<FriendField[]>([])
  const [fieldsLoadState, setFieldsLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [events, setEvents] = useState<EventListItem[]>([])
  const [eventsLoadState, setEventsLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [folders, setFolders] = useState<Folder[]>([])
  const [foldersLoadState, setFoldersLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [foldersReloadToken, setFoldersReloadToken] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // #996 DEEP-27: createDraft を一度も呼んでいない段階で「下書き保存」と
  // 出さない。実際の保存状態（未保存／保存中／保存済み／失敗）だけを表示する。
  const [saveState, setSaveState] = useState<SaveState>('unsaved')
  // #996 DEEP-07: 「このひな形を使う」で反映するひな形と、置換確認中のひな形。
  const [appliedTemplateId, setAppliedTemplateId] = useState<string | null>(null)
  const [pendingTemplate, setPendingTemplate] = useState<ReminderTemplate | null>(null)
  // friend_field 起点のひな形を適用したあと、候補が読めたら名前一致で選ぶ目印。
  const [pendingFieldMatch, setPendingFieldMatch] = useState<string | null>(null)
  const appliedTemplate = reminderTemplates.find((template) => template.id === appliedTemplateId) ?? null

  /*
   * N-080: 名前・メモ・起点を入れた状態で画面を離れるとき確認する。
   * フォルダは初期値が自動で入るので dirty の判定には入れない。
   * ひな形を適用した時点で保存内容が変わるので dirty に含める。
   */
  const dirty = Boolean(name.trim() || description.trim() || triggerFieldId || triggerEventId || repeatYearly || appliedTemplateId)
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: saving })

  /*
   * #996 DEEP-05: いま表示しているアカウントを記録する。
   * 候補取得の応答が届いた時点でここが変わっていたら、その応答は
   * 前アカウントのものなので捨てる（逆順応答で候補が入れ替わらないように）。
   */
  const accountRef = useRef(selectedAccountId)

  useEffect(() => {
    let active = true
    setFoldersLoadState('loading')
    void api.folders.list('reminder').then((res) => {
      if (!active) return
      if (!res.success) return setFoldersLoadState('error')
      setFolders(res.data)
      setFoldersLoadState('ready')
      const booking = res.data.find((folder) => folder.name.includes('予約'))
      if (booking) setFolderId((current) => current || booking.id)
    }).catch(() => { if (active) setFoldersLoadState('error') })
    return () => { active = false }
  }, [foldersReloadToken])

  /*
   * #996 DEEP-05: アカウントが切り替わったら、前アカウントの候補一覧・
   * 選択ID・取得状態をまとめて捨て、今のアカウントの候補を取り直す。
   * Aの情報欄IDがBの下書きへ紛れ込まないようにする。
   * リマインダ名・社内メモは利用者の入力文でアカウントに紐づかないので残す。
   * ひな形の選択も利用者の意図なので残し、friend_field 起点なら
   * 新しいアカウントの候補へ名前一致を掛け直す。
   */
  useEffect(() => {
    if (accountRef.current === selectedAccountId) return
    accountRef.current = selectedAccountId
    setTriggerFieldId('')
    setTriggerEventId('')
    setDateFields([])
    setFieldsLoadState('idle')
    setEvents([])
    setEventsLoadState('idle')
    setPendingFieldMatch(appliedTemplate?.triggerType === 'friend_field' ? appliedTemplate.fieldNameMatch ?? null : null)
    setError('')
  }, [selectedAccountId, appliedTemplate])

  /*
   * N-074: 起点の候補は選んだ種類が必要になってから、そのアカウントの
   * 実在データだけを読む。日付系以外の情報欄は起点にならないので外す。
   * 読み直しは 'idle' へ戻すだけ。in-flight のGETを途中で打ち消すと、
   * 'loading' へ遷移した瞬間のeffect再実行で自分の応答を捨ててしまう。
   * 応答を反映する前に accountRef と照合し、前アカウントの
   * 遅い応答が今の候補を上書きしないようにする（DEEP-05）。
   */
  useEffect(() => {
    if (triggerType !== 'friend_field' || !selectedAccountId || fieldsLoadState !== 'idle') return
    const accountId = selectedAccountId
    setFieldsLoadState('loading')
    void api.friendFields.list(accountId).then((res) => {
      if (accountRef.current !== accountId) return
      if (!res.success) return setFieldsLoadState('error')
      setDateFields(res.data.filter((field) => field.type === 'date' || field.type === 'datetime'))
      setFieldsLoadState('ready')
    }).catch(() => { if (accountRef.current === accountId) setFieldsLoadState('error') })
  }, [triggerType, selectedAccountId, fieldsLoadState])

  useEffect(() => {
    if (triggerType !== 'event' || !selectedAccountId || eventsLoadState !== 'idle') return
    const accountId = selectedAccountId
    setEventsLoadState('loading')
    void eventsApi.listEvents(accountId, { filter: 'all', limit: 100, sort: 'name' }).then((res) => {
      if (accountRef.current !== accountId) return
      setEvents(res.items)
      setEventsLoadState('ready')
    }).catch(() => { if (accountRef.current === accountId) setEventsLoadState('error') })
  }, [triggerType, selectedAccountId, eventsLoadState])

  // ひな形が指す情報欄（例: 「誕生日」）がこのアカウントの候補にあれば自動で選ぶ。
  useEffect(() => {
    if (!pendingFieldMatch || fieldsLoadState !== 'ready') return
    const match = dateFields.find((field) => field.name.includes(pendingFieldMatch))
    if (match) setTriggerFieldId(match.id)
    setPendingFieldMatch(null)
  }, [pendingFieldMatch, dateFields, fieldsLoadState])

  // 起点カードを手で選び直したら、ひな形が設定した起点とずれるので適用を外す。
  // 情報欄の自動選択も、friend_field 以外へ変わった時点で保留を解除する。
  function chooseTriggerType(next: ReminderTriggerType) {
    setTriggerType(next)
    if (appliedTemplate && appliedTemplate.triggerType !== next) setAppliedTemplateId(null)
    if (next !== 'friend_field') setPendingFieldMatch(null)
  }

  /*
   * #996 DEEP-07: ひな形の適用。基準日・タイミング・本文をまとめて反映する。
   * 別のひな形や手で選んだ起点が既にあるときだけ、置き換えてよいか確認する。
   */
  function applyTemplate(template: ReminderTemplate) {
    setAppliedTemplateId(template.id)
    setTriggerType(template.triggerType)
    setRepeatYearly(Boolean(template.repeatYearly))
    setTriggerFieldId('')
    setTriggerEventId('')
    setPendingFieldMatch(template.triggerType === 'friend_field' ? template.fieldNameMatch ?? null : null)
  }

  function requestTemplate(template: ReminderTemplate) {
    const hasInputsToReplace =
      (appliedTemplateId !== null && appliedTemplateId !== template.id) ||
      triggerFieldId !== '' ||
      triggerEventId !== '' ||
      repeatYearly
    if (hasInputsToReplace) setPendingTemplate(template)
    else applyTemplate(template)
  }

  /*
   * #996 DEEP-05: 今のアカウントの候補が確定するまで次へ進ませない。
   * 確定前に進むと「Aの候補を見てBへ保存」になりうる。
   */
  const candidatesPending =
    (triggerType === 'friend_field' && fieldsLoadState !== 'ready') ||
    (triggerType === 'event' && eventsLoadState !== 'ready')

  async function save() {
    if (accountLoading || !selectedAccountId) return setError('LINEアカウントを選んでください')
    if (!name.trim()) return setError('リマインダ名を入力してください')
    if (triggerType === 'friend_field' && !triggerFieldId) {
      return setError('基準日に使う友だち情報欄を選んでください')
    }
    if (triggerType === 'event' && !triggerEventId) {
      return setError('基準日にするイベントを選んでください')
    }
    setSaving(true)
    setSaveState('saving')
    setError('')
    try {
      /*
       * #996 DEEP-06: 本文・タイミングはひな形を選んだときだけ用途に合う
       * 初期値を入れる。未選択なら空欄にし、STEP 3 で利用者が決める。
       *
       * REMINDER-07: ひな形なしでは空の1通目を作らない。本文の無い通は
       * Worker の下書き検査（送る内容が空の通知があります）で弾かれ、
       * 基本設定から先へ進めなかった。下書きは通知0件を許すので、
       * 通知は STEP 3 で足す。空本文のまま公開・送信はできない
       * （公開前チェックとテスト送信が別の口で止める）。
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
        name: name.trim(), description: description.trim() || null, lineAccountId: selectedAccountId!,
        folderId: folderId || null, triggerType, deliveryMode: 'time',
        triggerFieldId: triggerType === 'friend_field' ? triggerFieldId || null : null,
        triggerEventId: triggerType === 'event' ? triggerEventId || null : null,
        repeatYearly: triggerType === 'friend_field' ? repeatYearly : false,
        leapYearPolicy,
        triggerOffsetMinutes: null, sendAtTime: appliedTemplate?.step.sendAtTime ?? null, targetTagId: null,
        stopConditions: { bookingCancelled: true, supportMarkCompleted: true, daysAfterTarget: 7, friendBlocked: true },
        steps: firstStep ? [firstStep] : [],
      }
      const res = await api.reminders.createDraft(settings)
      if (!res.success) throw new Error(res.error)
      setSaveState('saved')
      router.push(`/reminders/edit?id=${encodeURIComponent(String(res.data.reminderId))}&stage=target`)
    } catch (saveError) {
      setSaveState('failed')
      setError(saveError instanceof Error ? saveError.message : '下書きを保存できませんでした')
    } finally { setSaving(false) }
  }

  /*
   * #996 DEEP-04: 右サマリーの基準日は、保存される triggerType と同じ意味で
   * 出す。イベント起点は「イベントの予約日時」（回答フォームの回答日ではない）。
   */
  const baseSummary =
    triggerType === 'booking'
      ? '予約日時'
      : triggerType === 'event'
        ? 'イベントの予約日時'
        : triggerFieldId
          ? `友だち情報欄の日付（${dateFields.find((field) => field.id === triggerFieldId)?.name ?? '選択中'}）`
          : '友だち情報欄の日付'

  const saveStatusLabel =
    saveState === 'saving'
      ? '保存中…'
      : saveState === 'saved'
        ? '下書きを保存しました'
        : saveState === 'failed'
          ? '下書きを保存できませんでした'
          : '未保存'

  const lifecycleLabel =
    saveState === 'saved' ? '下書き' : saveState === 'failed' ? '保存失敗' : saveState === 'saving' ? '保存中' : '未保存'

  return (
    <div data-design-node="uJP22" data-design="Body" className={styles.screen}>
      <div data-design="Crumb"><ReminderWizard current={1} /></div>
      <div data-design="Head" />
      {error ? <p className="bg-danger-bg text-danger mb-3 rounded-lg p-3 text-sm">{error}</p> : null}
      <ReminderWorkspace aside={<div data-design="Right">
        <SummaryCard rows={[["対象者", '未設定'], ['基準日', baseSummary], ['通知ステップ', appliedTemplate ? `1通（${appliedTemplate.timingLabel}）` : '未設定'], ['状態', lifecycleLabel]]} />
        <LinePreview caption={appliedTemplate ? `${appliedTemplate.timingLabel}に届く予定です` : '通知ステップは STEP 3 で設定します'} empty={!appliedTemplate}>
          {appliedTemplate ? appliedTemplate.step.messageContent : 'メッセージは STEP 3 で作成します。基準日を選ぶと、差し込める項目がここに出ます。'}
        </LinePreview>
        <div className={styles.previewActions}>
          <Button disabled>テスト送信</Button>
          <Button disabled>通知イメージを見る</Button>
        </div>
        <p className={styles.previewNote}>テスト送信と表示確認は、STEP 3 で通知を作ると使えます。</p>
      </div>}>
        <div data-design="Left" className="grid gap-3">
        <ReminderPanel title="基本設定" note="管理名とフォルダを設定します。">
          <div className={`${styles.basicFields} ${styles.basicFieldsGrid}`}>
            {/* #996 DEEP-01: カウンターはラベル行右（labelAside）。補足文は入力の下。 */}
            <Field label="リマインダ名" required labelAside={`${name.length} / 60文字`}><TextInput value={name} maxLength={60} placeholder="例：Google Meet相談の前日案内" onChange={(event) => setName(event.target.value)} className={inputClass} /></Field>
            <Field label="フォルダ" note={foldersLoadState === 'ready' && folders.length === 0 ? 'フォルダはまだありません。一覧から追加できます。' : undefined}><div className="flex items-center gap-2"><SelectField value={folderId} onChange={(event) => setFolderId(event.target.value)} disabled={foldersLoadState !== 'ready'} aria-label="リマインダのフォルダ" className={inputClass} options={[{ value: '', label: foldersLoadState === 'loading' ? 'フォルダを読み込み中' : foldersLoadState === 'error' ? 'フォルダを読み込めませんでした' : '未分類' }, ...folders.map((folder) => ({ value: folder.id, label: folder.name }))]} />{foldersLoadState === 'error' ? <Button onClick={() => setFoldersReloadToken((value) => value + 1)}>フォルダを再読み込み</Button> : null}</div></Field>
            {/* #996 DEEP-03: 社内メモは最低3行。共通TextAreaの120px基準を潰さない。 */}
            <div className="md:col-span-2"><Field label="社内メモ　任意" note="友だちには表示されません"><TextArea rows={3} value={description} placeholder="運用目的や注意点を入力" onChange={(event) => setDescription(event.target.value)} className={inputClass} /></Field></div>
          </div>
        </ReminderPanel>
        {/* #996 DEEP-04: 「フォーム回答日」は実際にはイベント予約の開始日時を保存する。表示を実装に合わせる。 */}
        <ReminderPanel title="基準日の選択" note="予約日時・友だち情報欄の日付・イベントの予約日時から選べます。">
          {/*
            #999 DEEP-02: 1つだけ選ぶ群は共通のラジオカード（本物の input[type=radio]）。
            ●・○の文字を置いた button は選択状態を支援技術へ伝えなかった。
            群名はパネルの見出しと同じ「基準日の選択」を legend へ渡す。
          */}
          <RadioCardGroup legend="基準日の選択" className={`${styles.baseChoices} grid gap-2 md:grid-cols-3`}>
            <RadioCard name="reminder-trigger-type" value="booking" checked={triggerType === 'booking'} title="予約日時を基準にする" note="予約管理・Google Meet相談の日時に連動します。" onChange={() => chooseTriggerType('booking')} />
            <RadioCard name="reminder-trigger-type" value="friend_field" checked={triggerType === 'friend_field'} title="友だち情報欄の日付" note="誕生日・契約終了日など、日付型の情報欄を選びます。" onChange={() => chooseTriggerType('friend_field')} />
            <RadioCard name="reminder-trigger-type" value="event" checked={triggerType === 'event'} title="イベントの予約日時" note="イベントへの予約が入った開始日時を起点にします。" onChange={() => chooseTriggerType('event')} />
          </RadioCardGroup>
          {triggerType === 'friend_field' ? (
            <div className="mt-3">
              <Field label="基準日に使う情報欄" required note="日付・日時型の項目だけを表示しています">
                <div className="flex items-center gap-2">
                  <SelectField
                    value={triggerFieldId}
                    onChange={(event) => setTriggerFieldId(event.target.value)}
                    disabled={fieldsLoadState !== 'ready'}
                    aria-label="基準日に使う情報欄"
                    className={inputClass}
                    options={[
                      { value: '', label: fieldsLoadState === 'loading' || fieldsLoadState === 'idle' ? '情報欄を読み込み中' : fieldsLoadState === 'error' ? '情報欄を読み込めませんでした' : '選んでください' },
                      ...dateFields.map((field) => ({ value: field.id, label: field.name })),
                    ]}
                  />
                  {fieldsLoadState === 'error' ? <Button onClick={() => setFieldsLoadState('idle')}>再読み込み</Button> : null}
                </div>
              </Field>
              {fieldsLoadState === 'ready' && dateFields.length === 0 ? <small>このアカウントに日付型の情報欄がまだありません。友だち情報欄から追加してください。</small> : null}
              <div className="mt-3">
                <label className="flex items-center gap-2 text-sm font-bold text-ink">
                  <input
                    type="checkbox"
                    checked={repeatYearly}
                    onChange={(event) => setRepeatYearly(event.target.checked)}
                    aria-label="毎年くり返す"
                  />
                  毎年くり返す（誕生日・契約更新日など）
                </label>
                {repeatYearly ? (
                  <div className="mt-2">
                    <Field label="2月29日が基準日のとき" note="うるう年は2月29日に届きます。平年の扱いを選んでください。">
                      <SelectField
                        value={leapYearPolicy}
                        onChange={(event) => setLeapYearPolicy(event.target.value as 'feb28' | 'mar1' | 'skip')}
                        aria-label="2月29日が基準日のときの平年の扱い"
                        options={[
                          { value: 'feb28', label: '2月28日に届ける' },
                          { value: 'mar1', label: '3月1日に届ける' },
                          { value: 'skip', label: 'その年は届けない' },
                        ]}
                      />
                    </Field>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          {triggerType === 'event' ? (
            <div className="mt-3">
              <Field label="基準日にするイベント" required note="このイベントへの予約の開始日時を起点にします">
                <div className="flex items-center gap-2">
                  <SelectField
                    value={triggerEventId}
                    onChange={(event) => setTriggerEventId(event.target.value)}
                    disabled={eventsLoadState !== 'ready'}
                    aria-label="基準日にするイベント"
                    className={inputClass}
                    options={[
                      { value: '', label: eventsLoadState === 'loading' || eventsLoadState === 'idle' ? 'イベントを読み込み中' : eventsLoadState === 'error' ? 'イベントを読み込めませんでした' : '選んでください' },
                      ...events.map((event) => ({ value: event.id, label: event.name })),
                    ]}
                  />
                  {eventsLoadState === 'error' ? <Button onClick={() => setEventsLoadState('idle')}>再読み込み</Button> : null}
                </div>
              </Field>
              {eventsLoadState === 'ready' && events.length === 0 ? <small>このアカウントにイベントがまだありません。イベント管理から作成してください。</small> : null}
            </div>
          ) : null}
        </ReminderPanel>
        {/* #996 DEEP-07: 説明だけの表に「このひな形を使う」を付け、選べるようにする。 */}
        <ReminderPanel title="ひな形から作る" note="用途に合う組み合わせを選ぶと、基準日・タイミング・本文をまとめて入力します。">
          <div className="overflow-hidden rounded-lg border border-hairline"><table className="w-full text-left text-xs"><thead className="bg-canvas-sunken text-ink-faint"><TableHeadRow>{/* 表の外側の余白は見出しの余白（16px）にそろえ、操作は右へ寄せる。 */}<Th className="pl-4">ひな形</Th><Th>基準日</Th><Th>通知のタイミング</Th><Th align="right" className="pr-4">操作</Th></TableHeadRow></thead><tbody className="divide-y divide-hairline">{reminderTemplates.map((template) => <tr key={template.id}><td className="py-2 pr-2 pl-4"><strong className="block text-ink">{template.title}</strong><span className="text-ink-faint">{template.note}</span></td><td>{template.baseLabel}</td><td>{template.timingLabel}</td><td className="py-2 pr-4 pl-2 text-right"><Button onClick={() => requestTemplate(template)}>{appliedTemplateId === template.id ? '選択中' : 'このひな形を使う'}</Button></td></tr>)}</tbody></table></div>
        </ReminderPanel>
        </div>
      </ReminderWorkspace>
      <ReminderFooter status={saveStatusLabel} primary={saving ? '保存中…' : '下書きを保存して対象設定へ'} primaryDisabled={saving || candidatesPending} onPrimary={() => void save()} />
      <ConfirmDialog open={leaveTarget !== null} title="入力中の内容があります" description="このまま移動すると、入力した内容は保存されません。移動しますか？" confirmLabel="保存せずに移動" cancelLabel="入力を続ける" onConfirm={confirmLeave} onCancel={cancelLeave} />
      <ConfirmDialog open={pendingTemplate !== null} title="ひな形で入力を置き換えますか？" description={pendingTemplate ? `「${pendingTemplate.title}」を使うと、基準日・タイミング・本文の設定がひな形の内容に置き換わります。` : ''} confirmLabel="このひな形を使う" cancelLabel="やめる" onConfirm={() => { if (pendingTemplate) applyTemplate(pendingTemplate); setPendingTemplate(null) }} onCancel={() => setPendingTemplate(null)} />
    </div>
  )
}
