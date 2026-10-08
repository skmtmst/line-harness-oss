'use client'

/*
 * ★V8 LINEアカウント（Pencil `V7vn3`）。
 *
 * 白い板の頭（題・説明・右に「並び順と親子を変える」「LINEアカウントを登録」）→
 * 左に「設定の中のメニュー」→ 右に数の4枚・探す欄と絞り込みの札・表・下の案内。
 * データの口は今の画面（app/accounts/page.tsx）と同じ：
 * 一覧（確かめ直しは live）・アーカイブ（理由・本人確認）・アーカイブから戻す。
 * 「並び順と親子を変える」は今ある並び替えの部品（components/accounts/account-ordering）を窓で開く。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUpDown, CircleDot, Plus, Star } from 'lucide-react'
import type { LineAccount } from '@line-crm/shared'
import { ApiError, api, describeSaveFailure } from '@/lib/api'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { usePageTitle } from '@/components/shell/page-chrome'
import { SettingsPage } from '@/components/templates'
import SettingsInnerNav from '@/components/layout/settings-inner-nav'
import AccountOrdering from '@/components/accounts/account-ordering'
import StepUpPrompt, { isStepUpRequired, type StepUpRequest } from '@/components/step-up-prompt'
import type { ActionMenuItem } from '@/components/shared/action-menu'
import { RowMenu } from '@/components/shared/row-actions'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import FilterChip from '@/components/shared/filter-chip'
import { TextArea } from '@/components/shared/text-field'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import SearchField from '@/components/shared/search-field'
import StatusBadge from '@/components/shared/status-badge'
import {
  ACCOUNT_FILTERS,
  type AccountFilter,
  type AccountWithStats,
  accountKpis,
  connectionLabel,
  matchesFilter,
  matchesQuery,
  orderAccounts,
  parentName,
  webhookLabel,
} from './view'
import frame from '../sa-frame.module.css'
import styles from './accounts.module.css'

const TITLE = 'LINEアカウント'
const DESCRIPTION = 'musubo でつないでいる LINE 公式アカウントです。既定のアカウントと、親子（本店と支店など）を決めます。'

export default function AccountsV8() {
  usePageTitle(TITLE)
  const router = useRouter()
  const role = useStaffRole()
  // 役割が読めるまでは今までどおり出し、見るだけと分かったら変える操作を隠す（最後の守りはサーバ）。
  const canManage = role === null || canManageRole(role)
  const [accounts, setAccounts] = useState<AccountWithStats[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<AccountFilter>('all')
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<LineAccount | null>(null)
  const [archiveReason, setArchiveReason] = useState('')
  const [restoreTarget, setRestoreTarget] = useState<LineAccount | null>(null)
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState('')
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [stepUp, setStepUp] = useState<StepUpRequest | null>(null)
  const [orderingOpen, setOrderingOpen] = useState(false)

  const load = useCallback(async (live: boolean): Promise<boolean> => {
    setStatus('loading')
    try {
      const res = await api.lineAccounts.list(live)
      if (!res.success) { setStatus('error'); return false }
      setAccounts(res.data as AccountWithStats[])
      setStatus('ready')
      return true
    } catch {
      setStatus('error')
      return false
    }
  }, [])

  useEffect(() => { void load(false) }, [load])

  const ordered = useMemo(() => orderAccounts(accounts), [accounts])
  const shown = useMemo(
    () => ordered.filter((a) => matchesFilter(a, filter) && matchesQuery(a, query)),
    [ordered, filter, query],
  )
  const ready = status === 'ready'
  // 未取得（読み込み中・取得失敗）を 0 と出さない。成功した空一覧だけ 0。
  const kpis = ready ? accountKpis(accounts) : null
  const filterCount = (value: AccountFilter) => (ready ? accounts.filter((a) => matchesFilter(a, value)).length : '—')

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
      const res = await api.lineAccounts.archive(archiveTarget.id, archiveReason.trim() || undefined, stepUpToken)
      if (!res.success) throw new Error(res.error)
      setArchiveTarget(null)
      setArchiveReason('')
      await load(false)
      setNotice({ tone: 'success', text: `「${archiveTarget.name}」をアーカイブしました。` })
    } catch (caught) {
      if (!stepUpToken && isStepUpRequired(caught)) {
        setStepUp({ purpose: 'line_account.archive', action: `「${archiveTarget.name}」をアーカイブする`, retry: runArchive })
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
        setStepUp({ purpose: 'line_account.credentials', action: `「${restoreTarget.name}」をアーカイブから戻す`, retry: runRestore })
        return
      }
      setDialogError(describeSaveFailure(caught))
    } finally {
      setBusy(false)
    }
  }, [restoreTarget, load])

  /** 行の「…」の中身：詳細・接続をもう一度確かめる・引き継ぎ・アーカイブ（戻す）。 */
  const menuItems = (account: LineAccount): ActionMenuItem[] => {
    const items: ActionMenuItem[] = [
      { id: 'detail', label: '詳細', external: true, onSelect: () => { setOpenMenuId(null); router.push(`/accounts/detail?id=${account.id}`) } },
      { id: 'recheck', label: '接続をもう一度確かめる', disabled: busy, onSelect: () => void recheck(account) },
    ]
    if (!canManage) return items
    items.push({ id: 'handover', label: '引き継ぎ', external: true, onSelect: () => { setOpenMenuId(null); router.push(`/accounts/handover?id=${account.id}`) } })
    items.push(account.archivedAt
      ? { id: 'restore', label: 'アーカイブから戻す', dividerBefore: true, disabled: busy, onSelect: () => { setOpenMenuId(null); setDialogError(''); setRestoreTarget(account) } }
      : { id: 'archive', label: 'アーカイブ', tone: 'danger', dividerBefore: true, disabled: busy, onSelect: () => { setOpenMenuId(null); setDialogError(''); setArchiveReason(''); setArchiveTarget(account) } })
    return items
  }

  const headActions = canManage ? (
    <div className={styles.headActions}>
      <Button variant="secondary" onClick={() => setOrderingOpen(true)}>
        <ArrowUpDown size={15} aria-hidden="true" />並び順と親子を変える
      </Button>
      <Button variant="primary" href="/accounts/new">
        <Plus size={15} aria-hidden="true" />LINEアカウントを登録
      </Button>
    </div>
  ) : undefined

  return (
    <div className={frame.screen}>
      <SettingsPage boardId="V7vn3" title={TITLE} description={DESCRIPTION} actions={headActions} navigation={<SettingsInnerNav inline />}>
        {notice ? (
          <Notice tone={notice.tone === 'success' ? 'success' : 'danger'} message={notice.text} onClose={() => setNotice(null)} />
        ) : null}

        <div className={styles.kpis} data-design="KPIs">
          <Kpi label="つないでいる" value={kpis?.connected} unit="アカウント" />
          <Kpi label="稼働中" value={kpis?.active} unit="件" />
          <Kpi label="接続に問題" value={kpis?.problem} unit="件" warn />
          <Kpi label="友だちの合計" value={kpis?.friends} unit="人" />
        </div>

        <div className={styles.toolbar}>
          <SearchField
            className={styles.search}
            placeholder="アカウント名・チャネル ID で探す"
            aria-label="アカウント名・チャネル ID で探す"
            value={query}
            onChange={setQuery}
            onClear={() => setQuery('')}
          />
          <div className={styles.chips} role="group" aria-label="状態で絞り込む">
            {ACCOUNT_FILTERS.map((item) => (
              <FilterChip
                key={item.value}
                selected={filter === item.value}
                onChange={() => setFilter(item.value)}
                icon={filter === item.value ? <CircleDot size={13} aria-hidden="true" /> : <Star size={13} aria-hidden="true" />}
              >
                {`${item.label} ${filterCount(item.value)}`}
              </FilterChip>
            ))}
          </div>
        </div>

        {status === 'loading' ? (
          <ListState kind="loading" />
        ) : status === 'error' ? (
          <ListState kind="error" action={<Button type="button" onClick={() => void load(false)}>再読み込み</Button>} />
        ) : shown.length === 0 ? (
          <div className={styles.table}>
            <ListState
              kind="empty"
              emptyPreset={accounts.length === 0 ? 'createable' : 'filtered'}
              title={accounts.length === 0 ? 'LINEアカウントがありません' : undefined}
              description={accounts.length === 0 ? '「＋ LINEアカウントを登録」から、送受信に使うアカウントを登録してください。' : undefined}
              action={accounts.length === 0
                ? (canManage ? <Button href="/accounts/new" variant="primary"><Plus size={15} aria-hidden="true" />LINEアカウントを登録</Button> : undefined)
                : <Button type="button" onClick={() => { setQuery(''); setFilter('all') }}>条件を外す</Button>}
            />
          </div>
        ) : (
          <div className={styles.table} role="table" aria-label="LINEアカウントの一覧">
            <div className={`${styles.row} ${styles.head}`} role="row">
              <span className={styles.colName} role="columnheader">アカウント</span>
              <span className={styles.colConn} role="columnheader">接続状態</span>
              <span className={styles.colHook} role="columnheader">Webhook</span>
              <span className={styles.colFriends} role="columnheader">友だち</span>
              <span className={styles.colDefault} role="columnheader">既定</span>
              <span className={styles.colParent} role="columnheader">親アカウント</span>
              <span className={styles.colMenu} role="columnheader"><span className={styles.srOnly}>操作</span></span>
            </div>
            {shown.map((account) => {
              const connection = connectionLabel(account)
              const webhook = webhookLabel(account)
              const parent = parentName(account, accounts)
              const archived = Boolean(account.archivedAt)
              const friends = archived || account.stats?.friendCount == null ? '—' : account.stats.friendCount.toLocaleString('ja-JP')
              return (
                <div key={account.id} className={`${styles.row} ${styles.body}`} role="row">
                  <span className={styles.colName} role="cell">
                    <span className={styles.name} title={account.name}>{account.name}</span>
                    <span className={styles.sub}>{`チャネル ${account.channelId}`}</span>
                  </span>
                  <span className={styles.colConn} role="cell"><StatusBadge tone={connection.tone}>{connection.label}</StatusBadge></span>
                  <span className={styles.colHook} role="cell">
                    {archived ? <span className={styles.faint}>—</span> : <StatusBadge tone={webhook.tone}>{webhook.label}</StatusBadge>}
                  </span>
                  <span className={`${styles.colFriends} ${friends === '—' ? styles.faint : ''}`} role="cell">{friends}</span>
                  <span className={`${styles.colDefault} ${account.isDefault ? '' : styles.faint}`} role="cell">
                    {account.isDefault ? <span aria-label="既定のアカウント">★</span> : '—'}
                  </span>
                  <span className={`${styles.colParent} ${parent === '—' ? styles.faint : ''}`} role="cell" title={parent}>{parent}</span>
                  <span className={`${styles.colMenu} ${styles.menuBox}`} role="cell">
                    <RowMenu
                      label={`${account.name}の操作`}
                      items={menuItems(account)}
                      open={openMenuId === account.id}
                      onOpenChange={(next) => setOpenMenuId(next ? account.id : null)}
                    />
                  </span>
                </div>
              )
            })}
          </div>
        )}

        <p className={styles.footNote}>行の「…」から 詳細・接続をもう一度確かめる・既定にする・引き継ぎ（UID の移行）・アーカイブ。</p>
      </SettingsPage>

      <Dialog
        open={orderingOpen}
        size="large"
        title="並び順と親子を変える"
        description="アカウントをドラッグするか、カードの「…」から移動先を選んで、親・子・孫の順に整理します。"
        onCancel={() => { setOrderingOpen(false); void load(false) }}
        footer={<Button variant="secondary" onClick={() => { setOrderingOpen(false); void load(false) }}>閉じる</Button>}
      >
        {orderingOpen ? <AccountOrdering /> : null}
      </Dialog>

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
        <label className={styles.reason}>
          <span className={styles.reasonLabel}>アーカイブの理由（任意）</span>
          <TextArea
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
      {stepUp ? <StepUpPrompt request={stepUp} onDone={() => setStepUp(null)} onClose={() => setStepUp(null)} /> : null}
    </div>
  )
}

/** 数の1枚：見出し・数・単位。 */
function Kpi({ label, value, unit, warn = false }: { label: string; value: number | null | undefined; unit: string; warn?: boolean }) {
  const text = value == null ? '—' : value.toLocaleString('ja-JP')
  return (
    <div className={styles.kpi}>
      <span className={styles.kpiLabel}>{label}</span>
      <span className={`${styles.kpiValue} ${warn && (value ?? 0) > 0 ? styles.kpiWarn : ''}`}>{text}</span>
      <span className={styles.kpiUnit}>{unit}</span>
    </div>
  )
}

/** アーカイブできない理由（API の blockers）を、運用者の言葉で。 */
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
