'use client'

import { ChevronLeft, LogIn } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useState, type ReactNode } from 'react'
import { api, type OpsTenantDetail } from '@/lib/api'
import { AUDIT_ACTION_LABEL, PLAN_STATUS_LABEL, ROLE_LABEL, formatDate, formatDateTime, planLabel, opsCall } from '@/components/ops/ops-ui'
import { opsEnvironmentLabel } from '@/components/ops/ops-env-bar'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import StatusBadge from '@/components/shared/status-badge'
import TargetMissing from '@/components/shared/target-missing'
import { Tabs } from '@/components/shared/tabs'
import { TextField } from '@/components/shared/text-field'
import Toggle from '@/components/shared/toggle'
import { formatNumber } from '@/lib/format'
import { OpsHead } from './shell'
import { useOpsReadOnly } from './use-ops-read-only'
import parts from './parts.module.css'
import styles from './tenant-detail.module.css'

/**
 * 運営の契約先の詳細 V8（絵 `Oub6x`・停止の窓 `okXoi`）。
 *
 * 動きは v7（app/ops/tenants/detail）と同じ口：`?id=` で /api/ops/tenants/:id を読む。
 * 代理ログイン（閲覧のみ・確認つき）・停止・アーカイブ・再開（名前と理由の確認つき）・
 * 飲食店機能の入り切り。閲覧のみの運営メンバーには、状態を変えるボタンとスイッチを出さない。
 */

const TABS = [
  { key: 'overview', label: '概要' },
  { key: 'accounts', label: '店舗' },
  { key: 'members', label: '権限者' },
  { key: 'audit', label: '監査' },
] as const
type TabKey = (typeof TABS)[number]['key']
type StatusTarget = 'suspended' | 'archived' | 'active'

const AUDIT_WORD: Record<string, string> = {
  'impersonation.start': '代理ログイン（閲覧）',
  'impersonation.write': '代理ログイン（書き込み）',
  'pii.reveal': '個人情報の表示',
  'tenant.status.change': '契約先の停止',
}

function shortDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const full = formatDateTime(value)
  const m = full.match(/^(\d+)-(\d+)-(\d+) (\d+:\d+)$/)
  return m ? `${Number(m[2])}/${Number(m[3])} ${m[4]}` : full
}

export default function OpsTenantDetailV8() {
  return (
    <Suspense fallback={<ListState kind="loading" title="契約先を読み込んでいます" />}>
      <DetailContent />
    </Suspense>
  )
}

function DetailContent() {
  const searchParams = useSearchParams()
  const id = searchParams.get('id') ?? ''
  const [detail, setDetail] = useState<OpsTenantDetail | null>(null)
  const [tab, setTab] = useState<TabKey>('overview')
  const [error, setError] = useState('')
  const [statusDialog, setStatusDialog] = useState<StatusTarget | null>(null)
  const [busy, setBusy] = useState(false)
  const [impersonateConfirm, setImpersonateConfirm] = useState(false)
  const readOnly = useOpsReadOnly()

  const load = useCallback(async () => {
    if (!id) { setError('契約先が指定されていません'); return }
    const res = await opsCall(api.ops.tenant(id))
    if (!res.success) { setError(res.error || '読み込めませんでした'); return }
    setDetail(res.data)
  }, [id])

  useEffect(() => { void load() }, [load])

  const impersonate = async () => {
    if (!detail || busy) return
    setBusy(true)
    const res = await opsCall(api.ops.impersonation.start(detail.tenant.id))
    setBusy(false)
    if (!res.success) { setError(res.error || '代理ログインを始められませんでした'); return }
    setImpersonateConfirm(false)
    window.location.assign('/hq')
  }

  const toggleRestaurantFeature = async (next: boolean) => {
    if (!detail || busy) return
    const current = detail.tenant.featurePacks
    const featurePacks = next ? [...new Set([...current, 'restaurant'])] : current.filter((pack) => pack !== 'restaurant')
    setBusy(true)
    const res = await opsCall(api.ops.setTenantFeaturePacks(detail.tenant.id, featurePacks))
    setBusy(false)
    if (!res.success) { setError(res.error || '機能パックを変更できませんでした'); return }
    setError('')
    await load()
  }

  const environment = opsEnvironmentLabel(process.env.NEXT_PUBLIC_API_URL)

  if (!id) {
    return (
      <div data-design-node="Oub6x">
        <TargetMissing kind="unspecified" title="見る契約先が指定されていません" description="契約先アカウントの一覧から、見る契約先を選び直してください。" backHref="/ops/tenants" backLabel="契約先の一覧へ戻る" />
      </div>
    )
  }

  if (!detail) {
    return (
      <div data-design-node="Oub6x">
        <OpsHead title="契約先アカウント" environment={environment} actions={<BackToList />} />
        <div className={parts.panel}>
          {error
            ? <ListState kind="error" title="契約先を表示できませんでした" description={error} onRetry={() => void load()} />
            : <ListState kind="loading" title="契約先を読み込んでいます" />}
        </div>
      </div>
    )
  }

  const { tenant, accounts, members, audit } = detail
  const owner = members.find((m) => m.role === 'owner' && m.email) ?? members.find((m) => m.email)
  const restaurant = tenant.featurePacks.includes('restaurant')
  const billing = tenant.plan_status === 'trialing' && tenant.trial_ends_at
    ? `トライアル（${formatDate(tenant.trial_ends_at)} まで）`
    : `${PLAN_STATUS_LABEL[tenant.plan_status] ?? tenant.plan_status}${tenant.current_period_ends_at ? `・次回 ${formatDate(tenant.current_period_ends_at)}` : ''}`

  return (
    <div data-design-node="Oub6x">
      <OpsHead
        title={tenant.name}
        description={`${planLabel(tenant.plan_key)}・${PLAN_STATUS_LABEL[tenant.plan_status] ?? tenant.plan_status}・${formatDate(tenant.created_at).replace(/-/g, '/')} から`}
        environment={environment}
        actions={(
          <>
            <BackToList />
            {!readOnly && tenant.status === 'active' ? <Button onClick={() => setStatusDialog('archived')}>アーカイブ</Button> : null}
            <Button onClick={() => setImpersonateConfirm(true)} disabled={busy || tenant.status === 'archived'}><LogIn aria-hidden="true" />代理ログイン（閲覧のみ）</Button>
            {readOnly ? null : tenant.status === 'active'
              ? <Button variant="danger" onClick={() => setStatusDialog('suspended')}>停止</Button>
              : <Button onClick={() => setStatusDialog('active')}>再開</Button>}
          </>
        )}
      />
      <div className={parts.stack}>
        {error ? <p role="alert" className={parts.alert}>{error}</p> : null}
        <div className={parts.tabs}>
          <Tabs
            label="契約先の中身"
            items={TABS.map((t) => ({
              label: t.key === 'accounts' ? `店舗 ${accounts.length}` : t.key === 'members' ? `権限者 ${members.length}` : t.label,
              current: tab === t.key,
              onClick: () => setTab(t.key),
            }))}
          />
        </div>

        {tab === 'overview' ? (
          <div className={parts.row}>
            <section className={parts.panel} aria-label="契約先の情報">
              <h3 className={parts.panelTitle}>契約先の情報</h3>
              <dl className={styles.kvs}>
                <Kv k="統括名" v={tenant.name} />
                <Kv k="メール" v={owner ? `${owner.email}（${ROLE_LABEL[owner.role] ?? owner.role}）` : '—'} />
                <Kv k="登録日" v={formatDate(tenant.created_at)} />
                <Kv k="最終ログイン" v={formatDateTime(tenant.last_login_at)} />
              </dl>
            </section>
            <section className={parts.panel} aria-label="契約の状況">
              <h3 className={parts.panelTitle}>契約の状況</h3>
              <dl className={styles.kvs}>
                <Kv k="プラン" v={planLabel(tenant.plan_key)} />
                <Kv k="請求" v={billing} />
                <Kv k="使用量" v={`店舗 ${accounts.filter((a) => !a.archived_at).length}・権限者 ${members.filter((m) => m.is_active).length}・請求の詳細は Stripe`} />
                <Kv
                  k="飲食店機能"
                  v={readOnly ? (restaurant ? '使う' : '使わない') : (
                    <span className={styles.toggleRow}>
                      <span>{restaurant ? '使う' : '使わない'}</span>
                      <Toggle checked={restaurant} label={`飲食店機能を${restaurant ? 'オフ' : 'オン'}にする`} onChange={(next) => void toggleRestaurantFeature(next)} />
                    </span>
                  )}
                />
              </dl>
            </section>
          </div>
        ) : null}

        {tab === 'accounts' || tab === 'overview' ? (
          <section className={parts.panel} aria-label="店舗（LINE公式アカウント）">
            <h3 className={parts.panelTitle}>店舗（LINE公式アカウント）</h3>
            {accounts.length === 0 ? (
              <ListState kind="empty" title="店舗がありません" description="この契約先にはまだ LINE 公式アカウントがつながっていません。" />
            ) : (
              <div className={parts.mini} role="table" aria-label="店舗">
                <div className={parts.miniHead} role="row">
                  <span className={parts.grow} role="columnheader">名前</span>
                  <span className={`${parts.fixed} ${styles.col90}`} role="columnheader">接続状態</span>
                  <span className={`${parts.num} ${styles.col80}`} role="columnheader">友だち数</span>
                  <span className={`${parts.fixed} ${styles.col80}`} role="columnheader">状態</span>
                </div>
                {accounts.map((a) => (
                  <div key={a.id} className={`${parts.miniRow} ${styles.accountRow}`} role="row">
                    <span className={parts.grow} role="cell" title={a.name}>{a.name}</span>
                    <span className={`${parts.fixed} ${styles.col90}`} role="cell">{a.archived_at || !a.is_active ? <StatusBadge tone="neutral">止めている</StatusBadge> : <StatusBadge tone="success">接続中</StatusBadge>}</span>
                    <span className={`${parts.num} ${styles.col80}`} role="cell">{a.archived_at ? '—' : formatNumber(a.friend_count)}</span>
                    <span className={`${parts.fixed} ${styles.col80}`} role="cell">{a.archived_at ? <StatusBadge tone="neutral">アーカイブ</StatusBadge> : a.is_active ? <StatusBadge tone="success">有効</StatusBadge> : <StatusBadge tone="neutral">停止</StatusBadge>}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {tab === 'members' ? (
          <section className={parts.panel} aria-label="権限者">
            <h3 className={parts.panelTitle}>権限者</h3>
            {members.length === 0 ? (
              <ListState kind="empty" title="権限者がいません" description="この契約先にはまだ権限者が登録されていません。" />
            ) : (
              <div className={parts.mini} role="table" aria-label="権限者">
                <div className={parts.miniHead} role="row">
                  <span className={parts.grow} role="columnheader">名前</span>
                  <span className={`${parts.fixed} ${styles.colMail}`} role="columnheader">メール</span>
                  <span className={`${parts.fixed} ${styles.col90}`} role="columnheader">役割</span>
                  <span className={`${parts.fixed} ${styles.col80}`} role="columnheader">状態</span>
                  <span className={`${parts.fixed} ${styles.colAt}`} role="columnheader">最終ログイン</span>
                </div>
                {members.map((m) => (
                  <div key={m.id} className={parts.miniRow} role="row">
                    <span className={parts.grow} role="cell" title={m.name}>{m.name}</span>
                    <span className={`${parts.fixed} ${styles.colMail}`} role="cell" title={m.email ?? ''}>{m.email ?? '—'}</span>
                    <span className={`${parts.fixed} ${styles.col90}`} role="cell">{ROLE_LABEL[m.role] ?? m.role}{m.access_level === 'read_only' ? '（閲覧）' : ''}</span>
                    <span className={`${parts.fixed} ${styles.col80}`} role="cell">{m.is_active ? <StatusBadge tone="success">有効</StatusBadge> : <StatusBadge tone="neutral">停止</StatusBadge>}</span>
                    <span className={`${parts.fixed} ${styles.colAt}`} role="cell">{shortDateTime(m.last_login_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {tab === 'audit' || tab === 'overview' ? (
          <section className={parts.panel} aria-label="運営の操作（監査）">
            <h3 className={parts.panelTitle}>運営の操作（監査）</h3>
            {audit.length === 0 ? (
              <ListState kind="empty" title="運営の操作はまだありません" description="運営がこの契約先に対して行った操作が、ここに残ります。" />
            ) : (
              <div className={parts.mini} role="table" aria-label="運営の操作">
                <div className={parts.miniHead} role="row">
                  <span className={`${parts.fixed} ${styles.colAt}`} role="columnheader">日時</span>
                  <span className={`${parts.fixed} ${styles.col80}`} role="columnheader">運営者</span>
                  <span className={`${parts.fixed} ${styles.colWhat}`} role="columnheader">操作</span>
                  <span className={parts.grow} role="columnheader">理由</span>
                </div>
                {audit.map((row) => (
                  <div key={row.id} className={parts.miniRow} role="row">
                    <span className={`${parts.fixed} ${styles.colAt}`} role="cell" title={formatDateTime(row.created_at)}>{shortDateTime(row.created_at)}</span>
                    <span className={`${parts.fixed} ${styles.col80}`} role="cell" title={row.staff_name}>{row.staff_name}</span>
                    <span className={`${parts.fixed} ${styles.colWhat}`} role="cell">{AUDIT_WORD[row.action] ?? AUDIT_ACTION_LABEL[row.action]?.label ?? row.action}</span>
                    <span className={parts.grow} role="cell" title={row.reason ?? ''}>{row.reason ?? '—'}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : null}
      </div>

      {statusDialog ? (
        <StatusDialog
          tenantId={tenant.id}
          target={statusDialog}
          tenantName={tenant.name}
          onClose={() => setStatusDialog(null)}
          onDone={() => { setStatusDialog(null); void load() }}
        />
      ) : null}
      {impersonateConfirm ? (
        <ConfirmDialog
          open
          title={`「${tenant.name}」に代理ログインする`}
          description="閲覧のみで始まります。契約先のデータを扱います。操作はすべて記録されます。"
          confirmLabel="代理ログインを始める"
          busy={busy}
          error={error || undefined}
          onConfirm={() => void impersonate()}
          onCancel={() => { if (!busy) setImpersonateConfirm(false) }}
        />
      ) : null}
    </div>
  )
}

function BackToList() {
  return (
    <Button href="/ops/tenants">
      <ChevronLeft aria-hidden="true" />一覧へ
    </Button>
  )
}

function Kv({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className={styles.kv}>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  )
}

/** 停止・アーカイブ・再開（絵 `okXoi`）。名前の打ち直しと4文字以上の理由がそろうまで押せない。 */
function StatusDialog({ tenantId, target, tenantName, onClose, onDone }: { tenantId: string; target: StatusTarget; tenantName: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [confirmName, setConfirmName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const label = target === 'suspended' ? '停止する' : target === 'archived' ? 'アーカイブする' : '再開する'
  const needsName = target !== 'active'
  const ready = reason.trim().length >= 4 && (!needsName || confirmName === tenantName)

  const submit = async () => {
    if (busy) return
    if (!ready) {
      setError(needsName && confirmName !== tenantName ? '契約先の名前をそのまま入力してください' : '理由を4文字以上で入力してください')
      return
    }
    setBusy(true)
    setError('')
    const res = await opsCall(api.ops.changeTenantStatus(tenantId, { status: target, reason: reason.trim(), confirmName: needsName ? confirmName : undefined }))
    setBusy(false)
    if (!res.success) { setError(res.error || '変更できませんでした'); return }
    onDone()
  }

  return (
    <Dialog
      open
      designWidth={540}
      designTop={200}
      title={`${tenantName} を${label}`}
      tone={needsName ? 'destructive' : 'default'}
      confirmation
      confirmLabel={label}
      busy={busy}
      error={error || undefined}
      designNode={target === 'suspended' ? 'okXoi' : undefined}
      onConfirm={() => void submit()}
      onCancel={onClose}
    >
      <div className={parts.dialogBody}>
        <p className={needsName ? styles.dangerNote : parts.dialogNote}>
          {target === 'suspended'
            ? '停止すると、この契約先の権限者はログインできなくなります。配信も止まります。'
            : target === 'archived'
              ? 'アーカイブすると一覧から外れます。データは消えません。'
              : '再開すると、権限者がまたログインできるようになります。'}
        </p>
        {needsName ? (
          <label className={styles.field}>
            <span className={styles.label}>確認のため、契約先の名前をそのまま入力</span>
            <TextField value={confirmName} onChange={(event) => setConfirmName(event.target.value)} placeholder={tenantName} />
          </label>
        ) : null}
        <label className={styles.field}>
          <span className={styles.label}>理由（4文字以上）</span>
          <TextField value={reason} onChange={(event) => setReason(event.target.value)} placeholder="支払いの遅れが3か月続いたため" aria-label="理由（4文字以上）" required />
        </label>
      </div>
    </Dialog>
  )
}
