'use client'

import { ChevronLeft, Eye } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useState, type ReactNode } from 'react'
import { api, type OpsTenantDetail } from '@/lib/api'
import OpsPageHeader from '@/components/ops/ops-page-header'
import {
  PLAN_STATUS_LABEL,
  ROLE_LABEL,
  auditActionChip,
  formatDate,
  formatDateTime,
  planLabel,
  tenantStatusChip,
  opsCall,
} from '@/components/ops/ops-ui'
import Button from '@/components/shared/button'
import Card, { CardHeader } from '@/components/shared/card'
import Chip from '@/components/shared/chip'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import TargetMissing from '@/components/shared/target-missing'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { Tabs } from '@/components/shared/tabs'
import { TextArea, TextField } from '@/components/shared/text-field'
import { RequiredBadge } from '@/components/shared/form-controls'

/**
 * 契約先アカウント詳細。★V6 37-4 `vhwld`。第 1 段は 概要／店舗／権限者／監査 のタブ。
 *
 * 静的書き出し（`next export`）では動的セグメント `[id]` を書き出せないので、
 * ほかの詳細画面と同じく `/ops/tenants/detail?id=…` で受ける。
 */

const TABS = [
  { key: 'overview', label: '概要' },
  { key: 'accounts', label: '店舗' },
  { key: 'members', label: '権限者' },
  { key: 'audit', label: '監査' },
] as const
type TabKey = (typeof TABS)[number]['key']
type StatusTarget = 'suspended' | 'archived' | 'active'

export default function OpsTenantDetailPage() {
  return (
    <Suspense fallback={<ListState kind="loading" title="契約先を読み込んでいます" />}>
      <OpsTenantDetailContent />
    </Suspense>
  )
}

function OpsTenantDetailContent() {
  const searchParams = useSearchParams()
  const id = searchParams.get('id') ?? ''
  const [detail, setDetail] = useState<OpsTenantDetail | null>(null)
  const [tab, setTab] = useState<TabKey>('overview')
  const [error, setError] = useState('')
  const [statusDialog, setStatusDialog] = useState<StatusTarget | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!id) { setError('契約先が指定されていません'); return }
    const res = await opsCall(api.ops.tenant(id))
    if (!res.success) { setError(res.error || '読み込めませんでした'); return }
    setDetail(res.data)
  }, [id])

  useEffect(() => { void load() }, [load])

  const impersonate = async () => {
    if (!detail) return
    setBusy(true)
    const res = await opsCall(api.ops.impersonation.start(detail.tenant.id))
    setBusy(false)
    if (!res.success) { setError(res.error || '代理ログインを始められませんでした'); return }
    window.location.assign('/hq')
  }

  /*
   * `?id=` なしで開くのは失敗ではないので、赤いエラーではなく
   * ★V7「開き先がない」で一覧へ戻して選び直させる。
   */
  if (!id) {
    return (
      <div data-design-node="vhwld">
        <TargetMissing
          kind="unspecified"
          title="見る契約先が指定されていません"
          description="契約先アカウントの一覧から、見る契約先を選び直してください。"
          backHref="/ops/tenants"
          backLabel="契約先の一覧へ戻る"
        />
      </div>
    )
  }

  if (!detail) {
    return (
      <div data-design-node="vhwld">
        <OpsPageHeader title="契約先アカウント" actions={<BackToList />} />
        {error
          ? <ListState kind="error" title="契約先を表示できませんでした" description={error} onRetry={() => void load()} />
          : <ListState kind="loading" title="契約先を読み込んでいます" />}
      </div>
    )
  }

  const { tenant, accounts, members, audit } = detail

  return (
    <div data-design-node="vhwld">
      <OpsPageHeader title="契約先アカウント" actions={<BackToList />} />

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <h2 className="text-heading font-bold text-ink">{tenant.name}</h2>
        {tenant.plan_key ? <Chip tone="info">{planLabel(tenant.plan_key)}</Chip> : null}
        {tenantStatusChip(tenant.status, tenant.plan_status)}
        <div className="flex-1" />
        <Button onClick={() => void impersonate()} disabled={busy || tenant.status === 'archived'}>
          <Eye aria-hidden="true" className="h-4 w-4" />
          代理ログイン
        </Button>
        {tenant.status === 'active' ? (
          <>
            <Button onClick={() => setStatusDialog('suspended')}>停止</Button>
            <Button onClick={() => setStatusDialog('archived')}>アーカイブ</Button>
          </>
        ) : (
          <Button onClick={() => setStatusDialog('active')}>再開</Button>
        )}
      </div>

      {error ? <p role="alert" className="mb-3 text-caption text-status-danger">{error}</p> : null}

      <div className="mb-4">
        <Tabs items={TABS.map((t) => ({ label: t.label, current: tab === t.key, onClick: () => setTab(t.key) }))} />
      </div>

      {tab === 'overview' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="契約先の情報" />
            <dl className="flex flex-col gap-3">
              <Kv k="統括名" v={tenant.name} />
              <Kv k="登録日" v={formatDate(tenant.created_at)} />
              <Kv k="店舗数" v={String(accounts.filter((a) => !a.archived_at).length)} />
              <Kv k="権限者数" v={String(members.filter((m) => m.is_active).length)} />
              <Kv k="最終ログイン" v={formatDateTime(tenant.last_login_at)} />
              <Kv k="機能パック" v={tenant.featurePacks.length ? tenant.featurePacks.join('・') : '—'} />
            </dl>
          </Card>
          <Card>
            <CardHeader title="契約の状況" />
            <dl className="flex flex-col gap-3">
              <Kv k="プラン" v={planLabel(tenant.plan_key)} />
              <Kv k="状態" v={PLAN_STATUS_LABEL[tenant.plan_status] ?? tenant.plan_status} />
              <Kv k="次回の請求日" v={formatDate(tenant.current_period_ends_at)} />
              <Kv k="トライアル" v={tenant.trial_ends_at ? `${formatDate(tenant.trial_ends_at)} まで` : '—'} />
              <Kv k="請求の詳細" v="Stripe の管理画面で確認します" tone="info" />
            </dl>
          </Card>
        </div>
      ) : null}

      {tab === 'accounts' ? (
        accounts.length === 0 ? <ListState kind="empty" title="店舗がありません" description="この契約先にはまだ LINE 公式アカウントがつながっていません。" /> : (
          <DataTable>
            <thead>
              <TableHeadRow>
                <Th>店舗（LINE公式アカウント）</Th>
                <Th className="w-28" align="right">友だち数</Th>
                <Th className="w-36">接続状態</Th>
                <Th className="w-40">最終更新</Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <Tr key={a.id}>
                  <Td><span className="block truncate text-label font-bold text-ink" title={a.name}>{a.name}</span></Td>
                  <Td align="right"><span className="text-label text-ink">{a.friend_count.toLocaleString()}</span></Td>
                  <Td>{a.archived_at ? <Chip tone="neutral">アーカイブ</Chip> : a.is_active ? <Chip tone="ok">接続中</Chip> : <Chip tone="danger">停止</Chip>}</Td>
                  <Td><span className="text-caption text-ink-secondary">{formatDateTime(a.updated_at)}</span></Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        )
      ) : null}

      {tab === 'members' ? (
        members.length === 0 ? <ListState kind="empty" title="権限者がいません" description="この契約先にはまだ権限者が登録されていません。" /> : (
          <DataTable>
            <thead>
              <TableHeadRow>
                <Th className="w-64">名前</Th>
                <Th className="w-72">メール</Th>
                <Th className="w-28">役割</Th>
                <Th className="w-28">状態</Th>
                <Th className="w-40">最終ログイン</Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {members.map((m) => (
                <Tr key={m.id}>
                  <Td><span className="block truncate text-label font-bold text-ink" title={m.name}>{m.name}</span></Td>
                  <Td><span className="block truncate text-caption text-ink-secondary" title={m.email ?? ''}>{m.email ?? '—'}</span></Td>
                  <Td><span className="text-caption text-ink-secondary">{ROLE_LABEL[m.role] ?? m.role}{m.access_level === 'read_only' ? '（閲覧）' : ''}</span></Td>
                  <Td>{m.is_active ? <Chip tone="ok">有効</Chip> : <Chip tone="neutral">停止</Chip>}</Td>
                  <Td><span className="text-caption text-ink-secondary">{formatDateTime(m.last_login_at)}</span></Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        )
      ) : null}

      {tab === 'audit' ? (
        audit.length === 0 ? <ListState kind="empty" title="運営の操作はまだありません" description="運営がこの契約先に対して行った操作が、ここに残ります。" /> : (
          <DataTable>
            <thead>
              <TableHeadRow>
                <Th className="w-40">日時</Th>
                <Th className="w-40">運営者</Th>
                <Th className="w-56">操作</Th>
                <Th>理由</Th>
                <Th className="w-32">契約先に表示</Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {audit.map((row) => (
                <Tr key={row.id}>
                  <Td><span className="text-caption text-ink-secondary">{formatDateTime(row.created_at)}</span></Td>
                  <Td><span className="block truncate text-caption font-bold text-ink">{row.staff_name}</span></Td>
                  <Td>{auditActionChip(row.action)}</Td>
                  <Td><span className="block truncate text-caption text-ink-secondary" title={row.reason ?? ''}>{row.reason ?? '—'}</span></Td>
                  <Td><span className="text-caption text-ink-faint">{row.visible_to_tenant ? '表示する' : '運営のみ'}</span></Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        )
      ) : null}

      {statusDialog ? (
        <StatusDialog
          tenantId={tenant.id}
          target={statusDialog}
          tenantName={tenant.name}
          onClose={() => setStatusDialog(null)}
          onDone={() => { setStatusDialog(null); void load() }}
        />
      ) : null}
    </div>
  )
}

function BackToList() {
  return (
    <Button href="/ops/tenants" size="field">
      <ChevronLeft aria-hidden="true" className="h-4 w-4" />
      一覧へ
    </Button>
  )
}

function Kv({ k, v, tone }: { k: string; v: ReactNode; tone?: 'info' }) {
  return (
    <div className="flex items-center gap-3">
      <dt className="w-36 shrink-0 text-caption font-semibold text-ink-faint">{k}</dt>
      <dd className={tone === 'info' ? 'text-label text-status-info' : 'text-label text-ink'}>{v}</dd>
    </div>
  )
}

/** 停止・アーカイブ・再開の確認。停止とアーカイブは契約先の名前を手で入力させる。 */
function StatusDialog({ tenantId, target, tenantName, onClose, onDone }: { tenantId: string; target: StatusTarget; tenantName: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [confirmName, setConfirmName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const label = target === 'suspended' ? '停止する' : target === 'archived' ? 'アーカイブする' : '再開する'
  const needsName = target !== 'active'
  const ready = reason.trim().length >= 4 && (!needsName || confirmName === tenantName)

  const submit = async () => {
    if (!ready || busy) return
    setBusy(true)
    setError('')
    const res = await opsCall(api.ops.changeTenantStatus(tenantId, { status: target, reason: reason.trim(), confirmName: needsName ? confirmName : undefined }))
    setBusy(false)
    if (!res.success) { setError(res.error || '変更できませんでした'); return }
    onDone()
  }

  return (
    <ConfirmDialog
      open
      title={`${tenantName} を${label}`}
      description={
        target === 'suspended'
          ? '停止すると、この契約先の権限者はログインできなくなります。'
          : target === 'archived'
            ? 'アーカイブすると一覧から外れます。データは消えません。'
            : '再開すると、権限者がまたログインできるようになります。'
      }
      confirmLabel={label}
      destructive={needsName}
      busy={busy}
      error={error}
      onConfirm={ready ? () => void submit() : undefined}
      onCancel={onClose}
    >
      <div className="flex flex-col gap-4">
        {needsName ? (
          <label className="block">
            <span className="mb-1.5 block text-caption font-bold text-ink">確認のため、契約先の名前をそのまま入力</span>
            <TextField value={confirmName} onChange={(event) => setConfirmName(event.target.value)} placeholder={tenantName} />
          </label>
        ) : null}
        <label className="block">
          <span className="mb-1.5 block text-caption font-bold text-ink">理由<RequiredBadge /><span className="font-normal text-ink-faint">（4文字以上）</span></span>
          <TextArea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} />
        </label>
      </div>
    </ConfirmDialog>
  )
}
