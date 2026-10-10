'use client'

import ReadOnlyNotice from '@/components/shared/read-only-notice'
import { useState } from 'react'
import KpiCard from '@/components/shared/kpi-card'
import { Check, Undo2 } from 'lucide-react'
import { ApiError } from '@/lib/api'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import { TextArea } from '@/components/shared/text-field'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { useAccount } from '@/contexts/account-context'
import { restaurantTestApi, type RestaurantApproval, type RestaurantSnapshot, type RestaurantStore } from '@/lib/restaurant-test-api'
import RestaurantFrame, { type RestaurantContext } from '../common-a/frame'
import { formatStamp, StatRow, Status } from '../common-a/parts'
import styles from './approvals.module.css'
import { Field } from '@/components/shared/form-controls'
import { permissionDeniedMessage } from '@/components/shared/api-error-message'
import { emptyValue } from '@/components/shared/empty-value'
import { SaveErrorField } from '@/components/shared/save-form-errors'

/*
 * ★V8 承認ワークフロー（Pencil `t8WgD8`、閲覧のみ `n4DT7`、差し戻す理由の小窓 `n4j0Rm`）。
 *
 * 数4 → 承認カード（種類・状態・店舗・申請者・変更内容・差戻しコメント・差戻し／承認する）→ 公開境界。
 * 閲覧のみ（変える権限が無い人）には案内の帯を出し、差戻し・承認するのボタンは置かない
 * （2026-10-06 オーナー決定。場所だけ空けて、下の並びを動かさない）。
 * 承認待ちのカードは閲覧のみのとき枠を緑にして目立たせる（n4DT7）。動きは BEHAVIOR.md。
 */

const kindLabel: Record<RestaurantApproval['kind'], string> = {
  gbp_post: 'Google投稿',
  line_message: 'LINE配信',
  menu_change: 'メニュー改定',
}

function approvalPayload(item: RestaurantApproval): Record<string, unknown> {
  try {
    const parsed = item.payload_json ? JSON.parse(item.payload_json) : {}
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch { return {} }
}

/** 小窓の太字の行：改定は「前 → 後」、ほかは件名（n4j0Rm）。 */
function approvalSummary(item: RestaurantApproval): string {
  const payload = approvalPayload(item)
  const before = typeof payload.before === 'string' ? payload.before : null
  const after = typeof payload.after === 'string' ? payload.after : null
  if (before || after) return `${before || emptyValue('unknown')} → ${after || emptyValue('unknown')}`
  return item.title
}

/** R105: 承認する中身（投稿文・配信文・改定前後）を見せてから判断できるようにする（今の画面と同じ）。 */
function ApprovalContent({ item, data }: { item: RestaurantApproval; data: RestaurantSnapshot }) {
  const payload = approvalPayload(item)
  if (item.kind === 'gbp_post') {
    const post = typeof payload.postId === 'string' ? data.posts.find((p) => p.id === payload.postId) : null
    const typeLabel = typeof payload.typeLabel === 'string'
      ? payload.typeLabel
      : post ? ({ standard: '通常の投稿', event: 'イベント', offer: 'クーポン' }[post.post_type] || post.post_type) : null
    const title = typeof payload.title === 'string' ? payload.title : post?.title
    const body = typeof payload.body === 'string' ? payload.body : post?.body
    if (!typeLabel && !title && !body) return <p className={styles.muted}>投稿の内容を読み込めませんでした。</p>
    return (
      <>
        {typeLabel ? <p className={styles.payloadMeta}>{`種別：${typeLabel}`}</p> : null}
        {title ? <p className={styles.payloadTitle}>{title}</p> : null}
        {body ? <p className={styles.payloadBody}>{body}</p> : null}
      </>
    )
  }
  if (item.kind === 'line_message') {
    const flow = typeof payload.flowId === 'string' ? data.lineFlows.find((f) => f.id === payload.flowId) : null
    const title = typeof payload.title === 'string' ? payload.title : flow?.title
    const body = typeof payload.body === 'string' ? payload.body : flow?.body
    if (!title && !body) return <p className={styles.muted}>配信の内容を読み込めませんでした。</p>
    return (
      <>
        {title ? <p className={styles.payloadTitle}>{title}</p> : null}
        {body ? <p className={styles.payloadBody}>{body}</p> : null}
      </>
    )
  }
  if (item.kind === 'menu_change') {
    const before = typeof payload.before === 'string' ? payload.before : null
    const after = typeof payload.after === 'string' ? payload.after : null
    if (before === null && after === null) return <p className={styles.muted}>改定の前後が記録されていません。申請者に確認してください。</p>
    return (
      <p className={styles.payloadDiff}>
        <span className={styles.diffKey}>変更前：</span>
        <span className={styles.diffBefore}>{before || emptyValue('unknown')}</span>
        <span className={styles.diffKey}>→</span>
        <span className={styles.diffAfter}>{after || emptyValue('unknown')}</span>
      </p>
    )
  }
  return <p className={styles.muted}>内容の詳細は申請者に確認してください。</p>
}

function ApprovalCard({ item, data, store, busy, readOnly, onApprove, onReturn }: {
  item: RestaurantApproval
  data: RestaurantSnapshot
  store: RestaurantStore | undefined
  busy: boolean
  readOnly: boolean
  onApprove: (item: RestaurantApproval) => void
  onReturn: (item: RestaurantApproval) => void
}) {
  const pending = item.status === 'pending'
  return (
    <article className={`${styles.card} ${readOnly && pending ? styles.cardPending : ''}`}>
      <div className={styles.cardHead}>
        <span className={styles.kindChip}>{kindLabel[item.kind]}</span>
        <Status value={item.status} />
        <span className={styles.store}>{store?.name || '全店舗'}</span>
        <span className={styles.spacer} aria-hidden="true" />
        {pending && !readOnly ? (
          <>
            <Button className={styles.returnButton} disabled={busy} onClick={() => onReturn(item)}><Undo2 aria-hidden className={styles.buttonIcon} />差戻し</Button>
            <Button disabled={busy} onClick={() => onApprove(item)}><Check aria-hidden className={styles.buttonIcon} />承認する</Button>
          </>
        ) : pending ? (
          /* 閲覧のみ：ボタンは置かず、ボタンの高さだけ空ける（下の並びを動かさない）。 */
          <span className={styles.actionsSpace} aria-hidden="true" />
        ) : null}
      </div>
      <h3 className={styles.cardTitle}>{item.title}</h3>
      <p className={styles.requested}>{`申請：${item.requested_by || emptyValue('unknown')} ・ ${formatStamp(item.created_at)}`}</p>
      <div className={styles.payload}>
        <p className={styles.payloadLabel}>変更内容</p>
        <ApprovalContent item={item} data={data} />
      </div>
      {item.review_comment ? <p className={styles.returnComment}>{item.review_comment}</p> : null}
    </article>
  )
}

/** n4j0Rm：対象の要約＋理由（必須）＋注意＋「差し戻す」。 */
function ReturnDialog({ item, store, busy, onCancel, onSubmit }: {
  item: RestaurantApproval | null
  store: RestaurantStore | undefined
  busy: boolean
  onCancel: () => void
  onSubmit: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  return (
    <Dialog
      open={item !== null}
      title="差し戻しますか？"
      designNode="n4j0Rm"
      onCancel={onCancel}
      footer={(
        <div className={styles.dialogActions}>
          <Button onClick={onCancel} disabled={busy}>キャンセル</Button>
          <Button variant="primary" disabled={busy || !reason.trim()} busy={busy} busyLabel="処理中…" onClick={() => onSubmit(reason.trim())}>差し戻す</Button>
        </div>
      )}
    >
      {item ? (
        <div className={styles.dialogBody}>
          <div className={styles.dialogSummary}>
            <p className={styles.dialogSummaryMeta}>
              {`${kindLabel[item.kind]}・${store?.name || '全店舗'}・申請 ${item.requested_by || emptyValue('unknown')}（${formatStamp(item.created_at)}）`}
            </p>
            <p className={styles.dialogSummaryMain}>{approvalSummary(item)}</p>
          </div>
          <Field note={<>差し戻すと、申請は「差戻し」になり、直して出し直すまで公開されません。</>} label="差し戻す理由（・申請者に届きます）" required><SaveErrorField names={["reason"]}><TextArea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="例：原価の根拠（仕入れ値の表）を添えてください"
              rows={3}
              disabled={busy}
            /></SaveErrorField></Field>

        </div>
      ) : null}
    </Dialog>
  )
}

function ApprovalsBoard({ ctx }: { ctx: RestaurantContext }) {
  const { data, selectedStoreId, busy, mutate, reload } = ctx
  const { selectedAccountId } = useAccount()
  const role = useStaffRole()
  const readOnly = !canManageRole(role)
  const [returnTarget, setReturnTarget] = useState<RestaurantApproval | null>(null)
  const rows = data.approvals.filter((item) => !selectedStoreId || item.store_id === selectedStoreId || item.store_id === null)
  const pending = rows.filter((item) => item.status === 'pending')
  const decide = (id: string, action: 'approve' | 'return', comment?: string) => {
    if (!selectedAccountId || readOnly) return
    void mutate(
      async () => {
        const result = await restaurantTestApi.decideApproval(selectedAccountId, id, action, comment)
        if (result.data.menuChangeStatus === 'failed') {
          await reload()
          throw new ApiError(409, result.data.failureReason || '新価格を反映できませんでした。最新価格を確認して再申請してください。')
        }
      },
      action === 'approve' ? '承認しました。外部公開は行っていません。' : '差し戻しました。',
    )
  }

  return (
    <>
      {readOnly ? (
        <ReadOnlyNotice role="note" />
      ) : null}
      <StatRow>
        <KpiCard title="承認待ち" valueText={`${pending.length}`} detail="対応が必要" valueTone={pending.length > 0 ? 'warning' : 'default'} icon={null} presentation="band" value={null} unit="" />
        <KpiCard title="Google投稿" valueText={`${rows.filter((a) => a.kind === 'gbp_post').length}`} detail="投稿下書き" icon={null} presentation="band" value={null} unit="" />
        <KpiCard title="LINE配信" valueText={`${rows.filter((a) => a.kind === 'line_message').length}`} detail="配信下書き" icon={null} presentation="band" value={null} unit="" />
        <KpiCard title="メニュー改定" valueText={`${rows.filter((a) => a.kind === 'menu_change').length}`} detail="価格・内容変更" icon={null} presentation="band" value={null} unit="" />
      </StatRow>
      {rows.length === 0 ? (
        <div className={styles.emptyBox}><ListState kind="empty" title="承認待ちはありません" /></div>
      ) : (
        rows.map((item) => (
          <ApprovalCard
            key={item.id}
            item={item}
            data={data}
            store={data.stores.find((s) => s.id === item.store_id)}
            busy={busy}
            readOnly={readOnly}
            onApprove={(target) => decide(target.id, 'approve')}
            onReturn={setReturnTarget}
          />
        ))
      )}
      <section className={styles.boundary}>
        <h2 className={styles.boundaryTitle}>公開境界</h2>
        <p className={styles.boundaryText}>承認しても検証中は外部公開しません。状態は「承認済」まで進みます。Google投稿、LINE送信、メニュー媒体反映は、接続承認後に別工程として有効化します。</p>
      </section>
      <ReturnDialog
        item={returnTarget}
        store={data.stores.find((s) => s.id === returnTarget?.store_id)}
        busy={busy}
        onCancel={() => setReturnTarget(null)}
        onSubmit={(reason) => {
          const target = returnTarget
          if (!target) return
          setReturnTarget(null)
          decide(target.id, 'return', reason)
        }}
      />
    </>
  )
}

export default function ApprovalsV8() {
  return (
    <RestaurantFrame
      boardId="t8WgD8"
      title="承認ワークフロー"
      description="Google投稿・LINE配信・メニュー改定を公開前に確認します。"
      allStores
    >
      {(ctx) => <ApprovalsBoard ctx={ctx} />}
    </RestaurantFrame>
  )
}
