'use client'

import { useEffect, useState } from 'react'
import { AUTOMATION_DRAFT_ACTION_OPTIONS, AUTOMATION_DRAFT_TRIGGER_OPTIONS } from '@line-crm/shared'
import { api, ApiError, type AutomationDraftAction, type AutomationDraftDetail } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import CreatePage from '@/components/shared/create-page'
import { Field, TextArea, TextInput } from '@/components/shared/form-controls'
import DateTimeField, { TimeField } from '@/components/shared/date-time-field'
import ListState from '@/components/shared/list-state'
import TargetMissing from '@/components/shared/target-missing'
import Select from '@/components/shared/select'
import { useCanManageAutomations } from './use-automation-permission'
import Notice from '@/components/shared/notice'

// #734: きっかけ・処理の選択肢は共有の正本から描画する。新規作成と同じ一覧。
const EVENTS: Array<{ value: AutomationDraftDetail['eventType']; label: string }> = AUTOMATION_DRAFT_TRIGGER_OPTIONS.map(
  (option) => ({ value: option.value as AutomationDraftDetail['eventType'], label: option.label }),
)

const ACTIONS: Array<{ value: AutomationDraftAction['type']; label: string }> = AUTOMATION_DRAFT_ACTION_OPTIONS.map(
  (option) => ({ value: option.value as AutomationDraftAction['type'], label: option.label }),
)

function stringParam(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function stringListParam(value: unknown): string {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean).join(',') : stringParam(value)
}

/** ISO日時を datetime-local 入力の形へ直す。 */
function isoToLocalInput(value: string): string {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return ''
  const date = new Date(time)
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// #734: この画面で欄を持たない設定は、読み込んだ値をそのまま残す。
// 開いて保存しただけで formId/at などが消える事故を防ぐ。
const MANAGED_CONFIG_KEYS: Record<string, ReadonlySet<string>> = {
  tag_change: new Set(['tagId', 'action']),
  message_received: new Set(['keyword']),
  datetime: new Set(['at', 'friendIds']),
  daily: new Set(['time', 'friendIds']),
  weekly: new Set(['time', 'weekdays', 'friendIds']),
}

function preservedConfig(eventType: string, config: Record<string, unknown>): Record<string, unknown> {
  const managed = MANAGED_CONFIG_KEYS[eventType] ?? new Set<string>()
  return Object.fromEntries(Object.entries(config).filter(([key]) => !managed.has(key)))
}

export default function AutomationDraftEditor({ draftId }: { draftId: string }) {
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const canManage = useCanManageAutomations()
  const [draftVersionId, setDraftVersionId] = useState('')
  const [name, setName] = useState('')
  const [eventType, setEventType] = useState<AutomationDraftDetail['eventType']>('friend_add')
  const [triggerTagId, setTriggerTagId] = useState('')
  const [triggerTagAction, setTriggerTagAction] = useState('add')
  const [triggerKeyword, setTriggerKeyword] = useState('')
  const [triggerAt, setTriggerAt] = useState('')
  const [triggerTime, setTriggerTime] = useState('')
  const [triggerWeekdays, setTriggerWeekdays] = useState('')
  const [triggerFriendIds, setTriggerFriendIds] = useState('')
  const [preserved, setPreserved] = useState<Record<string, unknown>>({})
  const [preservedFor, setPreservedFor] = useState('')
  const [actionType, setActionType] = useState<AutomationDraftAction['type']>('add_tag')
  const [actionTagId, setActionTagId] = useState('')
  const [actionScenarioId, setActionScenarioId] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [actionCommonActionId, setActionCommonActionId] = useState('')
  const [tags, setTags] = useState<Array<{ id: string; name: string }>>([])
  const [scenarios, setScenarios] = useState<Array<{ id: string; name: string }>>([])
  const [commonActions, setCommonActions] = useState<Array<{ id: string; name: string }>>([])
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error' | 'not-found'>('loading')
  /** 失敗したあとの「もう一度読み込む」で取り直すための番号。 */
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (accountLoading || canManage !== true || !selectedAccountId) return
    let cancelled = false
    setLoadState('loading')
    void Promise.all([
      api.automations.draftResources(selectedAccountId),
      api.automations.getDraft(draftId, selectedAccountId),
    ]).then(([resourceResult, draftResult]) => {
      if (cancelled) return
      if (!resourceResult.success || !draftResult.success) {
        setLoadState('error')
        return
      }
      const draft = draftResult.data
      const action = draft.actions[0]
      setTags(resourceResult.data.tags)
      setScenarios(resourceResult.data.scenarios)
      setCommonActions(resourceResult.data.commonActions ?? [])
      setDraftVersionId(draft.draftVersionId)
      setName(draft.name)
      setEventType(draft.eventType)
      setTriggerTagId(stringParam(draft.triggerConfig.tagId))
      setTriggerTagAction(draft.triggerConfig.action === 'remove' ? 'remove' : 'add')
      setTriggerKeyword(stringParam(draft.triggerConfig.keyword))
      setTriggerAt(isoToLocalInput(stringParam(draft.triggerConfig.at)))
      setTriggerTime(stringParam(draft.triggerConfig.time))
      setTriggerWeekdays(stringListParam(draft.triggerConfig.weekdays))
      setTriggerFriendIds(stringListParam(draft.triggerConfig.friendIds))
      setPreserved(preservedConfig(draft.eventType, draft.triggerConfig))
      setPreservedFor(draft.eventType)
      if (action) {
        setActionType(action.type)
        setActionTagId(stringParam(action.params.tagId))
        setActionScenarioId(stringParam(action.params.scenarioId))
        setActionMessage(stringParam(action.params.content))
        setActionCommonActionId(stringParam(action.params.commonActionId))
      }
      setLoadState('ready')
    }).catch((caught: unknown) => {
      if (cancelled) return
      if (caught instanceof ApiError && caught.status === 404) setLoadState('not-found')
      else setLoadState('error')
    })
    return () => { cancelled = true }
  }, [accountLoading, canManage, draftId, reloadKey, selectedAccountId])

  if (accountLoading || canManage === null) {
    return <ListState kind="loading" title="下書きを読み込んでいます" />
  }
  if (!canManage) {
    return <ListState kind="forbidden" title="下書きを編集する権限がありません" />
  }
  if (!selectedAccountId) {
    return <ListState kind="empty" title="LINE公式アカウントを選んでください" />
  }
  if (loadState === 'loading') {
    return <ListState kind="loading" title="下書きを読み込んでいます" />
  }
  if (loadState === 'not-found') {
    return (
      <TargetMissing
        kind="not-found"
        title="この下書きは見つかりません"
        description="削除されたか、別の記録です。見本の一覧から選び直してください。"
        backHref="/automations?tab=templates"
        backLabel="見本の一覧へ戻る"
      />
    )
  }
  if (loadState === 'error') {
    return (
      <TargetMissing
        kind="error"
        title="下書きを表示できませんでした"
        description="下書きは消えていません。通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。"
        onRetry={() => setReloadKey((key) => key + 1)}
      />
    )
  }

  const action: AutomationDraftAction = {
    id: 'step-1',
    type: actionType,
    params: actionType === 'add_tag'
      ? { tagId: actionTagId }
      : actionType === 'start_scenario'
        ? { scenarioId: actionScenarioId }
        : actionType === 'common_action'
          ? { commonActionId: actionCommonActionId }
          : { messageType: 'text', content: actionMessage.trim() },
    onFailure: 'stop',
  }

  // #734: きっかけの設定は欄の値をそのまま送る。欄の無い設定(formIdなど)は
  // 読み込んだ値を残し、開いて保存しただけで消えないようにする。
  // 送る鍵は新規作成と同じ形に揃える(サーバのvalidateTriggerConfigが正本)。
  const buildTriggerConfig = (): Record<string, unknown> => {
    const kept = preservedFor === eventType ? preserved : {}
    if (eventType === 'tag_change') return { ...kept, tagId: triggerTagId, action: triggerTagAction }
    if (eventType === 'message_received') {
      const keyword = triggerKeyword.trim()
      return keyword ? { ...kept, keyword } : kept
    }
    if (eventType === 'datetime') {
      const at = triggerAt ? new Date(`${triggerAt}:00+09:00`).toISOString() : ''
      return {
        ...kept,
        at,
        friendIds: triggerFriendIds.split(',').map((id) => id.trim()).filter(Boolean),
      }
    }
    if (eventType === 'daily' || eventType === 'weekly') {
      return {
        ...kept,
        time: triggerTime,
        friendIds: triggerFriendIds.split(',').map((id) => id.trim()).filter(Boolean),
        ...(eventType === 'weekly'
          ? { weekdays: triggerWeekdays.split(',').map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6) }
          : {}),
      }
    }
    return kept
  }

  return (
    <CreatePage
      title="下書きを仕上げる"
      description="見本に実データは入っていません。このアカウントで使うタグやシナリオを選び、下書きとして保存します。"
      parent={['オートメーション', '/automations?tab=templates']}
      saveLabel="下書きを保存"
      validate={() => {
        if (!name.trim()) return 'ルール名を入力してください'
        if (eventType === 'tag_change' && !triggerTagId) return 'きっかけのタグを選んでください'
        if (eventType === 'datetime' && !triggerAt) return '実行日時を入力してください'
        if (eventType === 'datetime' && !triggerFriendIds.trim()) return '対象の友だちを入力してください'
        if ((eventType === 'daily' || eventType === 'weekly') && !triggerTime) return '実行時刻を入力してください'
        if ((eventType === 'daily' || eventType === 'weekly') && !triggerFriendIds.trim()) return '対象の友だちを入力してください'
        if (eventType === 'weekly' && !triggerWeekdays.trim()) return '曜日を入力してください'
        if (actionType === 'add_tag' && !actionTagId) return '付けるタグを選んでください'
        if (actionType === 'start_scenario' && !actionScenarioId) return '始めるシナリオを選んでください'
        if (actionType === 'common_action' && !actionCommonActionId) return '使う共通アクションを選んでください'
        if (actionType === 'send_message' && !actionMessage.trim()) return '送る文面を入力してください'
        return null
      }}
      onSave={async () => {
        try {
          const response = await api.automations.updateDraft(draftId, selectedAccountId, {
            expectedDraftVersionId: draftVersionId,
            name: name.trim(),
            eventType,
            triggerConfig: buildTriggerConfig(),
            actions: [action],
          })
          if (!response.success) throw new Error(response.error)
          return draftId
        } catch {
          throw new Error('下書きを保存できませんでした。状態を読み直してから、もう一度お試しください。')
        }
      }}
    >
      <p className="text-ink text-sm font-semibold">1. どのルールか</p>
      <Field label="ルール名" htmlFor="au-name" required>
        <TextInput id="au-name" value={name} onChange={(event) => setName(event.target.value)} />
      </Field>

      <p className="text-ink mt-2 text-sm font-semibold">2. 何が起きたら動かすか</p>
      <Field label="きっかけ" htmlFor="au-event" required>
        <Select
          id="au-event"
          aria-label="きっかけ"
          size="full"
          value={eventType}
          onChange={(value) => setEventType(value as AutomationDraftDetail['eventType'])}
          options={EVENTS}
        />
      </Field>
      {eventType === 'tag_change' ? (
        <>
          <Field label="対象のタグ" htmlFor="au-trigger-tag" required note="見本は実データIDを持たないため、必ず選び直します。">
            <Select
              id="au-trigger-tag"
              aria-label="対象のタグ"
              size="full"
              value={triggerTagId}
              onChange={setTriggerTagId}
              options={[{ value: '', label: '— 選んでください —' }, ...tags.map((tag) => ({ value: tag.id, label: tag.name }))]}
            />
          </Field>
          <Field label="付いたとき・外れたとき" htmlFor="au-trigger-tag-action" required>
            <Select
              id="au-trigger-tag-action"
              aria-label="付いたとき・外れたとき"
              size="full"
              value={triggerTagAction}
              onChange={setTriggerTagAction}
              options={[{ value: 'add', label: '付いたとき' }, { value: 'remove', label: '外れたとき' }]}
            />
          </Field>
        </>
      ) : null}
      {eventType === 'message_received' ? (
        <Field label="含まれる言葉" htmlFor="au-trigger-keyword" note="空のままならすべてのメッセージが対象です。">
          <TextInput
            id="au-trigger-keyword"
            aria-label="含まれる言葉"
            value={triggerKeyword}
            onChange={(event) => setTriggerKeyword(event.target.value)}
            placeholder="例: 予約"
          />
        </Field>
      ) : null}
      {eventType === 'form_submitted' ? (
        <Field label="対象のフォーム" htmlFor="au-trigger-form-note" note={preservedFor === 'form_submitted' && typeof preserved.formId === 'string' && preserved.formId ? 'フォームの指定は保存時のまま残ります。この画面では変えられません。' : 'すべてのフォームが対象です。'}>
          <TextInput id="au-trigger-form-note" aria-label="対象のフォーム" value={preservedFor === 'form_submitted' && typeof preserved.formId === 'string' ? preserved.formId : ''} disabled placeholder="すべてのフォーム" />
        </Field>
      ) : null}
      {eventType === 'link_clicked' ? (
        <Field label="対象のリンク" htmlFor="au-trigger-link-note" note={preservedFor === 'link_clicked' && typeof preserved.trackedLinkId === 'string' && preserved.trackedLinkId ? 'リンクの指定は保存時のまま残ります。この画面では変えられません。' : 'すべてのリンクが対象です。'}>
          <TextInput id="au-trigger-link-note" aria-label="対象のリンク" value={preservedFor === 'link_clicked' && typeof preserved.trackedLinkId === 'string' ? preserved.trackedLinkId : ''} disabled placeholder="すべてのリンク" />
        </Field>
      ) : null}
      {eventType === 'calendar_booked' ? (
        <Field label="対象の予約" htmlFor="au-trigger-booking-note" note={preservedFor === 'calendar_booked' && Object.keys(preserved).length > 0 ? '予約の絞り込みは保存時のまま残ります。この画面では変えられません。' : 'すべての予約が対象です。'}>
          <TextInput id="au-trigger-booking-note" aria-label="対象の予約" value="" disabled placeholder="すべての予約" />
        </Field>
      ) : null}
      {eventType === 'datetime' ? (
        <>
          <Field label="実行日時" htmlFor="au-trigger-at" required>
            <DateTimeField
              id="au-trigger-at"
              aria-label="実行日時"
              value={triggerAt}
              onChange={setTriggerAt}
            />
          </Field>
          <Field label="対象の友だち" htmlFor="au-trigger-friend-ids" required note="友だちIDをカンマ区切りで入力します（最大100人）。">
            <TextInput
              id="au-trigger-friend-ids"
              aria-label="対象の友だち"
              value={triggerFriendIds}
              onChange={(event) => setTriggerFriendIds(event.target.value)}
              placeholder="例: friend-1,friend-2"
            />
          </Field>
        </>
      ) : null}
      {eventType === 'daily' ? (
        <>
          <Field label="実行時刻" htmlFor="au-trigger-time" required>
            <TimeField
              id="au-trigger-time"
              aria-label="実行時刻"
              value={triggerTime}
              onChange={setTriggerTime}
            />
          </Field>
          <Field label="対象の友だち" htmlFor="au-trigger-daily-friend-ids" required note="友だちIDをカンマ区切りで入力します（最大100人）。">
            <TextInput
              id="au-trigger-daily-friend-ids"
              aria-label="対象の友だち"
              value={triggerFriendIds}
              onChange={(event) => setTriggerFriendIds(event.target.value)}
              placeholder="例: friend-1,friend-2"
            />
          </Field>
        </>
      ) : null}
      {eventType === 'weekly' ? (
        <>
          <Field label="実行時刻" htmlFor="au-trigger-weekly-time" required>
            <TimeField
              id="au-trigger-weekly-time"
              aria-label="実行時刻"
              value={triggerTime}
              onChange={setTriggerTime}
            />
          </Field>
          <Field label="曜日" htmlFor="au-trigger-weekdays" required note="曜日番号をカンマ区切りで入力します（例: 1,3 は月・水）。">
            <TextInput
              id="au-trigger-weekdays"
              aria-label="曜日"
              value={triggerWeekdays}
              onChange={(event) => setTriggerWeekdays(event.target.value)}
              placeholder="例: 1,3"
            />
          </Field>
          <Field label="対象の友だち" htmlFor="au-trigger-weekly-friend-ids" required note="友だちIDをカンマ区切りで入力します（最大100人）。">
            <TextInput
              id="au-trigger-weekly-friend-ids"
              aria-label="対象の友だち"
              value={triggerFriendIds}
              onChange={(event) => setTriggerFriendIds(event.target.value)}
              placeholder="例: friend-1,friend-2"
            />
          </Field>
        </>
      ) : null}

      <p className="text-ink mt-2 text-sm font-semibold">3. 何をするか</p>
      <Field label="すること" htmlFor="au-action" required>
        <Select
          id="au-action"
          aria-label="すること"
          size="full"
          value={actionType}
          onChange={(value) => setActionType(value as AutomationDraftAction['type'])}
          options={ACTIONS}
        />
      </Field>
      {actionType === 'add_tag' ? (
        <Field label="付けるタグ" htmlFor="au-action-tag" required>
          <Select
            id="au-action-tag"
            aria-label="付けるタグ"
            size="full"
            value={actionTagId}
            onChange={setActionTagId}
            options={[{ value: '', label: '— 選んでください —' }, ...tags.map((tag) => ({ value: tag.id, label: tag.name }))]}
          />
        </Field>
      ) : actionType === 'start_scenario' ? (
        <Field label="始めるシナリオ" htmlFor="au-scenario" required>
          <Select
            id="au-scenario"
            aria-label="始めるシナリオ"
            size="full"
            value={actionScenarioId}
            onChange={setActionScenarioId}
            options={[{ value: '', label: '— 選んでください —' }, ...scenarios.map((scenario) => ({ value: scenario.id, label: scenario.name }))]}
          />
        </Field>
      ) : actionType === 'common_action' ? (
        <Field
          label="使う共通アクション"
          htmlFor="au-common-action"
          required
          note="公開済みのものだけ選べます。実行するときの版が記録に残ります。"
        >
          <Select
            id="au-common-action"
            aria-label="使う共通アクション"
            size="full"
            value={actionCommonActionId}
            onChange={setActionCommonActionId}
            options={[
              { value: '', label: commonActions.length === 0 ? '公開済みの共通アクションがありません' : '— 選んでください —' },
              ...commonActions.map((item) => ({ value: item.id, label: item.name })),
            ]}
          />
        </Field>
      ) : (
        <Field label="送る文面" htmlFor="au-message" required>
          <TextArea id="au-message" rows={4} value={actionMessage} onChange={(event) => setActionMessage(event.target.value)} />
        </Field>
      )}
      <Notice tone="warn">
        保存しても自動では動きません。公開するまでは下書きのままです。
      </Notice>
    </CreatePage>
  )
}
