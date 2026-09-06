'use client'

import React, { useMemo, useState } from 'react'
import MergedTabs from '@/components/layout/merged-tabs'
import Button from '@/components/shared/button'
import NoteBar from '@/components/shared/note-bar'
import PageHeader from '@/components/shared/page-header'
import Select from '@/components/shared/select'
import SummaryCard from '@/components/shared/summary-card'
import { ActionCell, DataTable, Td, Th, TableHeadRow, Tr } from '@/components/shared/table'
import { Tabs } from '@/components/shared/tabs'
import IdentityDecisionDialog from '@/components/identity/identity-decision-dialog'
import {
  ConfidenceTag,
  IdentityEvidenceList,
  IdentityHistoryList,
  IdentityImpactList,
  IdentitySubjectCard,
} from '@/components/identity/identity-parts'
import { IdentityStateBlock } from '@/components/identity/identity-state'
import { useIdentityReview } from '@/components/identity/identity-review'
import { maskedText, NOT_AVAILABLE } from '@/components/identity/identity-view'
import styles from '@/components/identity/identity-review.module.css'
import { EC_TABS } from '../ec-tabs'

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
  const [view, setView] = useState<'all' | 'candidate' | 'none' | 'conflict'>('all')
  const [sort, setSort] = useState<'newest' | 'confidence'>('newest')
  const candidateCount = review.items.filter((item) => Boolean(item.right.label)).length
  const noneCount = review.items.length - candidateCount
  const conflictCount = review.items.filter((item) => item.confidence.label === 'medium').length
  const shown = useMemo(() => review.items
    .filter((item) => {
      if (view === 'candidate') return Boolean(item.right.label)
      if (view === 'none') return !item.right.label
      if (view === 'conflict') return item.confidence.label === 'medium'
      return true
    })
    .toSorted((left, right) => sort === 'confidence'
      ? right.confidence.score - left.confidence.score
      : Date.parse(right.detectedAt) - Date.parse(left.detectedAt)), [review.items, sort, view])

  return (
    <div className="flex min-w-0 flex-col gap-4 px-10 pb-8 pt-4">
      <PageHeader
        breadcrumb={[
          { label: 'EC連携', href: '/ec-commerce' },
          { label: '会員のつき合わせ' },
        ]}
        title="会員のつき合わせ"
        description="ECの注文・会員とLINEの友だちが同じ人かを決めます。"
        actions={<Button href="/ec-commerce?tab=connector">つき合わせの決めごと</Button>}
      />

      <MergedTabs basePath="/ec-commerce" tabs={EC_TABS} active="identity" defaultKey="events" />

      <IdentityStateBlock
        state={review.state}
        failure={review.failure}
        emptyTitle="つき合わせる会員はありません"
        emptyDescription="メールアドレスか電話番号が同じなら自動で結び付きます。どちらも違うときだけ、ここへ並びます。"
      />

      {review.state === 'ready' ? (
        <>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <SummaryCard variant="v6" title="結びついていない" value={review.items.length} unit="件" detail="確認待ちの注文・会員" badge="要対応" />
            <SummaryCard variant="v6" title="候補が見つかった" value={candidateCount} unit="件" detail="確認済みの連絡先や名前が近い人" />
            <SummaryCard variant="v6" title="自動で結びついた" value={null} unit="件" detail="集計の取得元は未接続" />
            <SummaryCard variant="v6" title="結びつけると増える売上" value={null} unit="円" detail="影響額の取得元は未接続" />
          </div>

          <NoteBar>確認済みのメールアドレスか電話番号が同じなら候補になります。名前だけが同じ人は、別人のこともあるため自動では結びつけません。</NoteBar>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs items={([
                ['all', 'すべて', review.items.length],
                ['candidate', '候補あり', candidateCount],
                ['none', '候補なし', noneCount],
                ['conflict', '同じ人が2人いる疑い', conflictCount],
              ] as const).map(([value, label, count]) => ({
                label,
                count,
                current: view === value,
                onClick: () => setView(value),
              }))} />
            <Select
              aria-label="候補の並び順"
              value={sort}
              onChange={(value) => setSort(value as typeof sort)}
              options={[
                { value: 'newest', label: '注文が新しい順' },
                { value: 'confidence', label: '確からしさが高い順' },
              ]}
            />
          </div>

          <div className={styles.tableWrap}>
            <DataTable>
              <thead>
                <TableHeadRow>
                  <Th>ECの注文・会員</Th>
                  <Th>LINEの候補</Th>
                  <Th>似ているところ</Th>
                  <Th>確からしさ</Th>
                  <Th>結びつけると</Th>
                  <Th align="right">操作</Th>
                </TableHeadRow>
              </thead>
              <tbody>
                {shown.map((item) => (
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
                    <Td>{NOT_AVAILABLE}</Td>
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
            結びついていない {review.items.length.toLocaleString('ja-JP')} 件中 {shown.length.toLocaleString('ja-JP')} 件を表示しています。
            自動で結びついた件数と、結び付けたときに増える売上は {NOT_AVAILABLE} です。
            結び付けても元の注文とLINEの友だちは残り、過去のLINE送信は再送しません。
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
