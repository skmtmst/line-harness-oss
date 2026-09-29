'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ecEventLabel } from '@line-crm/shared'
import Button from '@/components/shared/button'
import Drawer from '@/components/shared/drawer'
import ListState from '@/components/shared/list-state'
import {
  ApiError,
  api,
  type EcActionExecution,
  type EcOrderDetail,
  type EcOrderDetailEvent,
} from '@/lib/api'
import { formatEcDateTime as dateTime } from './ec-datetime'
import {
  DELIVERY_STATUS_TEXT,
  EVENT_STATUS_TEXT,
  FAILURE_KIND_TEXT,
  FOLLOWUP_REASON_TEXT,
  FOLLOWUP_STATUS_TEXT,
  eventStoppedStage,
} from './ec-failure'
import {
  PAYOUT_BATCH_STATE_TEXT,
  PAYOUT_RESULT_TEXT,
  REWARD_ENTRY_STATUS_TEXT,
  SETTLEMENT_STATE_TEXT,
} from '../affiliates/affiliate-display'
import styles from './ec-commerce-v6.module.css'

/*
 * IDEA-23: 注文1件の処理状況パネル。取り込みの記録の各行から「この注文の
 * 状況」で開き、届いた出来事 → 通知 → 発送後の案内 → 成果/マイル/スコア を
 * 時系列で辿れるようにする。どの段階で止まったかと、やり直せる操作
 * （もう一度やる・会員のつき合わせ）を同じ場所に出す。
 *
 * 親ECの注文管理画面や注文台帳の複製はしない。EC側の注文ページがあるときは
 * detailUrl への外部リンクだけを置く。
 */

type DetailState = 'loading' | 'ready' | 'error' | 'forbidden'

const ORDER_STATUS_TEXT: Record<string, string> = {
  current: '通常の注文',
  refunded: '返金済み',
  cancelled: '取り消し済み',
}

const DISPATCH_LABEL: Record<string, string> = {
  notification: 'お客様への通知',
  v6: '自動化・スコアへの連携',
}

const DISPATCH_STATUS: Record<string, string> = {
  pending: '処理中',
  sent: '完了',
  failed: '失敗',
}

function money(currency: string, amount: number | null): string | null {
  if (amount === null) return null
  return `${currency === 'JPY' ? '¥' : ''}${amount.toLocaleString('ja-JP')}`
}

function signedAmount(amount: number): string {
  return `${amount > 0 ? '+' : '−'}${Math.abs(amount).toLocaleString('ja-JP')}`
}

function amountText(detail: EcOrderDetail): string | null {
  const order = detail.order
  if (order.status === 'refunded' && order.refundedAmount !== null) {
    return `返金 −${money(order.currency, order.refundedAmount)}`
  }
  return money(order.currency, order.totalAmount)
}

function EventBlock({
  event,
  retryingId,
  onRetry,
}: {
  event: EcOrderDetailEvent
  retryingId: string | null
  onRetry: (action: EcActionExecution) => void
}) {
  const statusInfo = EVENT_STATUS_TEXT[event.status] ?? { label: event.status, tone: 'muted' as const }
  const stoppedStage = eventStoppedStage(event)
  return (
    <div className={styles.detailEvent}>
      <div className={styles.detailEventHead}>
        <span className={styles.cellMain}>{ecEventLabel(event.eventType, event.eventType)}</span>
        <span className={`${styles.status} ${styles[`status${statusInfo.tone === 'good' ? 'Good' : statusInfo.tone === 'warn' ? 'Warn' : statusInfo.tone === 'danger' ? 'Danger' : 'Muted'}`]}`}>
          {statusInfo.label}
        </span>
      </div>
      <p className={styles.cellSub}>{dateTime(event.receivedAt)} に届きました{event.processedAt ? ` ／ ${dateTime(event.processedAt)} に確定` : ''}</p>
      {stoppedStage ? (
        <p className={styles.detailStage}>止まった段階：{stoppedStage}</p>
      ) : null}
      {event.actions.map((action) => {
        const kind = action.failureKind ? FAILURE_KIND_TEXT[action.failureKind] : null
        return (
          <div key={action.id} className={styles.detailRow}>
            <div className="min-w-0">
              <p className="text-sm text-ink">
                {action.errorMessage
                  ?? (action.status === 'succeeded' ? '完了しました'
                    : action.status === 'skipped' ? '見送りました'
                    : action.status === 'pending' || action.status === 'processing' ? '処理中です'
                    : '失敗しました。通信を確かめて、もう一度お試しください。')}
                {kind ? `（${kind.label}）` : ''}
              </p>
              <p className={styles.cellSub}>
                {action.attemptCount > 0 ? `${action.attemptCount}/${action.maxAttempts}回` : 'まだ試していません'}
                {action.attempts.length > 1 ? `・手動で戻した ${action.attempts.filter((attempt) => attempt.triggerKind === 'manual').length}回` : ''}
              </p>
              {kind && (action.status === 'retryable_failed' || action.status === 'permanent_failed' || action.status === 'skipped') ? (
                <p className={styles.detailHint}>{kind.hint}</p>
              ) : null}
            </div>
            {action.retryAvailable ? (
              <Button type="button" disabled={retryingId === action.id} onClick={() => onRetry(action)}>
                {retryingId === action.id ? '戻しています…' : 'もう一度やる'}
              </Button>
            ) : null}
          </div>
        )
      })}
      {event.dispatches.map((dispatch) => (
        <p key={dispatch.subscriber} className={styles.cellSub}>
          {DISPATCH_LABEL[dispatch.subscriber] ?? dispatch.subscriber}：{DISPATCH_STATUS[dispatch.status] ?? dispatch.status}
          {dispatch.failureKind ? `（${FAILURE_KIND_TEXT[dispatch.failureKind].label}）` : ''}
        </p>
      ))}
      {event.deliveries.map((delivery) => (
        <p key={delivery.id} className={styles.cellSub}>
          {delivery.audienceType === 'operator' ? '運用者へ' : 'お客様へ'}
          {delivery.channel === 'email' ? 'メール' : delivery.channel === 'in_app' ? '画面通知' : 'LINE'}
          ：{DELIVERY_STATUS_TEXT[delivery.status] ?? delivery.status}
          {delivery.acceptedAt ? `（${dateTime(delivery.acceptedAt)}）` : ''}
          {delivery.errorMessage ? `・${delivery.errorMessage}` : ''}
          {delivery.failureKind ? `（${FAILURE_KIND_TEXT[delivery.failureKind].label}）` : ''}
        </p>
      ))}
    </div>
  )
}

export default function OrderDetailDrawer({
  orderId,
  accountId,
  onClose,
  onRetryAction,
  retryingId,
}: {
  orderId: string | null
  accountId: string | null
  onClose: () => void
  onRetryAction: (action: EcActionExecution) => Promise<void>
  retryingId: string | null
}) {
  const [state, setState] = useState<DetailState>('loading')
  const [detail, setDetail] = useState<EcOrderDetail | null>(null)
  const loadSeq = useRef(0)

  const load = useCallback(async (showLoading = true) => {
    if (!orderId || !accountId) return
    const seq = loadSeq.current + 1
    loadSeq.current = seq
    if (showLoading) setState('loading')
    try {
      const response = await api.ecCommerce.orderDetail(orderId, accountId)
      if (seq !== loadSeq.current) return
      if (!response.success || !response.data) throw new Error('invalid_order_detail')
      setDetail(response.data)
      setState('ready')
    } catch (error) {
      if (seq !== loadSeq.current) return
      setState(error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error')
    }
  }, [orderId, accountId])

  useEffect(() => {
    setDetail(null)
    setState('loading')
    void load()
  }, [load])

  const retry = async (action: EcActionExecution) => {
    await onRetryAction(action)
    await load(false)
  }

  const order = detail?.order ?? null
  const friendId = order?.friendId ?? null
  return (
    <Drawer
      open={orderId !== null}
      title={order ? `注文 ${order.orderNumber}` : '注文の状況'}
      description={order
        ? `${ORDER_STATUS_TEXT[order.status] ?? order.status} ／ ${dateTime(order.orderedAt)} に注文`
        : undefined}
      onClose={onClose}
      footer={state === 'ready' ? (
        <p className={styles.footer}>
          もう一度行う・再取込では、届き済みの通知や入った成果・マイルは重ねません。
        </p>
      ) : undefined}
    >
      {state === 'loading' ? (
        <ListState kind="loading" title="注文の状況を読み込んでいます" />
      ) : state === 'forbidden' ? (
        <ListState kind="empty" title="この注文の状況を見る権限がありません" />
      ) : state === 'error' || !detail || !order ? (
        <ListState kind="error" title="注文の状況を読み込めませんでした" description="通信の状態を確認して、もう一度お試しください。" onRetry={() => void load()} />
      ) : (
        <div className="flex flex-col gap-4">
          <section className={styles.detailSection}>
            <h3 className={styles.detailSectionTitle}>注文の内容</h3>
            <dl className={styles.detailDl}>
              <div className={styles.detailDlRow}><dt>お客様</dt><dd>
                {friendId
                  ? <Link className={styles.textLink} href={`/friends/detail?id=${encodeURIComponent(friendId)}`}>{order.customerName ?? '友だちを見る'}</Link>
                  : order.customerName ?? <span className="text-ink-faint">LINEの友だちと結びついていません</span>}
                {friendId ? null : (
                  <span className={styles.cellSub}>
                    {'　'}<Link className={styles.textLink} href="/ec-commerce/identity-candidates">会員のつき合わせへ</Link>
                  </span>
                )}
              </dd></div>
              <div className={styles.detailDlRow}><dt>金額</dt><dd>{amountText(detail) ?? '—'}</dd></div>
              <div className={styles.detailDlRow}><dt>中身</dt><dd>
                {order.orderLines.length
                  ? order.orderLines.map((line) => `${line.productName} × ${line.quantity}`).join('・')
                  : '商品明細は未取得'}
              </dd></div>
              {order.detailUrl ? (
                <div className={styles.detailDlRow}><dt>EC側の注文</dt><dd>
                  <a className={styles.textLink} href={order.detailUrl} target="_blank" rel="noreferrer">ECの管理画面で開く</a>
                </dd></div>
              ) : null}
            </dl>
          </section>

          <section className={styles.detailSection}>
            <h3 className={styles.detailSectionTitle}>この注文に届いた出来事</h3>
            {detail.events.length === 0 ? (
              <p className={styles.cellSub}>届いた出来事はありません。</p>
            ) : (
              <div className="flex flex-col gap-3">
                {detail.events.map((event) => (
                  <EventBlock key={event.id} event={event} retryingId={retryingId} onRetry={(action) => void retry(action)} />
                ))}
              </div>
            )}
          </section>

          <section className={styles.detailSection}>
            <h3 className={styles.detailSectionTitle}>発送後に届く案内</h3>
            {detail.followUps.length === 0 ? (
              <p className={styles.cellSub}>予約されている案内はありません。</p>
            ) : (
              <div className="flex flex-col gap-2">
                {detail.followUps.map((job) => {
                  const info = FOLLOWUP_STATUS_TEXT[job.status] ?? { label: job.status, tone: 'muted' as const }
                  const reasonText = job.reason ? FOLLOWUP_REASON_TEXT[job.reason] ?? job.reason : null
                  return (
                    <div key={job.id} className={styles.detailRow}>
                      <div className="min-w-0">
                        <p className="text-sm text-ink">{job.campaignLabel ?? job.campaignKey}</p>
                        <p className={styles.cellSub}>
                          {dateTime(job.scheduledAt)} 予定
                          {job.sentAt ? ` ／ ${dateTime(job.sentAt)} に送信` : ''}
                          {reasonText ? ` ／ ${reasonText}` : ''}
                          {job.failureKind ? ` ／ ${FAILURE_KIND_TEXT[job.failureKind].label}` : ''}
                        </p>
                      </div>
                      <span className={`${styles.status} ${styles[`status${info.tone === 'good' ? 'Good' : info.tone === 'warn' ? 'Warn' : info.tone === 'danger' ? 'Danger' : 'Muted'}`]}`}>
                        {info.label}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          <section className={styles.detailSection}>
            <h3 className={styles.detailSectionTitle}>成果・マイル・スコア</h3>
            {detail.outcomes.conversions.length === 0 && detail.outcomes.mileage.length === 0 && detail.outcomes.scores.length === 0 ? (
              <p className={styles.cellSub}>この注文に結びついた成果・マイル・スコアはありません。</p>
            ) : (
              <div className="flex flex-col gap-2">
                {detail.outcomes.conversions.map((conversion) => (
                  /*
                   * IDEA-16: 注文から成果へ辿った行に、帰属した紹介者・確定した
                   * 報酬・支払い確定→締め→支払いCSV→取り込んだ結果まで並べる。
                   * 承認前の成果は報酬が「未確定」のまま。確定額と混ぜない。
                   */
                  <div key={conversion.id} className="min-w-0">
                    <p className="truncate text-caption text-ink-faint">
                      成果：{conversion.pointName ?? '計測地点'} を記録
                      {conversion.value !== null ? `（¥${conversion.value.toLocaleString('ja-JP')}）` : ''}
                      {conversion.approvalStatus === 'pending' ? '・承認待ち' : conversion.approvalStatus === 'approved' ? '・承認済み' : conversion.approvalStatus === 'rejected' ? '・却下' : ''}
                      （{dateTime(conversion.createdAt)}）
                    </p>
                    <p className="truncate text-caption text-ink-faint">
                      {conversion.affiliateName ? `紹介者：${conversion.affiliateName}　` : ''}
                      報酬：{conversion.rewardAmount != null ? `¥${conversion.rewardAmount.toLocaleString('ja-JP')}` : '未確定'}
                      {conversion.rewardEntryStatus ? `・支払い確定：${REWARD_ENTRY_STATUS_TEXT[conversion.rewardEntryStatus] ?? conversion.rewardEntryStatus}` : ''}
                      {conversion.settlementState ? `・締め：${SETTLEMENT_STATE_TEXT[conversion.settlementState] ?? conversion.settlementState}` : ''}
                      {conversion.payoutBatchState ? `・支払いCSV：${PAYOUT_BATCH_STATE_TEXT[conversion.payoutBatchState] ?? conversion.payoutBatchState}` : ''}
                      {conversion.payoutResult ? `・結果：${PAYOUT_RESULT_TEXT[conversion.payoutResult] ?? conversion.payoutResult}` : ''}
                    </p>
                    {conversion.reversedAmount != null ? (
                      <p className="truncate text-caption text-ink-faint">
                        確定後の取消：−¥{conversion.reversedAmount.toLocaleString('ja-JP')}（次の支払いで差し引かれます）
                      </p>
                    ) : null}
                    {conversion.duplicateCandidate ? (
                      <p className="mt-1.5 text-caption font-semibold text-danger">
                        同じ注文・同じ成果地点の成果がほかにもあります。二重に認めないか注文番号で確かめてください。
                      </p>
                    ) : null}
                  </div>
                ))}
                {detail.outcomes.mileage.map((entry) => (
                  <p key={entry.id} className={styles.cellSub}>
                    マイル：{signedAmount(entry.amount)}（{entry.reason}・{dateTime(entry.occurredAt)}）
                    {entry.status === 'void' ? '・無効' : ''}
                  </p>
                ))}
                {detail.outcomes.scores.map((score) => (
                  <p key={score.id} className={styles.cellSub}>
                    スコア：{signedAmount(score.scoreChange)}{score.reason ? `（${score.reason}）` : ''}（{dateTime(score.occurredAt)}）
                  </p>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </Drawer>
  )
}
