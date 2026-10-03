'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Combobox from '@/components/shared/combobox'
import DateTimeField from '@/components/shared/date-time-field'
import { TextArea } from '@/components/shared/form-controls'
import ListState from '@/components/shared/list-state'
import Select from '@/components/shared/select'
import { ApiError, api } from '@/lib/api'
import type { CommonActionResources, FriendListItem } from '@/lib/api'
import { IdempotencyKeyStore } from '@/lib/idempotency-key-store'
import type {
  FriendBulkOperation,
  FriendBulkPreview,
  FriendBulkRunDetail,
  FriendBulkSelection,
} from '@line-crm/shared'
import {
  ITEM_GROUPS, OPERATIONS, blockedReason, canExecute, canRetry, canUndo, countText,
  failureOf, isRunComplete, itemStatusLabel, operationLabel, type Failure,
} from './bulk-run-view'
import styles from './bulk-run-dialog.module.css'
import { formatNumber } from '@/lib/format'

type Phase = 'operation' | 'confirm' | 'result'
type ResultState = 'idle' | 'loading' | 'ready' | 'error'
type ResultAction = 'execute' | 'retry' | 'undo'

const RESULT_POLL_INTERVAL_MS = 750
const RESULT_POLL_LIMIT = 40

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 友だちの一括操作（設計 `IAf7j`）。
 *
 * 流れは **対象選択 → 操作選択 → サーバーで対象を再計算 → 最終確認 → 結果**。
 * **選んだ人数がそのまま対象になるとは限らない。** 除外はサーバーが決めるので、
 * 実行前に必ず数え直した結果を見せる。
 */
export default function BulkRunDialog({
  open,
  friendIds,
  selectedFriends,
  tags,
  accountId,
  onClose,
  onDone,
}: {
  open: boolean
  friendIds: string[]
  selectedFriends: FriendListItem[]
  tags: Array<{ id: string; name: string }>
  accountId: string | null
  onClose: () => void
  onDone: () => void
}) {
  const [phase, setPhase] = useState<Phase>('operation')
  const [operationKind, setOperationKind] = useState<FriendBulkOperation['kind']>('add_tag')
  const [tagId, setTagId] = useState('')
  /* F-1: 7操作の入力。開き直したら空に戻す（下の世代切り替えで初期化）。 */
  const [scenarioId, setScenarioId] = useState('')
  const [operatorId, setOperatorId] = useState('')
  const [supportStatus, setSupportStatus] = useState('')
  const [supportMarkId, setSupportMarkId] = useState('')
  const [reminderId, setReminderId] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [messageContent, setMessageContent] = useState('')
  const [commonActionId, setCommonActionId] = useState('')
  const [resources, setResources] = useState<CommonActionResources | null>(null)
  const [operators, setOperators] = useState<Array<{ id: string; name: string }>>([])
  const [resourcesState, setResourcesState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [preview, setPreview] = useState<FriendBulkPreview | null>(null)
  const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'error' | 'forbidden'>('idle')
  const [detail, setDetail] = useState<FriendBulkRunDetail | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [busy, setBusy] = useState(false)
  const [irreversibleConfirmed, setIrreversibleConfirmed] = useState(false)
  const [runId, setRunId] = useState<string | null>(null)
  const [resultState, setResultState] = useState<ResultState>('idle')
  const [resultAction, setResultAction] = useState<ResultAction>('execute')

  /*
    **遅い返事を別の対象へ映さない。**
    アカウント・対象の組み合わせ・世代の3つが一致したときだけ受け取る。
  */
  const requestRef = useRef<{ accountId: string | null; targetKey: string; generation: number }>({
    accountId: null, targetKey: '', generation: 0,
  })
  const resultRequestRef = useRef(0)
  const createKeysRef = useRef(new IdempotencyKeyStore())
  const undoKeysRef = useRef(new IdempotencyKeyStore())
  const didChangeRef = useRef(false)

  const targetKey = friendIds.join('\u001f')
  const contextRef = useRef({ accountId, targetKey, open })
  contextRef.current = { accountId, targetKey, open }
  const selection = useMemo<FriendBulkSelection>(
    () => ({ kind: 'explicit', friendIds: [...friendIds] }),
    [friendIds],
  )
  const chosen = OPERATIONS.find((o) => o.kind === operationKind)
  const reversible = preview?.reversible ?? chosen?.reversible ?? false
  /* 選択肢の読み込みが終わるまで、担当者変更は作らせない。 */
  const operatorsLoaded = resourcesState === 'ready'

  /* 実行内容の1行まとめ。未入力のときは選び直しを促す。 */
  const operationSummary = (() => {
    if (operationKind === 'add_tag' || operationKind === 'remove_tag') {
      return tags.find((tag) => tag.id === tagId)?.name ?? '選択してください'
    }
    if (operationKind === 'start_scenario' || operationKind === 'stop_scenario') {
      return resources?.scenarios.find((scenario) => scenario.id === scenarioId)?.name ?? '選択してください'
    }
    if (operationKind === 'assign_operator') {
      if (!operatorsLoaded) return '読み込んでいます'
      return operatorId ? operators.find((operator) => operator.id === operatorId)?.name ?? '選択してください' : '割り当てなしに戻す'
    }
    if (operationKind === 'set_support') {
      const statusLabel = { unread: '未対応', in_progress: '対応中', on_hold: '保留', resolved: '対応済み' }[supportStatus] ?? ''
      const markName = resources?.supportMarks?.find((mark) => mark.id === supportMarkId)?.name ?? ''
      return [statusLabel, markName].filter(Boolean).join('・') || '選択してください'
    }
    if (operationKind === 'set_reminder') {
      const name = resources?.reminders?.find((reminder) => reminder.id === reminderId)?.name ?? ''
      if (!name || !targetDate) return '選択してください'
      return `${name}・${targetDate}`
    }
    if (operationKind === 'send_message') {
      return resources?.templates?.find((template) => template.id === templateId)?.name
        ?? (messageContent.trim() ? `直接入力（${messageContent.trim().length}文字）` : '選択してください')
    }
    if (operationKind === 'run_common_action') {
      return resources?.commonActions?.find((action) => action.id === commonActionId)?.name ?? '選択してください'
    }
    return '選択してください'
  })()

  const operation = useCallback((): FriendBulkOperation | null => {
    if (operationKind === 'add_tag' || operationKind === 'remove_tag') {
      return tagId ? { kind: operationKind, tagId } : null
    }
    if (operationKind === 'start_scenario' || operationKind === 'stop_scenario') {
      return scenarioId ? { kind: operationKind, scenarioId } : null
    }
    if (operationKind === 'assign_operator') {
      // 空は「割り当てなし」に戻す。担当者未選択のままは作らない。
      return operatorId === '' && !operatorsLoaded ? null : { kind: operationKind, operatorId: operatorId || null }
    }
    if (operationKind === 'set_support') {
      if (!supportStatus && !supportMarkId) return null
      return {
        kind: operationKind,
        ...(supportStatus ? { status: supportStatus as 'unread' | 'in_progress' | 'on_hold' | 'resolved' } : {}),
        ...(supportMarkId ? { markId: supportMarkId } : {}),
      }
    }
    if (operationKind === 'set_reminder') {
      if (!reminderId || !targetDate) return null
      return { kind: operationKind, reminderId, targetDate: new Date(`${targetDate}:00+09:00`).toISOString() }
    }
    if (operationKind === 'send_message') {
      const content = messageContent.trim()
      if (templateId) return { kind: operationKind, templateId }
      return content ? { kind: operationKind, content, messageType: 'text' } : null
    }
    if (operationKind === 'run_common_action') {
      return commonActionId ? { kind: operationKind, commonActionId } : null
    }
    return null
  }, [operationKind, tagId, scenarioId, operatorId, operatorsLoaded, supportStatus, supportMarkId, reminderId, targetDate, templateId, messageContent, commonActionId])

  const loadPreview = useCallback(async () => {
    const op = operation()
    if (!op || friendIds.length === 0) return
    requestRef.current = {
      accountId,
      targetKey,
      generation: requestRef.current.generation + 1,
    }
    const at = { ...requestRef.current }
    const stillHere = () =>
      contextRef.current.open
      && contextRef.current.accountId === at.accountId
      && contextRef.current.targetKey === at.targetKey
      && requestRef.current.generation === at.generation

    setPreviewState('loading')
    setFailure(null)
    try {
      /* **対象はサーバーが数え直す。** 画面の選択数を実行数として扱わない。 */
      const res = await api.friends.bulkPreview(selection, op)
      if (!stillHere()) return
      if (!res.success) throw new Error('failed')
      setPreview(res.data)
      setPreviewState('idle')
      setPhase('confirm')
    } catch (err) {
      if (!stillHere()) return
      const status = err instanceof ApiError ? err.status : undefined
      /* 権限不足は取得失敗と別。候補も個人情報も描かない。 */
      setPreviewState(status === 403 ? 'forbidden' : 'error')
      setPreview(null)
    }
  }, [accountId, friendIds, operation, selection, targetKey])

  const pollRun = useCallback(async (id: string, action: ResultAction) => {
    const generation = resultRequestRef.current + 1
    resultRequestRef.current = generation
    setRunId(id)
    setResultAction(action)
    setResultState('loading')
    setFailure(null)

    for (let attempt = 0; attempt < RESULT_POLL_LIMIT; attempt += 1) {
      try {
        const response = await api.friends.bulkGet(id)
        if (resultRequestRef.current !== generation) return
        if (!response.success) throw new Error('failed')
        setDetail(response.data)
        if (isRunComplete(response.data.status)) {
          setResultState('ready')
          return
        }
      } catch (error) {
        if (resultRequestRef.current !== generation) return
        setResultState('error')
        setFailure(failureOf({
          status: error instanceof ApiError ? error.status : undefined,
          action: 'detail',
        }))
        return
      }
      await wait(RESULT_POLL_INTERVAL_MS)
      if (resultRequestRef.current !== generation) return
    }

    if (resultRequestRef.current === generation) {
      setResultState('error')
      setFailure({
        kind: 'failure',
        message: '処理は受け付けていますが、まだ終わっていません。少し待ってから結果を読み直してください。',
        canReload: true,
      })
    }
  }, [])

  /* F-1: 操作の選択肢（シナリオ・担当者・対応・リマインダ・文面・共通アクション）。 */
  useEffect(() => {
    if (!open || !accountId) return
    let cancelled = false
    setResourcesState('loading')
    void Promise.all([
      api.commonActions.resources(accountId),
      api.operators.list(),
    ]).then(([resourceResult, operatorResult]) => {
      if (cancelled) return
      if (!resourceResult.success || !operatorResult.success) {
        setResourcesState('error')
        return
      }
      setResources(resourceResult.data)
      setOperators(operatorResult.data)
      setResourcesState('ready')
    }).catch(() => {
      if (!cancelled) setResourcesState('error')
    })
    return () => { cancelled = true }
  }, [open, accountId])

  useEffect(() => {
    /*
      閉じたときだけでなく、アカウントや対象が変わった瞬間に古い返事を無効にする。
      次のpreviewを押すまで世代を進めないと、切替前の遅い返事が新しい画面へ入る。
    */
    setPhase('operation'); setPreview(null); setDetail(null); setRunId(null)
    setFailure(null); setIrreversibleConfirmed(false); setPreviewState('idle')
    setTagId(''); setScenarioId(''); setOperatorId(''); setSupportStatus(''); setSupportMarkId('')
    setReminderId(''); setTargetDate(''); setTemplateId(''); setMessageContent(''); setCommonActionId('')
    setResultState('idle'); setResultAction('execute'); setBusy(false)
    requestRef.current = {
      accountId,
      targetKey,
      generation: requestRef.current.generation + 1,
    }
    resultRequestRef.current += 1
    didChangeRef.current = false
  }, [accountId, open, targetKey])

  if (!open) return null

  const execute = async () => {
    const op = operation()
    if (!op) return
    const started = { accountId, targetKey }
    const stillHere = () => contextRef.current.open
      && contextRef.current.accountId === started.accountId
      && contextRef.current.targetKey === started.targetKey
    const signature = JSON.stringify({ selection, operation: op })
    setBusy(true)
    setFailure(null)
    try {
      /*
        Workerが受け付けるのはUUID。返事を受け取れなかった再試行では同じ鍵を使い、
        同じ操作を二重に作らない。受付成功が分かってからだけ鍵を捨てる。
      */
      const key = createKeysRef.current.get(signature)
      const res = await api.friends.bulkCreate(selection, op, {
        idempotencyKey: key,
        ...(reversible ? {} : { confirmIrreversible: true }),
      })
      if (!res.success) throw new Error('failed')
      createKeysRef.current.clear(signature)
      if (!stillHere()) {
        onDone()
        return
      }
      didChangeRef.current = true
      setPhase('result')
      setDetail(null)
      void pollRun(res.data.id, 'execute')
    } catch (err) {
      if (!stillHere()) return
      setFailure(failureOf({
        status: err instanceof ApiError ? err.status : undefined,
        action: 'create',
      }))
    } finally {
      setBusy(false)
    }
  }

  const retry = async () => {
    if (!detail) return
    const started = { accountId, targetKey }
    const stillHere = () => contextRef.current.open
      && contextRef.current.accountId === started.accountId
      && contextRef.current.targetKey === started.targetKey
    setBusy(true); setFailure(null)
    try {
      /* **やり直すのは失敗した対象だけ。** 成功済みには触らない。 */
      const res = await api.friends.bulkRetry(detail.id)
      if (!res.success) throw new Error('failed')
      if (!stillHere()) {
        onDone()
        return
      }
      setDetail(null)
      void pollRun(detail.id, 'retry')
    } catch (err) {
      if (!stillHere()) return
      setFailure(failureOf({
        status: err instanceof ApiError ? err.status : undefined,
        action: 'retry',
      }))
    } finally { setBusy(false) }
  }

  const undo = async () => {
    if (!detail) return
    const started = { accountId, targetKey }
    const stillHere = () => contextRef.current.open
      && contextRef.current.accountId === started.accountId
      && contextRef.current.targetKey === started.targetKey
    const signature = `undo:${detail.id}`
    setBusy(true); setFailure(null)
    try {
      const res = await api.friends.bulkUndo(detail.id, undoKeysRef.current.get(signature))
      if (!res.success) throw new Error('failed')
      undoKeysRef.current.clear(signature)
      if (!stillHere()) {
        onDone()
        return
      }
      didChangeRef.current = true
      setDetail(null)
      /* 取り消しは別の実行。元のIDではなく、返された取消実行IDを追う。 */
      void pollRun(res.data.id, 'undo')
    } catch (err) {
      if (!stillHere()) return
      setFailure(failureOf({
        status: err instanceof ApiError ? err.status : undefined,
        action: 'undo',
      }))
    } finally { setBusy(false) }
  }

  const close = () => {
    requestRef.current = { ...requestRef.current, generation: requestRef.current.generation + 1 }
    resultRequestRef.current += 1
    if (didChangeRef.current) {
      didChangeRef.current = false
      onDone()
    }
    onClose()
  }

  const reloadFailure = () => {
    if (phase === 'result' && runId) void pollRun(runId, resultAction)
    else void loadPreview()
  }

  const blocked = blockedReason({ preview, reversible, irreversibleConfirmed })
  const resultTitle = resultAction === 'undo'
    ? '取り消し'
    : resultAction === 'retry'
      ? 'やり直し'
      : detail
        ? operationLabel(detail.operation.kind)
        : '一括操作'
  const resultComplete = detail ? isRunComplete(detail.status) : false
  const operationTiles = [
    { kind: 'add_tag', label: 'タグを付ける', note: '友だちを分類します', icon: '◇', available: true },
    { kind: 'start_scenario', label: 'シナリオを開始', note: 'ステップ配信を開始します', icon: '▷', available: true },
    { kind: 'assign_operator', label: '担当者を変更', note: '担当者をまとめて変更します', icon: '♙', available: true },
    { kind: 'set_support', label: '対応マークを変更', note: '対応状況を更新します', icon: '✓', available: true },
    { kind: 'set_reminder', label: 'リマインダーを設定', note: '指定日時に通知します', icon: '♧', available: true },
    { kind: 'send_message', label: 'メッセージを送る', note: '同じ内容をまとめて送ります', icon: '□', available: true },
    { kind: 'run_common_action', label: 'アクションを実行', note: '登録済みのアクションを実行します', icon: 'ϟ', available: true },
    { kind: 'remove_tag', label: 'タグを外す', note: '付いているタグをまとめて外します', icon: '◇', available: true },
    { kind: 'stop_scenario', label: 'シナリオを停止', note: '進行中のステップ配信を止めます', icon: '▣', available: true },
  ] as const

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label="友だちを一括操作">
      <div className={styles.panel} data-design-node="IAf7j">
        <header className={styles.head}>
          <h2 className={styles.screenTitle}>友だちを一括操作</h2>
          <div className="flex items-center justify-between gap-3">
            <button type="button" className={styles.backButton} onClick={close}>← 友だち一覧へ戻る</button>
            <button type="button" className="inline-flex items-center justify-center rounded-mini p-1.5 text-ink-secondary hover:bg-canvas hover:text-ink" onClick={close} aria-label="閉じる">
              <X aria-hidden="true" size={20} />
            </button>
          </div>
          <div className={styles.selectionBanner}>
            <strong>✓　{formatNumber(friendIds.length)}人を選択中</strong>
            <span>対象を確認してから操作を選んでください</span>
            <button type="button" onClick={close}>選択を解除</button>
          </div>
        </header>

        {failure ? (
          <div className={failure.kind === 'forbidden' ? styles.notice : styles.warn} role="alert" data-failure-kind={failure.kind}>
            <p>{failure.message}</p>
            {failure.canReload ? <Button onClick={reloadFailure}>読み直す</Button> : null}
          </div>
        ) : null}

        {phase === 'operation' ? (
          <div className={styles.body}>
            <div className={styles.operationLayout}>
            <fieldset className={styles.operationPanel}>
              <legend className={styles.panelTitle}>実行する操作を選択</legend>
              <div className={styles.categoryTabs}><strong>よく使う</strong><span>タグ</span><span>シナリオ</span><span>担当者・対応マーク</span><span>その他</span></div>
              <div className={styles.ops}>
                {operationTiles.map((op) => (
                  <button
                    key={op.kind}
                    type="button"
                    role="radio"
                    aria-checked={operationKind === op.kind}
                    disabled={!op.available}
                    title={op.available ? undefined : '入力項目と実行APIを接続後に利用できます'}
                    onClick={() => op.available && setOperationKind(op.kind)}
                    className={operationKind === op.kind ? styles.opOn : styles.op}
                  >
                    <span className={styles.opIcon}>{op.icon}</span>
                    <span className={styles.opLabel}>{op.label}</span>
                    <span className={styles.opNote}>{op.note}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <aside className={styles.executionPanel}>
              <h3 className={styles.panelTitle}>実行内容</h3>
              <dl className={styles.executionSummary}>
                <div><dt>対象</dt><dd>選択した友だち {friendIds.length}人</dd></div>
                <div><dt>操作</dt><dd>{operationLabel(operationKind)}</dd></div>
                <div><dt>内容</dt><dd>{operationSummary}</dd></div>
              </dl>
            {(operationKind === 'add_tag' || operationKind === 'remove_tag') ? (
              <div className={styles.field}>
                <span className={styles.label}>どのタグ</span>
                <Combobox
                  aria-label="どのタグ"
                  placeholder="選んでください"
                  value={tagId}
                  onChange={setTagId}
                  options={tags.map((tag) => ({ value: tag.id, label: tag.name }))}
                />
              </div>
            ) : null}
            {(operationKind === 'start_scenario' || operationKind === 'stop_scenario') ? (
              <div className={styles.field}>
                <span className={styles.label}>どのシナリオ</span>
                <Combobox
                  aria-label="どのシナリオ"
                  placeholder={resourcesState === 'loading' ? '読み込んでいます' : '選んでください'}
                  value={scenarioId}
                  onChange={setScenarioId}
                  disabled={resourcesState === 'loading'}
                  options={(resources?.scenarios ?? []).map((scenario) => ({ value: scenario.id, label: scenario.name }))}
                />
              </div>
            ) : null}
            {operationKind === 'assign_operator' ? (
              <div className={styles.field}>
                <span className={styles.label}>どの担当者</span>
                <Combobox
                  aria-label="どの担当者"
                  placeholder={resourcesState === 'loading' ? '読み込んでいます' : '選んでください'}
                  value={operatorId}
                  onChange={setOperatorId}
                  disabled={resourcesState === 'loading'}
                  options={[{ value: '', label: '割り当てなしに戻す' }, ...operators.map((operator) => ({ value: operator.id, label: operator.name }))]}
                />
              </div>
            ) : null}
            {operationKind === 'set_support' ? (
              <>
                <div className={styles.field}>
                  <span className={styles.label}>対応状況</span>
                  <Select
                    aria-label="対応状況"
                    label="対応状況"
                    value={supportStatus}
                    onChange={setSupportStatus}
                    options={[
                      { value: '', label: '変えない' },
                      { value: 'unread', label: '未対応' },
                      { value: 'in_progress', label: '対応中' },
                      { value: 'on_hold', label: '保留' },
                      { value: 'resolved', label: '対応済み' },
                    ]}
                  />
                </div>
                <div className={styles.field}>
                  <span className={styles.label}>対応マーク</span>
                  <Combobox
                    aria-label="対応マーク"
                    placeholder={resourcesState === 'loading' ? '読み込んでいます' : '変えない'}
                    value={supportMarkId}
                    onChange={setSupportMarkId}
                    disabled={resourcesState === 'loading'}
                    options={(resources?.supportMarks ?? []).map((mark) => ({ value: mark.id, label: mark.name }))}
                  />
                </div>
              </>
            ) : null}
            {operationKind === 'set_reminder' ? (
              <>
                <div className={styles.field}>
                  <span className={styles.label}>どのリマインダー</span>
                  <Combobox
                    aria-label="どのリマインダー"
                    placeholder={resourcesState === 'loading' ? '読み込んでいます' : '選んでください'}
                    value={reminderId}
                    onChange={setReminderId}
                    disabled={resourcesState === 'loading'}
                    options={(resources?.reminders ?? []).map((reminder) => ({ value: reminder.id, label: reminder.name }))}
                  />
                </div>
                <div className={styles.field}>
                  <span className={styles.label}>いつ知らせる</span>
                  <DateTimeField
                    aria-label="いつ知らせる"
                    value={targetDate}
                    onChange={setTargetDate}
                  />
                </div>
              </>
            ) : null}
            {operationKind === 'send_message' ? (
              <>
                <div className={styles.field}>
                  <span className={styles.label}>どの文面</span>
                  <Combobox
                    aria-label="どの文面"
                    placeholder={resourcesState === 'loading' ? '読み込んでいます' : '直接入力する'}
                    value={templateId}
                    onChange={setTemplateId}
                    disabled={resourcesState === 'loading'}
                    options={(resources?.templates ?? []).map((template) => ({ value: template.id, label: template.name }))}
                  />
                </div>
                {!templateId ? (
                  <div className={styles.field}>
                    <span className={styles.label}>送る内容</span>
                    <TextArea
                      aria-label="送る内容"
                      placeholder="同じ内容をまとめて送ります"
                      value={messageContent}
                      onChange={(event) => setMessageContent(event.target.value)}
                      rows={3}
                    />
                  </div>
                ) : null}
                <p className={styles.executionHint}>ⓘ 1,000人以上への送信は承認が必要です。承認の案内は結果に出ます。</p>
              </>
            ) : null}
            {operationKind === 'run_common_action' ? (
              <div className={styles.field}>
                <span className={styles.label}>どのアクション</span>
                <Combobox
                  aria-label="どのアクション"
                  placeholder={resourcesState === 'loading' ? '読み込んでいます' : '選んでください'}
                  value={commonActionId}
                  onChange={setCommonActionId}
                  disabled={resourcesState === 'loading'}
                  options={(resources?.commonActions ?? []).map((action) => ({ value: action.id, label: action.name }))}
                />
              </div>
            ) : null}
            {resourcesState === 'error' && operationKind !== 'add_tag' && operationKind !== 'remove_tag' ? (
              <p className={styles.executionHint}>ⓘ 選択肢を読み込めませんでした。開き直すと読み直します。</p>
            ) : null}
            <p className={styles.executionHint}>ⓘ 実行前に対象と操作内容を確認できます。</p>

            {previewState === 'loading' ? <ListState kind="loading" title="対象を数えています" /> : null}
            {previewState === 'error' ? (
              <ListState
                kind="error"
                title="対象を数えられませんでした"
                description="選んだ友だちは変わっていません。読み直してから、もう一度お試しください。"
                onRetry={() => void loadPreview()}
              />
            ) : null}
            {previewState === 'forbidden' ? (
              <ListState
                kind="forbidden"
                title="まとめて操作する権限がありません"
                description="この操作はオーナーと管理者だけが行えます。"
              />
            ) : null}

            <div className={styles.actions}>
              <Button variant="primary" disabled={!operation() || previewState === 'loading'} onClick={() => void loadPreview()}>
                実行内容を確認
              </Button>
            </div>
            </aside>
            </div>

            <section className={styles.selectedPanel}>
              <div className={styles.selectedHead}><h3>選択した友だち</h3><strong>{friendIds.length}人</strong></div>
              <div className={styles.selectedTable}>
                <div className={styles.selectedRowHead}><span>名前</span><span>流入元</span><span>担当者</span><span>現在のタグ</span></div>
                {selectedFriends.map((friend) => (
                  <div className={styles.selectedRow} key={friend.id}>
                    <strong>{friend.displayName}</strong>
                    <span>{friend.firstTrackedLinkName ?? 'LINE'}</span>
                    <span>{friend.operator?.name ?? '未割り当て'}</span>
                    <span>{friend.tags.map((tag) => tag.name).join('・') || '—'}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        ) : null}

        {phase === 'confirm' && preview ? (
          <div className={styles.body}>
            <dl className={styles.summary}>
              <div><dt>選んだ人</dt><dd>{countText(preview.selectedCount, '人')}</dd></div>
              <div><dt>実際の対象</dt><dd className={styles.strong}>{countText(preview.targetCount, '人')}</dd></div>
              <div><dt>対象外</dt><dd>{countText(preview.excludedCount, '人')}</dd></div>
            </dl>

            {preview.accountBreakdown.length > 0 ? (
              <section className={styles.block}>
                <h3 className={styles.blockTitle}>LINEアカウント別</h3>
                <ul className={styles.list}>
                  {preview.accountBreakdown.map((row) => (
                    <li key={row.lineAccountId ?? 'none'}>
                      {row.lineAccountId ? 'このアカウント' : 'アカウント未設定'}
                      <span className={styles.count}>{countText(row.count, '人')}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {preview.exclusions.length > 0 ? (
              <section className={styles.block}>
                <h3 className={styles.blockTitle}>対象外の理由</h3>
                <ul className={styles.list}>
                  {preview.exclusions.map((row) => (
                    <li key={row.reason}>{row.reason}<span className={styles.count}>{countText(row.count, '人')}</span></li>
                  ))}
                </ul>
              </section>
            ) : null}

            {preview.sample.length > 0 ? (
              <section className={styles.block}>
                <h3 className={styles.blockTitle}>選択した友だち</h3>
                <ul className={styles.list}>
                  {preview.sample.map((item) => (
                    /* 内部IDは出さない。名前が無いときは「名前未登録」。 */
                    <li key={item.friendId}>{item.displayName ?? '名前未登録'}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {!reversible ? (
              <Checkbox checked={irreversibleConfirmed} onCheckedChange={setIrreversibleConfirmed}>
                {/* 取り消せないことを窓の中に書く。 */}
                この操作は取り消せません。{countText(preview.targetCount, '人')}に実行することを確認しました。
              </Checkbox>
            ) : null}

            {blocked ? <p className={styles.hint}>{blocked}</p> : null}

            <div className={styles.actions}>
              <Button onClick={() => setPhase('operation')} disabled={busy}>戻る</Button>
              <Button
                variant="primary"
                disabled={!canExecute({ preview, busy, irreversibleConfirmed, reversible })}
                onClick={() => void execute()} busy={busy} busyLabel="実行中…">
                {`${countText(preview.targetCount, '人')}に実行`}
              </Button>
            </div>
          </div>
        ) : null}

        {phase === 'result' ? (
          <div className={styles.body}>
            {resultState === 'loading' && !detail ? (
              <ListState kind="loading" title={`${resultTitle}の結果を確認しています`} />
            ) : null}

            {detail ? (
              <>
                <dl className={styles.summary}>
                  {ITEM_GROUPS.map((group) => {
                    const value = group.key === 'success' ? detail.successCount
                      : group.key === 'skipped' ? detail.skippedCount
                        : group.key === 'temporary_failure' ? detail.temporaryFailureCount
                          : detail.permanentFailureCount
                    return (
                      <div key={group.key}>
                        <dt>{group.label}</dt>
                        <dd>{countText(value, '人')}</dd>
                        <p className={styles.hint}>{group.note}</p>
                      </div>
                    )
                  })}
                </dl>

                <p className={styles.note}>
                  {resultComplete
                    ? `${resultTitle}が終わりました。`
                    : `${resultTitle}を処理しています。終わるまでこの結果を更新します。`}
                </p>

                {detail.items.length > 0 ? (
                  <ul className={styles.list}>
                    {detail.items.map((item) => (
                      <li key={item.id}>
                        {item.displayName ?? '名前未登録'}
                        <span className={styles.count}>{itemStatusLabel(item.status)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : null}

            {resultState === 'ready' && (canUndo(detail) || canRetry(detail)) ? (
              <div className={styles.actions}>
                {canUndo(detail) ? (
                  <Button onClick={() => void undo()} disabled={busy}>取り消す</Button>
                ) : null}
                {canRetry(detail) ? (
                  <Button variant="primary" onClick={() => void retry()} disabled={busy}>
                    失敗した{countText(detail?.temporaryFailureCount, '人')}だけやり直す
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
