'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { api, type OpsTenantRow, type OpsTenantSummary } from '@/lib/api'
import OpsPageHeader, { ReadonlyDesignNode } from '@/app/ops/readonly-header-v8'
import '@/app/ops/readonly-v8.css'
import { formatDate, formatDateTime, planLabel, planStatusChip, tenantDetailHref, tenantUseStatusChip, opsCall } from '@/components/ops/ops-ui'
import Button from '@/components/shared/button'
import Chip from '@/components/shared/chip'
import { isForbiddenOrRateLimited } from '@/components/shared/api-error-message'
import Dialog from '@/components/shared/dialog'
import FilterChip from '@/components/shared/filter-chip'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import KpiCard from '@/components/shared/kpi-card'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { TextField } from '@/components/shared/text-field'

/** 契約先アカウント（一覧）。★V6 37-3 `X9f5jy`。 */

/*
 * 一覧の読み込み失敗の説明。403・429 は説明を渡さず、ListState が捕まえた
 * 失敗から共通の1枚（権限の案内・待ち案内）を作る。それ以外は捕まえた言葉を
 * そのまま出す（通信断の「通信できませんでした」など）。
 */
function loadDescription(err: unknown): string | undefined {
  if (isForbiddenOrRateLimited(err)) return undefined
  if (err instanceof TypeError) return '通信できませんでした。ネットワークを確認してもう一度お試しください'
  if (err instanceof Error && err.message && !/^API error: /.test(err.message)) return err.message
  return undefined
}

const STATUS_FILTERS: Array<{ key: string; label: string }> = [
  { key: 'trialing', label: 'トライアル' },
  { key: 'active', label: '契約中' },
  { key: 'past_due', label: '決済失敗' },
  { key: 'suspended', label: '停止' },
  { key: 'archived', label: '解約' },
]

export default function OpsTenantsPage() {
  const router = useRouter()
  const [rows, setRows] = useState<OpsTenantRow[]>([])
  const [summary, setSummary] = useState<OpsTenantSummary | null>(null)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // ★V7：一覧の失敗は一覧の場所の1枚で出す。操作の知らせと混ぜない。
  const [listFailed, setListFailed] = useState(false)
  // M042：一覧の読み込みで捕まえた失敗そのもの。ListState が 403 は権限の
  // 案内（再試行なし）・429 は待ち案内に切り替える。
  const [listLoadError, setListLoadError] = useState<unknown>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newRestaurant, setNewRestaurant] = useState(false)
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError('')
    setListFailed(false)
    setListLoadError(null)
    try {
      const res = await api.ops.tenants({ q: q.trim() || undefined })
      if (!res.success) {
        const failure = new Error(res.error || '読み込めませんでした')
        setError(failure.message); setListFailed(true); setListLoadError(failure); return
      }
      setRows(res.data)
      setSummary(res.summary)
    } catch (caught) {
      setError('読み込めませんでした'); setListFailed(true); setListLoadError(caught)
    }
  }, [q])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void load().finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [load])

  // ダッシュボード（★V6 37-2）の「要対応」から ?status= 付きで来たときの初期絞り込み。
  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get('status') ?? ''
    if (STATUS_FILTERS.some((f) => f.key === status)) setFilter(status)
  }, [])

  const visible = rows.filter((row) => {
    if (!filter) return true
    if (filter === 'trialing') return row.plan_status === 'trialing'
    if (filter === 'past_due') return row.plan_status === 'past_due'
    // 「契約中」＝請求契約が生きているもの（active＋決済失敗）。請求が解約・
    // 課金対象外のものは入れない（監査 R153）。決済失敗は行の札で分かる。
    if (filter === 'active') return row.plan_status === 'active' || row.plan_status === 'past_due'
    return row.status === filter
  })

  const impersonate = async (tenant: OpsTenantRow) => {
    setBusyId(tenant.id)
    const res = await opsCall(api.ops.impersonation.start(tenant.id))
    setBusyId(null)
    if (!res.success) { setError(res.error || '代理ログインを始められませんでした'); return }
    // 契約先の統括コンソールへ。帯は AppShell が出す。
    window.location.assign('/hq')
  }

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

  return (
    <ReadonlyDesignNode node="XWtYC"><div data-design-node="X9f5jy" className="v8-ro-ops-page v8-ro-ops-tenants flex flex-col gap-4">
      {/* カード同士の縦の間隔はこの親の gap-4（16px）だけで作る。子ごとの mb/mt は付けない。 */}
      <OpsPageHeader title="契約先アカウント" />

      <div className="v8-ro-ops-metrics grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard variant="v6" title="契約中" value={summary ? summary.active : null} unit="社" detail="" help="請求が生きている契約先（決済失敗を含む）" loading={loading && !summary} />
        <KpiCard variant="v6" title="トライアル中" value={summary ? summary.trialing : null} unit="社" detail="期限切れ前に案内" loading={loading && !summary} />
        <KpiCard variant="v6" title="停止中" value={summary ? summary.suspended : null} unit="社" detail="" help="運営が止めた契約先です" badge={summary?.suspended ? '確認' : undefined} badgeTone="warning" loading={loading && !summary} />
        <KpiCard variant="v6" title="決済失敗" value={summary ? summary.pastDue : null} unit="社" detail="Stripe で支払いが止まっている" badge={summary?.pastDue ? '要対応' : undefined} badgeTone="danger" loading={loading && !summary} />
      </div>

      <div>
        <NoteBar tone="info">契約先を選ぶと詳細が開きます。代理ログインは既定で閲覧のみです。</NoteBar>
      </div>

      {/*
        作る操作は数字のカードの下・一覧のすぐ上の左にそろえる。
        探す・絞り込むも一覧の操作なので同じ並びへ。
      */}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={() => { setCreateError(''); setCreating(true) }}>
          ＋ 契約先を作る
        </Button>
        <div className="w-full max-w-md">
          <SearchField
            value={q}
            onChange={setQ}
            onClear={() => setQ('')}
            placeholder="統括名・メール・店舗名・LINEアカウント名で探す"
            aria-label="契約先を探す"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <FilterChip key={f.key} selected={filter === f.key} onChange={(selected) => setFilter(selected ? f.key : '')}>
              {f.label}
            </FilterChip>
          ))}
        </div>
      </div>

      <Dialog
        open={creating}
        title="契約先を作る"
        confirmLabel="作る"
        cancelLabel="キャンセル"
        confirmIcon={<Plus size={16} aria-hidden="true" />}
        busy={createBusy}
        error={createError || undefined}
        designNode="i0FTN"
        onConfirm={() => void create()}
        onCancel={closeCreate}
      >
        <div className="flex flex-col gap-4">
          <label className="block">
            <span className="mb-1.5 block text-caption font-medium text-ink">統括名（会社名）</span>
            <TextField
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="株式会社 然"
              maxLength={100}
              aria-label="統括名（会社名）"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-caption font-medium text-ink">飲食店機能</span>
            <Select
              aria-label="飲食店機能"
              value={newRestaurant ? 'use' : 'skip'}
              onChange={(value) => setNewRestaurant(value === 'use')}
              size="full"
              options={[
                { value: 'skip', label: '使わない' },
                { value: 'use', label: '使う' },
              ]}
            />
          </label>
          <p className="text-caption text-ink-secondary">作ると、統括の最初の権限者へ招待を送れるようになります。プランは契約先の詳細で決めます。</p>
        </div>
      </Dialog>

      {/*
        ★V7：一覧の失敗は一覧の場所の1枚で出すので、ここでは操作の知らせだけ出す。
      */}
      {error && !listFailed ? <p role="alert" className="mb-3 text-caption text-danger">{error}</p> : null}

      {loading ? (
        <ListState kind="loading" title="契約先を読み込んでいます" />
      ) : error && visible.length === 0 ? (
        // 「1件も無い」と「読み込めなかった」を言い分ける。失敗時は空の案内ではなくエラーと再読み込みを出す。
        <ListState kind="error" title="契約先を表示できませんでした" description={loadDescription(listLoadError)} error={listLoadError ?? undefined} onRetry={() => void load()} />
      ) : visible.length === 0 ? (
        <div className="bg-canvas rounded-card border-hairline border">
          <ListState kind="empty" title="該当する契約先がありません" description="検索の言葉や絞り込みを変えてください。" />
        </div>
      ) : (
        <DataTable>
          <thead>
            <TableHeadRow>
              {/* 列幅は画面が決める（部品は幅を持たない）。1,440px 幅で操作列まで収まるよう、日付系は狭く。 */}
              <Th>統括名</Th>
              <Th className="w-28">プラン</Th>
              <Th className="w-40 tenants-use-col">利用 / 請求</Th>
              <Th className="w-28">契約日</Th>
              <Th className="w-28">期限</Th>
              <Th className="w-16" align="right">店舗</Th>
              <Th className="w-16" align="right">権限者</Th>
              <Th className="w-36">最終ログイン</Th>
              {/* 「代理ログイン」（5文字）が w-28 では右端で切れる。操作列は入る幅で固定する。 */}
              {/* 代理ログインボタンが列からはみ出さない幅にする。 */}
                <Th className="w-36 tenants-op-col" align="right">操作</Th>
            </TableHeadRow>
          </thead>
          <tbody>
            {visible.map((row) => (
              <Tr key={row.id}>
                <Td>
                  <Link href={tenantDetailHref(row.id)} className="block truncate text-label font-medium text-ink hover:underline" title={row.name}>{row.name}</Link>
                  <span className="mt-1 block truncate text-caption text-ink-faint">{row.featurePacks.length ? row.featurePacks.join('・') : ' '}</span>
                </Td>
                <Td><span className="text-label text-ink-secondary">{planLabel(row.plan_key)}</span></Td>
                <Td><span className="inline-flex flex-wrap items-center gap-1">{tenantUseStatusChip(row.status)}{planStatusChip(row.plan_status)}</span></Td>
                <Td><span className="text-caption text-ink-secondary">{formatDate(row.created_at)}</span></Td>
                <Td>
                  {row.trial_ends_at
                    ? <span className="text-caption font-medium text-status-warn-deep">{formatDate(row.trial_ends_at)}</span>
                    : <span className="text-caption text-ink-faint">—</span>}
                </Td>
                <Td align="right"><span className="text-label text-ink">{row.account_count}</span></Td>
                <Td align="right"><span className="text-label text-ink">{row.staff_count}</span></Td>
                <Td><span className="text-caption text-ink-secondary">{formatDateTime(row.last_login_at)}</span></Td>
                <Td align="right">
                  {/* 「詳細」は統括名のリンクと重複するので置かない。操作は代理ログインだけ。 */}
                  <Button size="field" onClick={() => void impersonate(row)} disabled={busyId === row.id || row.status === 'archived'}>
                    代理ログイン
                  </Button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
      )}
      {!loading && visible.length > 0 ? <p className="mt-2"><Chip tone="neutral">{visible.length} 件</Chip></p> : null}
    </div></ReadonlyDesignNode>
  )
}
