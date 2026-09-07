'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
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
import { useAccount } from '@/contexts/account-context'
import { ApiError, api, type EcIdentityCandidateOperationsList } from '@/lib/api'
import EcTabs from '../ec-tabs-view'
import ecStyles from '../ec-commerce-v6.module.css'

/**
 * 設計 `ELayY` 23-1-A「会員のつき合わせ」。
 *
 * ECの注文・会員と、LINEの友だちが同じ人かを決める。友だち同士の照合
 * （`InCDe`）と読む契約は同じで、こちらは**まだ結びついていない件を
 * 並べて選ぶ**形になる。
 *
 * 一覧・判定は共通の本人照合APIを使い、件数と売上影響はEC運用APIの
 * account scope付き集計を使う。推測した数字は表示しない。
 */
export default function EcIdentityCandidatesPage() {
  const review = useIdentityReview('ec_member')
  const { selectedAccountId } = useAccount()
  const detail = review.detail
  const [operations, setOperations] = useState<EcIdentityCandidateOperationsList | null>(null)
  const [operationsState, setOperationsState] = useState<'loading' | 'ready' | 'empty' | 'error' | 'forbidden'>('loading')
  const [view, setView] = useState<'all' | 'candidate' | 'none' | 'conflict'>('all')
  const [sort, setSort] = useState<'newest' | 'confidence'>('newest')

  const loadOperations = useCallback(async () => {
    if (!selectedAccountId) {
      setOperations(null)
      setOperationsState('empty')
      return
    }
    setOperationsState('loading')
    try {
      const response = await api.ecCommerce.operationIdentityCandidates({
        lineAccountId: selectedAccountId,
        status: 'pending',
        limit: 100,
      })
      if (!response.success || !Array.isArray(response.data?.items) || !response.data?.summary) {
        throw new Error('invalid_identity_operations_response')
      }
      setOperations(response.data)
      setOperationsState('ready')
    } catch (error) {
      setOperationsState(error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error')
    }
  }, [selectedAccountId])

  useEffect(() => { void loadOperations() }, [loadOperations])

  const scopedItems = useMemo(
    () => review.items.filter((item) => item.left.lineAccountId === selectedAccountId),
    [review.items, selectedAccountId],
  )
  const candidateCount = operations?.summary.candidateExternalCustomers ?? 0
  const noneCount = Math.max(0, (operations?.summary.unmatched ?? 0) - candidateCount)
  const conflictCount = operations?.summary.duplicateSuspicions ?? 0
  const impactByCandidate = useMemo(() => new Map((operations?.items ?? []).map((item) => {
    const metrics = Array.isArray(item.impact) ? item.impact : []
    const revenue = metrics.find((metric) => {
      if (!metric || typeof metric !== 'object') return false
      const key = String((metric as Record<string, unknown>).key ?? '')
      return ['sales', 'revenue', 'order_amount'].includes(key)
    }) as Record<string, unknown> | undefined
    return [item.id, typeof revenue?.value === 'number' ? revenue.value : null] as const
  })), [operations])
  const shown = useMemo(() => scopedItems
    .filter((item) => {
      if (view === 'candidate') return Boolean(item.right.label)
      if (view === 'none') return !item.right.label
      if (view === 'conflict') return item.confidence.label === 'medium'
      return true
    })
    .toSorted((left, right) => sort === 'confidence'
      ? right.confidence.score - left.confidence.score
      : Date.parse(right.detectedAt) - Date.parse(left.detectedAt)), [scopedItems, sort, view])

  const pageState = operationsState !== 'ready'
    ? operationsState
    : review.state === 'ready' && scopedItems.length === 0
      ? 'empty'
      : review.state

  return (
    <div className={ecStyles.root}>
      <PageHeader
        breadcrumb={[
          { label: '専用機能' },
          { label: 'EC連携', href: '/ec-commerce' },
          { label: '会員のつき合わせ' },
        ]}
        title="EC連携"
        description=""
        actions={<Button href="/ec-commerce?tab=connector">つき合わせの決めごと</Button>}
      />

      <EcTabs accountId={selectedAccountId} active="identity" />

      <IdentityStateBlock
        state={pageState}
        failure={review.failure}
        emptyTitle="つき合わせる会員はありません"
        emptyDescription="メールアドレスか電話番号が同じなら自動で結び付きます。どちらも違うときだけ、ここへ並びます。"
      />

      {pageState === 'ready' ? (
        <>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <SummaryCard variant="v6" title="結びついていない" value={operations?.summary.unmatched ?? null} unit="件" detail="確認待ちの注文・会員" badge="要対応" />
            <SummaryCard variant="v6" title="候補が見つかった" value={candidateCount} unit="件" detail="確認済みの連絡先や名前が近い人" />
            <SummaryCard variant="v6" title="自動で結びついた" value={operations?.summary.linked ?? null} unit="件" detail="同じ人として結びついた会員" />
            <SummaryCard variant="v6" title="結びつけると増える売上" value={operations?.summary.potentialRevenue ?? null} unit="円" detail="確認待ちの会員ぶん" />
          </div>

          <NoteBar>確認済みのメールアドレスか電話番号が同じなら候補になります。名前だけが同じ人は、別人のこともあるため自動では結びつけません。</NoteBar>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs items={([
                ['all', 'すべて', operations?.summary.unmatched ?? 0],
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
                    <Td>{impactByCandidate.get(item.id) === null || impactByCandidate.get(item.id) === undefined
                      ? NOT_AVAILABLE
                      : `¥${impactByCandidate.get(item.id)?.toLocaleString('ja-JP')} が入る`}</Td>
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
            結びついていない {(operations?.summary.unmatched ?? 0).toLocaleString('ja-JP')} 件中 {shown.length.toLocaleString('ja-JP')} 件を表示しています。
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
