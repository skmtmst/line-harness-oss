'use client'

import '@/app/notifications/readonly-v8.css'
import ReadonlyHeaderV8 from '@/app/notifications/readonly-header-v8'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import NoteBar from '@/components/shared/note-bar'
import PageHeader from '@/components/shared/page-header'
import Select from '@/components/shared/select'
import KpiCard from '@/components/shared/kpi-card'
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
import { impactText, maskedText, NOT_AVAILABLE } from '@/components/identity/identity-view'
import styles from '@/components/identity/identity-review.module.css'
import { useAccount } from '@/contexts/account-context'
import { formatNumber } from '@/lib/format'
import { ApiError, api, type EcIdentityCandidateOperationsList } from '@/lib/api'
import { ORDER_IMPACT_KEYS, REVENUE_IMPACT_KEYS, type IdentityCandidateImpactMetric } from '@line-crm/shared'
import EcTabs from '../ec-tabs-view'
import ListRange from '@/components/ui/list-range'
import ecStyles from '../ec-commerce-v6.module.css'

// #517 軽4: 計量キーは共有の正本を使う。手書きの重複を持たない。
// 影響の計量は共有の型で受け、表示は `impactText` 系に寄せる。

const isImpactMetric = (value: unknown): value is IdentityCandidateImpactMetric => {
  if (!value || typeof value !== 'object') return false
  const metric = value as { key?: unknown; value?: unknown; unit?: unknown }
  return typeof metric.key === 'string'
    && (metric.value === null || typeof metric.value === 'number')
    && typeof metric.unit === 'string'
}

function candidateImpactText(value: unknown): string {
  if (!Array.isArray(value)) return NOT_AVAILABLE
  const metrics = value.filter(isImpactMetric)
  const order = metrics.find((metric) => ORDER_IMPACT_KEYS.includes(metric.key))
  const revenue = metrics.find((metric) => REVENUE_IMPACT_KEYS.includes(metric.key))
  const countText = order && order.value !== null ? `注文 ${impactText(order)}` : ''
  const revenueText = revenue && revenue.value !== null ? impactText(revenue) : ''
  return countText || revenueText ? `${[countText, revenueText].filter(Boolean).join(' ')} が入る` : NOT_AVAILABLE
}

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
  const { selectedAccountId } = useAccount()
  const review = useIdentityReview('ec_member', { lineAccountId: selectedAccountId })
  const detail = review.detail
  const [operations, setOperations] = useState<EcIdentityCandidateOperationsList | null>(null)
  const [operationsState, setOperationsState] = useState<'loading' | 'ready' | 'empty' | 'error' | 'forbidden'>('loading')
  const [view, setView] = useState<'all' | 'candidate' | 'none' | 'conflict'>('all')
  /* w1W8h：絵の並び順は「確からしさが高い順」。 */
  const [sort, setSort] = useState<'newest' | 'confidence'>('confidence')

  /*
   * R600残件：アカウント切替で先行した集計要求の応答が後から届いても
   * 採用しない。番号の新しい要求だけを採用し、アカウントも照合して
   * 「選んだアカウント」と「出ている集計」がずれないようにする。
   * A→B→Aと戻っても最初のAの遅延応答は捨てる。遅延した失敗も今の
   * アカウントの確定集計を壊さない。
   */
  const operationsReqRef = useRef(0)
  const selectedAccountRef = useRef(selectedAccountId)
  selectedAccountRef.current = selectedAccountId

  const loadOperations = useCallback(async () => {
    if (!selectedAccountId) {
      operationsReqRef.current += 1
      setOperations(null)
      setOperationsState('empty')
      return
    }
    const account = selectedAccountId
    const req = ++operationsReqRef.current
    const isCurrent = () => req === operationsReqRef.current && selectedAccountRef.current === account
    setOperationsState('loading')
    try {
      const response = await api.ecCommerce.operationIdentityCandidates({
        lineAccountId: account,
        status: 'pending',
        limit: 100,
      })
      if (!isCurrent()) return
      if (!response.success || !Array.isArray(response.data?.items) || !response.data?.summary) {
        throw new Error('invalid_identity_operations_response')
      }
      setOperations(response.data)
      setOperationsState('ready')
    } catch (error) {
      if (!isCurrent()) return
      setOperationsState(error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error')
    }
  }, [selectedAccountId])

  useEffect(() => { void loadOperations() }, [loadOperations])

  const scopedItems = review.items
  /*
   * R600：運用集計と候補一覧は別の読み口。集計だけが失敗しても、
   * 取得済みの候補と判定入口は残す。集計の失敗は集計の場所（数値の
   * カード帯）にだけ出し、画面全体のエラーに広げない。
   */
  const reviewReady = review.state === 'ready'
  const operationsReady = operationsState === 'ready' && operations !== null
  const candidateCount = operations?.summary.candidateExternalCustomers ?? 0
  const noneCount = operations?.summary.withoutCandidates ?? null
  const conflictCount = operations?.summary.duplicateSuspicions ?? 0
  /*
   * 集計のカード帯の3段目。読めていない数を 0 と書かない（未取得は「—」）。
   * 4枚が同じ1回の取得を指すので、再試行の口は先頭の1枚にだけ寄せる。
   */
  const operationsDetail = (normal: React.ReactNode): React.ReactNode => {
    if (operationsReady) return normal
    if (operationsState === 'loading') return '読み込んでいます'
    if (operationsState === 'forbidden') return '表示する権限がありません'
    if (operationsState === 'error') return '読み込めませんでした'
    return normal
  }
  const operationsRetry = operationsState === 'error' ? () => { void loadOperations() } : undefined
  const impactByCandidate = useMemo(
    () => new Map((operations?.items ?? []).map((item) => [item.id, candidateImpactText(item.impact)] as const)),
    [operations],
  )
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

  /*
   * R600：候補の有無は候補の読み口で決める。運用集計の失敗では
   * 画面を隠さない（集計欄だけが失敗表示になる）。候補の読み口が
   * 失敗・権限不足のときは従来どおり中身を出さない。
   */
  const pageState = !reviewReady
    ? review.state
    : scopedItems.length === 0 || operationsState === 'empty'
      ? 'empty'
      : 'ready'

  return (
    <div className={`${ecStyles.root} v8-ro-notifications-page`} data-design-node="w1W8h">
      <ReadonlyHeaderV8 title="EC連携" description="LINEとまだ結びついていない出来事と、会員の候補を分けて確認します。" />
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
        onRetry={() => { void loadOperations(); review.reload() }}
      />

      {pageState === 'ready' ? (
        <>
          {/*
            w1W8h：絵の順番・言葉に寄せる（自動で結びついた→候補が見つかった→
            結びついていない→結びついていない注文の金額、単位は人／¥）。
            つき合わせ総数は2枚目の補足へ移し、カードでは繰り返さない。
          */}
          <div data-ro-kpis="true" className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <KpiCard
              variant="v6"
              title="自動で結びついた"
              value={operationsReady ? (operations?.summary.linked ?? null) : null}
              unit="人"
              detail={operationsDetail('メールか電話番号が同じ')}
              loading={operationsState === 'loading'}
              onRetry={operationsRetry}
            />
            <KpiCard
              variant="v6"
              title="候補が見つかった"
              value={operationsReady ? candidateCount : null}
              unit="人"
              detail={operationsReady
                ? `人が決める（つき合わせ ${formatNumber(operations?.summary.unmatched ?? 0)} のうち）`
                : operationsDetail('人が決める')}
              help="名前や電話が近い人がいます"
              loading={operationsState === 'loading'}
            />
            <KpiCard
              variant="v6"
              title="結びついていない"
              value={operationsReady ? noneCount : null}
              unit="人"
              detail={operationsDetail('候補なし')}
              help="候補が見つからなかった注文・会員です"
              loading={operationsState === 'loading'}
            />
            <KpiCard
              variant="v6"
              title="結びついていない注文の金額"
              value={null}
              unit=""
              valueText={operationsReady && operations?.summary.potentialRevenue != null
                ? `¥${formatNumber(operations.summary.potentialRevenue)}`
                : undefined}
              detail={operationsReady
                ? `候補 ${formatNumber(candidateCount)} 人の注文`
                : operationsDetail('分析にも入ります')}
              help="候補全体の注文金額です。同じEC会員は1人分として数えます"
              loading={operationsState === 'loading'}
            />
          </div>

          <NoteBar help="メールアドレスか電話番号が同じなら自動で結びつきます" helpLabel="自動で結びつく条件">メールアドレスか電話番号が同じなら、自動で結びつきます。どちらも違うときに、ここへ並びます。名前だけが同じ人は、別人のこともあるので自動では結びつけません。</NoteBar>

          <div className="flex flex-wrap items-center justify-between gap-3">
            {/*
              R600：集計が読めていないときは数を出さない（0件と書くと
              「候補が消えた」に見える）。`count` を省くと札だけになる。
            */}
            <Tabs items={([
                ['all', 'すべて', operationsReady ? operations?.summary.unmatched ?? 0 : undefined],
                ['candidate', '候補あり', operationsReady ? candidateCount : undefined],
                ['none', '候補なし', operationsReady ? noneCount ?? undefined : undefined],
                ['conflict', '同じ人が2人いる疑い', operationsReady ? conflictCount : undefined],
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
                  {/* 操作列は2つのボタン幅で固定し、残りは本文の列で吸収する。 */}
                  <Th align="right" className="w-56">操作</Th>
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
                    <Td>{Array.isArray(item.evidenceSummary) && item.evidenceSummary.length > 0 ? item.evidenceSummary.join('／') : NOT_AVAILABLE}</Td>
                    <Td>
                      <ConfidenceTag confidence={item.confidence} />
                    </Td>
                    <Td>{impactByCandidate.get(item.id) ?? NOT_AVAILABLE}</Td>
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

          {review.hasMore ? (
            <div className="flex justify-center">
              <Button type="button" onClick={review.loadMore} disabled={review.loadingMore} busy={review.loadingMore} busyLabel="読み込み中…">続きを読み込む
              </Button>
            </div>
          ) : null}

          <p className={styles.footerNote}>
            {operationsReady ? (
              <ListRange label="結びついていない" total={operations?.summary.unmatched ?? 0} first={shown.length === 0 ? 0 : 1} last={shown.length} />
            ) : (
              /* R600：総数が読めていないときは「—」にし、0件と書かない。 */
              <span className="text-ink-faint text-xs">結びついていない —</span>
            )}
            <span className="block">結び付けても元の注文とLINEの友だちは残り、過去のLINE送信は再送しません。</span>
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
