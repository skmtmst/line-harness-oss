'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BadgeCheck, CircleDot, CreditCard, Hourglass, Pause, Plus, Star } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api, type OpsTenantRow, type OpsTenantSummary } from '@/lib/api'
import { formatDate, planLabel, tenantDetailHref, opsCall } from '@/components/ops/ops-ui'
import { opsEnvironmentLabel } from '@/components/ops/ops-env-bar'
import { isForbiddenOrRateLimited } from '@/components/shared/api-error-message'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import FilterChip from '@/components/shared/filter-chip'
import KpiCard from '@/components/shared/kpi-card'
import kpiStyles from '@/components/shared/kpi-card.module.css'
import ListState from '@/components/shared/list-state'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import { TextField } from '@/components/shared/text-field'
import { OpsHead } from './shell'
import { useOpsReadOnly } from './use-ops-read-only'
import parts from './parts.module.css'
import styles from './tenants.module.css'

/**
 * 運営の契約先アカウント V8（絵 `XWtYC`・作る窓 `i0FTN`）。
 *
 * 動きは v7（app/ops/tenants）と同じ口：/api/ops/tenants を検索語で読み、状態の札で絞る。
 * `?status=` で絞り込みを受け取る（ダッシュボードの要対応から来る）。
 * 契約先の名前から詳細へ。代理ログインは詳細の画面から行う。
 * 「契約先を作る」は書ける運営メンバーにだけ出す（閲覧のみの人には出さない）。
 */

function loadDescription(err: unknown): string | undefined {
  if (isForbiddenOrRateLimited(err)) return undefined
  if (err instanceof TypeError) return '通信できませんでした。ネットワークを確認してもう一度お試しください'
  if (err instanceof Error && err.message && !/^API error: /.test(err.message)) return err.message
  return undefined
}

const STATUS_FILTERS: Array<{ key: string; label: string }> = [
  { key: 'active', label: '契約中' },
  { key: 'trialing', label: 'トライアル' },
  { key: 'past_due', label: '決済失敗' },
  { key: 'suspended', label: '停止' },
  { key: 'archived', label: '解約' },
]

/** 状態の札（利用の状態と請求の状態を1枚に：停止・解約が先、あとは請求）。 */
function tenantState(row: OpsTenantRow): { label: string; tone: StatusBadgeTone } {
  if (row.status === 'suspended') return { label: '停止', tone: 'neutral' }
  if (row.status === 'archived') return { label: '解約', tone: 'neutral' }
  if (row.plan_status === 'trialing') return { label: 'トライアル', tone: 'info' }
  if (row.plan_status === 'past_due') return { label: '決済失敗', tone: 'danger' }
  if (row.plan_status === 'active') return { label: '契約中', tone: 'success' }
  if (row.plan_status === 'exempt') return { label: '課金対象外', tone: 'neutral' }
  return { label: '請求解約', tone: 'neutral' }
}

/** 10/4 の形。 */
function monthDay(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' })
}

export default function OpsTenantsV8() {
  const router = useRouter()
  const [rows, setRows] = useState<OpsTenantRow[]>([])
  const [summary, setSummary] = useState<OpsTenantSummary | null>(null)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [listLoadError, setListLoadError] = useState<unknown>(null)
  const readOnly = useOpsReadOnly()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newRestaurant, setNewRestaurant] = useState(false)
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState('')

  const load = useCallback(async () => {
    setListLoadError(null)
    try {
      const res = await api.ops.tenants({ q: q.trim() || undefined })
      if (!res.success) { setListLoadError(new Error(res.error || '読み込めませんでした')); return }
      setRows(res.data)
      setSummary(res.summary)
    } catch (caught) {
      setListLoadError(caught)
    }
  }, [q])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void load().finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [load])

  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get('status') ?? ''
    if (STATUS_FILTERS.some((f) => f.key === status)) setFilter(status)
  }, [])

  const visible = rows.filter((row) => {
    if (!filter) return true
    if (filter === 'trialing') return row.plan_status === 'trialing'
    if (filter === 'past_due') return row.plan_status === 'past_due'
    if (filter === 'active') return row.plan_status === 'active' || row.plan_status === 'past_due'
    return row.status === filter
  })

  const closeCreate = () => {
    if (createBusy) return
    setCreating(false)
    setNewName('')
    setNewRestaurant(false)
    setCreateError('')
  }

  const create = async () => {
    if (createBusy) return
    if (!newName.trim()) { setCreateError('統括名を入力してください'); return }
    setCreateBusy(true)
    setCreateError('')
    const res = await opsCall(api.ops.createTenant(newName.trim(), newRestaurant ? ['restaurant'] : []))
    setCreateBusy(false)
    if (!res.success) { setCreateError(res.error || '作成できませんでした'); return }
    setNewName('')
    setNewRestaurant(false)
    setCreating(false)
    router.push(tenantDetailHref(res.data.id))
  }

  const first = (fn: (row: OpsTenantRow) => boolean) => rows.find(fn)
  const trialEnd = rows.filter((row) => row.plan_status === 'trialing' && row.trial_ends_at).map((row) => row.trial_ends_at as string).sort()[0]
  const pastDue = first((row) => row.plan_status === 'past_due')
  const suspended = first((row) => row.status === 'suspended')
  const kpiLoading = loading && !summary

  return (
    <div data-design-node="XWtYC">
      <OpsHead
        title="契約先アカウント"
        description="契約先を選ぶと詳細が開きます。代理ログインは既定で閲覧のみです。"
        environment={opsEnvironmentLabel(process.env.NEXT_PUBLIC_API_URL)}
        actions={readOnly ? null : (
          <Button variant="primary" onClick={() => { setCreateError(''); setCreating(true) }}><Plus aria-hidden="true" />契約先を作る</Button>
        )}
      />
      <div className={parts.stack}>
        <div className={`${parts.kpis} ${kpiStyles.strip}`}>
          <KpiCard presentation="cell" icon={<BadgeCheck size={13} aria-hidden="true" />} title="契約中" value={summary ? summary.active : null} unit="社" detail="請求が生きている契約先（決済失敗を含む）" loading={kpiLoading} />
          <KpiCard presentation="cell" icon={<Hourglass size={13} aria-hidden="true" />} title="トライアル中" value={summary ? summary.trialing : null} unit="社" detail={trialEnd ? `期限 ${monthDay(trialEnd)}` : '期限切れ前に案内'} loading={kpiLoading} />
          <KpiCard presentation="cell" icon={<CreditCard size={13} aria-hidden="true" />} title="決済失敗" value={summary ? summary.pastDue : null} unit="社" detail={pastDue ? pastDue.name : 'Stripe で支払いが止まっている'} loading={kpiLoading} />
          <KpiCard presentation="cell" icon={<Pause size={13} aria-hidden="true" />} title="停止中" value={summary ? summary.suspended : null} unit="社" detail={suspended ? suspended.name : '運営が止めた契約先'} loading={kpiLoading} />
        </div>

        <div className={styles.tools}>
          <div className={styles.search}>
            <SearchField value={q} onChange={setQ} onClear={() => setQ('')} placeholder="統括名・メール・店舗名で探す" aria-label="契約先を探す" />
          </div>
          <FilterChip icon={<CircleDot size={13} aria-hidden="true" />} selected={filter === ''} onChange={() => setFilter('')}>
            {loading || listLoadError ? 'すべて' : `すべて ${rows.length}`}
          </FilterChip>
          {STATUS_FILTERS.map((f) => (
            <FilterChip key={f.key} icon={<Star size={13} aria-hidden="true" />} selected={filter === f.key} onChange={(selected) => setFilter(selected ? f.key : '')}>
              {f.label}
            </FilterChip>
          ))}
        </div>

        {loading && rows.length === 0 ? (
          <ListState kind="loading" title="契約先を読み込んでいます" />
        ) : listLoadError && rows.length === 0 ? (
          <div className={parts.panel}>
            <ListState kind="error" title="契約先を表示できませんでした" description={loadDescription(listLoadError)} error={listLoadError ?? undefined} onRetry={() => void load()} />
          </div>
        ) : visible.length === 0 ? (
          <div className={parts.panel}>
            <ListState kind="empty" title="該当する契約先がありません" description="検索の言葉や絞り込みを変えてください。" />
          </div>
        ) : (
          <div className={parts.mini} role="table" aria-label="契約先">
            <div className={parts.miniHead} role="row">
              <span className={parts.grow} role="columnheader">統括名</span>
              <span className={`${parts.fixed} ${styles.col90}`} role="columnheader">プラン</span>
              <span className={`${parts.fixed} ${styles.col90}`} role="columnheader">状態</span>
              <span className={`${parts.num} ${styles.colStores}`} role="columnheader">店舗</span>
              <span className={`${parts.num} ${styles.colStaff}`} role="columnheader">権限者</span>
              <span className={`${parts.fixed} ${styles.colBilling}`} role="columnheader">利用 / 請求</span>
              <span className={`${parts.fixed} ${styles.col90}`} role="columnheader">契約日</span>
              <span className={`${parts.fixed} ${styles.col90}`} role="columnheader">最終ログイン</span>
              <span className={`${parts.fixed} ${styles.colFeature}`} role="columnheader">飲食店機能</span>
            </div>
            {visible.map((row) => {
              const state = tenantState(row)
              return (
                <div key={row.id} className={`${parts.miniRow} ${styles.row}`} role="row">
                  <span className={parts.grow} role="cell">
                    <Link href={tenantDetailHref(row.id)} className={parts.link} title={row.name}>{row.name}</Link>
                  </span>
                  <span className={`${parts.fixed} ${styles.col90}`} role="cell">{row.plan_status === 'trialing' && !row.plan_key ? 'トライアル' : planLabel(row.plan_key)}</span>
                  <span className={`${parts.fixed} ${styles.col90}`} role="cell"><StatusBadge tone={state.tone}>{state.label}</StatusBadge></span>
                  <span className={`${parts.num} ${styles.colStores}`} role="cell">{row.account_count}</span>
                  <span className={`${parts.num} ${styles.colStaff}`} role="cell">{row.staff_count}</span>
                  <span className={`${parts.fixed} ${styles.colBilling} ${styles.billing}`} role="cell">
                    <span className={styles.billingMain}>{row.plan_status === 'trialing' ? 'トライアル' : planLabel(row.plan_key)}</span>
                    <span className={styles.billingSub}>{row.trial_ends_at ? `期限 ${monthDay(row.trial_ends_at)}` : row.current_period_ends_at ? `次回 ${monthDay(row.current_period_ends_at)}` : '—'}</span>
                  </span>
                  <span className={`${parts.fixed} ${styles.col90}`} role="cell">{formatDate(row.created_at).replace(/-/g, '/')}</span>
                  <span className={`${parts.fixed} ${styles.col90}`} role="cell">{monthDay(row.last_login_at)}</span>
                  <span className={`${parts.fixed} ${styles.colFeature}`} role="cell">{row.featurePacks.includes('restaurant') ? '使う' : '—'}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <Dialog
        open={creating}
        designWidth={520}
        designTop={240}
        title="契約先を作る"
        confirmLabel="作る"
        cancelLabel="キャンセル"
        confirmIcon={<Plus size={15} aria-hidden="true" />}
        busy={createBusy}
        error={createError || undefined}
        designNode="i0FTN"
        onConfirm={() => void create()}
        onCancel={closeCreate}
      >
        <div className={parts.dialogBody}>
          <label className={styles.field}>
            <span className={styles.label}>統括名（会社名）</span>
            <TextField value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="株式会社 然" maxLength={100} aria-label="統括名（会社名）" />
          </label>
          <div className={styles.field}>
            <span className={styles.smallLabel}>飲食店機能</span>
            <div className={styles.fullSelect}>
              <Select aria-label="飲食店機能" value={newRestaurant ? 'use' : 'skip'} onChange={(value) => setNewRestaurant(value === 'use')} size="full" options={[{ value: 'skip', label: '使わない' }, { value: 'use', label: '使う' }]} />
            </div>
          </div>
          <p className={parts.dialogNote}>作ると、統括の最初の権限者へ招待を送れるようになります。プランは契約先の詳細で決めます。</p>
        </div>
      </Dialog>
    </div>
  )
}
