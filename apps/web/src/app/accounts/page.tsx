'use client'

import '@/app/notifications/readonly-v8.css'
import ReadonlyHeaderV8, { ReadonlyDesignNode } from '@/app/notifications/readonly-header-v8'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LineAccount } from '@line-crm/shared'
import { ApiError, api, describeSaveFailure } from '@/lib/api'
import { MoreHorizontal } from 'lucide-react'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import FilterChip from '@/components/shared/filter-chip'
import { TextArea } from '@/components/shared/form-controls'
import IconButton from '@/components/shared/icon-button'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import SearchField from '@/components/shared/search-field'
import StatusBadge from '@/components/shared/status-badge'
import StepUpPrompt, { isStepUpRequired, type StepUpRequest } from '@/components/step-up-prompt'
import { TableHeadRow, Th } from '@/components/shared/table'
import ListRange from '@/components/ui/list-range'
import {
  ACCOUNT_FILTERS,
  connectionLabel,
  matchesFilter,
  matchesQuery,
  parentName,
  webhookLabel,
  type AccountFilter,
} from './account-list-view'
import AccountMigration from './migration'
import { useAdminTheme } from '@/lib/use-admin-theme'
import AccountsV8 from '@/v8/settings/accounts/accounts'

type AccountWithStats = LineAccount & {
  stats?: { friendCount: number; activeScenarios: number; messagesThisMonth: number }
  timezone?: string
}

/**
 * LINEアカウントの一覧。設計板 `V7vn3`。
 *
 * 板どおりの3段（数3枚／検索と絞り込み／表）だけを出す。表の操作は
 * 行ごとの「⋯」にまとめ、詳細・確かめ直し・引き継ぎ・
 * アーカイブ（戻す）を置く。アーカイブの理由入力と本人確認は、
 * 詳しい画面と同じ流れをここでも使う。
 */
function AccountsPageV7() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [accounts, setAccounts] = useState<AccountWithStats[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<AccountFilter>('all')
  /** 開いている行の操作メニュー。板 V7vn3 の「⋯」。 */
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<LineAccount | null>(null)
  const [archiveReason, setArchiveReason] = useState('')
  const [restoreTarget, setRestoreTarget] = useState<LineAccount | null>(null)
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState('')
  /** 行の操作の結果の知らせ。成功も失敗も文字で残す。 */
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [stepUp, setStepUp] = useState<StepUpRequest | null>(null)

  const load = useCallback(async (live: boolean): Promise<boolean> => {
    setStatus('loading')
    try {
      const res = await api.lineAccounts.list(live)
      if (!res.success) { setStatus('error'); return false }
      setAccounts(res.data)
      setStatus('ready')
      return true
    } catch {
      setStatus('error')
      return false
    }
  }, [])

  useEffect(() => { void load(false) }, [load])

  const shown = useMemo(
    () => accounts.filter((a) => matchesFilter(a, filter) && matchesQuery(a, query)),
    [accounts, filter, query],
  )

  // R520: 未取得（読み込み中・取得失敗）を 0 件と出さない。成功した空一覧だけ 0。
  const ready = status === 'ready'
  const activeCount = ready ? accounts.filter((a) => a.isActive && !a.archivedAt).length : null
  const inactiveCount = ready ? accounts.filter((a) => !a.isActive && !a.archivedAt).length : null
  const archivedCount = ready ? accounts.filter((a) => Boolean(a.archivedAt)).length : null
  const kpiRetry = status === 'error' ? () => void load(false) : undefined
  // 数カードの3段目は共通部品の決まりで必ず出す。読み込み中・取得失敗の
  // 知らせをここに書き、R520（未取得を 0 と出さない）を保つ。
  const kpiDetail = (fallback: string) =>
    status === 'loading' ? '読み込んでいます' : status === 'error' ? '読み込めませんでした' : fallback

  /** このアカウントの接続を、新しく確かめ直す。一覧全体を最新で取り直す。 */
  const recheck = useCallback(async (account: LineAccount) => {
    setOpenMenuId(null)
    setNotice(null)
    const ok = await load(true)
    setNotice(ok
      ? { tone: 'success', text: `「${account.name}」を確かめ直しました。` }
      : { tone: 'error', text: '確かめ直せませんでした。もう一度お試しください。' })
  }, [load])

  const runArchive = useCallback(async (stepUpToken?: string) => {
    if (!archiveTarget) return
    setBusy(true)
    setDialogError('')
    try {
      const res = await api.lineAccounts.archive(
        archiveTarget.id, archiveReason.trim() || undefined, stepUpToken)
      if (!res.success) throw new Error(res.error)
      setArchiveTarget(null)
      setArchiveReason('')
      await load(false)
      setNotice({ tone: 'success', text: `「${archiveTarget.name}」をアーカイブしました。` })
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
  }, [archiveTarget, archiveReason, load])

  /** アーカイブから戻す。戻った直後は「止まっている」状態。 */
  const runRestore = useCallback(async (stepUpToken?: string) => {
    if (!restoreTarget) return
    setBusy(true)
    setDialogError('')
    try {
      const res = await api.lineAccounts.restore(restoreTarget.id, stepUpToken)
      if (!res.success) throw new Error(res.error)
      setRestoreTarget(null)
      await load(false)
      setNotice({ tone: 'success', text: `「${restoreTarget.name}」をアーカイブから戻しました。` })
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
  }, [restoreTarget, load])

  /** 行の「⋯」の中身。板 V7vn3 の4項目。 */
  const menuItems = useCallback((account: LineAccount): ActionMenuItem[] => [
    {
      id: 'detail', label: '詳細', external: true,
      onSelect: () => { setOpenMenuId(null); router.push(`/accounts/detail?id=${account.id}`) },
    },
    {
      id: 'recheck', label: '接続をもう一度確かめる', disabled: busy,
      onSelect: () => void recheck(account),
    },
    {
      id: 'handover', label: '引き継ぎ', external: true,
      onSelect: () => { setOpenMenuId(null); router.push(`/accounts/handover?id=${account.id}`) },
    },
    account.archivedAt
      ? {
        id: 'restore', label: 'アーカイブから戻す', dividerBefore: true, disabled: busy,
        onSelect: () => { setOpenMenuId(null); setDialogError(''); setRestoreTarget(account) },
      }
      : {
        id: 'archive', label: 'アーカイブ', tone: 'danger', dividerBefore: true, disabled: busy,
        onSelect: () => { setOpenMenuId(null); setDialogError(''); setArchiveReason(''); setArchiveTarget(account) },
      },
  ], [busy, recheck, router])

  const rowMenu = useCallback((account: LineAccount) => (
    <>
      <IconButton
        aria-label={`${account.name}の操作`}
        aria-haspopup="menu"
        aria-expanded={openMenuId === account.id}
        onClick={() => setOpenMenuId(openMenuId === account.id ? null : account.id)}
      >
        <MoreHorizontal aria-hidden="true" size={16} />
      </IconButton>
      <ActionMenu
        open={openMenuId === account.id}
        onClose={() => setOpenMenuId(null)}
        ariaLabel={`${account.name}の操作`}
        items={menuItems(account)}
      />
    </>
  ), [menuItems, openMenuId])

  if (searchParams.get('tab') === 'migration') return <AccountMigration />

  return (
    <ReadonlyDesignNode node="V7vn3"><div className="flex flex-col gap-4 v8-ro-notifications-page">
      {/* カード同士の縦の間隔はこの親の gap-4（16px）だけで作る。子ごとの mb/mt は付けない。 */}
      <div data-design="Head" className="flex min-h-10 flex-wrap items-center justify-between gap-3">
        <ReadonlyHeaderV8 title="LINEアカウント" description="統括内の全アカウントの接続・Webhook・友だち数を確認できます。" />
        <div className="flex flex-wrap gap-2">
          <Button href="/accounts/new" variant="primary">＋ LINEアカウントを登録する</Button>
        </div>
      </div>

      {notice && (
        <Notice tone={notice.tone === 'success' ? 'success' : 'danger'} message={notice.text} onClose={() => setNotice(null)} />
      )}

      {/* 板 V7vn3 の数3枚。絵に無い「接続に問題」の4枚目は置かない。 */}
      <div data-design="KPIs" data-ro-kpis="true" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/* R520: 未取得は null で「—」。成功した空一覧だけ 0。 */}
        <KpiCard title="稼働中" value={activeCount} unit="" variant="v6"
          loading={status === 'loading'} onRetry={kpiRetry}
          detail={kpiDetail('送受信をしています')} />
        <KpiCard title="停止中" value={inactiveCount} unit="" variant="v6"
          loading={status === 'loading'} onRetry={kpiRetry}
          detail={kpiDetail('送受信を止めています')} />
        <KpiCard title="アーカイブ" value={archivedCount} unit="" variant="v6"
          loading={status === 'loading'} onRetry={kpiRetry}
          detail={kpiDetail('記録は残っています')} />
      </div>

      <div className="bg-canvas rounded-card border-hairline border p-3">
        {/* 板どおり、検索と絞り込みを同じ白い板に入れる。 */}
        <div data-search-row className="flex flex-wrap items-center gap-2">
          <SearchField
            placeholder="アカウント名・チャネルIDで検索"
            aria-label="アカウント名・チャネルIDで検索"
            value={query}
            onChange={setQuery}
            onClear={() => setQuery('')}
            className="min-w-44 flex-1"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-ink-faint text-xs">条件：</span>
          {ACCOUNT_FILTERS.map((item) => (
            <FilterChip key={item.value} selected={filter === item.value} onChange={() => setFilter(item.value)}>
              {item.label}
            </FilterChip>
          ))}
          {/* 件数は結果の件数だけ。選べない件数の文字は置かない。 */}
          {/* R520: 読み込み中・取得失敗の合計は 0 件と出さず「—」。 */}
          {status === 'ready' ? (
            <ListRange className="ml-auto whitespace-nowrap" total={shown.length} first={shown.length === 0 ? 0 : 1} last={shown.length} />
          ) : (
            <span
              className="text-ink-faint ml-auto text-xs whitespace-nowrap"
              title={status === 'loading' ? '読み込んでいます' : '読み込めませんでした'}
            >
              —
            </span>
          )}
        </div>
      </div>

      {status === 'loading' ? (
        <ListState kind="loading" />
      ) : status === 'error' ? (
        <ListState
          kind="error"
          action={<Button type="button" onClick={() => void load(false)}>再読み込み</Button>}
        />
      ) : shown.length === 0 ? (
        <div className="bg-canvas rounded-card border-hairline border">
          <ListState
            kind="empty"
            emptyPreset={accounts.length === 0 ? 'createable' : 'filtered'}
            title={accounts.length === 0 ? 'LINEアカウントがありません' : undefined}
            description={accounts.length === 0
              ? '「＋ LINEアカウントを登録」から、送受信に使うアカウントを登録してください。'
              : undefined}
            action={accounts.length === 0
              ? <Button href="/accounts/new" variant="primary">＋ LINEアカウントを登録する</Button>
              : <Button type="button" onClick={() => { setQuery(''); setFilter('all') }}>条件を外す</Button>}
          />
        </div>
      ) : (
        <div className="bg-canvas rounded-card border-hairline border">
          <ul className="divide-hairline divide-y md:hidden" data-design="List">
            {shown.map((account) => {
              const connection = connectionLabel(account)
              const webhook = webhookLabel(account)
              return (
                <li key={account.id} className="p-4">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-ink truncate text-sm font-medium" title={account.name}>{account.name}</p>
                      <p className="text-ink-faint mt-0.5 truncate text-xs">
                        チャネル {account.channelId}
                        {` ・ ${account.timezone ?? 'Asia/Tokyo'}`}
                      </p>
                    </div>
                    <div className="relative shrink-0">{rowMenu(account)}</div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <StatusBadge tone={connection.tone}>{connection.label}</StatusBadge>
                    <StatusBadge tone={webhook.tone}>{webhook.label}</StatusBadge>
                  </div>
                  <details className="mt-3">
                    <summary className="text-ink-secondary cursor-pointer text-xs font-semibold">詳しい情報を見る</summary>
                    <dl className="mt-2 space-y-1 text-xs">
                      <div className="flex justify-between gap-3"><dt className="text-ink-faint">親</dt><dd className="text-ink-secondary truncate" title={parentName(account, accounts)}>{parentName(account, accounts)}</dd></div>
                    </dl>
                  </details>
                </li>
              )
            })}
          </ul>
          <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[56rem]">
            <thead>
              <TableHeadRow>
                <Th className="pl-5">アカウント</Th>
                <Th>接続状態</Th>
                <Th>Webhook</Th>
                <Th>親</Th>
                <Th align="right" className="w-28 pr-5">操作</Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {shown.map((account) => {
                const connection = connectionLabel(account)
                const webhook = webhookLabel(account)
                return (
                  <tr key={account.id} className="border-hairline hover:bg-canvas-sunken border-t align-middle">
                    <td className="py-3 pr-4 pl-5">
                      <p className="text-ink text-sm font-semibold">{account.name}</p>
                      <p className="text-ink-faint mt-0.5 text-xs">
                        チャネル {account.channelId}
                        {` ・ ${account.timezone ?? 'Asia/Tokyo'}`}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge tone={connection.tone}>{connection.label}</StatusBadge>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge tone={webhook.tone}>{webhook.label}</StatusBadge>
                    </td>
                    <td className="text-ink-secondary px-4 py-3 text-sm">
                      {parentName(account, accounts)}
                    </td>
                    <td className="py-3 pr-5 pl-4 text-right whitespace-nowrap">
                      <div className="relative inline-block">{rowMenu(account)}</div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={archiveTarget !== null}
        title={`「${archiveTarget?.name}」をアーカイブしますか？`}
        description="一覧から外します。送受信は止まり、友だちと履歴は残ります。あとから「アーカイブから戻す」で戻せます。動いているアカウント・既定のアカウント・配送中のアカウントはアーカイブできません。"
        confirmLabel="アーカイブする"
        destructive
        busy={busy}
        error={dialogError || undefined}
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
      {stepUp && <StepUpPrompt request={stepUp} onDone={() => setStepUp(null)} onClose={() => setStepUp(null)} />}
    </div></ReadonlyDesignNode>
  )
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

/**
 * ★V8：data-theme="v8" のときだけ新しい画面（src/v8/settings/accounts）を出す。
 * `?tab=migration`（UID の移行）は今までどおり今の画面が受ける。
 */
export default function AccountsPage() {
  const theme = useAdminTheme()
  const searchParams = useSearchParams()
  return theme === 'v8' && searchParams.get('tab') !== 'migration' ? <AccountsV8 /> : <AccountsPageV7 />
}
