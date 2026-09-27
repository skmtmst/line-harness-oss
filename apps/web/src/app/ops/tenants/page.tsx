'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, type OpsTenantRow, type OpsTenantSummary } from '@/lib/api'
import OpsPageHeader from '@/components/ops/ops-page-header'
import { formatDate, formatDateTime, planLabel, tenantDetailHref, tenantStatusChip, opsCall } from '@/components/ops/ops-ui'
import Button from '@/components/shared/button'
import Chip from '@/components/shared/chip'
import FilterChip from '@/components/shared/filter-chip'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import SearchField from '@/components/shared/search-field'
import KpiCard from '@/components/shared/kpi-card'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { TextField } from '@/components/shared/text-field'

/** 契約先アカウント（一覧）。★V6 37-3 `X9f5jy`。 */

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
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError('')
    setListFailed(false)
    const res = await opsCall(api.ops.tenants({ q: q.trim() || undefined }))
    if (!res.success) { setError(res.error || '読み込めませんでした'); setListFailed(true); return }
    setRows(res.data)
    setSummary(res.summary)
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
    if (filter === 'active') return row.status === 'active' && row.plan_status !== 'trialing'
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

  const create = async (event: FormEvent) => {
    event.preventDefault()
    if (!newName.trim()) return
    const res = await opsCall(api.ops.createTenant(newName.trim()))
    if (!res.success) { setError(res.error || '作成できませんでした'); return }
    setNewName('')
    setCreating(false)
    router.push(tenantDetailHref(res.data.id))
  }

  return (
    <div data-design-node="X9f5jy">
      <OpsPageHeader title="契約先アカウント" />

      <div className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard variant="v6" title="契約中" value={summary ? summary.active : null} unit="社" detail="" help="トライアルを除きます" loading={loading && !summary} />
        <KpiCard variant="v6" title="トライアル中" value={summary ? summary.trialing : null} unit="社" detail="期限切れ前に案内" loading={loading && !summary} />
        <KpiCard variant="v6" title="停止中" value={summary ? summary.suspended : null} unit="社" detail="" help="運営が止めた契約先です" badge={summary?.suspended ? '確認' : undefined} badgeTone="warning" loading={loading && !summary} />
        <KpiCard variant="v6" title="決済失敗" value={summary ? summary.pastDue : null} unit="社" detail="Stripe で支払いが止まっている" badge={summary?.pastDue ? '要対応' : undefined} badgeTone="danger" loading={loading && !summary} />
      </div>

      <div className="mb-4">
        <NoteBar tone="info">契約先を選ぶと詳細が開きます。代理ログインは既定で閲覧のみです。</NoteBar>
      </div>

      {/*
        作る操作は数字のカードの下・一覧のすぐ上の左にそろえる。
        探す・絞り込むも一覧の操作なので同じ並びへ。
      */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={() => setCreating((v) => !v)}>
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

      {creating ? (
        <form onSubmit={(event) => void create(event)} className="mb-4 flex items-center gap-2 rounded-card border border-hairline bg-canvas px-4 py-3">
          <div className="flex-1">
            <TextField
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="統括名（会社名）"
              maxLength={100}
              aria-label="統括名"
            />
          </div>
          <Button type="submit" variant="primary">作成する</Button>
          <Button onClick={() => setCreating(false)}>やめる</Button>
        </form>
      ) : null}

      {/*
        ★V7：一覧の失敗は一覧の場所の1枚で出すので、ここでは操作の知らせだけ出す。
      */}
      {error && !listFailed ? <p role="alert" className="mb-3 text-caption text-danger">{error}</p> : null}

      {loading ? (
        <ListState kind="loading" title="契約先を読み込んでいます" />
      ) : error && visible.length === 0 ? (
        // 「1件も無い」と「読み込めなかった」を言い分ける。失敗時は空の案内ではなくエラーと再読み込みを出す。
        <ListState kind="error" title="契約先を表示できませんでした" onRetry={() => void load()} />
      ) : visible.length === 0 ? (
        <ListState kind="empty" title="該当する契約先がありません" description="検索の言葉や絞り込みを変えてください。" />
      ) : (
        <DataTable>
          <thead>
            <TableHeadRow>
              {/* 列幅は画面が決める（部品は幅を持たない）。1,440px 幅で操作列まで収まるよう、日付系は狭く。 */}
              <Th>統括名</Th>
              <Th className="w-28">プラン</Th>
              <Th className="w-24">状態</Th>
              <Th className="w-28">契約日</Th>
              <Th className="w-28">期限</Th>
              <Th className="w-16" align="right">店舗</Th>
              <Th className="w-16" align="right">権限者</Th>
              <Th className="w-36">最終ログイン</Th>
              {/* 「代理ログイン」（5文字）が w-28 では右端で切れる。操作列は入る幅で固定する。 */}
              {/* 代理ログインボタンが列からはみ出さない幅にする。 */}
                <Th className="w-36" align="right">操作</Th>
            </TableHeadRow>
          </thead>
          <tbody>
            {visible.map((row) => (
              <Tr key={row.id}>
                <Td>
                  <Link href={tenantDetailHref(row.id)} className="block truncate text-label font-bold text-ink hover:underline" title={row.name}>{row.name}</Link>
                  <span className="mt-1 block truncate text-caption text-ink-faint">{row.featurePacks.length ? row.featurePacks.join('・') : ' '}</span>
                </Td>
                <Td><span className="text-label text-ink-secondary">{planLabel(row.plan_key)}</span></Td>
                <Td>{tenantStatusChip(row.status, row.plan_status)}</Td>
                <Td><span className="text-caption text-ink-secondary">{formatDate(row.created_at)}</span></Td>
                <Td>
                  {row.trial_ends_at
                    ? <span className="text-caption font-bold text-status-warn-deep">{formatDate(row.trial_ends_at)}</span>
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
    </div>
  )
}
