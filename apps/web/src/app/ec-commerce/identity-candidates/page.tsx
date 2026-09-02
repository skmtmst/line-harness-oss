'use client'

import React from 'react'
import Button from '@/components/shared/button'
import PageHeader from '@/components/shared/page-header'
import { ActionCell, DataTable, Td, Th, TableHeadRow, Tr } from '@/components/shared/table'
import IdentityDecisionDialog from '@/components/identity/identity-decision-dialog'
import {
  ConfidenceTag,
  IdentityAssurance,
  IdentityEvidenceList,
  IdentityHistoryList,
  IdentityImpactList,
  IdentitySubjectCard,
} from '@/components/identity/identity-parts'
import { IdentityStateBlock } from '@/components/identity/identity-state'
import { useIdentityReview } from '@/components/identity/identity-review'
import { maskedText, NOT_AVAILABLE } from '@/components/identity/identity-view'
import styles from '@/components/identity/identity-review.module.css'

/**
 * 設計 `ELayY` 23-1-A「会員のつき合わせ」。
 *
 * ECの注文・会員と、LINEの友だちが同じ人かを決める。友だち同士の照合
 * （`InCDe`）と読む契約は同じで、こちらは**まだ結びついていない件を
 * 並べて選ぶ**形になる。
 *
 * 設計にある「自動で結びついた」「結びつけると増える売上」は、いまの
 * 読み口が返さない。数字を作らず「—（未取得）」と出す。
 */
export default function EcIdentityCandidatesPage() {
  const review = useIdentityReview('ec_member')
  const detail = review.detail

  return (
    <div className={styles.screen}>
      <PageHeader
        breadcrumb={[
          { label: 'EC連携', href: '/ec-commerce' },
          { label: '会員のつき合わせ' },
        ]}
        title="会員のつき合わせ"
        description="ECの注文・会員とLINEの友だちが同じ人かを決めます。"
        actions={<Button href="/ec-commerce">EC連携へ</Button>}
      />

      <IdentityStateBlock
        state={review.state}
        failure={review.failure}
        emptyTitle="つき合わせる会員はありません"
        emptyDescription="メールアドレスか電話番号が同じなら自動で結び付きます。どちらも違うときだけ、ここへ並びます。"
      />

      {review.state === 'ready' ? (
        <>
          <IdentityAssurance>
            結び付けても、ECの注文とLINEの友だちはどちらも残ります。過去のLINE送信は再送しません。
          </IdentityAssurance>

          <div className={styles.tableWrap}>
            <DataTable>
              <thead>
                <TableHeadRow>
                  <Th>ECの注文・会員</Th>
                  <Th>LINEの候補</Th>
                  <Th>似ているところ</Th>
                  <Th>確からしさ</Th>
                  <Th align="right">操作</Th>
                </TableHeadRow>
              </thead>
              <tbody>
                {review.items.map((item) => (
                  <Tr key={item.id}>
                    <Td>
                      <span className={styles.cellStack}>
                      <span className={styles.subjectLabel}>{item.left.label}</span>
                      <span className={styles.subjectDetail}>
                        {item.left.detail ?? NOT_AVAILABLE}
                        {item.left.attributes[0]
                          ? `／${maskedText(item.left.attributes[0].valuePreview)}`
                          : ''}
                      </span>
                      </span>
                    </Td>
                    <Td>
                      <span className={styles.cellStack}>
                      <span className={styles.subjectLabel}>{item.right.label}</span>
                      <span className={styles.subjectDetail}>
                        {item.right.lineAccountName ?? NOT_AVAILABLE}
                      </span>
                      </span>
                    </Td>
                    <Td>{item.evidenceSummary.join('／')}</Td>
                    <Td>
                      <ConfidenceTag confidence={item.confidence} />
                    </Td>
                    <ActionCell>
                      <Button type="button" onClick={() => review.select(item.id)}>
                        候補を見る
                      </Button>
                      <Button
                        type="button"
                        variant="primary"
                        data-qa-open="ELayY"
                        onClick={() => review.openDialog(item.id)}
                      >
                        決める
                      </Button>
                    </ActionCell>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          </div>

          <p className={styles.footerNote}>
            結びついていない {review.items.length.toLocaleString('ja-JP')} 件を表示しています。
            自動で結びついた件数と、結び付けたときに増える売上は {NOT_AVAILABLE} です。
          </p>

          {detail ? (
            <>
              <div className={styles.split}>
                <IdentityEvidenceList evidence={detail.evidence} confidence={detail.confidence} />
                <IdentityImpactList impact={detail.impact} />
              </div>
              <div className={styles.pair}>
                <IdentitySubjectCard side="ECの注文・会員" subject={detail.left} />
                <IdentitySubjectCard side="LINEの友だち" subject={detail.right} />
              </div>
              <IdentityHistoryList history={detail.history} />

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
        </>
      ) : null}
    </div>
  )
}
