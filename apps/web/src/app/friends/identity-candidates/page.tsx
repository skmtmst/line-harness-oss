'use client'

import React from 'react'
import Button from '@/components/shared/button'
import Breadcrumb from '@/components/shared/breadcrumb'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { usePageTitle } from '@/components/shell/page-chrome'
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
  usePageTitle('重複候補の確認')
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
    <div
      className={`${styles.screen} [&_[data-identity-part=assurance]>p:last-child]:hidden [&_[data-identity-part=assurance]]:py-3`}
      style={{ gap: 14 }}
    >
      <div className="flex min-h-10 items-center justify-between gap-3">
        <Breadcrumb items={[{ label: '重複検出', href: '/friends?tab=duplicates' }, { label: '候補 #D-018' }]} />
        <Button href="/friends?tab=duplicates">重複検出へ</Button>
      </div>

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
              <div className="mt-2 overflow-hidden rounded-control border border-hairline">
                <DataTable className="table-fixed text-xs">
                  <thead className="bg-canvas-sunken text-ink-secondary">
                    <TableHeadRow><Th>項目</Th><Th>候補A</Th><Th>候補B</Th><Th>採用する値</Th></TableHeadRow>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {profileCandidates.map((field) => {
                      const left = field.options.find((option) => option.sourceFriendId === detail.left.id)
                      const right = field.options.find((option) => option.sourceFriendId === detail.right.id)
                      return (
                        <Tr key={field.fieldKey}>
                          <Td><span className="font-semibold text-ink">{field.fieldLabel}</span></Td>
                          <Td>{left?.valuePreview ?? '—'}</Td>
                          <Td>{right?.valuePreview ?? '—'}</Td>
                          <Td>判定時に選択</Td>
                        </Tr>
                      )
                    })}
                    {tagCandidates.length > 0 ? (
                      <Tr>
                        <Td><span className="font-semibold text-ink">タグ</span></Td>
                        <Td colSpan={2}>{tagCandidates.map((tag) => tag.name).join('・')}</Td>
                        <Td>元の友だちに保持</Td>
                      </Tr>
                    ) : null}
                  </tbody>
                </DataTable>
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
