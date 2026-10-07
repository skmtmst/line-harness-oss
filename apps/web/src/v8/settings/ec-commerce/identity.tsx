'use client'

/*
 * ★V8-B `w1W8h`：EC連携 会員のつき合わせ（/ec-commerce/identity-candidates）。
 *
 * 外側は取り込みの記録（GmVR5）と同じ設定の板（narrow-nav）と中の切り替え。中身は絵の順：
 * 数の帯（自動で結びついた・候補が見つかった・結びついていない・結びついていない注文の金額）→
 * 自動で結びつく条件の帯 → 並び（と絞り込み）・注意 → 候補の表（「候補を見る」「決める」、候補なしは「友だちを探す」）。
 * 動きは今の画面（app/ec-commerce/identity-candidates/page.tsx）と同じ：候補は本人照合の口、
 * 件数と金額はEC運用の集計の口（アカウントの切り替えで古い応答を捨てる・集計だけの失敗は数の帯だけ）、
 * 「候補を見る」で表の下に根拠・影響・両方の中身・これまでの判断、「決める」で判定の窓。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowUpRight, Link2, Plug, Search, Unlink, UserSearch } from 'lucide-react'
import { ORDER_IMPACT_KEYS, REVENUE_IMPACT_KEYS, type IdentityCandidateImpactMetric } from '@line-crm/shared'
import Button from '@/components/shared/button'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import Select from '@/components/shared/select'
import ListRange from '@/components/ui/list-range'
import IdentityDecisionDialog from '@/components/identity/identity-decision-dialog'
import { IdentityEvidenceList, IdentityHistoryList, IdentityImpactList, IdentitySubjectCard } from '@/components/identity/identity-parts'
import { IdentityStateBlock } from '@/components/identity/identity-state'
import { useIdentityReview } from '@/components/identity/identity-review'
import { confidenceText, impactText, NOT_AVAILABLE } from '@/components/identity/identity-view'
import { useAccount } from '@/contexts/account-context'
import { ApiError, api, type EcIdentityCandidateOperationsList } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { SbSettingsScreen } from '../sb-frame/settings-screen'
import { EcTabsV8 } from './screen'
import shared from './screen.module.css'
import styles from './identity.module.css'

type View = 'all' | 'candidate' | 'none' | 'conflict'
type Sort = 'newest' | 'confidence'

const isImpactMetric = (value: unknown): value is IdentityCandidateImpactMetric => {
  if (!value || typeof value !== 'object') return false
  const metric = value as { key?: unknown; value?: unknown; unit?: unknown }
  return typeof metric.key === 'string' && (metric.value === null || typeof metric.value === 'number') && typeof metric.unit === 'string'
}

/** 「注文 3件 ¥18,600」。取れないときは null（推測した数を出さない）。 */
function candidateImpact(value: unknown): string | null {
  if (!Array.isArray(value)) return null
  const metrics = value.filter(isImpactMetric)
  const order = metrics.find((metric) => ORDER_IMPACT_KEYS.includes(metric.key))
  const revenue = metrics.find((metric) => REVENUE_IMPACT_KEYS.includes(metric.key))
  const parts = [order && order.value !== null ? `注文 ${impactText(order)}` : '', revenue && revenue.value !== null ? impactText(revenue) : ''].filter(Boolean)
  return parts.length ? parts.join(' ') : null
}

const AUTO_LINK_NOTE = 'メールアドレスか電話番号が同じなら、自動で結びつきます。どちらも違うときに、ここへ並びます。名前だけが同じ人は、別人のこともあるので自動では結びつけません。'

const VIEW_OPTIONS: Array<{ value: View; label: string }> = [
  { value: 'all', label: 'すべて' },
  { value: 'candidate', label: '候補あり' },
  { value: 'none', label: '候補なし' },
  { value: 'conflict', label: '同じ人が2人いる疑い' },
]

function confidenceTone(label: string): 'good' | 'info' | 'muted' {
  if (label === 'very_high' || label === 'high') return 'good'
  if (label === 'medium') return 'info'
  return 'muted'
}

export default function EcIdentityCandidatesScreen() {
  const { selectedAccountId } = useAccount()
  const review = useIdentityReview('ec_member', { lineAccountId: selectedAccountId })
  const detail = review.detail
  const [operations, setOperations] = useState<EcIdentityCandidateOperationsList | null>(null)
  const [operationsState, setOperationsState] = useState<'loading' | 'ready' | 'empty' | 'error' | 'forbidden'>('loading')
  const [view, setView] = useState<View>('all')
  const [sort, setSort] = useState<Sort>('confidence')

  /* アカウントを切り替えたら、前のアカウントの遅れた応答は採らない（R600）。 */
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
      const response = await api.ecCommerce.operationIdentityCandidates({ lineAccountId: account, status: 'pending', limit: 100 })
      if (!isCurrent()) return
      if (!response.success || !Array.isArray(response.data?.items) || !response.data?.summary) throw new Error('invalid_identity_operations_response')
      setOperations(response.data)
      setOperationsState('ready')
    } catch (error) {
      if (!isCurrent()) return
      setOperationsState(error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error')
    }
  }, [selectedAccountId])

  useEffect(() => { void loadOperations() }, [loadOperations])

  const operationsReady = operationsState === 'ready' && operations !== null
  const candidateCount = operations?.summary.candidateExternalCustomers ?? 0
  const noneCount = operations?.summary.withoutCandidates ?? null
  const conflictCount = operations?.summary.duplicateSuspicions ?? 0
  /* 集計が読めていないときは数を 0 と書かない。数の帯の下の行で理由を言う。 */
  const operationsDetail = (normal: string): string => {
    if (operationsReady) return normal
    if (operationsState === 'loading') return '読み込んでいます'
    if (operationsState === 'forbidden') return '表示する権限がありません'
    if (operationsState === 'error') return '読み込めませんでした'
    return normal
  }
  const impactByCandidate = useMemo(
    () => new Map((operations?.items ?? []).map((item) => [item.id, candidateImpact(item.impact)] as const)),
    [operations],
  )
  const viewCount: Record<View, number | null | undefined> = {
    all: operationsReady ? operations?.summary.unmatched ?? 0 : undefined,
    candidate: operationsReady ? candidateCount : undefined,
    none: operationsReady ? noneCount : undefined,
    conflict: operationsReady ? conflictCount : undefined,
  }
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

  const pageState = review.state !== 'ready'
    ? review.state
    : review.items.length === 0 || operationsState === 'empty'
      ? 'empty'
      : 'ready'

  let body: ReactNode
  if (pageState !== 'ready') {
    body = (
      <IdentityStateBlock
        state={pageState}
        failure={review.failure}
        emptyTitle="つき合わせる会員はありません"
        emptyDescription="メールアドレスか電話番号が同じなら自動で結び付きます。どちらも違うときだけ、ここへ並びます。"
        onRetry={() => { void loadOperations(); review.reload() }}
      />
    )
  } else {
    body = (
      <>
        <KpiBand data-kpi-presentation="cards" gridClassName={styles.kpis}>
          <KpiCard presentation="card" icon={<Link2 size={13} aria-hidden="true" />} title="自動で結びついた" value={operationsReady ? (operations?.summary.linked ?? null) : null} unit="人" detail={operationsDetail('メールか電話番号が同じ')} loading={operationsState === 'loading'} onRetry={operationsState === 'error' ? () => { void loadOperations() } : undefined} />
          <KpiCard presentation="card" icon={<UserSearch size={13} aria-hidden="true" />} title="候補が見つかった" value={operationsReady ? candidateCount : null} unit="人" detail={operationsReady ? `人が決める（つき合わせ ${formatNumber(operations?.summary.unmatched ?? 0)} のうち）` : operationsDetail('人が決める')} loading={operationsState === 'loading'} />
          <KpiCard presentation="card" icon={<Unlink size={13} aria-hidden="true" />} title="結びついていない" value={operationsReady ? noneCount : null} unit="人" detail={operationsDetail('候補なし')} loading={operationsState === 'loading'} />
          <KpiCard
            presentation="card"
            icon={<ArrowUpRight size={13} aria-hidden="true" />}
            title="結びついていない注文の金額"
            value={null}
            unit=""
            valueText={operationsReady && operations?.summary.potentialRevenue != null ? `¥${formatNumber(operations.summary.potentialRevenue)}` : undefined}
            detail={operationsReady ? `候補 ${formatNumber(candidateCount)} 人の注文` : operationsDetail('分析にも入ります')}
            loading={operationsState === 'loading'}
          />
        </KpiBand>

        <p className={styles.band} title={AUTO_LINK_NOTE}>{AUTO_LINK_NOTE}</p>

        <div className={styles.toolbar}>
          <span className={styles.sortBox}>
            <Select aria-label="候補の並び順" value={sort} onChange={(value) => setSort(value as Sort)} options={[{ value: 'confidence', label: '確からしさが高い順' }, { value: 'newest', label: '注文が新しい順' }]} />
          </span>
          {/* 絵に無い絞り込み（候補あり・候補なし・同じ人が2人いる疑い）は、並びの横に小さく残す。 */}
          <span className={styles.sortBox}>
            <Select
              aria-label="候補の絞り込み"
              value={view}
              onChange={(value) => setView(value as View)}
              options={VIEW_OPTIONS.map((option) => ({ value: option.value, label: viewCount[option.value] == null ? option.label : `${option.label} ${formatNumber(viewCount[option.value] ?? 0)}` }))}
            />
          </span>
          <span className={shared.spacer} />
          <span className={styles.note}>結び付けても元の注文と LINE の友だちは残り、過去の LINE 送信は再送しません。</span>
        </div>

        <div className={shared.table} role="table" aria-label="会員のつき合わせの候補">
          <div role="row" className={`${styles.row} ${shared.headRow}`}>
            <span role="columnheader">ECの注文・会員</span>
            <span role="columnheader">LINEの候補</span>
            <span role="columnheader">似ているところ</span>
            <span role="columnheader">確からしさ</span>
            <span role="columnheader">操作</span>
          </div>
          {shown.length === 0 ? (
            <div role="row" className={styles.emptyRow}><span role="cell">この絞り込みに当たる候補はありません</span></div>
          ) : shown.map((item) => {
            const impact = impactByCandidate.get(item.id) ?? null
            const leftSub = [item.left.detail, impact].filter(Boolean).join('・') || NOT_AVAILABLE
            const hasCandidate = Boolean(item.right.label)
            const selected = review.selectedId === item.id
            return (
              <div key={item.id} role="row" className={styles.row} data-selected={selected || undefined}>
                <span role="cell" className={shared.stack}>
                  <span className={styles.name} title={item.left.label}>{item.left.label}</span>
                  <span className={shared.sub} title={leftSub}>{leftSub}</span>
                </span>
                <span role="cell" className={shared.stack}>
                  <span className={styles.name}>{hasCandidate ? item.right.label : '結びついていない —'}</span>
                  {hasCandidate ? <span className={shared.sub}>{item.right.detail ?? item.right.lineAccountName ?? NOT_AVAILABLE}</span> : null}
                </span>
                <span role="cell" className={shared.text} title={item.evidenceSummary.join('・')}>
                  {hasCandidate ? (item.evidenceSummary.length ? item.evidenceSummary.join('・') : NOT_AVAILABLE) : '候補なし'}
                </span>
                <span role="cell">
                  {hasCandidate ? (
                    <span className={shared.status} data-tone={confidenceTone(item.confidence.label)}>
                      <span className={shared.dot} aria-hidden="true" />
                      {confidenceText(item.confidence.label)}
                    </span>
                  ) : '—'}
                </span>
                <span role="cell" className={styles.ops}>
                  {hasCandidate ? (
                    <>
                      <Button type="button" variant={selected ? 'primary' : 'secondary'} aria-pressed={selected} onClick={() => review.select(item.id)}>候補を見る</Button>
                      <Button type="button" data-qa-open="ELayY" onClick={() => review.openDialog(item.id)}>決める</Button>
                    </>
                  ) : (
                    <Button href={`/friends?q=${encodeURIComponent(item.left.label)}`}><Search className={shared.btnIcon} aria-hidden="true" />友だちを探す</Button>
                  )}
                </span>
              </div>
            )
          })}
        </div>

        {review.hasMore ? (
          <div className={styles.more}>
            <Button type="button" onClick={review.loadMore} disabled={review.loadingMore} busy={review.loadingMore} busyLabel="読み込み中…">続きを読み込む</Button>
          </div>
        ) : null}

        <p className={shared.foot}>
          {operationsReady
            ? <ListRange label="結びついていない" total={operations?.summary.unmatched ?? 0} first={shown.length === 0 ? 0 : 1} last={shown.length} />
            : <span>結びついていない —</span>}
        </p>

        {detail ? (
          <section className={styles.detail} aria-label="「候補を見る」で開いた中身">
            <div className={styles.detailPair}>
              <IdentitySubjectCard side="ECの会員" subject={detail.left} />
              <IdentitySubjectCard side="LINE の友だち" subject={detail.right} />
            </div>
            <div className={styles.detailPair}>
              <IdentityEvidenceList evidence={detail.evidence} confidence={detail.confidence} />
              <IdentityImpactList impact={detail.impact} />
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
          </section>
        ) : null}
      </>
    )
  }

  return (
    <SbSettingsScreen
      boardId="w1W8h"
      layout="narrow-nav"
      title="EC連携"
      description="ネットショップから注文・発送・定期便の出来事を取り込み、LINE の友だちと結びつけます。"
      actions={<Button href="/ec-commerce?tab=connector" variant="secondary"><Plug className={shared.btnIcon} aria-hidden="true" />つなぎ先の設定</Button>}
    >
      <EcTabsV8 accountId={selectedAccountId} active="identity" />
      {body}
    </SbSettingsScreen>
  )
}
