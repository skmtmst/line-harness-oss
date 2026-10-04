'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AUTOMATION_DRAFT_ACTION_OPTIONS,
  AUTOMATION_DRAFT_TRIGGER_OPTIONS,
  automationActionLabel,
  automationTriggerLabel,
} from '@line-crm/shared'
import { api, ApiError, type AutomationDraftAction, type AutomationDraftDetail } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import { Field, TextInput, TextArea } from '@/components/shared/form-controls'
import HelpTip from '@/components/shared/help-tip'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import Select from '@/components/shared/select'
import StickyBar from '@/components/shared/sticky-bar'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import TargetMissing from '@/components/shared/target-missing'
import { useCanManageAutomations } from '@/components/automations/use-automation-permission'
import { formatNumber } from '@/lib/format'
import styles from '../automation-api-v8.module.css'

/*
 * ★V8 下書きを仕上げる（板 `J1VA8`）。
 * 見本から作った下書きを、このアカウントの実データで仕上げる面。
 * v8 のときだけ出す枝。v7 の編集器には触らない。
 */

const TRIGGER_META: Record<string, { note: string }> = {
  friend_add: { note: '友だち追加で動きます' },
  message_received: { note: '届いたトークの言葉で絞れます' },
  tag_change: { note: '選んだタグの付け外しで動きます' },
}

const MAIN_TRIGGERS = ['friend_add', 'message_received', 'tag_change'] as const

function stringParam(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function actionTitle(action: AutomationDraftAction): string {
  return automationActionLabel(action.type as string)
}

function actionDetail(
  action: AutomationDraftAction,
  tags: Array<{ id: string; name: string }>,
  scenarios: Array<{ id: string; name: string }>,
  commonActions: Array<{ id: string; name: string }>,
): string {
  const params = action.params as Record<string, unknown>
  if (action.type === 'add_tag') {
    const tag = tags.find((item) => item.id === stringParam(params.tagId))
    return tag ? `タグ「${tag.name}」` : 'タグを選び直してください'
  }
  if (action.type === 'start_scenario') {
    const scenario = scenarios.find((item) => item.id === stringParam(params.scenarioId))
    return scenario ? `テンプレート「${scenario.name}」` : 'シナリオを選び直してください'
  }
  if (action.type === 'common_action') {
    const common = commonActions.find((item) => item.id === stringParam(params.commonActionId))
    return common ? `共通アクション「${common.name}」` : '共通アクションを選び直してください'
  }
  if ((action.type as string) === 'notify_staff') {
    const message = stringParam(params.message)
    return message ? `${message.slice(0, 24)}${message.length > 24 ? '…' : ''}` : '担当へ知らせる'
  }
  if (action.type === 'send_message') {
    const content = stringParam(params.content)
    return content ? `${content.slice(0, 24)}${content.length > 24 ? '…' : ''}` : '文面を入力してください'
  }
  return ''
}

export default function AutomationDraftV8({ draftId }: { draftId: string }) {
  const router = useRouter()
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const canManage = useCanManageAutomations()
  usePageTitle('下書きを仕上げる')
  const [draftVersionId, setDraftVersionId] = useState('')
  const [savedVersionId, setSavedVersionId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [eventType, setEventType] = useState<AutomationDraftDetail['eventType']>('friend_add')
  const [showAllTriggers, setShowAllTriggers] = useState(false)
  const [triggerTagId, setTriggerTagId] = useState('')
  const [triggerTagAction, setTriggerTagAction] = useState('add')
  const [triggerKeyword, setTriggerKeyword] = useState('')
  const [actions, setActions] = useState<AutomationDraftAction[]>([])
  const [preservedConditions, setPreservedConditions] = useState<Record<string, unknown>>({})
  const [tags, setTags] = useState<Array<{ id: string; name: string }>>([])
  const [scenarios, setScenarios] = useState<Array<{ id: string; name: string }>>([])
  const [commonActions, setCommonActions] = useState<Array<{ id: string; name: string }>>([])
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error' | 'not-found'>('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [audience, setAudience] = useState<{ count: number | null; runs30d: number | null }>({ count: null, runs30d: null })
  /* F-15: 選んだ友だち1人で試す。保存済みの版でだけ試せる。 */
  const [testFriend, setTestFriend] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testError, setTestError] = useState('')
  const [tested, setTested] = useState(false)

  const load = useCallback(async () => {
    if (accountLoading || canManage !== true || !selectedAccountId) return
    setLoadState('loading')
    try {
      const [resourceResult, draftResult] = await Promise.all([
        api.automations.draftResources(selectedAccountId),
        api.automations.getDraft(draftId, selectedAccountId),
      ])
      if (!resourceResult.success || !draftResult.success) {
        setLoadState('error')
        return
      }
      const draft = draftResult.data
      setTags(resourceResult.data.tags)
      setScenarios(resourceResult.data.scenarios)
      setCommonActions(resourceResult.data.commonActions ?? [])
      setDraftVersionId(draft.draftVersionId)
      setSavedVersionId(draft.draftVersionId)
      setName(draft.name)
      setEventType(draft.eventType)
      setTriggerTagId(stringParam(draft.triggerConfig.tagId))
      setTriggerTagAction(draft.triggerConfig.action === 'remove' ? 'remove' : 'add')
      setTriggerKeyword(stringParam(draft.triggerConfig.keyword))
      setPreservedConditions({ ...(draft.conditions ?? {}) })
      setActions(draft.actions.length > 0 ? draft.actions : [])
      setTested(false)
      setLoadState('ready')
      api.automations.audiencePreview(draftId, selectedAccountId, draft.draftVersionId)
        .then((preview) => {
          if (!preview.success) return
          const data = preview.data as { matchedFriendCount?: number | null; executionCount30d?: number | null }
          setAudience({ count: data.matchedFriendCount ?? null, runs30d: data.executionCount30d ?? null })
        })
        .catch(() => undefined)
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) setLoadState('not-found')
      else setLoadState('error')
    }
  }, [accountLoading, canManage, draftId, selectedAccountId])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  const summarySentence = useMemo(() => {
    const trigger = automationTriggerLabel(eventType)
    const first = actions[0]
    const doing = first ? actionTitle(first) : 'すること'
    return `${trigger}ら、${doing}ます。`
  }, [eventType, actions])

  const linkRows = useMemo(() => {
    const rows: Array<[string, string]> = []
    const scenarioAction = actions.find((action) => action.type === 'start_scenario')
    const tagAction = actions.find((action) => action.type === 'add_tag')
    const commonAction = actions.find((action) => action.type === 'common_action')
    if (scenarioAction) {
      const scenario = scenarios.find((item) => item.id === stringParam((scenarioAction.params as Record<string, unknown>).scenarioId))
      rows.push(['テンプレート', scenario ? scenario.name : '選び直してください'])
    }
    if (triggerTagId || tagAction) {
      const tagId = triggerTagId || stringParam((tagAction?.params as Record<string, unknown> | undefined)?.tagId)
      const tag = tags.find((item) => item.id === tagId)
      rows.push(['タグ', tag ? tag.name : '選び直してください'])
    }
    rows.push(['共通アクション', commonAction
      ? (commonActions.find((item) => item.id === stringParam((commonAction.params as Record<string, unknown>).commonActionId))?.name ?? '選び直してください')
      : 'なし'])
    return rows
  }, [actions, scenarios, tags, commonActions, triggerTagId])

  if (accountLoading || canManage === null) return <ListState kind="loading" title="下書きを読み込んでいます" />
  if (!canManage) return <ListState kind="forbidden" title="下書きを編集する権限がありません" />
  if (!selectedAccountId) return <ListState kind="empty" title="LINE公式アカウントを選んでください" />
  if (loadState === 'loading') return <ListState kind="loading" title="下書きを読み込んでいます" />
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

  const buildTriggerConfig = (): Record<string, unknown> => {
    if (eventType === 'tag_change') return { tagId: triggerTagId, action: triggerTagAction }
    if (eventType === 'message_received') {
      const keyword = triggerKeyword.trim()
      return keyword ? { keyword } : {}
    }
    return {}
  }

  const validate = (): string | null => {
    if (!name.trim()) return 'ルール名を入力してください'
    if (eventType === 'tag_change' && !triggerTagId) return 'きっかけのタグを選んでください'
    if (eventType === 'message_received' && !triggerKeyword.trim()) return '含まれる言葉を入力してください'
    if (actions.length === 0) return '何をするかを1つ以上入れてください'
    for (const action of actions) {
      const params = action.params as Record<string, unknown>
      if (action.type === 'add_tag' && !stringParam(params.tagId)) return '付けるタグを選んでください'
      if (action.type === 'start_scenario' && !stringParam(params.scenarioId)) return '始めるシナリオを選んでください'
      if (action.type === 'common_action' && !stringParam(params.commonActionId)) return '使う共通アクションを選んでください'
      if (action.type === 'send_message' && !stringParam(params.content).trim()) return '送る文面を入力してください'
      if ((action.type as string) === 'notify_staff' && (!stringParam(params.notificationRuleId) || !stringParam(params.message).trim())) {
        return '担当へ知らせる内容を選び直してください'
      }
    }
    return null
  }

  const save = async (): Promise<boolean> => {
    if (!selectedAccountId || saving || publishing) return false
    const problem = validate()
    if (problem) {
      setSaveError(problem)
      return false
    }
    setSaving(true)
    setSaveError('')
    try {
      const response = await api.automations.updateDraft(draftId, selectedAccountId, {
        expectedDraftVersionId: draftVersionId,
        name: name.trim(),
        eventType,
        triggerConfig: buildTriggerConfig(),
        conditions: preservedConditions,
        actions,
      })
      if (!response.success) throw new Error(response.error)
      setDraftVersionId(response.data.draftVersionId)
      setSavedVersionId(response.data.draftVersionId)
      setTested(false)
      return true
    } catch {
      setSaveError('下書きを保存できませんでした。状態を読み直してから、もう一度お試しください。')
      return false
    } finally {
      setSaving(false)
    }
  }

  const publish = async () => {
    if (!selectedAccountId || publishing) return
    const saved = await save()
    if (!saved) return
    setPublishing(true)
    setSaveError('')
    try {
      const response = await api.automations.publishDraft(draftId, selectedAccountId, draftVersionId, true)
      if (!response.success) throw new Error(response.error)
      router.push('/automations')
    } catch {
      setSaveError('動かし始められませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setPublishing(false)
    }
  }

  const askSingleTest = () => {
    if (!testFriend.trim()) {
      setTestError('試す友だちを1人選んでください')
      return
    }
    if (savedVersionId !== draftVersionId) {
      setTestError('変えた後は保存し直してから試してください')
      return
    }
    setTestError('')
    setConfirming(true)
  }

  const runSingleTest = async () => {
    if (!selectedAccountId || testing) return
    setTesting(true)
    setTestError('')
    try {
      const response = await api.automations.test(draftId, selectedAccountId, testFriend.trim(), savedVersionId ?? undefined, crypto.randomUUID())
      if (!response.success) throw new Error(response.error)
      setConfirming(false)
      setTested(true)
    } catch {
      setTestError('試しに動かせませんでした。通信を確かめて、もう一度お試しください。')
    } finally {
      setTesting(false)
    }
  }

  const moveAction = (index: number, direction: -1 | 1) => {
    const next = index + direction
    if (next < 0 || next >= actions.length) return
    const reordered = [...actions]
    const [moved] = reordered.splice(index, 1)
    reordered.splice(next, 0, moved)
    setActions(reordered)
  }

  const triggerOptions = AUTOMATION_DRAFT_TRIGGER_OPTIONS.filter((option) =>
    showAllTriggers || (MAIN_TRIGGERS as readonly string[]).includes(option.value),
  )

  return (
    <div className={styles.board} data-design-node="J1VA8">
      <div>
        <Button href="/automations?tab=templates" variant="secondary">← 見本へ</Button>
      </div>
      <div>
        <h1 className={styles.title}>下書きを仕上げる</h1>
        <p className={styles.lead}>見本に実データは入っていません。このアカウントで使うタグやシナリオを選び、下書きとして保存します。</p>
      </div>

      <Notice tone="info" className={styles.sourceBand}>
        {`見本「${name}」から作った下書きです。タグとテンプレートを、このアカウントのものに選び直してください。`}
      </Notice>

      {saveError ? <Notice tone="danger">{saveError}</Notice> : null}

      <div className={styles.finishGrid}>
        <div className={styles.finishMain}>
          <Card>
            <h2 className={styles.stepNo}>1. どのルールか</h2>
            <p className={styles.stepNote}>一覧で見分けるための名前。お客さまには見えません。</p>
            <Field label="ルール名">
              <TextInput aria-label="ルール名" value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
          </Card>

          <Card>
            <h2 className={styles.stepNo}>2. 何が起きたら動かすか</h2>
            <RadioCardGroup legend="きっかけ" className={styles.triggerCards}>
              {triggerOptions.map((option) => (
                <RadioCard
                  key={option.value}
                  name="draft-trigger"
                  value={option.value}
                  checked={eventType === option.value}
                  onChange={(value) => setEventType(value as AutomationDraftDetail['eventType'])}
                  title={option.label}
                  note={TRIGGER_META[option.value]?.note}
                />
              ))}
            </RadioCardGroup>
            {!showAllTriggers ? (
              <p>
                <button type="button" className={styles.linkButton} onClick={() => setShowAllTriggers(true)}>
                  ほかのきっかけもすべて見る
                </button>
              </p>
            ) : null}
            {eventType === 'message_received' ? (
              <Field label="含まれる言葉">
                <TextInput aria-label="含まれる言葉" value={triggerKeyword} onChange={(event) => setTriggerKeyword(event.target.value)} placeholder="予約" />
              </Field>
            ) : null}
            {eventType === 'tag_change' ? (
              <>
                <Field label="きっかけのタグ">
                  <Select
                    aria-label="きっかけのタグ"
                    label="きっかけのタグ"
                    value={triggerTagId}
                    options={[{ value: '', label: '— 選んでください —' }, ...tags.map((tag) => ({ value: tag.id, label: tag.name }))]}
                    onChange={(value) => setTriggerTagId(value)}
                  />
                </Field>
                <Field label="付け外し">
                  <Select
                    aria-label="付け外し"
                    label="付け外し"
                    value={triggerTagAction}
                    options={[
                      { value: 'add', label: 'タグが付いたとき' },
                      { value: 'remove', label: 'タグが外れたとき' },
                    ]}
                    onChange={(value) => setTriggerTagAction(value)}
                  />
                </Field>
              </>
            ) : null}
          </Card>

          <Card>
            <h2 className={styles.stepNo}>だれに動かしますか</h2>
            <p className={styles.stepNote}>動かす相手</p>
            <Field label="動かす相手">
              <Select
                aria-label="動かす相手"
                label="動かす相手"
                value="all"
                options={[{ value: 'all', label: 'すべての友だち' }]}
                onChange={() => undefined}
                disabled
              />
            </Field>
          </Card>

          <Card>
            <h2 className={styles.stepNo}>3. 何をするか</h2>
            <p className={styles.stepNote}>上から順に動きます</p>
            {actions.map((action, index) => {
              const params = action.params as Record<string, unknown>
              return (
                <div key={action.id || index} className={styles.actionRow}>
                  <span className={styles.actionNo}>{index + 1}</span>
                  <div className={styles.actionBody}>
                    <p className={styles.actionTitle}>{actionTitle(action)}</p>
                    <p className={styles.actionDetail}>{actionDetail(action, tags, scenarios, commonActions)}</p>
                    <Field label="することの種類">
                      <Select
                        aria-label={`すること${index + 1}の種類`}
                        label={`すること${index + 1}の種類`}
                        value={action.type}
                        options={AUTOMATION_DRAFT_ACTION_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                        onChange={(value) => {
                          const type = value as AutomationDraftAction['type']
                          setActions((current) => current.map((item, position) => position === index
                            ? { ...item, type, params: {} }
                            : item))
                        }}
                      />
                    </Field>
                    {action.type === 'add_tag' ? (
                      <Field label="付けるタグ">
                        <Select
                          aria-label={`すること${index + 1}のタグ`}
                          label={`すること${index + 1}のタグ`}
                          value={stringParam(params.tagId)}
                          options={[{ value: '', label: '— 選んでください —' }, ...tags.map((tag) => ({ value: tag.id, label: tag.name }))]}
                          onChange={(tagId) => {
                            setActions((current) => current.map((item, position) => position === index
                              ? { ...item, params: { ...params, tagId } }
                              : item))
                          }}
                        />
                      </Field>
                    ) : null}
                    {action.type === 'start_scenario' ? (
                      <Field label="始めるシナリオ">
                        <Select
                          aria-label={`すること${index + 1}のシナリオ`}
                          label={`すること${index + 1}のシナリオ`}
                          value={stringParam(params.scenarioId)}
                          options={[{ value: '', label: '— 選んでください —' }, ...scenarios.map((scenario) => ({ value: scenario.id, label: scenario.name }))]}
                          onChange={(scenarioId) => {
                            setActions((current) => current.map((item, position) => position === index
                              ? { ...item, params: { ...params, scenarioId } }
                              : item))
                          }}
                        />
                      </Field>
                    ) : null}
                    {action.type === 'send_message' ? (
                      <Field label="送る文面">
                        <TextArea
                          aria-label={`すること${index + 1}の文面`}
                          value={stringParam(params.content)}
                          onChange={(event) => {
                            const content = event.target.value
                            setActions((current) => current.map((item, position) => position === index
                              ? { ...item, params: { ...params, messageType: 'text', content } }
                              : item))
                          }}
                        />
                      </Field>
                    ) : null}
                    {action.type === 'common_action' ? (
                      <Field label="使う共通アクション">
                        <Select
                          aria-label={`すること${index + 1}の共通アクション`}
                          label={`すること${index + 1}の共通アクション`}
                          value={stringParam(params.commonActionId)}
                          options={[{ value: '', label: '— 選んでください —' }, ...commonActions.map((common) => ({ value: common.id, label: common.name }))]}
                          onChange={(commonActionId) => {
                            setActions((current) => current.map((item, position) => position === index
                              ? { ...item, params: { ...params, commonActionId } }
                              : item))
                          }}
                        />
                      </Field>
                    ) : null}
                  </div>
                  <div className={styles.cellStack}>
                    <Button variant="secondary" disabled={index === 0} onClick={() => moveAction(index, -1)}>↑</Button>
                    <Button variant="secondary" disabled={index === actions.length - 1} onClick={() => moveAction(index, 1)}>↓</Button>
                    <Button variant="secondary" onClick={() => setActions((current) => current.filter((_, position) => position !== index))}>削除</Button>
                  </div>
                </div>
              )
            })}
            <p>
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => setActions((current) => [...current, { id: `step-${current.length + 1}`, type: 'send_message', params: { messageType: 'text', content: '' }, onFailure: 'stop' }])}
              >
                ＋ することを足す
              </button>
            </p>
          </Card>
        </div>

        <div className={styles.finishSide}>
          <Card>
            <h2 className={styles.sideTitle}>いまの決めごとを文章にすると</h2>
            <p className={styles.sideText}>{summarySentence}</p>
          </Card>

          <Card>
            <h2 className={styles.sideTitle}>当てはまりそうな人数</h2>
            <p className={styles.subLine}>この30日にあてはめた見込み</p>
            <p className={styles.sideNumber}><span>動きそうな回数</span><strong>{audience.runs30d == null ? '—' : `${formatNumber(audience.runs30d)}回`}</strong></p>
            <p className={styles.sideNumber}><span>人数</span><strong>{audience.count == null ? '—' : `${formatNumber(audience.count)}人`}</strong></p>
          </Card>

          <Card>
            <h2 className={styles.sideTitle}>1人で試す</h2>
            <p className={styles.subLine}>選んだ友だち1人だけに動かします</p>
            <Field label="友だち">
              <TextInput
                aria-label="試す友だち"
                value={testFriend}
                onChange={(event) => { setTestFriend(event.target.value); setTested(false) }}
                placeholder="友だちの名前・IDで探す"
              />
            </Field>
            <Button variant="secondary" onClick={askSingleTest} disabled={testing}>1人で試す</Button>
            {tested ? <Notice tone="info">試しに動かしました。「動いた記録」で結果を確かめてください。</Notice> : null}
            {testError ? <Notice tone="danger">{testError}</Notice> : null}
          </Card>

          <Card>
            <h2 className={styles.sideTitle}>気をつけること</h2>
            <ul className={styles.careList}>
              <li>・ 同じきっかけのルールが2つあると、両方動きます</li>
              <li>・ 止めると、そのあとのきっかけでは動きません</li>
              <li>・ 友だちになったときは、ブロック解除では動きません</li>
            </ul>
          </Card>

          <Card>
            <h2 className={styles.sideTitle}>
              つながる先
              <HelpTip label="つながる先の説明">名前はこのアカウントのものに選び直した結果です。</HelpTip>
            </h2>
            <dl className={styles.linkRows}>
              {linkRows.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>

      <StickyBar
        actions={(
          <>
            <Button variant="secondary" href="/automations?tab=templates">キャンセル</Button>
            <Button variant="secondary" onClick={() => void save()} disabled={saving || publishing} busy={saving} busyLabel="保存しています…">下書きを保存</Button>
            <Button onClick={() => void publish()} disabled={saving || publishing} busy={publishing} busyLabel="動かしています…">つくって動かす</Button>
          </>
        )}
      />

      <ConfirmDialog
        open={confirming}
        title="1人で試しますか？"
        description={`送り先：${testFriend}。送られるのは、保存済みの内容です。取り消せません。`}
        confirmLabel="試しに動かす"
        busy={testing}
        error={testError}
        onConfirm={() => void runSingleTest()}
        onCancel={() => { if (!testing) setConfirming(false) }}
      />
    </div>
  )
}
