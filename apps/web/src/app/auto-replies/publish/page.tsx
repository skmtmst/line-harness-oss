'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Bell,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  FlaskConical,
  List,
  MessageCircle,
  PauseCircle,
  Pencil,
  Send,
  Tag,
} from 'lucide-react'
import type {
  AutoReplyConflict,
  AutoReplyDraftVersion,
  AutoReplyDryRunResult,
  AutoReplyPublishResult,
  AutoReplyValidationResult,
} from '@line-crm/shared'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Select from '@/components/shared/select'
import { usePageTitle } from '@/components/shell/page-chrome'
import { ApiError, api, type FriendListItem } from '@/lib/api'
import { canPublish, conflictTone, publishGates, type PublishStage } from './publish-flow'
import styles from './publish.module.css'

type LoadState = 'loading' | 'ready' | 'error' | 'denied'
type FriendLoadState = 'loading' | 'ready' | 'error'

const PAGE_TITLES: Record<PublishStage, string> = {
  conflicts: '自動応答・競合と優先順位',
  test: '自動応答をテスト',
  confirm: '自動応答ルール・最終確認',
  done: '自動応答・有効化完了',
}

const WIZARD_STEPS = [
  '基本設定',
  'どんなときに動くか',
  '何を返すか',
  '優先順位',
  '確認',
] as const

const REASON_LABELS: Record<string, string> = {
  message_kind_not_matched: 'メッセージの種類が違います',
  keyword_not_matched: 'キーワードに当たりません',
  outside_active_window: '受け付ける時間帯の外です',
  weekday_not_allowed: 'この曜日は受け付けません',
  operator_handling: '担当者が対応中です',
  already_replied_once: 'この友だちへは一度返しています',
  cooldown_active: '前回の返信から間を空けています',
  friend_conditions_not_met: '友だちの条件に当てはまりません',
}

const RESULT_LABELS: Record<string, string> = {
  won: '一致しました',
  skipped: '見送りました',
  not_matched: '一致しませんでした',
}

const ACTION_LABELS: Record<string, string> = {
  add_tag: 'タグ追加',
  remove_tag: 'タグ解除',
  set_metadata: '友だち情報を更新',
  start_scenario: 'シナリオ開始',
  stop_scenario: 'シナリオ停止',
  resume_scenario: 'シナリオ再開',
  send_message: 'メッセージ送信',
  send_webhook: '外部連携へ送信',
  switch_rich_menu: 'リッチメニュー切替',
  remove_rich_menu: 'リッチメニュー解除',
  set_support_mark: '対応マーク',
  support_mark: '対応マーク',
  notify: '担当者通知',
}

function Wizard({ stage }: { stage: PublishStage }) {
  const current = stage === 'conflicts' || stage === 'test' ? 3 : 4
  return (
    <ol className={styles.steps} aria-label="自動応答編集の進み方">
      {WIZARD_STEPS.map((label, index) => {
        const done = stage === 'done' || index < current
        const active = !done && index === current
        return (
          <li key={label} className={styles.step} aria-current={active ? 'step' : undefined}>
            <span className={done ? styles.stepDone : active ? styles.stepCurrent : styles.stepTodo}>
              {done ? <Check aria-hidden="true" /> : index + 1}
            </span>
            <span>
              <small>STEP {index + 1}</small>
              <strong>{label}</strong>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function PanelHeading({ title, description }: { title: string; description?: string }) {
  return (
    <header className={styles.panelHeading}>
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
    </header>
  )
}

function SummaryRows({ rows }: { rows: Array<{ label: string; value: string }> }) {
  return (
    <dl className={styles.summaryRows}>
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd title={row.value}>{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function LinePreview({
  lead,
  message,
  actionLabel = '予約を確認',
  className,
}: {
  lead: string
  message: string
  actionLabel?: string
  className?: string
}) {
  return (
    <section className={`${styles.linePreview} ${className ?? ''}`} aria-label="LINEプレビュー">
      <strong>LINEプレビュー</strong>
      <span>{lead}</span>
      <div>
        <p>{message}</p>
        <span>{actionLabel}</span>
      </div>
    </section>
  )
}

function actionTypeOf(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  const type = item.actionType ?? item.action_type ?? item.type
  return typeof type === 'string' ? type : null
}

function actionLabel(types: string[]): string {
  if (types.length === 0) return '返信のみ'
  return types.map((type) => ACTION_LABELS[type] ?? '設定した処理').join('・')
}

function conditionLabel(draft: AutoReplyDraftVersion): string {
  if (draft.settings.respondToAll) return 'すべてのメッセージ'
  const words = draft.settings.keywords
    ?.flatMap((item) => typeof item.keyword === 'string' ? [item.keyword] : []) ?? []
  const keyword = words[0] ?? draft.settings.keyword
  return keyword ? `「${keyword}」を含む` : '—（未取得）条件を確認できません'
}

function targetLabel(draft: AutoReplyDraftVersion): string {
  const conditions = draft.settings.friendConditions
  if (!conditions) return 'すべての友だち'
  const label = conditions.label
  return typeof label === 'string' && label ? label : '条件に合う友だち'
}

function scheduleLabel(draft: AutoReplyDraftVersion): string {
  const { activeFrom, activeUntil } = draft.settings
  if (!activeFrom && !activeUntil) return '毎日・終日'
  return `毎日 ${activeFrom ?? '00:00'}〜${activeUntil ?? '24:00'}`
}

function responseLabel(draft: AutoReplyDraftVersion): string {
  if (draft.settings.responseType === 'silent') return '返信なし・アクションのみ'
  if (draft.settings.templateId) return 'テンプレート＋ボタン'
  return draft.settings.responseType === 'text' ? 'テキスト' : '設定した返信'
}

function senderLabel(friend: FriendListItem): string {
  const mark = friend.supportMark?.name ?? (friend.handled === false ? '未対応' : '対応状況なし')
  const operator = friend.operator?.name ?? '担当者なし'
  return `${mark}・${operator}`
}

function AutoReplyPublishInner() {
  const params = useSearchParams()
  const autoReplyId = params.get('id') ?? ''
  const [stage, setStage] = useState<PublishStage>('conflicts')
  usePageTitle(PAGE_TITLES[stage])

  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [friendLoadState, setFriendLoadState] = useState<FriendLoadState>('loading')
  const [draft, setDraft] = useState<AutoReplyDraftVersion | null>(null)
  const [conflicts, setConflicts] = useState<AutoReplyConflict[]>([])
  const [friends, setFriends] = useState<FriendListItem[]>([])
  const [selectedFriendId, setSelectedFriendId] = useState('')
  const [testMessage, setTestMessage] = useState('予約変更したい')
  const [validation, setValidation] = useState<AutoReplyValidationResult | null>(null)
  const [dryRun, setDryRun] = useState<AutoReplyDryRunResult | null>(null)
  const [published, setPublished] = useState<AutoReplyPublishResult | null>(null)
  const [acknowledged, setAcknowledged] = useState<Set<string>>(() => new Set())
  const [testDialogOpen, setTestDialogOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  const loadFriends = useCallback(async (accountId: string) => {
    setFriendLoadState('loading')
    try {
      const res = await api.friends.list({
        accountId,
        includeChatStatus: true,
        limit: 20,
      })
      const items = res.success && Array.isArray(res.data?.items) ? res.data.items : []
      setFriends(items)
      setSelectedFriendId((current) => current || items[0]?.id || '')
      setFriendLoadState('ready')
    } catch {
      setFriends([])
      setSelectedFriendId('')
      setFriendLoadState('error')
    }
  }, [])

  const load = useCallback(async () => {
    if (!autoReplyId) {
      setLoadState('error')
      return
    }
    setLoadState('loading')
    try {
      const [draftRes, conflictRes] = await Promise.all([
        api.autoReplies.getDraft(autoReplyId),
        api.autoReplies.conflicts(autoReplyId),
      ])
      if (!draftRes.success || !conflictRes.success || !draftRes.data?.settings) {
        throw new Error('load failed')
      }
      setDraft(draftRes.data)
      setConflicts(Array.isArray(conflictRes.data?.conflicts) ? conflictRes.data.conflicts : [])
      setLoadState('ready')
      await loadFriends(draftRes.data.settings.lineAccountId)
    } catch (cause) {
      setLoadState(cause instanceof ApiError && cause.status === 403 ? 'denied' : 'error')
    }
  }, [autoReplyId, loadFriends])

  useEffect(() => { void load() }, [load])

  const gates = useMemo(
    () => publishGates(validation, dryRun, acknowledged),
    [validation, dryRun, acknowledged],
  )
  const ready = canPublish(gates)

  const run = async (what: string, fn: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setActionError('')
    try {
      await fn()
    } catch {
      setActionError(`${what}できませんでした。状態を読み直してから、もう一度お試しください。`)
    } finally {
      setBusy(false)
    }
  }

  if (loadState === 'loading') return <ListState kind="loading" />
  if (loadState === 'denied') {
    return (
      <ListState
        kind="error"
        title="この自動応答を有効化する権限がありません"
        description="下書きの中身も表示していません。統括または管理者に有効化を依頼してください。"
      />
    )
  }
  if (loadState === 'error' || !draft) {
    return (
      <ListState
        kind="error"
        title="下書きを表示できませんでした"
        description="保存した下書きは消えていません。状態を読み直して、もう一度お試しください。"
        action={<Button onClick={() => void load()}>再読み込み</Button>}
      />
    )
  }

  const draftActionTypes = draft.settings.actions
    ?.flatMap((item) => {
      const type = actionTypeOf(item)
      return type ? [type] : []
    }) ?? []
  const testedActionTypes = dryRun?.actions.map((item) => item.kind) ?? draftActionTypes
  const ruleName = draft.settings.name || draft.settings.keyword || '名前を確認できません'
  const previewMessage = dryRun?.winner?.responseContent || draft.settings.responseContent
    || '—（未取得）返信内容を確認できません'

  const openTestStage = () => {
    setStage('test')
    setTestDialogOpen(true)
  }

  const runDryTest = () => void run('テストを実行', async () => {
    if (!selectedFriendId || !testMessage.trim()) throw new Error('test input missing')
    const res = await api.autoReplies.testDraft(autoReplyId, {
      friendId: selectedFriendId,
      incomingText: testMessage,
    })
    if (!res.success) throw new Error('test failed')
    setDryRun(res.data)
    setTestDialogOpen(false)
  })

  return (
    <div className={styles.page} data-design-node={stage === 'conflicts' ? 'U9hzqH' : stage === 'test' ? 'g46ja' : stage === 'confirm' ? 'Yj6CQ' : 'e6iJG'}>
      <Link href="/auto-replies" className={styles.backLink}>
        <ArrowLeft aria-hidden="true" />
        {stage === 'test' ? '自動応答編集' : '自動応答一覧'}
      </Link>

      <Wizard stage={stage} />

      {actionError ? (
        <div className={styles.errorNotice} role="alert">
          <AlertTriangle aria-hidden="true" />
          {actionError}
        </div>
      ) : null}

      {stage === 'conflicts' ? (
        <section className={styles.panel}>
          <PanelHeading title="競合と優先順位" description="同じメッセージに反応する自動応答を確認します。上にあるものが先に動きます。" />
          {conflicts.length === 0 ? (
            <ListState kind="empty" title="重なる自動応答はありません" description="この下書きだけが反応します。" />
          ) : (
            <ul className={styles.conflictList}>
              {conflicts.map((conflict) => {
                const tone = conflictTone(conflict, draft.autoReplyId)
                const checked = acknowledged.has(conflict.autoReplyId)
                return (
                  <li key={conflict.autoReplyId}>
                    <label>
                      <input
                        type="checkbox"
                        checked={checked}
                        aria-label={`${conflict.name}の重なりを確認した`}
                        onChange={() => {
                          setAcknowledged((current) => {
                            const next = new Set(current)
                            if (next.has(conflict.autoReplyId)) next.delete(conflict.autoReplyId)
                            else next.add(conflict.autoReplyId)
                            return next
                          })
                        }}
                      />
                      <span>
                        <strong>{conflict.name}</strong>
                        <small>{tone.label}・{conflict.reason}</small>
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
          <div className={styles.inlineActions}>
            <Button
              data-qa-open="g46ja"
              variant="primary"
              disabled={busy || acknowledged.size !== conflicts.length}
              onClick={openTestStage}
            >
              自動応答をテストへ
            </Button>
          </div>
        </section>
      ) : null}

      {stage === 'test' ? (
        <>
          <div className={styles.columns}>
            <div className={styles.mainColumn}>
              <section className={`${styles.panel} ${styles.confirmPanel}`}>
                <PanelHeading title="テスト入力" description="受信した想定の言葉を入力します。" />
                <div className={styles.testFields}>
                  <label>
                    <span>メッセージ</span>
                    <input
                      value={testMessage}
                      onChange={(event) => setTestMessage(event.target.value)}
                      maxLength={2_000}
                      placeholder="例：予約変更したい"
                    />
                  </label>
                  <div className={styles.selectField}>
                    <span>送信者</span>
                    <Select
                      aria-label="送信者"
                      size="full"
                      value={selectedFriendId}
                      disabled={friendLoadState !== 'ready' || friends.length === 0}
                      onChange={setSelectedFriendId}
                      options={friends.length > 0
                        ? friends.map((friend) => ({ value: friend.id, label: senderLabel(friend) }))
                        : [{ value: '', label: friendLoadState === 'error' ? '—（未取得）送信者を確認できません' : '読み込み中' }]}
                    />
                  </div>
                </div>
              </section>

              <section className={styles.panel}>
                <PanelHeading title="判定結果" description="どのルールが反応するか確認します。" />
                <div className={styles.resultCards}>
                  <div>
                    <MessageCircle aria-hidden="true" />
                    <span><small>一致したルール</small><strong>{dryRun?.winner?.name ?? ruleName}</strong></span>
                  </div>
                  <div>
                    <Tag aria-hidden="true" />
                    <span><small>返信内容</small><strong>{responseLabel(draft)}</strong></span>
                  </div>
                </div>
                {dryRun ? (
                  <ol className={styles.evaluationList}>
                    {dryRun.candidates.map((candidate) => (
                      <li key={candidate.autoReplyId}>
                        <span>{candidate.priority}. {candidate.name}</span>
                        <strong>{RESULT_LABELS[candidate.result] ?? candidate.result}</strong>
                        {candidate.reasonCodes.length > 0 ? (
                          <small>{candidate.reasonCodes.map((code) => REASON_LABELS[code] ?? code).join('・')}</small>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                ) : null}
              </section>
            </div>

            <aside className={styles.sideColumn}>
              <section className={styles.panel}>
                <PanelHeading title="設定内容" />
                <SummaryRows rows={[
                  { label: '本番への影響', value: 'なし' },
                  { label: 'テスト', value: dryRun ? '完了' : '—（未取得）未実行' },
                  { label: '一致したルール', value: dryRun?.winner?.name ?? '—（未取得）未実行' },
                  { label: '実行される内容', value: actionLabel(testedActionTypes) },
                ]} />
              </section>
              <LinePreview lead="［テスト］受信後すぐに返信" message={previewMessage} actionLabel="空き枠を見る" />
              <div className={styles.previewActions}>
                <Button onClick={() => setTestDialogOpen(true)}><Send aria-hidden="true" />テスト送信</Button>
                <Button onClick={() => setTestDialogOpen(true)}><Eye aria-hidden="true" />応答イメージを見る</Button>
              </div>
            </aside>
          </div>

          <div className={styles.stickyBar}>
            <div />
            <div className={styles.stickyActions}>
              <Button href={`/auto-replies/edit?id=${encodeURIComponent(autoReplyId)}`}>下書きを保存</Button>
              <Button variant="primary" onClick={() => setTestDialogOpen(true)} disabled={busy || !selectedFriendId}>
                自動応答をテスト
              </Button>
              <Button
                data-qa-open="Yj6CQ"
                disabled={busy || !dryRun}
                onClick={() => void run('最終確認を表示', async () => {
                  const res = await api.autoReplies.validateDraft(autoReplyId)
                  if (!res.success) throw new Error('validate failed')
                  setValidation(res.data)
                  setStage('confirm')
                })}
              >
                最終確認へ
              </Button>
            </div>
            <div />
          </div>
        </>
      ) : null}

      {stage === 'confirm' ? (
        <>
          <div className={styles.columns}>
            <div className={styles.mainColumn}>
              <section className={`${styles.panel} ${styles.checkPanel}`}>
                <PanelHeading title="有効化前チェック" />
                <ul>
                  {gates.map((gate) => (
                    <li key={gate.label}>
                      <CheckCircle2 aria-hidden="true" />
                      <span>{gate.label}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className={styles.panel}>
                <PanelHeading title="最終確認" description="有効化すると受信メッセージを自動判定します。" />
                <SummaryRows rows={[
                  { label: 'ルール名', value: ruleName },
                  { label: 'どんなときに動くか', value: conditionLabel(draft) },
                  { label: '曜日・時間', value: scheduleLabel(draft) },
                  { label: '対象', value: targetLabel(draft) },
                  { label: '返信', value: responseLabel(draft) },
                  { label: 'アクション', value: actionLabel(draftActionTypes) },
                ]} />
                <div className={styles.warningNotice}>
                  <AlertTriangle aria-hidden="true" />
                  {draft.settings.oncePerFriend ? '最初の1件だけ実行し、' : ''}
                  {draft.settings.cooldownMinutes
                    ? `${draft.settings.cooldownMinutes}分間の連続反応を防止します。`
                    : '設定した条件に合う最初のルールだけ実行します。'}
                </div>
              </section>
            </div>

            <aside className={styles.sideColumn}>
              <LinePreview className={styles.confirmPreview} lead={`${conditionLabel(draft)}メッセージが届いたら、すぐに返します`} message={previewMessage} />
              <section className={styles.panel}>
                <PanelHeading title="有効化する内容" />
                <SummaryRows rows={[
                  { label: '状態', value: '有効化前' },
                  {
                    label: '過去の一致',
                    value: draft.matchedLast28Days === null || draft.matchedLast28Days === undefined
                      ? '—（未取得）'
                      : `${draft.matchedLast28Days}件／28日`,
                  },
                  { label: '競合', value: `${conflicts.length}件・確認済み` },
                  { label: '監視', value: 'Slack通知' },
                ]} />
              </section>
            </aside>
          </div>

          <div className={styles.stickyBar}>
            <div />
            <div className={styles.stickyActions}>
              <Button onClick={() => setStage('test')}><ArrowLeft aria-hidden="true" />戻って修正</Button>
              <Button href={`/auto-replies/edit?id=${encodeURIComponent(autoReplyId)}`}>下書きを保存</Button>
              <Button
                variant="primary"
                disabled={busy || !ready}
                title={ready ? undefined : '上の確認がすべて済むまで有効化できません'}
                onClick={() => void run('自動応答を有効化', async () => {
                  const key = `${autoReplyId}:${draft.versionId}`
                  const res = await api.autoReplies.publishDraft(
                    autoReplyId,
                    { acknowledgedConflictIds: [...acknowledged] },
                    key,
                  )
                  if (!res.success) throw new Error('publish failed')
                  setPublished(res.data)
                  setStage('done')
                })}
              >
                自動応答を有効化
              </Button>
            </div>
            <div />
          </div>
        </>
      ) : null}

      {stage === 'done' && published ? (
        <>
          <div className={styles.columns}>
            <section className={`${styles.panel} ${styles.donePanel}`}>
              <div className={styles.doneMark}><MessageCircle aria-hidden="true" /></div>
              <h2>自動応答を有効化しました</h2>
              <p>受信メッセージを判定し、一致した友だちへ自動で返信します。</p>
              <div className={styles.doneSummary}>
                <SummaryRows rows={[
                  { label: 'ルール名', value: ruleName },
                  { label: 'どんなときに動くか', value: conditionLabel(draft) },
                  { label: '対象', value: targetLabel(draft) },
                  { label: '優先順位', value: `${draft.settings.priority}番目` },
                  { label: '状態', value: '稼働中' },
                ]} />
              </div>
              <div className={styles.infoNotice}>
                <Bell aria-hidden="true" />
                実行エラー・競合増加・担当者引継ぎはSlackへ通知します。
              </div>
              <div className={styles.doneActions}>
                <Button href="/auto-replies"><List aria-hidden="true" />一覧へ戻る</Button>
                <Button href={`/auto-replies/runs?id=${encodeURIComponent(autoReplyId)}`} variant="primary">
                  <Activity aria-hidden="true" />実行状況を確認
                </Button>
              </div>
            </section>

            <aside className={styles.sideColumn}>
              <section className={styles.panel}>
                <PanelHeading title="次にできること" description="稼働中でも安全に変更できます。" />
                <div className={styles.nextActions}>
                  <Button><PauseCircle aria-hidden="true" />自動応答を一時停止</Button>
                  <Button href={`/auto-replies/edit?id=${encodeURIComponent(autoReplyId)}`}><Pencil aria-hidden="true" />内容を編集する</Button>
                  <Button onClick={openTestStage}><FlaskConical aria-hidden="true" />テストを再実行</Button>
                  <Button href="/auto-replies"><Copy aria-hidden="true" />自動応答を複製して作成</Button>
                </div>
              </section>
              <section className={styles.panel}>
                <PanelHeading title="監視中" description="問題が起きた場合だけ表示します。" />
                <ul className={styles.monitorList}>
                  {['実行失敗', '競合数の増加', 'ループ検知', '担当者引継ぎ失敗'].map((label) => (
                    <li key={label}><Activity aria-hidden="true" />{label}</li>
                  ))}
                </ul>
              </section>
              <LinePreview className={styles.donePreview} lead={`「${testMessage}」を受信したらすぐ返します`} message={previewMessage} actionLabel="空き枠を見る" />
            </aside>
          </div>
          <div className={styles.stickyBar} aria-hidden="true"><div /></div>
        </>
      ) : null}

      {stage === 'test' && testDialogOpen ? (
        <div className={styles.overlay} role="presentation">
          <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="test-dialog-title">
            <div className={styles.dialogTitle}>
              <CheckCircle2 aria-hidden="true" />
              <h2 id="test-dialog-title">テストを実行しますか？</h2>
            </div>
            <p>入力内容に一致するルールと実行予定のアクションを確認します。</p>
            <div className={styles.dialogActions}>
              <Button onClick={() => { setTestDialogOpen(false); setStage('conflicts') }}>競合と優先順位へ戻る</Button>
              <Button data-qa-open="g46ja-run" onClick={runDryTest} disabled={busy || !selectedFriendId || !testMessage.trim()}>
                {busy ? 'テスト中…' : '自動応答をテスト'}
              </Button>
              <Button variant="primary" disabled={!dryRun} onClick={() => setTestDialogOpen(false)}>
                最終確認へ
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}

export default function AutoReplyPublishPage() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <AutoReplyPublishInner />
    </Suspense>
  )
}
