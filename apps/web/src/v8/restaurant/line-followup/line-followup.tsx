'use client'

import { DetailPreview } from '@/components/shared/detail-content'
import ReadOnlyNotice from '@/components/shared/read-only-notice'
import { useEffect, useRef, useState, type ComponentType } from 'react'
import { Bell, CalendarClock, CalendarHeart, Check, ChevronDown, Clock, HeartHandshake, MessageSquare, MessageSquareText, Star } from 'lucide-react'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import StatusBadge from '@/components/shared/status-badge'
import Select from '@/components/shared/select'
import { Field, TextInput } from '@/components/shared/form-controls'
import { useAccount } from '@/contexts/account-context'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { RestaurantFrame } from '@/v8/restaurant/common-a/public/frame/index'
import { DetailColumns } from '@/components/templates/detail-columns'
import type { ApiResponse, BroadcastBubble, RestaurantFollowupTrigger } from '@line-crm/shared'
import { ApiError, describeSaveFailure } from '@/lib/api/transport/errors'
import {
  fetchFollowupReviewHistory,
  fetchRestaurantFollowup,
  isUnsupportedBody,
  publishFollowupScenario,
  requestFollowupStart,
  saveFollowupBinding,
  saveFollowupMessages,
  stopFollowup,
  type FollowupLive,
  type FollowupStepLive,
} from '@/lib/api/helpers/restaurant-followup'
import { StepEditor, StepPreview, bubbleText } from './flow-editor'
import { RESTAURANT_TRIGGER_ROWS, UNIT_LABEL, UNIT_MINUTES, exactTiming, timingError, timingLabel, type FollowupTriggerRow, type OffsetUnit } from './config'
import styles from './line-followup.module.css'

/*
 * LINE来店フォロー（飲食・本番接続）。7つの行は店のフォローの設定で、
 * 送る中身はシナリオ（本体）の一歩と同じ吹き出し。行を押すと、
 * その中身をシナリオの一歩と同じ形で直せる。
 * くわしい直しは本体のシナリオ画面（くわしく設定する →）でする。
 */

type KindIcon = ComponentType<{ size?: number; 'aria-hidden'?: boolean }>
const KIND_ICONS: Record<RestaurantFollowupTrigger, KindIcon> = {
  reservation_created: Bell, reservation_24h: CalendarClock, reservation_2h: Clock,
  post_visit: HeartHandshake, review_request: Star, waitlist_invited: MessageSquareText, anniversary_before: CalendarHeart,
}

type ScreenState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'empty' }
  | { kind: 'ready'; live: FollowupLive }

function unwrap<T>(response: ApiResponse<T>, fallback: string): T {
  if (!response.success) throw new Error(response.error || fallback)
  return response.data
}

function RowStatus({ step }: { step: FollowupStepLive }) {
  if (!step.binding || !step.binding.enabled) return <StatusBadge tone="neutral">止めています</StatusBadge>
  if (step.state === 'sending') return <StatusBadge tone="success">送ります</StatusBadge>
  return <StatusBadge tone="neutral">準備ができました</StatusBadge>
}

/*
 * 申請の対象の見分け。公開と申請の間にほかの担当者が変えたら、公開した中身と
 * 画面の中身がずれる。再取得した中身が公開時と同じか比べ、違えば申請を止める。
 * 版と送りの状態は公開自体で変わるため比べない。一歩は丸ごと比べる
 * （旧形式の Flex 等は吹き出しが空でも中身が変わりうる）。
 */
export function liveFingerprint(live: FollowupLive): string {
  return JSON.stringify(live.steps.map(step => [step.trigger, step.binding, step.step]))
}

function SendingLine({ live }: { live: FollowupLive }) {
  const text = live.sendingStatus === 'active' ? '本送信しています'
    : live.sendingStatus === 'pending' ? '承認を待っています' : '本送信は止めています'
  /* 承認の行き先は状態の札から開く（左メニューは変えない）。 */
  if (live.approvalId) {
    return <p role="status"><Button variant="text" href="/restaurant-test/approvals">{`${text}（中身の版: ${live.templateVersion}）→`}</Button></p>
  }
  return <p role="status">{`${text}（中身の版: ${live.templateVersion}）`}</p>
}

/* 開いた行の操作（オン/オフ・時期・本文）。行が変わるたび作り直す。本文の下書きは Board が持ち、行を切り替えても保つ。 */
function OpenRow({ row, step, live, accountId, storeId, readOnly, unknownRole, reviewCount, busy, setBusy, failed, reload, bubbles, onBubbles }: {
  row: FollowupTriggerRow
  step: FollowupStepLive | null
  live: FollowupLive
  accountId: string
  storeId: string
  readOnly: boolean
  unknownRole: boolean
  reviewCount: number | null
  busy: string | null
  setBusy: (action: string | null) => void
  failed: (message: string) => void
  reload: () => void
  bubbles: BroadcastBubble[]
  onBubbles: (next: BroadcastBubble[]) => void
}) {
  const binding = step?.binding ?? null
  const enabled = binding?.enabled === 1
  const currentOffset = binding?.offset_minutes ?? row.defaultOffsetMinutes
  const initial = exactTiming(Math.abs(currentOffset), row.units)
  const [amount, setAmount] = useState(initial.amount)
  const [unit, setUnit] = useState<OffsetUnit>(initial.unit)
  const anniversaryLocked = row.trigger === 'anniversary_before'
  const noStep = !binding || !step?.step
  const unsupportedBody = isUnsupportedBody(step?.step ?? null)
  const locked = unknownRole || busy !== null
  /* 権限の理由は lockedReason、状態の理由は目の前の文。役割不明は理由なし。 */
  const permReason = readOnly ? '閲覧のみのため変えられません' : null
  const toggleStateReason = noStep ? '本体の一歩がまだないため、この行は変えられません'
    : anniversaryLocked ? '記念日前の始まりはサーバーの口がまだないため、オンと時期は変えられません' : null
  const bodyStateReason = noStep ? '本体の一歩がまだないため、本文は変えられません'
    : unsupportedBody ? 'この本文はテキスト以外の形のため、この画面では直せません。本体のシナリオ画面で直してください' : null
  const toggleLocked = locked || permReason !== null || toggleStateReason !== null
  const bodyLocked = locked || permReason !== null || bodyStateReason !== null

  const run = async (action: string, work: () => Promise<unknown>) => {
    setBusy(action)
    try {
      await work()
      reload()
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        reload()
        failed('ほかの担当者が先に保存しました。読み直しました。')
      } else {
        failed(describeSaveFailure(error))
      }
    } finally {
      setBusy(null)
    }
  }
  const offsetOf = (): number | null => {
    const value = Number(amount)
    if (!Number.isSafeInteger(value) || value < 0) return null
    const minutes = value * UNIT_MINUTES[unit]
    return row.direction === 'before' ? -minutes : minutes
  }
  return <div>
    <div>
      <Button variant="secondary" disabled={toggleLocked} busy={busy === 'toggle'}
        lockedReason={permReason}
        onClick={() => {
          if (!binding || !step) return
          const next = !enabled
          void run('toggle', async () => {
            unwrap(await saveFollowupBinding(accountId, storeId, binding.step_id, 'PATCH', {
              expectedVersion: live.templateVersion, trigger: row.trigger,
              offsetMinutes: binding.offset_minutes, enabled: next,
            }), 'オン/オフを変えられませんでした')
          })
        }}>
        {enabled ? '止める' : '送る'}
      </Button>
      {permReason && !unknownRole ? <p role="note">{permReason}</p> : null}
      {toggleStateReason ? <p role="note">{toggleStateReason}</p> : null}
    </div>
    <Field label="時期" note={row.direction === 'before' ? '前の日時を入れます' : '起点からの後を入れます（0はすぐ）'}>
      <TextInput value={amount} inputMode="numeric" disabled={toggleLocked}
        aria-label="時期の数値" onChange={event => setAmount(event.target.value)} />
      <Select value={unit} disabled={toggleLocked} aria-label="時期の単位"
        lockedReason={permReason ?? undefined}
        options={row.units.map(item => ({ value: item, label: UNIT_LABEL[item] }))}
        onChange={value => setUnit(value as OffsetUnit)} />
      <Button variant="secondary" disabled={toggleLocked} busy={busy === 'timing'}
        lockedReason={permReason}
        onClick={() => {
          const offset = offsetOf()
          if (offset === null) { failed('時期は0以上の整数で入れてください'); return }
          const invalid = timingError(row.trigger, offset)
          if (invalid) { failed(invalid); return }
          if (!binding) return
          void run('timing', async () => {
            unwrap(await saveFollowupBinding(accountId, storeId, binding.step_id, 'PATCH', {
              expectedVersion: live.templateVersion, trigger: row.trigger,
              offsetMinutes: offset, enabled,
            }), '時期を変えられませんでした')
          })
        }}>
        時期を保存する
      </Button>
    </Field>
    <StepEditor name={row.name} bubbles={bubbles} readOnly={bodyLocked} busy={busy === 'body'} onChange={onBubbles} />
    {bodyStateReason ? <p role="note">{bodyStateReason}</p> : null}
    <div>
      <Button variant="primary" disabled={bodyLocked} busy={busy === 'body'}
        lockedReason={permReason}
        onClick={() => {
          if (!binding || !step?.step || unsupportedBody) return
          const next = bubbles.length ? bubbles : [{ id: 'draft', type: 'text' as const, content: { text: '' } }]
          if (!next.some(item => item.type !== 'text' || bubbleText(item).trim())) { failed('本文を入れてください'); return }
          void run('body', async () => {
            unwrap(await saveFollowupMessages(accountId, storeId, binding.step_id, {
              expectedVersion: live.templateVersion, messageBubbles: next,
            }), '本文を保存できませんでした')
          })
        }}>
        <Check size={16} aria-hidden />本文を保存する
      </Button>
      <Button variant="text" href={`/scenarios/detail?id=${encodeURIComponent(live.scenarioId)}`}>くわしく設定する →</Button>
    </div>
    {row.trigger === 'review_request' ? (
      <p role="status">{reviewCount === null ? '送信履歴は読めませんでした' : `送信履歴 ${reviewCount}件`}</p>
    ) : null}
  </div>
}

function Board({ accountId, storeId, storeName, selectedTrigger, onSelect, readOnly, unknownRole }: {
  accountId: string | null
  storeId: string | null
  storeName: string
  selectedTrigger: RestaurantFollowupTrigger
  onSelect: (trigger: RestaurantFollowupTrigger) => void
  readOnly: boolean
  unknownRole: boolean
}) {
  const [previewExpanded, setPreviewExpanded] = useState(false)
  const [state, setState] = useState<ScreenState>({ kind: 'loading' })
  const [reviewCount, setReviewCount] = useState<number | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  /* 行ごとの本文の下書き。行を切り替えても保ち、読み直すと捨てる。店が変わると Board ごと作り直す。 */
  const [edits, setEdits] = useState<Record<string, BroadcastBubble[]>>({})
  /* 失敗の知らせは店が変わったときだけ消す。保存後の読み直しでは保つ。 */
  const storeKey = `${accountId ?? ''} ${storeId ?? ''}`
  const prevStoreKey = useRef(storeKey)
  useEffect(() => {
    if (!accountId || !storeId) return
    let cancelled = false
    if (prevStoreKey.current !== storeKey) {
      prevStoreKey.current = storeKey
      setActionError(null)
    }
    setState({ kind: 'loading' })
    fetchRestaurantFollowup(accountId, storeId, storeName).then(live => {
      if (cancelled) return
      setState(live ? { kind: 'ready', live } : { kind: 'empty' })
      if (live) {
        fetchFollowupReviewHistory(accountId, storeId).then(
          invitations => { if (!cancelled) setReviewCount(invitations.length) },
          () => { if (!cancelled) setReviewCount(null) },
        )
      }
    }).catch((error: unknown) => {
      if (cancelled) return
      setState({ kind: 'error', message: error instanceof Error ? error.message : '読み込めませんでした' })
    })
    return () => { cancelled = true }
  }, [accountId, storeId, storeName, reloadKey, storeKey])
  if (!accountId) return <p role="alert">アカウントを選んでください</p>
  if (state.kind === 'loading') return <p role="status">読み込んでいます…</p>
  if (state.kind === 'error') return <p role="alert">{state.message}</p>
  const rows = RESTAURANT_TRIGGER_ROWS
  const current: FollowupTriggerRow = rows.find(row => row.trigger === selectedTrigger) ?? rows[0]!
  const live = state.kind === 'ready' ? state.live : null
  const step: FollowupStepLive | null = live?.steps.find(item => item.trigger === current.trigger) ?? null
  const sample = live === null
  const blank = (id: string, text: string): BroadcastBubble[] => [{ id, type: 'text', content: { text } }]
  const draft = edits[current.trigger]
    ?? (step && step.bubbles.length ? step.bubbles : sample ? blank('sample', current.sampleText) : blank('draft', ''))
  /* 直せない形の本文は、空の見え方にせず正直に出す。 */
  const previewBubbles = !sample && isUnsupportedBody(step?.step ?? null) && !edits[current.trigger]
    ? blank('unsupported', '（この画面では見られない形の本文です）')
    : draft
  const reload = () => { setEdits({}); setReloadKey(key => key + 1) }
  const permReason = readOnly ? '閲覧のみのため変えられません' : null
  const startStopLocked = busy !== null || unknownRole || readOnly
  return <>
    {readOnly ? <ReadOnlyNotice role="note" /> : null}
    {actionError ? <p role="alert">{actionError}</p> : null}
    <DetailColumns asideLayout="detail" presentation="notification" asideLabel="LINEでの見え方" expanded={previewExpanded} onExpandedChange={setPreviewExpanded}
      aside={<DetailPreview title="LINEでの見え方"><StepPreview bubbles={previewBubbles} accountName={storeName || 'LINE公式アカウント'} /></DetailPreview>}>
      {live ? <SendingLine live={live} /> : null}
      <div className={styles.flowList}>
        {rows.map(row => {
          const Icon = KIND_ICONS[row.trigger] ?? MessageSquare
          const isSelected = row.trigger === current.trigger
          const rowStep = live?.steps.find(item => item.trigger === row.trigger) ?? null
          const offset = rowStep?.offsetMinutes ?? row.defaultOffsetMinutes
          return <div key={row.trigger} className={styles.flowItem}>
            <Card padding="none" contentPadding="0px 0px" data-open={isSelected || undefined} className={isSelected ? styles.flowCardOpen : undefined}>
              <button type="button" className={styles.flowButton} aria-expanded={isSelected} aria-label={row.name} onClick={() => onSelect(row.trigger)}>
                <span className={styles.flowIcon}><Icon size={16} aria-hidden /></span>
                <span className={styles.flowText}>
                  <span className={styles.flowName} title={row.name}>{row.name}</span>
                  <span className={styles.flowNote} title={row.note}>{row.note}</span>
                </span>
                <span className={styles.flowTiming}>{timingLabel(row.trigger, offset)}</span>
                <span className={styles.flowStatus}>{rowStep?.binding ? <RowStatus step={rowStep} /> : <StatusBadge tone="neutral">まだありません</StatusBadge>}</span>
                <ChevronDown size={18} aria-hidden="true" data-flow-chevron className={styles.flowChevron} data-open={isSelected || undefined} />
              </button>
            </Card>
            {isSelected && live && storeId ? (
              <OpenRow key={`${row.trigger}:${live.templateVersion}`} row={row} step={rowStep} live={live}
                accountId={accountId} storeId={storeId}
                readOnly={readOnly} unknownRole={unknownRole} reviewCount={reviewCount} busy={busy} setBusy={setBusy}
                failed={setActionError} reload={reload}
                bubbles={edits[row.trigger] ?? rowStep?.bubbles ?? blank('draft', '')}
                onBubbles={next => setEdits(current => ({ ...current, [row.trigger]: next }))} />
            ) : null}
            {isSelected && sample ? <StepEditor name={row.name} bubbles={draft} readOnly busy={false} onChange={() => {}} /> : null}
          </div>
        })}
      </div>
      {sample ? <p role="note">この店のフォローの設定はまだありません。表の文は見本です。</p> : null}
      {live && storeId ? (
        <div>
          <Button variant="secondary" disabled={startStopLocked} busy={busy === 'start'}
            lockedReason={permReason}
            onClick={() => {
              setBusy('start')
              /* 申請は公開版を対象にする。直前に公開し、公開で増えた版を取り直してから申請する。 */
              publishFollowupScenario(live.scenarioId).then(
                publishResponse => {
                  try {
                    unwrap(publishResponse, '本体のシナリオを公開できませんでした')
                  } catch (error) {
                    setBusy(null)
                    setActionError(error instanceof Error ? error.message : '本体のシナリオを公開できませんでした')
                    return
                  }
                  fetchRestaurantFollowup(accountId, storeId, storeName).then(
                    fresh => {
                      if (!fresh) {
                        setBusy(null)
                        setActionError('フォローの設定を読み直せませんでした')
                        return
                      }
                      if (liveFingerprint(fresh) !== liveFingerprint(live)) {
                        setBusy(null)
                        reload()
                        setActionError('ほかの担当者が先に保存しました。公開した中身と変わったため申請を止めました。読み直しました。')
                        return
                      }
                      requestFollowupStart(accountId, storeId, fresh.templateVersion).then(
                        response => {
                          setBusy(null)
                          try {
                            unwrap(response, '承認を申請できませんでした')
                          } catch (error) {
                            setActionError(error instanceof Error ? error.message : '承認を申請できませんでした')
                            return
                          }
                          reload()
                        },
                        (error: unknown) => {
                          setBusy(null)
                          if (error instanceof ApiError && error.status === 409) {
                            reload()
                            setActionError('承認を申請できませんでした。ほかの担当者が先に保存しました。読み直しました。')
                          } else {
                            setActionError(describeSaveFailure(error))
                          }
                        },
                      )
                    },
                    (error: unknown) => {
                      setBusy(null)
                      setActionError(describeSaveFailure(error))
                    },
                  )
                },
                (error: unknown) => {
                  setBusy(null)
                  setActionError(describeSaveFailure(error))
                },
              )
            }}>
            承認を申請する
          </Button>
          <Button variant="secondary" disabled={startStopLocked} busy={busy === 'stop'}
            lockedReason={permReason}
            onClick={() => {
              setBusy('stop')
              stopFollowup(accountId, storeId).then(
                () => { setBusy(null); reload() },
                (error: unknown) => {
                  setBusy(null)
                  setActionError(describeSaveFailure(error))
                },
              )
            }}>
            本送信を止める
          </Button>
        </div>
      ) : null}
    </DetailColumns>
  </>
}

export default function LineFollowupV8() {
  const { selectedAccountId } = useAccount()
  const [selectedTrigger, setSelectedTrigger] = useState<RestaurantFollowupTrigger>('reservation_created')
  const [account, setAccount] = useState(selectedAccountId)
  if (account !== selectedAccountId) {
    setAccount(selectedAccountId)
    setSelectedTrigger('reservation_created')
  }
  const role = useStaffRole()
  /* 役割が読めるまで null。そのあいだは閲覧のみと断定せず、理由なしで止める。 */
  const unknownRole = role === null
  const readOnly = !unknownRole && !canManageRole(role)
  return (
    <RestaurantFrame
      boardId="n9vvGx"
      title="LINE来店フォロー"
      description="予約前・来店後・口コミ依頼・会員証を、来店・退店のきっかけで送るひな形として作ります。LINE来店フォローは、来店・退店のきっかけを使う「シナリオのひな形」としてまとめる。行を押すと、その中身をシナリオの一歩と同じ形で直せる。"
      pickerAs="select"
      banner={false}
      subtitle={(store) => store ? store.name : ''}
      actions={() => null}
    >
      {(ctx) => <Board key={ctx.store?.id ?? 'none'} accountId={selectedAccountId} storeId={ctx.store?.id ?? null} storeName={ctx.store?.name ?? ''} selectedTrigger={selectedTrigger} onSelect={setSelectedTrigger} readOnly={readOnly} unknownRole={unknownRole} />}
    </RestaurantFrame>
  )
}
