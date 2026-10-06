'use client'

/*
 * ★V8-B 承認ワークフロー（板 `t8WgD8`、閲覧のみ `n4DT7`、差し戻す理由の小窓 `n4j0Rm`）。
 *
 * v7（restaurant-console.tsx の Approvals）と同じ口で、板の形で置く：
 * 数4 → 承認カード（種類・状態・店舗・申請者・変更内容・差戻しコメント・
 * 差戻し／承認する）→ 公開境界。
 * 見るだけの担当者（staff）には案内の帯を出し、決定ボタンを押せない形にする
 * （板 n4DT7「承認する・差戻しを押せない形」。承認待ちのカードは枠を緑にして目立たせる）。
 * 差戻しは小窓 n4j0Rm で理由（必須・API でも必須）を入れてから送る。
 * 主ボタンは1画面1つの決まりで、カードのボタンは副（secondary）のまま。
 */
import { useState } from 'react'
import { ApiError } from '@/lib/api'
import { Check, Eye, Undo2 } from 'lucide-react'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import { TextArea } from '@/components/shared/text-field'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { formatDateTime } from '@/lib/format'
import { useAccount } from '@/contexts/account-context'
import {
  restaurantTestApi,
  type RestaurantApproval,
  type RestaurantSnapshot,
  type RestaurantStore,
} from '@/lib/restaurant-test-api'
import RestaurantShell, { Stat, Status, type RestaurantV8Context } from './shell'
import styles from './shell.module.css'

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

/** 小窓の太字の行：改定は「前 → 後」、ほかは件名（板 n4j0Rm）。 */
function approvalSummary(item: RestaurantApproval): string {
  const payload = approvalPayload(item)
  const before = typeof payload.before === 'string' ? payload.before : null
  const after = typeof payload.after === 'string' ? payload.after : null
  if (before || after) return `${before || '—'} → ${after || '—'}`
  return item.title
}

/** R105: 承認する中身（投稿文・配信文・改定前後）を見せてから判断できるようにする（v7 と同じ）。 */
function ApprovalContent({ item, data }: { item: RestaurantApproval; data: RestaurantSnapshot }) {
  const payload = approvalPayload(item)
  if (item.kind === 'gbp_post') {
    const post = typeof payload.postId === 'string' ? data.posts.find((p) => p.id === payload.postId) : null
    const typeLabel = typeof payload.typeLabel === 'string'
      ? payload.typeLabel
      : post ? ({ standard: '通常の投稿', event: 'イベント', offer: 'クーポン' }[post.post_type] || post.post_type) : null
    const title = typeof payload.title === 'string' ? payload.title : post?.title
    const body = typeof payload.body === 'string' ? payload.body : post?.body
    if (!typeLabel && !title && !body) return <p className={styles.mutedText}>投稿の内容を読み込めませんでした。</p>
    return (
      <>
        {typeLabel ? <p className={styles.payloadMeta}>種別：{typeLabel}</p> : null}
        {title ? <p className={styles.payloadTitle}>{title}</p> : null}
        {body ? <p className={styles.payloadBody}>{body}</p> : null}
      </>
    )
  }
  if (item.kind === 'line_message') {
    const flow = typeof payload.flowId === 'string' ? data.lineFlows.find((f) => f.id === payload.flowId) : null
    const title = typeof payload.title === 'string' ? payload.title : flow?.title
    const body = typeof payload.body === 'string' ? payload.body : flow?.body
    if (!title && !body) return <p className={styles.mutedText}>配信の内容を読み込めませんでした。</p>
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
    if (before === null && after === null) return <p className={styles.mutedText}>改定の前後が記録されていません。申請者に確認してください。</p>
    return (
      <p className={styles.payloadDiff}>
        <span className={styles.payloadMeta}>変更前：</span>
        <span>{before || '—'}</span>
        <span className={styles.payloadMeta}>→</span>
        <span className={styles.payloadTitle}>{after || '—'}</span>
      </p>
    )
  }
  return <p className={styles.mutedText}>内容の詳細は申請者に確認してください。</p>
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
  return (
    <article className={`${styles.approvalCard} ${readOnly && item.status === 'pending' ? styles.approvalCardPending : ''}`}>
      <div className={styles.approvalHead}>
        <div className={styles.approvalMeta}>
          <span className={styles.kindChip}>{kindLabel[item.kind]}</span>
          <Status value={item.status} />
          <span className={styles.approvalStore}>{store?.name || '全店舗'}</span>
          <span className={styles.approvalSpacer} aria-hidden="true" />
          {item.status === 'pending' ? (
            <div className={styles.approvalActions}>
              <Button className={styles.returnBtn} disabled={busy || readOnly} onClick={() => onReturn(item)}><Undo2 size={15} aria-hidden />差戻し</Button>
              <Button className={styles.approveBtn} disabled={busy || readOnly} onClick={() => onApprove(item)}><Check size={15} aria-hidden />承認する</Button>
            </div>
          ) : null}
        </div>
        <h3 className={styles.approvalTitle}>{item.title}</h3>
        <p className={styles.cellSub}>申請：{item.requested_by || '—'} ・ {formatDateTime(item.created_at)}</p>
        <div className={styles.approvalBody}>
          <p className={styles.payloadLabel}>変更内容</p>
          <ApprovalContent item={item} data={data} />
        </div>
        {item.review_comment ? <p className={styles.returnComment}>{item.review_comment}</p> : null}
      </div>
    </article>
  )
}

/** 板 n4j0Rm：対象の要約＋理由（必須）＋注意＋「差し戻す」。 */
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
        <div className={styles.returnDialog}>
          <div className={styles.dialogSummary}>
            <p className={styles.dialogSummaryMeta}>
              {kindLabel[item.kind]}・{store?.name || '全店舗'}・申請 {item.requested_by || '—'}（{formatDateTime(item.created_at)}）
            </p>
            <p className={styles.dialogSummaryMain}>{approvalSummary(item)}</p>
          </div>
          <label className={styles.dialogField}>
            <span className={styles.dialogFieldLabel}>差し戻す理由（必須・申請者に届きます）</span>
            <TextArea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="例：原価の根拠（仕入れ値の表）を添えてください"
              rows={3}
              disabled={busy}
            />
          </label>
          <p className={styles.dialogNote}>差し戻すと、申請は「差戻し」になり、直して出し直すまで公開されません。</p>
        </div>
      ) : null}
    </Dialog>
  )
}

function ApprovalsBoard({ ctx }: { ctx: RestaurantV8Context }) {
  const { data, selectedStoreId, busy, mutate, reload } = ctx
  const { selectedAccountId } = useAccount()
  const role = useStaffRole()
  const readOnly = role !== null && !canManageRole(role)
  const [returnTarget, setReturnTarget] = useState<RestaurantApproval | null>(null)
  const rows = data.approvals.filter((item) => !selectedStoreId || item.store_id === selectedStoreId || item.store_id === null)
  const pending = rows.filter((item) => item.status === 'pending')
  const decide = (id: string, action: 'approve' | 'return', comment?: string) => {
    if (!selectedAccountId) return
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
        <div className={styles.readOnlyBanner}><Eye size={14} aria-hidden />閲覧のみで見ています。変える操作は管理者に頼んでください。</div>
      ) : null}
      <div className={styles.stats}>
        <Stat label="承認待ち" value={pending.length} note="対応が必要" warning={pending.length > 0} />
        <Stat label="Google投稿" value={rows.filter((a) => a.kind === 'gbp_post').length} note="投稿下書き" />
        <Stat label="LINE配信" value={rows.filter((a) => a.kind === 'line_message').length} note="配信下書き" />
        <Stat label="メニュー改定" value={rows.filter((a) => a.kind === 'menu_change').length} note="価格・内容変更" />
      </div>
      {rows.length === 0 ? (
        <div className={styles.panel}><div className={styles.stateBox}><ListState kind="empty" title="承認待ちはありません" /></div></div>
      ) : (
        <div className={styles.approvalList}>
          {rows.map((item) => (
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
          ))}
        </div>
      )}
      <div className={styles.boundaryPanel}>
        <h2 className={styles.boundaryPanelTitle}>公開境界</h2>
        <p className={styles.noteText}>承認しても検証中は外部公開しません。状態は「承認済」まで進みます。Google投稿、LINE送信、メニュー媒体反映は、接続承認後に別工程として有効化します。</p>
      </div>
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
    <RestaurantShell
      boardId="t8WgD8"
      title="承認ワークフロー"
      description="Google投稿・LINE配信・メニュー改定を公開前に確認します。"
      allStores
    >
      {(ctx) => <ApprovalsBoard ctx={ctx} />}
    </RestaurantShell>
  )
}
