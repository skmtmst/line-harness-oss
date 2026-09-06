'use client'

import React from 'react'
import Button from '@/components/shared/button'
import PageHeader from '@/components/shared/page-header'
import IdentityDecisionDialog from '@/components/identity/identity-decision-dialog'
import {
  IdentityAssurance,
  IdentityEvidenceList,
  IdentityHistoryList,
  IdentityImpactList,
  IdentitySubjectCard,
  StatusTag,
} from '@/components/identity/identity-parts'
import { IdentityStateBlock } from '@/components/identity/identity-state'
import { useIdentityReview } from '@/components/identity/identity-review'
import styles from '@/components/identity/identity-review.module.css'

/**
 * 設計 `InCDe` 3-2-A「重複候補の確認」。
 *
 * LINEの友だち同士が同じ人かどうかを、根拠を見て決める。
 * 一覧ではなく**1件を読み切る画面**なので、未判定の先頭を開いた状態で出す。
 *
 * ECの会員との照合（`ELayY`）とは、外枠だけが違って中身は同じ契約を読む。
 * 判断に使う部品は `components/identity` に1組だけ置いてある。
 */
export default function FriendIdentityCandidatesPage() {
  const review = useIdentityReview('friend_duplicate')
  const first = review.items[0] ?? null

  // 一覧が出た時点で先頭を開く。読む対象が無い画面にしない。
  React.useEffect(() => {
    if (review.state === 'ready' && first && !review.selectedId) review.select(first.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review.state, first?.id])

  const detail = review.detail
  const profileCandidates = detail && 'profileCandidates' in detail ? detail.profileCandidates : []
  const tagCandidates = detail && 'tagCandidates' in detail ? detail.tagCandidates : []

  return (
    <div className={styles.screen}>
      <PageHeader
        breadcrumb={[
          { label: '友だち', href: '/friends' },
          { label: '重複候補の確認' },
        ]}
        title="重複候補の確認"
        description="同じ人が2件に分かれていないかを、根拠を見て決めます。"
        actions={
          <Button href="/friends?tab=duplicates">重複検出へ</Button>
        }
      />

      <IdentityStateBlock
        state={review.state}
        failure={review.failure}
        emptyTitle="確認する候補はありません"
        emptyDescription="同じ人の疑いが見つかると、ここに並びます。"
      />

      {review.state === 'ready' && detail ? (
        <>
          <IdentityAssurance>
            2件の友だちは残したまま、同じ人として結び付けます。一斉配信は結び付けた人へ1通になります。
          </IdentityAssurance>

          <div className={styles.split}>
            <IdentityEvidenceList evidence={detail.evidence} confidence={detail.confidence} />
            <IdentityImpactList impact={detail.impact} />
          </div>

          <div className={styles.pair}>
            <IdentitySubjectCard side="候補A" subject={detail.left} />
            <IdentitySubjectCard side="候補B" subject={detail.right} />
          </div>

          {profileCandidates.length > 0 ? (
            <section className="rounded-card border border-hairline bg-canvas p-4 shadow-card">
              <h2 className="text-sm font-bold text-ink">統合プロフィールに採用する値</h2>
              <p className="mt-1 text-xs text-ink-faint">項目ごとに採用元を選び、判定と同じ履歴へ残します。</p>
              <div className="mt-3 overflow-hidden rounded-control border border-hairline">
                <table className="w-full table-fixed text-left text-xs">
                  <thead className="bg-canvas-sunken text-ink-secondary">
                    <tr><th className="p-2">項目</th><th className="p-2">候補A</th><th className="p-2">候補B</th><th className="p-2">採用する値</th></tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {profileCandidates.map((field) => {
                      const left = field.options.find((option) => option.sourceFriendId === detail.left.id)
                      const right = field.options.find((option) => option.sourceFriendId === detail.right.id)
                      return (
                        <tr key={field.fieldKey}>
                          <td className="p-2 font-semibold text-ink">{field.fieldLabel}</td>
                          <td className="p-2 text-ink-secondary">{left?.valuePreview ?? '—'}</td>
                          <td className="p-2 text-ink-secondary">{right?.valuePreview ?? '—'}</td>
                          <td className="p-2 text-ink-secondary">判定時に選択</td>
                        </tr>
                      )
                    })}
                    {tagCandidates.length > 0 ? (
                      <tr>
                        <td className="p-2 font-semibold text-ink">タグ</td>
                        <td className="p-2 text-ink-secondary" colSpan={2}>{tagCandidates.map((tag) => tag.name).join('・')}</td>
                        <td className="p-2 text-ink-secondary">元の友だちに保持</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <IdentityHistoryList history={detail.history} />

          <div className={styles.footer}>
            <p className={styles.footerNote}>判断できないときは保留にすると、あとから読み直せます。</p>
            <div className={styles.actions}>
              <StatusTag status={detail.status} />
              <Button
                type="button"
                variant="primary"
                data-qa-open="InCDe"
                disabled={!detail.canDecide}
                onClick={() => review.openDialog(detail.id)}
              >
                この2件を判定する
              </Button>
            </div>
          </div>

          <IdentityDecisionDialog
            open={review.dialogOpen}
            candidate={detail}
            busy={review.deciding}
            error={review.decideError || undefined}
            onCancel={review.closeDialog}
            onSubmit={review.decide}
          />
        </>
      ) : null}
    </div>
  )
}
