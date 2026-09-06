'use client'

import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Suspense, useCallback, useEffect, useState } from 'react'
import type { LineAccount } from '@line-crm/shared'
import { api } from '@/lib/api'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Breadcrumb from '@/components/shared/breadcrumb'
import StatusBadge from '@/components/shared/status-badge'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { Tabs } from '@/components/shared/tabs'
import { usePageTitle } from '@/components/shell/page-chrome'
import { connectionLabel, webhookLabel } from '../account-list-view'
import {
  DETAIL_TABS,
  accountActions,
  capacityLabel,
  credentialLabel,
  parentLabel,
  toTab,
} from './account-detail-view'

type AccountDetailView = LineAccount & {
  timezone?: string
  stats?: { friendCount: number; activeScenarios: number; messagesThisMonth: number }
  connection?: {
    lastTestAt: string | null
    lastTestStatus: 'succeeded' | 'failed' | null
    lastReceivedAt: string | null
  }
}

/** 設計 ★V6 33-3（`T9rA9`）。概要 / 接続の確認 / 資格情報 / 乗り換え の 4 タブ。 */
function AccountDetail() {
  /*
    **`[id]` は使えない。** この管理画面は静的書き出し（`output: 'export'`）
    なので、ビルド時に全IDが分からない動的セグメントは書き出せない
    （`route-integrity.test.ts`）。ほかの詳細画面と同じく `?id=` で表す。
  */
  const search = useSearchParams()
  const id = search?.get('id') ?? ''
  const tab = toTab(search?.get('tab') ?? null)

  const [account, setAccount] = useState<AccountDetailView | null>(null)
  const [all, setAll] = useState<LineAccount[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [stopTarget, setStopTarget] = useState<LineAccount | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  const load = useCallback(async () => {
    if (!id) return
    setStatus('loading')
    try {
      const [one, list] = await Promise.all([api.lineAccounts.get(id), api.lineAccounts.list()])
      if (!one.success) { setStatus('error'); return }
      setAccount(one.data)
      if (list.success) setAll(list.data)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [id])

  useEffect(() => { void load() }, [load])
  usePageTitle(account?.name)

  /** 送受信の停止・再開。**何が止まって何が残るかを、押す前に読ませる。** */
  const toggleActive = async () => {
    if (!stopTarget) return
    setBusy(true)
    setActionError('')
    try {
      const res = await api.lineAccounts.update(stopTarget.id, { isActive: !stopTarget.isActive })
      if (!res.success) throw new Error(res.error)
      setStopTarget(null)
      await load()
    } catch {
      setActionError('変えられませんでした。しばらくおいてから、もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  if (status === 'loading') return <ListState kind="loading" />
  if (status === 'error' || !account) {
    return (
      <ListState
        kind="error"
        action={<Button type="button" onClick={() => void load()}>再読み込み</Button>}
      />
    )
  }

  const connection = connectionLabel(account)
  const webhook = webhookLabel(account)

  return (
    <div data-design-node="T9rA9">
      <div data-design="Head" className="mb-4">
        <Breadcrumb items={[{ label: 'LINEアカウント', href: '/accounts' }, { label: account.name }]} />
      </div>

      {/* タブは `?tab=` のまま。共有・再読込・戻るに強い（§2-2）。 */}
      <Tabs
        items={DETAIL_TABS.map((t) => ({
          label: t.label,
          href: `/accounts/detail?id=${account.id}&tab=${t.value}`,
          current: tab === t.value,
        }))}
      />

      {tab === 'overview' && (
        <div className="mt-4 grid gap-4 xl:grid-cols-4">
          <div className="space-y-4 xl:col-span-3">
            <section className="bg-canvas rounded-card border-hairline border p-5">
              <div className="flex items-start justify-between gap-3">
                <p className="text-ink text-base font-bold">登録の内容</p>
                <Button href={`/accounts/detail?id=${account.id}&tab=credentials`}>編集する</Button>
              </div>
              <dl className="mt-3 space-y-2">
                <InlineRow label="表示名" value={account.name} />
                <InlineRow label="チャネルID" value={account.channelId} />
                <InlineRow label="タイムゾーン" value={account.timezone ?? 'Asia/Tokyo'} />
                <InlineRow label="国・地域" value={account.country ?? '未設定'} />
                <InlineRow label="役割メモ" value={account.role ?? '未設定'} />
                <InlineRow label="親アカウント" value={parentLabel(account, all)} />
                <InlineRow
                  label="友だち数"
                  value={account.stats
                    ? `${account.stats.friendCount.toLocaleString('ja-JP')}人（${capacityLabel(account)}）`
                    : `—（${capacityLabel(account)}）`}
                />
                <InlineRow label="状態" value={connection.label} tone={account.isActive ? 'success' : 'muted'} />
              </dl>
            </section>

            <section className="bg-canvas rounded-card border-hairline border p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-ink text-sm font-bold">資格情報</p>
                  <p className="text-ink-secondary mt-1 text-xs">秘密値そのものは表示しません。</p>
                </div>
                <Button href={`/accounts/detail?id=${account.id}&tab=credentials`}>差し替える</Button>
              </div>
              <dl className="mt-3 space-y-2">
                <CredentialRow
                  label="チャネルシークレット"
                  configured={account.channelSecretConfigured}
                  last4={account.channelSecretLast4}
                  updatedAt={account.channelSecretUpdatedAt}
                />
                <CredentialRow
                  label="チャネルアクセストークン"
                  configured={account.channelAccessTokenConfigured}
                  last4={account.channelAccessTokenLast4}
                  updatedAt={account.channelAccessTokenUpdatedAt}
                />
                <CredentialRow
                  label="Loginチャネルシークレット"
                  configured={account.loginChannelSecretConfigured}
                  last4={account.loginChannelSecretLast4}
                  updatedAt={account.loginChannelSecretUpdatedAt}
                />
                <InlineRow
                  label="シークレットの確認"
                  value={account.connection?.lastTestStatus === 'succeeded' && account.connection.lastTestAt
                    ? `確かめました（${formatMonthDay(account.connection.lastTestAt)} の受信で署名が合いました）`
                    : '未取得'}
                  tone={account.connection?.lastTestStatus === 'succeeded' ? 'success' : 'muted'}
                />
              </dl>
              <div className="bg-canvas-sunken rounded-control mt-3 px-3 py-2">
                <p className="text-ink text-xs font-bold">値そのものは、ここにも出しません</p>
                <p className="text-ink-secondary mt-1 text-xs">差し替えるときは、新しい値を入れて保存し直します。今の値を見たり直したりはできません。</p>
              </div>
            </section>

            <section className="bg-canvas rounded-card border-hairline border p-5">
              <p className="text-ink text-sm font-bold">このアカウントでできること</p>
              <div className="mt-3 space-y-2">
                {accountActions(account).map((action) => (
                  <div key={action.key} className="border-hairline rounded-control flex items-center justify-between gap-4 border px-3 py-2">
                    <div>
                      <p className={action.key === 'archive' ? 'text-danger text-sm font-medium' : 'text-ink text-sm font-medium'}>{action.title}</p>
                      <p className="text-ink-secondary mt-1 text-xs leading-relaxed">{action.description}</p>
                      {action.blockedReason && <p className="text-ink-faint mt-1 text-xs leading-relaxed">{action.blockedReason}</p>}
                    </div>
                    {action.blockedReason ? null : action.key === 'handover' ? (
                      <Button href={`/accounts/handover?id=${account.id}`}>{action.actionLabel}</Button>
                    ) : (
                      <Button type="button" onClick={() => setStopTarget(account)}>{action.actionLabel}</Button>
                    )}
                  </div>
                ))}
              </div>
              {actionError && <p role="alert" className="text-danger mt-3 text-xs">{actionError}</p>}
            </section>
          </div>

          <aside className="space-y-4">
            <section className="bg-canvas rounded-card border-hairline border p-5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-ink text-sm font-bold">Webhookの突合</p>
                <StatusBadge tone={webhook.tone}>{webhook.label}</StatusBadge>
              </div>
              <dl className="mt-4 space-y-3">
                <InlineRow label="LINE側に登録したURL" value={webhook.label === '一致・利用中' ? 'このシステムと一致' : webhook.label} tone={webhook.tone === 'success' ? 'success' : 'muted'} />
                <InlineRow label="Webhookの利用" value={account.webhook?.active === null || account.webhook?.active === undefined ? '確かめていません' : account.webhook.active ? 'オン' : 'オフ'} tone={account.webhook?.active ? 'success' : 'muted'} />
                <InlineRow label="最後のテスト" value={account.connection?.lastTestAt ? `${formatMonthDayTime(account.connection.lastTestAt)} に${account.connection.lastTestStatus === 'succeeded' ? '成功' : '失敗'}` : '未取得'} tone={account.connection?.lastTestStatus === 'succeeded' ? 'success' : 'muted'} />
                <InlineRow label="最後の受信" value={account.connection?.lastReceivedAt ? formatMonthDayTime(account.connection.lastReceivedAt) : '未取得'} />
              </dl>
              <p className="text-ink-secondary mt-3 break-all text-xs">{account.webhook?.actualUrl ?? '—'}</p>
              <Button href={`/accounts/detail?id=${account.id}&tab=connection`} className="mt-4">
                いまの状態をもう一度確かめる
              </Button>
            </section>

            <section className="bg-canvas rounded-card border-hairline border p-5">
              <p className="text-ink text-sm font-bold">つながる先</p>
              <ul className="text-ink-secondary mt-3 space-y-3 text-xs">
                <li><Link className="text-action hover:underline" href="/">ダッシュボード</Link><p className="mt-1">友だち追加URLとQRはここに出ます。</p></li>
                <li><Link className="text-action hover:underline" href="/staff">ログインユーザー</Link><p className="mt-1">人ごとの既定のアカウントはここで決めます。</p></li>
                <li><Link className="text-action hover:underline" href="/emergency">運用状態</Link><p className="mt-1">接続の異常や停止は、ここで見張ります。</p></li>
                <li><Link className="text-action hover:underline" href="/friends">友だち</Link><p className="mt-1">このアカウントの友だち{account.stats ? `${account.stats.friendCount.toLocaleString('ja-JP')}人` : 'は未取得'}はここに並びます。</p></li>
              </ul>
            </section>

            <section className="bg-canvas rounded-card border-hairline border p-5">
              <p className="text-ink text-sm font-bold">気をつけること</p>
              <ul className="text-ink-secondary mt-2 space-y-2 text-xs leading-relaxed">
                <li>・停止しても、友だちと履歴は消えません。</li>
                <li>・資格情報を差し替える前に接続を確かめます。</li>
                <li>・アーカイブした記録はあとから戻せます。</li>
              </ul>
            </section>
          </aside>
        </div>
      )}

      {tab === 'connection' && (
        <section className="bg-canvas rounded-card border-hairline mt-4 border p-5">
          <p className="text-ink text-sm font-bold">Webhookの突合</p>
          <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Row label="LINE側に登録したURL" value={account.webhook?.actualUrl ?? '—'} />
            <Row label="このシステムが待っているURL" value={account.webhook?.expectedUrl ?? '—'} />
            <Row
              label="突合の結果"
              value={webhook.label}
            />
            {/*
              **「オン」と書けるのは、返事があったときだけ。**
              `active` が null は「確かめていない」。false と混ぜない。
            */}
            <Row
              label="Webhookの利用"
              value={account.webhook?.active === null || account.webhook?.active === undefined
                ? '確かめていません'
                : account.webhook.active ? 'オン' : 'オフ'}
            />
          </dl>
          <p className="text-ink-faint mt-3 text-xs leading-relaxed">
            最後のテストと最後の受信の記録は、まだ繋がっていません。
          </p>
        </section>
      )}

      {tab === 'credentials' && (
        <section className="bg-canvas rounded-card border-hairline mt-4 border p-5">
          <p className="text-ink text-sm font-bold">資格情報</p>
          <dl className="mt-3 space-y-3">
            <Row label="チャネルシークレット" value={credentialLabel(account.channelSecretConfigured)} />
            <Row label="チャネルアクセストークン" value={credentialLabel(account.channelAccessTokenConfigured)} />
            <Row label="Loginチャネルシークレット" value={credentialLabel(account.loginChannelSecretConfigured)} />
          </dl>
          <p className="text-ink-secondary mt-3 text-xs leading-relaxed">
            値そのものは、ここにも出しません。差し替えるときは、新しい値を入れて保存し直します。
            今の値を見たり直したりはできません。差し替える前に接続を確かめ、通らなければ保存しません。
          </p>
        </section>
      )}

      {tab === 'handover' && (
        <section className="bg-canvas rounded-card border-hairline mt-4 border p-5">
          <p className="text-ink text-sm font-bold">乗り換え</p>
          <p className="text-ink-secondary mt-1 text-xs leading-relaxed">
            別のLINEアカウントへ、友だちと設定を引き継ぎます。事前確認をしてから本実行します。
          </p>
          <Button href={`/accounts/handover?id=${account.id}`} variant="primary" className="mt-3">
            乗り換えを始める
          </Button>
        </section>
      )}

      <ConfirmDialog
        open={stopTarget !== null}
        title={stopTarget?.isActive
          ? `「${stopTarget?.name}」の送受信を止めますか？`
          : `「${stopTarget?.name}」の送受信を再開しますか？`}
        description={stopTarget?.isActive
          ? '止めているあいだ、配信も受信もしません。友だちと履歴はそのまま残ります。予約している配信は止まります。いつでも戻せます。'
          : '再開すると、配信と受信が動き始めます。止めているあいだに予約していた配信は、自動で送り直しません。'}
        confirmLabel={stopTarget?.isActive ? '送受信を止める' : '送受信を再開する'}
        destructive={stopTarget?.isActive}
        busy={busy}
        onCancel={() => { if (!busy) setStopTarget(null) }}
        onConfirm={() => void toggleActive()}
      />
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ink-faint text-xs">{label}</dt>
      <dd className="text-ink mt-0.5 text-sm break-words">{value}</dd>
    </div>
  )
}

function formatMonthDay(value: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric', day: 'numeric', timeZone: 'Asia/Tokyo',
  }).format(new Date(value))
}

function formatMonthDayTime(value: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo',
  }).format(new Date(value))
}

function InlineRow({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'success' | 'muted'
}) {
  return (
    <div
      className="grid min-w-0 gap-3 rounded-control px-3 py-2 odd:bg-canvas-sunken"
      style={{ gridTemplateColumns: '9rem minmax(0, 1fr)' }}
    >
      <dt className="text-ink-faint text-xs">{label}</dt>
      <dd className={tone === 'success'
        ? 'text-success min-w-0 break-words text-sm font-medium'
        : tone === 'muted'
          ? 'text-ink-secondary min-w-0 break-words text-sm'
          : 'text-ink min-w-0 break-words text-sm'}>
        {value}
      </dd>
    </div>
  )
}

function CredentialRow({
  label,
  configured,
  last4,
  updatedAt,
}: {
  label: string
  configured: boolean | undefined
  last4: string | null
  updatedAt: string | null
}) {
  const value = configured
    ? [
      last4 || updatedAt ? '入っています' : credentialLabel(true),
      last4 ? `末尾 ****${last4}` : null,
      updatedAt ? `${formatMonthDay(updatedAt)} 更新` : '更新日は未取得',
    ].filter(Boolean).join(' ・ ')
    : credentialLabel(false)
  return <InlineRow label={label} value={value} tone={configured ? 'success' : 'muted'} />
}

export default function AccountDetailPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <AccountDetail />
    </Suspense>
  )
}
