'use client'

import '@/app/notifications/readonly-v8.css'
import ReadonlyHeaderV8, { ReadonlyDesignNode } from '@/app/notifications/readonly-header-v8'
import { useAdminTheme } from '@/lib/use-admin-theme'

import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Suspense, useCallback, useEffect, useState } from 'react'
import type { LineAccount } from '@line-crm/shared'
import { api, ApiError, describeSaveFailure } from '@/lib/api'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import ListState from '@/components/shared/list-state'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import TargetMissing from '@/components/shared/target-missing'
import Breadcrumb from '@/components/shared/breadcrumb'
import StatusBadge from '@/components/shared/status-badge'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { TextArea } from '@/components/shared/form-controls'
import { TextField } from '@/components/shared/text-field'
import StepUpPrompt, { isStepUpRequired, type StepUpRequest } from '@/components/step-up-prompt'
import TestRecipientsSetting from '@/components/accounts/test-recipients-setting'
import AccountEditModal from '@/components/accounts/account-edit-modal'
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
import { formatDateTime, formatDay, formatNumber } from '@/lib/format'

type AccountDetailView = LineAccount & {
  timezone?: string
  stats?: { friendCount: number; activeScenarios: number; messagesThisMonth: number }
}

/** 設計 ★V6 33-3（`T9rA9`）。概要 / 接続の確認 / 資格情報 / 乗り換え の 4 タブ。 */
function AccountDetail() {
  const theme = useAdminTheme()
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
  // R521: 親名称用の一覧は補助データ。本人の取得と切り離し、取れなくても詳細は出す。
  const [allState, setAllState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  /** 404・空で見つからないとき。取得の失敗（error）とは分ける。 */
  const [missing, setMissing] = useState(false)
  const [stopTarget, setStopTarget] = useState<LineAccount | null>(null)
  const [stopReason, setStopReason] = useState('')
  const [archiveTarget, setArchiveTarget] = useState<LineAccount | null>(null)
  const [archiveReason, setArchiveReason] = useState('')
  const [restoreTarget, setRestoreTarget] = useState<LineAccount | null>(null)
  const [stepUp, setStepUp] = useState<StepUpRequest | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  /**
   * R73。「編集する」「差し替える」は、入力欄も保存操作も無い資格情報タブへ
   * 飛ばすだけだった。既存の編集窓（PATCH/PUT 振り分け・本人確認つき）を
   * ここから開く。`null` は閉じている状態。
   */
  const [editSection, setEditSection] = useState<null | 'basic' | 'credentials'>(null)
  /** 保存口は統括・管理者だけ。運用担当には入力の入口を見せない。 */
  const [canManage, setCanManage] = useState(false)
  /** ダイアログ内のエラー（必須漏れ・接続失敗など）。窓を閉じずに見せる。 */
  const [dialogError, setDialogError] = useState('')
  /** 止めている間に送らなかった配信の一覧（X-1）。 */
  const [skippedDeliveries, setSkippedDeliveries] = useState<Array<{
    id: string; kind: string; title: string | null; skippedAt: string
  }> | null>(null)

  // R521: 親名称の一覧だけ失敗しても詳細全体を読めなくしない。ここだけ取り直せる。
  const loadAll = useCallback(async () => {
    setAllState('loading')
    try {
      const list = await api.lineAccounts.list()
      if (!list.success) { setAllState('error'); return }
      setAll(list.data)
      setAllState('ready')
    } catch {
      setAllState('error')
    }
  }, [])

  const load = useCallback(async () => {
    if (!id) return
    setStatus('loading')
    setMissing(false)
    try {
      const one = await api.lineAccounts.get(id)
      if (!one.success) { setStatus('error'); return }
      setAccount(one.data)
      // 止まっているアカウントでは「送らなかった」一覧も読む（X-1）。
      if (!one.data.isActive && !one.data.archivedAt) {
        api.lineAccounts.skippedDeliveries(id)
          .then((res) => { if (res.success) setSkippedDeliveries(res.data) })
          .catch(() => { /* 一覧が読めなくても詳細は使える。 */ })
      } else {
        setSkippedDeliveries(null)
      }
      setStatus('ready')
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) {
        setMissing(true)
        setStatus('ready')
        return
      }
      setStatus('error')
    }
  }, [id])

  useEffect(() => { void load() }, [load])
  useEffect(() => { void loadAll() }, [loadAll])
  useEffect(() => {
    let active = true
    void api.staff.me().then((response) => {
      if (active && response.success) setCanManage(response.data.role === 'owner' || response.data.role === 'admin')
    })
    return () => { active = false }
  }, [])
  usePageTitle(account?.name)

  /**
   * 送受信の停止・再開（X-1）。**理由は必須。**
   * 再開はサーバ側で接続確認をしてから動き出す。
   */
  const toggleActive = async (stepUpToken?: string) => {
    if (!stopTarget) return
    const reason = stopReason.trim()
    if (!reason) {
      setDialogError('理由を入れてください。あとから「なぜ止めたか」を追えるようにします。')
      return
    }
    setBusy(true)
    setActionError('')
    setDialogError('')
    try {
      const res = stopTarget.isActive
        ? await api.lineAccounts.deactivate(stopTarget.id, reason, stepUpToken)
        : await api.lineAccounts.activate(stopTarget.id, reason, stepUpToken)
      if (!res.success) throw new Error(res.error)
      setStopTarget(null)
      setStopReason('')
      await load()
    } catch (caught) {
      // 送受信の停止は大事な操作。本人確認を求められたら窓を立ててやり直す（V-1）。
      if (!stepUpToken && isStepUpRequired(caught)) {
        setStepUp({
          purpose: 'line_account.credentials',
          action: stopTarget.isActive ? 'アカウントの送受信を止める' : 'アカウントの送受信を再開する',
          retry: toggleActive,
        })
        return
      }
      // 接続が通らなくて再開できない等の理由は、APIの言葉をそのまま見せる。
      setDialogError(describeSaveFailure(caught))
    } finally {
      setBusy(false)
    }
  }

  /** アーカイブ（X-1）。止まっている・既定でない・配送が走っていない時だけ。 */
  const runArchive = async (stepUpToken?: string) => {
    if (!archiveTarget) return
    setBusy(true)
    setActionError('')
    setDialogError('')
    try {
      const res = await api.lineAccounts.archive(
        archiveTarget.id, archiveReason.trim() || undefined, stepUpToken)
      if (!res.success) throw new Error(res.error)
      setArchiveTarget(null)
      setArchiveReason('')
      await load()
    } catch (caught) {
      if (!stepUpToken && isStepUpRequired(caught)) {
        setStepUp({
          purpose: 'line_account.archive',
          action: `「${archiveTarget.name}」をアーカイブする`,
          retry: runArchive,
        })
        return
      }
      setDialogError(archiveFailureMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  /** アーカイブから戻す（X-1）。戻った直後は「止まっている」状態。 */
  const runRestore = async (stepUpToken?: string) => {
    if (!restoreTarget) return
    setBusy(true)
    setActionError('')
    setDialogError('')
    try {
      const res = await api.lineAccounts.restore(restoreTarget.id, stepUpToken)
      if (!res.success) throw new Error(res.error)
      setRestoreTarget(null)
      await load()
    } catch (caught) {
      if (!stepUpToken && isStepUpRequired(caught)) {
        setStepUp({
          purpose: 'line_account.credentials',
          action: `「${restoreTarget.name}」をアーカイブから戻す`,
          retry: runRestore,
        })
        return
      }
      setDialogError(describeSaveFailure(caught))
    } finally {
      setBusy(false)
    }
  }

  /*
    `?id=` なしで開くと読み込みが始まらず「読み込んでいます」が消えない。
    対象未指定は失敗ではないので、一覧へ戻して選び直させる（U097系）。
  */
  if (!id) {
    return (
      <TargetMissing
        kind="unspecified"
        title="見るアカウントが指定されていません"
        description="LINEアカウントの一覧から、見るアカウントを選び直してください。"
        backHref="/accounts"
        backLabel="LINEアカウントの一覧へ戻る"
      />
    )
  }
  if (status === 'loading') {
    return theme === 'v8' ? (
      <div aria-busy="true" aria-label="アカウントの内容を読み込んでいます">
        <DelayedSkeleton
          loading
          skeleton={(
            <div aria-hidden="true">
              <Skeleton width="18ch" height="1.5em" />
              <Skeleton width="100%" height="0.9em" />
              <Skeleton width="100%" height="0.9em" />
              <Skeleton width="100%" height="0.9em" />
              <Skeleton width="100%" height="0.9em" />
              <Skeleton width="100%" height="0.9em" />
            </div>
          )}
        />
      </div>
    ) : (
      <ListState kind="loading" />
    )
  }
  if (missing || (status === 'ready' && !account)) {
    return (
      <TargetMissing
        kind="not-found"
        title="このアカウントは見つかりません"
        description="削除されたか、別の記録です。一覧から選び直してください。"
        backHref="/accounts"
        backLabel="LINEアカウントの一覧へ戻る"
      />
    )
  }
  if (status === 'error' || !account) {
    return (
      <TargetMissing
        kind="error"
        title="アカウントを読み込めませんでした"
        description="通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。"
        onRetry={() => void load()}
      />
    )
  }

  const connection = connectionLabel(account)
  const webhook = webhookLabel(account)

  return (
    <ReadonlyDesignNode node="ihjfd"><div data-design-node="T9rA9" className="flex flex-col gap-4 v8-ro-notifications-page">
      {theme === 'v8' && <ReadonlyHeaderV8 title={account.name} description="登録の内容・接続状態・送受信の記録を確認します。秘密値は表示しません。" />}
      {/* カード同士の縦の間隔はこの親の gap-4（16px）だけで作る。子ごとの mb/mt は付けない。 */}
      <div data-design="Head">
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
        <div className="grid gap-4 xl:grid-cols-4">
          <div className="space-y-4 xl:col-span-3">
            <Card padding="roomy">
              <div className="flex items-start justify-between gap-3">
                <p className="text-ink text-base font-bold">登録の内容</p>
                {canManage && (
                  <Button type="button" onClick={() => setEditSection('basic')}>編集する</Button>
                )}
              </div>
              <dl className="mt-3">
                <InlineRow label="表示名" value={account.name} />
                <InlineRow label="チャネルID" value={account.channelId} />
                <InlineRow label="タイムゾーン" value={account.timezone ?? 'Asia/Tokyo'} />
                <InlineRow label="国・地域" value={account.country ?? '未設定'} />
                <InlineRow label="役割メモ" value={account.role ?? '未設定'} />
                {/*
                  R521: 親名称の一覧だけ取れないときはこの欄だけ未取得にし、
                  詳細のほかの欄はそのまま出す。ここだけ取り直せる。
                */}
                {!account.parentLineAccountId ? (
                  <InlineRow label="親アカウント" value="なし（このアカウントが親）" />
                ) : allState === 'ready' ? (
                  <InlineRow label="親アカウント" value={parentLabel(account, all)} />
                ) : allState === 'loading' ? (
                  <InlineRow label="親アカウント" value="読み込んでいます" />
                ) : (
                  <div
                    className="grid min-w-0 gap-3 border-b border-hairline py-1 last:border-b-0"
                    style={{ gridTemplateColumns: '9rem minmax(0, 1fr)' }}
                  >
                    <dt className="text-ink-faint text-xs">親アカウント</dt>
                    <dd className="text-ink-secondary min-w-0 break-words text-right text-sm">
                      読み込めませんでした
                      <button
                        type="button"
                        onClick={() => void loadAll()}
                        className="text-action ml-2 text-xs font-medium underline"
                      >
                        もう一度読み込む
                      </button>
                    </dd>
                  </div>
                )}
                <InlineRow
                  label="友だち数"
                  value={account.stats
                    ? `${formatNumber(account.stats.friendCount)}人（${capacityLabel(account)}）`
                    : `—（${capacityLabel(account)}）`}
                />
                <InlineRow label="状態" value={connection.label} tone={account.isActive ? 'success' : 'muted'} />
              </dl>
            </Card>

            <Card padding="roomy">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-ink text-sm font-bold">資格情報</p>
                  <p className="text-ink-secondary mt-1 text-xs">秘密値そのものは表示しません。</p>
                </div>
                {canManage && (
                  <Button type="button" onClick={() => setEditSection('credentials')}>差し替える</Button>
                )}
              </div>
              <dl className="mt-3">
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
                <p className="text-ink text-xs font-medium">値そのものは、ここにも出しません</p>
                <p className="text-ink-secondary mt-1 text-xs">差し替えるときは、新しい値を入れて保存し直します。今の値を見たり直したりはできません。</p>
              </div>
            </Card>

            <Card padding="roomy">
              <p className="text-ink text-sm font-bold">このアカウントでできること</p>
              <div className="mt-3 space-y-2">
                {accountActions(account).map((action) => (
                  <div key={action.key} className="border-hairline rounded-control flex items-center justify-between gap-4 border px-3 py-2">
                    <div>
                      <p className={action.key === 'archive' ? 'text-danger text-sm font-medium' : 'text-ink text-sm font-medium'}>{action.title}</p>
                      <p className="text-ink-secondary mt-1 text-xs leading-relaxed">{action.description}</p>
                    </div>
                    {action.blockedReason ? null : action.key === 'handover' ? (
                      <Button href={`/accounts/handover?id=${account.id}`}>{action.actionLabel}</Button>
                    ) : action.key === 'archive' ? (
                      <Button
                        type="button"
                        variant="danger"
                        onClick={() => { setDialogError(''); setArchiveReason(''); setArchiveTarget(account) }}
                      >{action.actionLabel}</Button>
                    ) : action.key === 'restore' ? (
                      <Button
                        type="button"
                        onClick={() => { setDialogError(''); setRestoreTarget(account) }}
                      >{action.actionLabel}</Button>
                    ) : (
                      <Button
                        type="button"
                        onClick={() => { setDialogError(''); setStopReason(''); setStopTarget(account) }}
                      >{action.actionLabel}</Button>
                    )}
                  </div>
                ))}
              </div>
              {actionError && <p role="alert" className="text-danger mt-3 text-xs">{actionError}</p>}
            </Card>

            {!account.isActive && !account.archivedAt && (
              <Card padding="roomy">
                <p className="text-ink text-sm font-bold">止まっている間に送らなかったもの</p>
                {account.inactivatedAt && (
                  <p className="text-ink-secondary mt-1 text-xs">
                    {formatMonthDayTime(account.inactivatedAt)} から止まっています
                    {account.inactiveReasonDetail ? `（理由: ${account.inactiveReasonDetail}）` : ''}
                  </p>
                )}
                {skippedDeliveries === null ? (
                  <p className="text-ink-faint mt-2 text-xs">読み込んでいます…</p>
                ) : skippedDeliveries.length === 0 ? (
                  <p className="text-ink-secondary mt-2 text-xs">送らなかった配信はありません。</p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {skippedDeliveries.map((row) => (
                      <li key={row.id} className="border-hairline rounded-control flex items-baseline justify-between gap-3 border px-3 py-2">
                        <span className="text-ink min-w-0 truncate text-xs" title={row.title ?? row.kind}>
                          {row.title ?? skippedKindLabel(row.kind)}
                        </span>
                        <span className="text-ink-faint shrink-0 text-xs">
                          {skippedKindLabel(row.kind)}・{formatMonthDayTime(row.skippedAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-ink-faint mt-2 text-xs leading-relaxed">
                  再開しても、ここに並んだ配信は自動では送り直しません。
                </p>
              </Card>
            )}

            <Card padding="roomy">
              <p className="text-ink text-sm font-bold">テスト送信先</p>
              <p className="text-ink-secondary mt-1 text-xs">
                リマインダや配信のテスト送信が届く先です。変更はこのアカウントだけに効きます。
              </p>
              <TestRecipientsSetting accountId={account.id} />
            </Card>
          </div>

          <aside className="space-y-4">
            <Card padding="roomy">
              <div className="flex items-center justify-between gap-2">
                <p className="text-ink text-sm font-bold">Webhookの突合</p>
                <StatusBadge tone={webhook.tone}>{webhook.label}</StatusBadge>
              </div>
              <dl className="mt-4 space-y-3">
                <StackedRow label="LINE側に登録したURL" value={webhook.label === '一致・利用中' ? 'このシステムと一致' : webhook.label} tone={webhook.tone === 'success' ? 'success' : 'muted'} />
                <StackedRow label="Webhookの利用" value={account.webhook?.active === null || account.webhook?.active === undefined ? '確かめていません' : account.webhook.active ? 'オン' : 'オフ'} tone={account.webhook?.active ? 'success' : 'muted'} />
                <StackedRow label="最後のテスト" value={account.connection?.lastTestAt ? `${formatMonthDayTime(account.connection.lastTestAt)} に${account.connection.lastTestStatus === 'succeeded' ? '成功' : '失敗'}` : '未取得'} tone={account.connection?.lastTestStatus === 'succeeded' ? 'success' : 'muted'} />
                <StackedRow label="最後の受信" value={account.connection?.lastReceivedAt ? formatMonthDayTime(account.connection.lastReceivedAt) : '未取得'} />
              </dl>
              <p className="text-ink-secondary mt-3 break-all text-xs">{account.webhook?.actualUrl ?? '—'}</p>
              <Button href={`/accounts/detail?id=${account.id}&tab=connection`} className="mt-4">
                いまの状態をもう一度確かめる
              </Button>
            </Card>

            <Card padding="roomy">
              <p className="text-ink text-sm font-bold">つながる先</p>
              <ul className="text-ink-secondary mt-3 space-y-3 text-xs">
                <li><Link className="text-action hover:underline" href="/">ダッシュボード</Link><p className="mt-1">友だち追加URLとQRはここに出ます。</p></li>
                <li><Link className="text-action hover:underline" href="/staff">ログインユーザー</Link><p className="mt-1">人ごとの既定のアカウントはここで決めます。</p></li>
                <li><Link className="text-action hover:underline" href="/emergency">運用状態</Link><p className="mt-1">接続の異常や停止は、ここで見張ります。</p></li>
                <li><Link className="text-action hover:underline" href="/friends">友だち</Link><p className="mt-1">このアカウントの友だち{account.stats ? `${formatNumber(account.stats.friendCount)}人` : 'は未取得'}はここに並びます。</p></li>
              </ul>
            </Card>

            <Card padding="roomy">
              <p className="text-ink text-sm font-bold">気をつけること</p>
              <ul className="text-ink-secondary mt-2 space-y-2 text-xs leading-relaxed">
                <li>・停止しても、友だちと履歴は消えません。</li>
                <li>・資格情報を差し替えたら、接続の表示を確かめます。</li>
                <li>・アーカイブした記録はあとから戻せます。</li>
              </ul>
            </Card>
          </aside>
        </div>
      )}

      {tab === 'connection' && (
        <Card padding="roomy">
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
        </Card>
      )}

      {tab === 'credentials' && (
        <Card padding="roomy">
          <p className="text-ink text-sm font-bold">資格情報</p>
          <dl className="mt-3 space-y-3">
            <Row label="チャネルシークレット" value={credentialLabel(account.channelSecretConfigured)} />
            <Row label="チャネルアクセストークン" value={credentialLabel(account.channelAccessTokenConfigured)} />
            <Row label="Loginチャネルシークレット" value={credentialLabel(account.loginChannelSecretConfigured)} />
          </dl>
          <p className="text-ink-secondary mt-3 text-xs leading-relaxed">
            値そのものは、ここにも出しません。差し替えるときは、新しい値を入れて保存し直します。
            今の値を見たり直したりはできません。
          </p>
          {canManage && (
            <Button type="button" className="mt-3" onClick={() => setEditSection('credentials')}>資格情報を差し替える</Button>
          )}
        </Card>
      )}

      {tab === 'handover' && (
        <Card padding="roomy">
          <p className="text-ink text-sm font-bold">乗り換え</p>
          <p className="text-ink-secondary mt-1 text-xs leading-relaxed">
            別のLINEアカウントへ、友だちと設定を引き継ぎます。事前確認をしてから本実行します。
          </p>
          <Button href={`/accounts/handover?id=${account.id}`} variant="primary" className="mt-3">
            乗り換えを始める
          </Button>
        </Card>
      )}

      <ConfirmDialog
        open={stopTarget !== null}
        title={stopTarget?.isActive
          ? `「${stopTarget?.name}」の送受信を止めますか？`
          : `「${stopTarget?.name}」の送受信を再開しますか？`}
        description={stopTarget?.isActive
          ? '止めているあいだ、配信も受信もしません。友だちと履歴はそのまま残ります。予約している配信は止まります。いつでも戻せます。'
          : '再開の前にLINEとの接続を確かめます。止めているあいだに予約していた配信は、自動で送り直しません。'}
        confirmLabel={stopTarget?.isActive ? '送受信を止める' : '送受信を再開する'}
        destructive={stopTarget?.isActive}
        busy={busy}
        error={dialogError || undefined}
        designNode={stopTarget?.isActive ? 'CFAyf' : undefined}
        onCancel={() => { if (!busy) { setStopTarget(null); setStopReason(''); setDialogError('') } }}
        onConfirm={() => void toggleActive()}
      >
        {/* 理由は必須（X-1）。あとから「なぜ止めたか」を追うため。板 `CFAyf` は1行入力。 */}
        <label className="mt-3 block">
          <span className="text-ink-secondary text-xs">
            {stopTarget?.isActive ? '止める理由' : '再開する理由'}（必須）
          </span>
          <span className="mt-1 block">
            <TextField
              maxLength={500}
              placeholder={stopTarget?.isActive
                ? '例: LINE側の表示がおかしいので、確認するまで止める'
                : '例: 接続を直したので再開する'}
              value={stopReason}
              onChange={(e) => setStopReason(e.target.value)}
              aria-label={stopTarget?.isActive ? '止める理由（必須）' : '再開する理由（必須）'}
            />
          </span>
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={archiveTarget !== null}
        title={`「${archiveTarget?.name}」をアーカイブしますか？`}
        description="一覧から外します。送受信は止まり、友だちと履歴は残ります。あとから「アーカイブから戻す」で戻せます。動いているアカウント・既定のアカウント・配送中のアカウントはアーカイブできません。"
        confirmLabel="アーカイブする"
        destructive
        busy={busy}
        error={dialogError || undefined}
        designNode="WOfBN"
        onCancel={() => { if (!busy) { setArchiveTarget(null); setArchiveReason(''); setDialogError('') } }}
        onConfirm={() => void runArchive()}
      >
        <label className="mt-3 block">
          <span className="text-ink-secondary text-xs">アーカイブの理由（任意）</span>
          <TextArea
            className="mt-1"
            rows={2}
            maxLength={500}
            placeholder="例: 使わなくなった旧店舗のアカウント"
            value={archiveReason}
            onChange={(e) => setArchiveReason(e.target.value)}
            disabled={busy}
          />
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={restoreTarget !== null}
        title={`「${restoreTarget?.name}」をアーカイブから戻しますか？`}
        description="一覧へ戻します。戻った直後は「止まっている」状態です。送受信を始めるには、接続を確かめてから「送受信を再開する」を使います。"
        confirmLabel="アーカイブから戻す"
        busy={busy}
        error={dialogError || undefined}
        onCancel={() => { if (!busy) { setRestoreTarget(null); setDialogError('') } }}
        onConfirm={() => void runRestore()}
      />
      {editSection !== null && (
        <AccountEditModal
          accountId={account.id}
          initialName={account.name}
          initialChannelId={account.channelId}
          initialLoginChannelId={account.loginChannelId ?? null}
          initialLiffId={account.liffId ?? null}
          initialOgSiteName={account.ogSiteName ?? null}
          initialOgDefaultDescription={account.ogDefaultDescription ?? null}
          initialOgDefaultImageUrl={account.ogDefaultImageUrl ?? null}
          initialFriendCapacity={account.friendCapacity ?? null}
          initialCapacityWarnAt={account.capacityWarnAt ?? null}
          initialIconUrl={account.iconUrl ?? null}
          initialSection={editSection}
          onClose={() => setEditSection(null)}
          onSaved={() => { void load() }}
        />
      )}
      {stepUp && <StepUpPrompt request={stepUp} onDone={() => setStepUp(null)} onClose={() => setStepUp(null)} />}
    </div></ReadonlyDesignNode>
  )
}

/** 「止めていたので送らなかった」の種類を、運用者の言葉で。 */
function skippedKindLabel(kind: string): string {
  switch (kind) {
  case 'broadcast': return '一斉配信'
  case 'scenario_step': return 'ステップ配信'
  case 'reminder': return 'リマインダ'
  case 'auto_reply': return '自動応答'
  case 'notification': return '通知'
  case 'automation': return 'オートメーション'
  default: return kind
  }
}

/**
 * アーカイブできない理由（API の blockers）を、運用者の言葉で。
 * 理由が読めないときは API のメッセージか汎用文を返す。
 */
function archiveFailureMessage(caught: unknown): string {
  if (caught instanceof ApiError && caught.code === 'LINE_ACCOUNT_ARCHIVE_BLOCKED') {
    const blockers = (caught.data as { blockers?: string[] } | undefined)?.blockers ?? []
    const messages = blockers
      .map((key) => ARCHIVE_BLOCKER_MESSAGES[key])
      .filter((message): message is string => Boolean(message))
    if (messages.length > 0) return messages.join(' / ')
    return 'このアカウントはいまアーカイブできません。止まっているか、既定でないかを確かめてください。'
  }
  return describeSaveFailure(caught)
}

const ARCHIVE_BLOCKER_MESSAGES: Record<string, string> = {
  account_active: '送受信がまだ動いています。先に「送受信を止める」で止めてください',
  default_account: '既定のアカウントです。先にほかのアカウントを既定にしてください',
  delivery_job_running: '予約・送信中の配信があります。終わるか取り消してからアーカイブしてください',
  traffic_pool_member: 'アクセス振り分けの組に入っています。組から外してからアーカイブしてください',
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
  return formatDay(new Date(value))
}

function formatMonthDayTime(value: string): string {
  return formatDateTime(new Date(value))
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
      className="grid min-w-0 gap-3 border-b border-hairline py-1 last:border-b-0"
      style={{ gridTemplateColumns: '9rem minmax(0, 1fr)' }}
    >
      <dt className="text-ink-faint text-xs">{label}</dt>
      <dd className={tone === 'success'
        ? 'text-success min-w-0 break-words text-right text-sm font-medium'
        : tone === 'muted'
          ? 'text-ink-secondary min-w-0 break-words text-right text-sm'
          : 'text-ink min-w-0 break-words text-right text-sm'}>
        {value}
      </dd>
    </div>
  )
}

/*
 * 狭い脇カード用の縦並びの行。札を上に、値を下の行頭に置くので、
 * 短い値が1〜2文字ずつ折れない（全ルート監査、2026-09-25）。
 */
function StackedRow({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'success' | 'muted'
}) {
  return (
    <div className="min-w-0 border-b border-hairline py-1 last:border-b-0">
      <dt className="text-ink-faint text-xs">{label}</dt>
      <dd className={tone === 'success'
        ? 'text-success mt-0.5 min-w-0 text-sm font-medium'
        : tone === 'muted'
          ? 'text-ink-secondary mt-0.5 min-w-0 text-sm'
          : 'text-ink mt-0.5 min-w-0 text-sm'}>
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
