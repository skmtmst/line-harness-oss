'use client'

import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Suspense, useCallback, useEffect, useState } from 'react'
import type { LineAccount } from '@line-crm/shared'
import { api } from '@/lib/api'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import PageHeader from '@/components/shared/page-header'
import StatusBadge from '@/components/shared/status-badge'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { Tabs } from '@/components/shared/tabs'
import { connectionLabel, webhookLabel } from '../account-list-view'
import {
  DETAIL_TABS,
  accountActions,
  capacityLabel,
  credentialLabel,
  parentLabel,
  toTab,
} from './account-detail-view'

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

  const [account, setAccount] = useState<LineAccount | null>(null)
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
      <PageHeader
        breadcrumb={[{ label: 'LINEアカウント', href: '/accounts' }, { label: account.name }]}
        title={account.name}
        description="登録の内容と接続の状態を確かめ、必要なら差し替えます。"
      />

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
                <div>
                  <p className="text-ink text-sm font-bold">アカウント情報</p>
                  <p className="text-ink-secondary mt-1 text-xs">管理画面で使う表示と所属です。</p>
                </div>
                <Button href={`/accounts/detail?id=${account.id}&tab=credentials`}>編集する</Button>
              </div>
              <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
                <Row label="表示名" value={account.name} />
                <Row label="チャネルID" value={account.channelId} />
                <Row label="接続状態" value={connection.label} />
                <Row label="国・地域" value={account.country ?? '未設定'} />
                <Row label="役割メモ" value={account.role ?? '未設定'} />
                <Row label="親アカウント" value={parentLabel(account, all)} />
                <Row label="友だち数の上限" value={capacityLabel(account)} />
                <Row label="LINE LoginチャネルID" value={account.loginChannelId ?? '未設定'} />
                <Row label="LIFF ID" value={account.liffId ?? '未設定'} />
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
              <dl className="mt-4 grid gap-3 sm:grid-cols-3">
                <CredentialRow
                  label="アクセストークン"
                  configured={account.channelAccessTokenConfigured}
                  last4={account.channelAccessTokenLast4}
                  updatedAt={account.channelAccessTokenUpdatedAt}
                />
                <CredentialRow
                  label="チャネルシークレット"
                  configured={account.channelSecretConfigured}
                  last4={account.channelSecretLast4}
                  updatedAt={account.channelSecretUpdatedAt}
                />
                <CredentialRow
                  label="Loginシークレット"
                  configured={account.loginChannelSecretConfigured}
                  last4={account.loginChannelSecretLast4}
                  updatedAt={account.loginChannelSecretUpdatedAt}
                />
              </dl>
            </section>

            <section className="bg-canvas rounded-card border-hairline border p-5">
              <p className="text-ink text-sm font-bold">このアカウントでできること</p>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                {accountActions(account).map((action) => (
                  <div key={action.key} className="border-hairline rounded-control border p-3">
                    <p className="text-ink text-sm font-medium">{action.title}</p>
                    <p className="text-ink-secondary mt-1 text-xs leading-relaxed">{action.description}</p>
                    {action.blockedReason ? (
                      <p className="text-ink-faint mt-2 text-xs leading-relaxed">{action.blockedReason}</p>
                    ) : action.key === 'handover' ? (
                      <Button href={`/accounts/handover?id=${account.id}`} className="mt-2">
                        {action.actionLabel}
                      </Button>
                    ) : (
                      <Button type="button" className="mt-2" onClick={() => setStopTarget(account)}>
                        {action.actionLabel}
                      </Button>
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
                <Row label="LINE側に登録したURL" value={account.webhook?.actualUrl ?? '—'} />
                <Row label="このシステムが待っているURL" value={account.webhook?.expectedUrl ?? '—'} />
                <Row
                  label="Webhookの利用"
                  value={account.webhook?.active === null || account.webhook?.active === undefined
                    ? '確かめていません'
                    : account.webhook.active ? 'オン' : 'オフ'}
                />
              </dl>
              <Button href={`/accounts/detail?id=${account.id}&tab=connection`} className="mt-4">
                接続を詳しく見る
              </Button>
            </section>

            <section className="bg-canvas rounded-card border-hairline border p-5">
              <p className="text-ink text-sm font-bold">つながる先</p>
              <ul className="text-ink-secondary mt-3 space-y-2 text-xs">
                <li><Link className="text-action hover:underline" href="/">ダッシュボード</Link></li>
                <li><Link className="text-action hover:underline" href="/staff">ログインユーザー</Link></li>
                <li><Link className="text-action hover:underline" href="/emergency">運用状態</Link></li>
                <li><Link className="text-action hover:underline" href="/friends">友だち</Link></li>
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
  const date = updatedAt
    ? new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium' }).format(new Date(updatedAt))
    : '更新日は未取得'
  return (
    <div className="bg-canvas-sunken rounded-control p-3">
      <dt className="text-ink-faint text-xs">{label}</dt>
      <dd className="text-ink mt-1 text-sm font-medium">
        {configured ? (last4 ? `•••• ${last4}` : credentialLabel(true)) : credentialLabel(false)}
      </dd>
      <dd className="text-ink-faint mt-1 text-xs">{date}</dd>
    </div>
  )
}

export default function AccountDetailPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <AccountDetail />
    </Suspense>
  )
}
