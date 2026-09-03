'use client'

import { useEffect, useState } from 'react'
import { api, type AutomationDraftAction, type AutomationDraftDetail } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import CreatePage from '@/components/shared/create-page'
import { Field, TextArea, TextInput } from '@/components/shared/form-controls'
import ListState from '@/components/shared/list-state'
import Select from '@/components/shared/select'
import { useCanManageAutomations } from './use-automation-permission'

const EVENTS: Array<{ value: AutomationDraftDetail['eventType']; label: string }> = [
  { value: 'friend_add', label: '友だちになったとき' },
  { value: 'message_received', label: 'メッセージを受け取ったとき' },
  { value: 'tag_change', label: 'タグが付いたとき' },
]

const ACTIONS: Array<{ value: AutomationDraftAction['type']; label: string }> = [
  { value: 'add_tag', label: 'タグを付ける' },
  { value: 'start_scenario', label: 'シナリオを始める' },
  { value: 'send_message', label: 'メッセージを送る' },
]

function stringParam(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export default function AutomationDraftEditor({ draftId }: { draftId: string }) {
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const canManage = useCanManageAutomations()
  const [draftVersionId, setDraftVersionId] = useState('')
  const [name, setName] = useState('')
  const [eventType, setEventType] = useState<AutomationDraftDetail['eventType']>('friend_add')
  const [triggerTagId, setTriggerTagId] = useState('')
  const [actionType, setActionType] = useState<AutomationDraftAction['type']>('add_tag')
  const [actionTagId, setActionTagId] = useState('')
  const [actionScenarioId, setActionScenarioId] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [tags, setTags] = useState<Array<{ id: string; name: string }>>([])
  const [scenarios, setScenarios] = useState<Array<{ id: string; name: string }>>([])
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')

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
      setDraftVersionId(draft.draftVersionId)
      setName(draft.name)
      setEventType(draft.eventType)
      setTriggerTagId(stringParam(draft.triggerConfig.tagId))
      if (action) {
        setActionType(action.type)
        setActionTagId(stringParam(action.params.tagId))
        setActionScenarioId(stringParam(action.params.scenarioId))
        setActionMessage(stringParam(action.params.content))
      }
      setLoadState('ready')
    }).catch(() => {
      if (!cancelled) setLoadState('error')
    })
    return () => { cancelled = true }
  }, [accountLoading, canManage, draftId, selectedAccountId])

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
  if (loadState === 'error') {
    return (
      <ListState
        kind="error"
        title="下書きを表示できませんでした"
        description="下書きは消えていません。前の画面へ戻り、もう一度開いてください。"
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
        : { messageType: 'text', content: actionMessage.trim() },
    onFailure: 'stop',
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
        if (actionType === 'add_tag' && !actionTagId) return '付けるタグを選んでください'
        if (actionType === 'start_scenario' && !actionScenarioId) return '始めるシナリオを選んでください'
        if (actionType === 'send_message' && !actionMessage.trim()) return '送る文面を入力してください'
        return null
      }}
      onSave={async () => {
        try {
          const response = await api.automations.updateDraft(draftId, selectedAccountId, {
            expectedDraftVersionId: draftVersionId,
            name: name.trim(),
            eventType,
            triggerConfig: eventType === 'tag_change' ? { tagId: triggerTagId, action: 'add' } : {},
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
        <Field label="付いたタグ" htmlFor="au-trigger-tag" required note="見本は実データIDを持たないため、必ず選び直します。">
          <Select
            id="au-trigger-tag"
            aria-label="付いたタグ"
            size="full"
            value={triggerTagId}
            onChange={setTriggerTagId}
            options={[{ value: '', label: '— 選んでください —' }, ...tags.map((tag) => ({ value: tag.id, label: tag.name }))]}
          />
        </Field>
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
      ) : (
        <Field label="送る文面" htmlFor="au-message" required>
          <TextArea id="au-message" rows={4} value={actionMessage} onChange={(event) => setActionMessage(event.target.value)} />
        </Field>
      )}
      <p className="rounded-v6-control bg-v6-warning-bg px-3 py-2 text-xs leading-5 text-v6-warning">
        保存しても自動では動きません。公開するまでは下書きのままです。
      </p>
    </CreatePage>
  )
}
