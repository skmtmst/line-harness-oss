'use client'

/*
 * ★V8 広告連携（Pencil：画面 `qSTVR`・広告費を手で入れる `ZxKL5`）。
 *
 * 頭（戻る・題・説明・右下に「費用を手で入れる」）→ 数の4枚 → 媒体の4枚 → 流入元ごとの費用 → 注 → 手で入れた費用。
 *
 * 呼ぶ口・権限・失敗の扱いは今の広告連携（app/inflow-links/ad-integration-v8.tsx の AdMetricsV8）と同じ
 * （BEHAVIOR.md の「広告連携」）。違うのは見せ方と、次の3つ：
 * - 送信履歴の口（/api/ad-platforms/logs）はこの画面に出す所が無いので呼ばない（履歴の画面は今のまま）
 * - 成果1件あたりは口（/api/ad-costs の conversionCost）が返す値を出す（今は「—」固定）
 * - 未接続の媒体の「つなぐ」は、今の広告とのつなぎ（v7）と同じ接続の窓を開く
 * 閲覧のみ（owner・admin 以外）には、費用を手で入れる・つなぐ・再読み込み・行の「…」・操作の行を出さない。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { AtSign, Check, Eye, Music, MoreHorizontal, Plug, Plus, RefreshCw, Search, Target, ThumbsUp, UserPlus, Wallet, XCircle } from 'lucide-react'
import type { EntryRoute } from '@line-crm/shared'
import { api, type AdPlatform } from '@/lib/api'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { formatNumber } from '@/lib/format'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import DateField from '@/components/shared/date-field'
import Dialog from '@/components/shared/dialog'
import IconButton from '@/components/shared/icon-button'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import { TextField } from '@/components/shared/text-field'
import AdConnectionDialog from './ad-connection-dialog'
import { DetailPage } from '@/components/templates'
import { focusField } from './focus-field'
import styles from './ads.module.css'

const PROVIDERS = [
  { key: 'google', label: 'Google広告', icon: Search },
  { key: 'meta', label: 'Meta広告', icon: ThumbsUp },
  { key: 'tiktok', label: 'TikTok', icon: Music },
  { key: 'x', label: 'X（旧Twitter）', icon: AtSign },
] as const

type AdCostRow = {
  sourceLabel: string
  adPlatformId: string | null
  entryRouteId: string | null
  source: 'import' | 'manual'
  totals: Array<{ currency: string; amountMinor: number }>
  friendAdds: number | null
  costPerFriendMinor: number | null
  lastImportedAt: string | null
}

type ManualCostEntry = {
  id: string
  sourceLabel: string
  day: string
  amountMinor: number
  currency: string
  entryRouteId: string | null
  cancelledAt: string | null
  cancelReason: string | null
  createdAt: string
}

type AdCostPlatformStatus = {
  id: string
  name: string
  displayName: string | null
  lastSuccessAt: string | null
  lastRunStatus: 'success' | 'failed' | null
  lastRunAt: string | null
  lastError: string | null
}

type ConversionCost = { confirmedConversionCount: number; costPerConversionMinor: number | null; currency: 'JPY' | null }

/** 費用の表示。最小通貨単位で来るので通貨に合わせて戻す。 */
function formatMinor(amountMinor: number, currency: string): string {
  const major = currency === 'JPY' ? amountMinor : amountMinor / 100
  return new Intl.NumberFormat('ja-JP', { style: 'currency', currency }).format(major)
}

/** 「10/1 6:00」の形（日本時間）。読めない値は null。 */
function shortJst(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: false, timeZone: 'Asia/Tokyo',
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('month')}/${get('day')} ${get('hour')}:${get('minute')}`
}

/** 「9/15」の形（費用の日付 YYYY-MM-DD）。 */
function shortDay(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  return match ? `${Number(match[2])}/${match[3]}` : day
}

function platformLabel(platform: Pick<AdPlatform, 'name' | 'displayName'>): string {
  return PROVIDERS.find((provider) => provider.key === platform.name)?.label ?? platform.displayName ?? platform.name
}

export default function AdsV8() {
  usePageTitle('広告連携')
  usePageCrumbs([{ label: 'ホーム', href: '/' }, { label: '流入と計測', href: '/inflow-links' }])
  const role = useStaffRole()
  const readonly = role !== null && !canManageRole(role)
  const { selectedAccountId } = useAccount()
  const loadGenerationRef = useRef(0)
  const latestAccountRef = useRef(selectedAccountId)
  latestAccountRef.current = selectedAccountId
  const [platforms, setPlatforms] = useState<AdPlatform[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [costRows, setCostRows] = useState<AdCostRow[]>([])
  const [costPlatforms, setCostPlatforms] = useState<AdCostPlatformStatus[]>([])
  const [conversionCost, setConversionCost] = useState<ConversionCost | null>(null)
  const [costFailed, setCostFailed] = useState(false)
  const [manualEntries, setManualEntries] = useState<ManualCostEntry[]>([])
  const [entryRoutes, setEntryRoutes] = useState<EntryRoute[]>([])
  const [canManage, setCanManage] = useState(false)
  const [importingId, setImportingId] = useState<string | null>(null)
  const [importError, setImportError] = useState('')
  const [connectionTarget, setConnectionTarget] = useState<{ key: string; label: string } | null>(null)
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const [cancelTarget, setCancelTarget] = useState<ManualCostEntry | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelBusy, setCancelBusy] = useState(false)
  const [cancelError, setCancelError] = useState('')
  const [cancelReasonError, setCancelReasonError] = useState('')
  const [manualOpen, setManualOpen] = useState(false)
  const [manualBusy, setManualBusy] = useState(false)
  const [manualError, setManualError] = useState('')
  const [manualLabel, setManualLabel] = useState('')
  const [manualRouteId, setManualRouteId] = useState('')
  const [manualDay, setManualDay] = useState('')
  const [manualAmount, setManualAmount] = useState('')
  const manage = canManage && !readonly

  const load = useCallback(async () => {
    const generation = ++loadGenerationRef.current
    const accountAtRequest = selectedAccountId
    if (!accountAtRequest) {
      setPlatforms([])
      setCostRows([])
      setCostPlatforms([])
      setFailed(false)
      setLoading(false)
      return
    }
    const isCurrent = () => generation === loadGenerationRef.current && accountAtRequest === latestAccountRef.current
    setLoading(true)
    setFailed(false)
    try {
      const [platformResponse, costResponse, routeResponse] = await Promise.all([
        api.adPlatforms.list(accountAtRequest),
        api.adCosts.list({ accountId: accountAtRequest }),
        api.entryRoutes.list(accountAtRequest),
      ])
      if (!isCurrent()) return
      if (!platformResponse.success) {
        setFailed(true)
        return
      }
      setPlatforms(platformResponse.data)
      if (routeResponse.success) setEntryRoutes(routeResponse.data)
      if (costResponse.success) {
        setCostRows((costResponse.data.rows ?? []) as AdCostRow[])
        setCostPlatforms((costResponse.data.platforms ?? []) as AdCostPlatformStatus[])
        setManualEntries((costResponse.data.manualEntries ?? []) as ManualCostEntry[])
        setConversionCost(costResponse.data.conversionCost ?? null)
        setCostFailed(false)
      } else {
        setCostRows([])
        setCostPlatforms([])
        setManualEntries([])
        setConversionCost(null)
        setCostFailed(true)
      }
    } catch {
      if (isCurrent()) setFailed(true)
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    setPlatforms([])
    void load()
    return () => {
      loadGenerationRef.current += 1
    }
  }, [load])

  useEffect(() => {
    if (!selectedAccountId) {
      setCanManage(false)
      return
    }
    let active = true
    void api.staff.me().then((response) => {
      if (active) setCanManage(response.success && (response.data.role === 'owner' || response.data.role === 'admin'))
    }).catch(() => undefined)
    return () => {
      active = false
    }
  }, [selectedAccountId])

  const [manualFieldErrors, setManualFieldErrors] = useState<Record<string, string>>({})

  const openManualEntry = () => {
    setManualError('')
    setManualFieldErrors({})
    setManualOpen(true)
  }

  const submitManualEntry = async () => {
    if (!selectedAccountId || manualBusy) return
    setManualError('')
    const amount = Number(manualAmount.replaceAll(',', ''))
    const errors: Record<string, string> = {}
    if (!manualLabel.trim()) errors['ad-cost-name'] = '流入元の名前を入れてください'
    if (!manualDay) errors['ad-cost-day'] = '費用の日付を選んでください'
    if (!manualAmount.trim()) errors['ad-cost-amount'] = '費用を入力してください'
    else if (!Number.isInteger(amount) || amount < 0) errors['ad-cost-amount'] = '費用は0以上の整数(円)で入れてください'
    setManualFieldErrors(errors)
    if (Object.keys(errors).length) { focusField(Object.keys(errors)[0]); return }
    setManualBusy(true)
    setManualError('')
    try {
      const res = await api.adCosts.create({
        lineAccountId: selectedAccountId,
        sourceLabel: manualLabel.trim(),
        entryRouteId: manualRouteId || undefined,
        day: manualDay,
        amountMinor: amount,
        currency: 'JPY',
      })
      if (!res.success) {
        setManualError(res.error ?? '記録できませんでした')
        return
      }
      setManualOpen(false)
      setManualLabel('')
      setManualRouteId('')
      setManualDay('')
      setManualAmount('')
      void load()
    } catch {
      setManualError('記録できませんでした。通信状態を確かめて、もう一度お試しください。')
    } finally {
      setManualBusy(false)
    }
  }

  const openCancel = (entry: ManualCostEntry) => {
    setCancelTarget(entry)
    setCancelReason('')
    setCancelError('')
    setCancelReasonError('')
  }

  const submitCancel = async () => {
    if (!cancelTarget || cancelBusy) return
    const reason = cancelReason.trim()
    if (!reason) {
      setCancelError('')
      setCancelReasonError('取り消す理由を入れてください')
      focusField('ad-cancel-reason')
      return
    }
    setCancelBusy(true)
    setCancelError('')
    try {
      const res = await api.adCosts.cancel(cancelTarget.id, reason)
      if (!res.success) {
        setCancelError(res.error ?? '取り消せませんでした')
        return
      }
      setCancelTarget(null)
      setSelectedEntryId(null)
      void load()
    } catch {
      setCancelError('取り消せませんでした。通信状態を確かめて、もう一度お試しください。')
    } finally {
      setCancelBusy(false)
    }
  }

  const runImportNow = async (platformId: string) => {
    if (importingId) return
    setImportingId(platformId)
    setImportError('')
    try {
      const res = await api.adPlatforms.importCost(platformId)
      if (!res.success) setImportError(res.error ?? '取り込めませんでした')
      void load()
    } catch {
      setImportError('取り込めませんでした。接続設定を確かめて、もう一度お試しください。')
    } finally {
      setImportingId(null)
    }
  }

  // 数の4枚。今の画面と同じ数え方（友だち1人あたりは計測リンクに結びついた円の行だけ）。
  const connected = platforms.filter((platform) => platform.isActive)
  const totalCostByCurrency = new Map<string, number>()
  for (const row of costRows) {
    for (const total of row.totals) totalCostByCurrency.set(total.currency, (totalCostByCurrency.get(total.currency) ?? 0) + total.amountMinor)
  }
  const linkedJpyRows = costRows.filter((row) => row.entryRouteId && row.totals.some((total) => total.currency === 'JPY'))
  const addsByRoute = new Map<string, number>()
  for (const row of linkedJpyRows) {
    if (row.entryRouteId && !addsByRoute.has(row.entryRouteId)) addsByRoute.set(row.entryRouteId, row.friendAdds ?? 0)
  }
  const linkedFriendAdds = [...addsByRoute.values()].reduce((sum, count) => sum + count, 0)
  const linkedJpyCost = linkedJpyRows.reduce((sum, row) => sum + (row.totals.find((total) => total.currency === 'JPY')?.amountMinor ?? 0), 0)
  const avgCostPerFriend = linkedFriendAdds > 0 ? Math.round(linkedJpyCost / linkedFriendAdds) : null
  const jpyTotal = totalCostByCurrency.get('JPY') ?? null
  const otherTotal = [...totalCostByCurrency].find(([currency]) => currency !== 'JPY') ?? null
  const routeById = new Map(entryRoutes.map((route) => [route.id, route]))
  const workerHost = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '')
  const selectedEntry = manualEntries.find((entry) => entry.id === selectedEntryId) ?? null

  if (!selectedAccountId) {
    return <ListState kind="empty" title="LINEアカウントを選択してください" description="選んだLINEアカウントの広告費だけを表示します。" />
  }

  return (
    <DetailPage boardId="qSTVR" title="広告連携" description="広告をつなぐと毎日自動で費用を取り込みます。取り込めない分（チラシや看板など）は「費用を手で入れる」から足せます。"
      contentPadding="0 var(--tpl-head-pad-side)"
      actions={manage ? <Button onClick={openManualEntry}><Plus size={15} aria-hidden="true" />費用を手で入れる</Button> : null}>
      <div className={styles.body}>
        {readonly ? (
          <p className={styles.viewerBand} role="status"><Eye size={16} aria-hidden="true" />閲覧のみで見ています。変える操作は管理者に頼んでください。</p>
        ) : null}
        {loading && platforms.length === 0 ? (
          <ListState kind="loading" title="広告連携を読み込んでいます" />
        ) : failed ? (
          <ListState
            kind="error"
            title="広告との接続状況を表示できませんでした"
            description="接続設定は消えていません。状態を読み直して、もう一度お試しください。"
            action={<Button onClick={() => void load()}>広告の状態を再読み込み</Button>}
          />
        ) : <>
          {/* 数の帯は共通部品（KpiBand）。絵は離れた4枚だが、帯の決まり（数の帯は共通部品）を優先する。 */}
          <KpiBand aria-label="広告連携の概要">
              <KpiCard icon={<Wallet size={13} aria-hidden="true" />} title="この30日の広告費"
                value={null} unit=""
                valueText={jpyTotal != null ? `¥${formatNumber(jpyTotal)}` : otherTotal ? formatMinor(otherTotal[1], otherTotal[0]) : '—'}
                detail="選んだ LINE アカウントの分だけ" />
              <KpiCard icon={<Plug size={13} aria-hidden="true" />} title="つないだ広告" value={connected.length} unit="件"
                detail={connected.length > 0 ? connected.map(platformLabel).join('・') : 'まだ接続がありません'} />
              <KpiCard icon={<UserPlus size={13} aria-hidden="true" />} title="友だち1人あたり"
                value={null} unit="" valueText={avgCostPerFriend != null ? `¥${formatNumber(avgCostPerFriend)}` : '—'}
                detail={`友だち追加 ${formatNumber(linkedFriendAdds)} 人`} />
              <KpiCard icon={<Target size={13} aria-hidden="true" />} title="成果1件あたり"
                value={null} unit=""
                valueText={conversionCost?.costPerConversionMinor != null && conversionCost.currency ? formatMinor(conversionCost.costPerConversionMinor, conversionCost.currency) : '—'}
                detail={conversionCost ? `成果 ${formatNumber(conversionCost.confirmedConversionCount)} 件` : '成果の件数を読み込めませんでした'} />
          </KpiBand>

          <div className={styles.providers} role="list" aria-label="媒体ごとの接続">
            {PROVIDERS.map((provider) => {
              const platform = platforms.find((item) => item.name === provider.key)
              const active = platform?.isActive === true
              const status = platform ? costPlatforms.find((item) => item.id === platform.id) : undefined
              const synced = shortJst(status?.lastSuccessAt) ?? shortJst(platform?.config.synced_at)
              const Icon = provider.icon
              return (
                <div key={provider.key} className={styles.provider} role="listitem">
                  <div className={styles.providerHead}>
                    <Icon size={16} aria-hidden="true" className={styles.providerIcon} />
                    <span className={styles.providerName}>{provider.label}</span>
                    {active
                      ? <StatusBadge tone="success" size="compact">つないでいる</StatusBadge>
                      : <StatusBadge tone="neutral" size="compact">未接続</StatusBadge>}
                  </div>
                  <p className={styles.providerSub} title={status?.lastRunStatus === 'failed' && status.lastError ? `直近は取り込めませんでした（${status.lastError}）` : undefined}>
                    {active ? `最後の取り込み ${synced ?? '—'}・毎日自動` : 'つなぐと費用とクリックを毎日取り込みます'}
                  </p>
                  {manage ? (
                    <span>
                      {active && platform ? (
                        <Button
                          disabled={importingId === platform.id}
                          busy={importingId === platform.id}
                          busyLabel="取り込んでいます…"
                          onClick={() => void runImportNow(platform.id)}
                        >
                          <RefreshCw size={15} aria-hidden="true" />広告の状態を再読み込み
                        </Button>
                      ) : (
                        <Button onClick={() => setConnectionTarget({ key: provider.key, label: provider.label })}>
                          <Plug size={15} aria-hidden="true" />つなぐ
                        </Button>
                      )}
                    </span>
                  ) : null}
                </div>
              )
            })}
          </div>
          {importError ? <p className={styles.error} role="alert">{importError}</p> : null}

          <h2 className={styles.sectionTitle} id="ads-costs">流入元ごとの費用</h2>
          {costFailed ? (
            <ListState
              kind="error"
              title="広告費を読み込めませんでした"
              description="記録は消えていません。もう一度読み込んでください。"
              action={<Button onClick={() => void load()}>もう一度読み込む</Button>}
            />
          ) : costRows.length === 0 ? (
            <ListState
              kind="empty"
              title="まだ費用の記録がありません"
              description="広告をつなぐと毎日自動で取り込みます。取り込めない分は「費用を手で入れる」から足せます。"
            />
          ) : (
            <div className={styles.table} role="table" aria-labelledby="ads-costs">
              <div className={styles.tableHead} role="row">
                <span className={styles.colSource} role="columnheader">流入元</span>
                <span className={styles.colMedia} role="columnheader">媒体</span>
                <span className={styles.colLink} role="columnheader">計測リンク</span>
                <span className={styles.colCost} role="columnheader">この30日の費用</span>
                <span className={styles.colNum} role="columnheader">友だち追加</span>
                <span className={styles.colNum} role="columnheader">1人あたり</span>
                <span className={styles.colImport} role="columnheader">取り込み</span>
              </div>
              {costRows.map((row) => {
                const platform = platforms.find((item) => item.id === row.adPlatformId)
                const route = row.entryRouteId ? routeById.get(row.entryRouteId) : undefined
                const link = route ? `${workerHost}/r/${route.refCode}` : null
                const cost = row.totals.length === 0 ? '—' : row.totals.map((total) => formatMinor(total.amountMinor, total.currency)).join(' ')
                return (
                  <div key={`${row.sourceLabel}|${row.adPlatformId ?? ''}|${row.entryRouteId ?? ''}`} className={styles.tableRow} role="row">
                    <span className={styles.colSource} role="cell"><span className={styles.cell} title={route ? `${route.name}（${row.sourceLabel}）` : row.sourceLabel}>{route?.name ?? row.sourceLabel}</span></span>
                    <span className={styles.colMedia} role="cell"><span className={styles.cell}>{platform ? platformLabel(platform) : row.source === 'manual' ? '手入力' : '—'}</span></span>
                    <span className={styles.colLink} role="cell"><span className={styles.cell} title={link ?? undefined}>{link ?? '—'}</span></span>
                    <span className={styles.colCost} role="cell"><span className={row.totals.length === 0 ? styles.faint : undefined}>{cost}</span></span>
                    <span className={styles.colNum} role="cell">{row.friendAdds == null ? '—' : formatNumber(row.friendAdds)}</span>
                    <span className={styles.colNum} role="cell">
                      <span className={row.costPerFriendMinor == null ? styles.faint : undefined}>
                        {row.costPerFriendMinor == null ? '—' : formatMinor(row.costPerFriendMinor, row.totals[0]?.currency ?? 'JPY')}
                      </span>
                    </span>
                    <span className={styles.colImport} role="cell">
                      {row.source === 'manual'
                        ? <StatusBadge tone="neutral" size="compact">手入力</StatusBadge>
                        : <StatusBadge tone="success" size="compact">自動</StatusBadge>}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
          <p className={styles.notice}>取り込んだ費用と手入力の分です。取れない日は「—」になります。秘密の鍵は画面に表示しません。中継リンクを通った人だけ広告と結びつきます。</p>

          {manualEntries.length > 0 ? (
            <section className={styles.card} aria-labelledby="ads-manual">
              <h2 className={styles.cardTitle} id="ads-manual">手で入れた費用</h2>
              <p className={styles.lead}>行の「…」から取り消すと、その日の費用は集計から外れます。</p>
              {manualEntries.map((entry) => {
                const cancelled = entry.cancelledAt != null
                const route = entry.entryRouteId ? routeById.get(entry.entryRouteId) : undefined
                return (
                  <div key={entry.id} className={styles.entryRow} data-selected={selectedEntryId === entry.id || undefined} data-cancelled={cancelled || undefined}>
                    <span className={styles.entryDay} title={entry.day}>
                      {shortDay(entry.day)}
                      {cancelled ? <span className={styles.faint}>{`　取り消し済み（${entry.cancelReason ?? '理由の記録なし'}）`}</span> : null}
                    </span>
                    <span className={styles.entrySource} title={entry.sourceLabel}>{route?.name ?? entry.sourceLabel}</span>
                    <span className={styles.entryAmount}>{formatMinor(entry.amountMinor, entry.currency)}</span>
                    <span className={styles.entryWho} title={`記録した日時 ${shortJst(entry.createdAt) ?? '—'}`}>{`記録 ${shortJst(entry.createdAt)?.split(' ')[0] ?? '—'}`}</span>
                    <span className={styles.entryMenu}>
                      {manage && !cancelled ? (
                        <IconButton
                          title={`${shortDay(entry.day)} ${entry.sourceLabel}の操作`}
                          aria-label={`${shortDay(entry.day)} ${entry.sourceLabel}の操作`}
                          aria-expanded={selectedEntryId === entry.id}
                          aria-controls="ads-entry-actions"
                          onClick={() => setSelectedEntryId((current) => (current === entry.id ? null : entry.id))}
                        >
                          <MoreHorizontal size={16} aria-hidden="true" />
                        </IconButton>
                      ) : null}
                    </span>
                  </div>
                )
              })}
              {manage ? (
                <div className={styles.rowActions} id="ads-entry-actions" role="group" aria-label="選んだ費用の操作">
                  <span className={styles.rowActionsLabel}>{selectedEntry ? `「${shortDay(selectedEntry.day)} ${selectedEntry.sourceLabel}」の操作：` : '「…」を開いたとき：'}</span>
                  <Button disabled={!selectedEntry} onClick={() => selectedEntry && openCancel(selectedEntry)}>
                    <XCircle size={15} aria-hidden="true" />取り消す
                  </Button>
                </div>
              ) : null}
            </section>
          ) : null}
        </>}
      </div>

      <Dialog
        open={manualOpen}
        title="広告費を手で入れる"
        description="媒体から取り込めない分（チラシや看板など）を日ごとに記録します。"
        designNode="ZxKL5"
        designWidth={520}
        designTop={225}
        confirmLabel="記録する"
        confirmIcon={<Check size={15} aria-hidden="true" />}
        busy={manualBusy}
        error={manualError || undefined}
        onConfirm={() => void submitManualEntry()}
        onCancel={() => { if (!manualBusy) setManualOpen(false) }}
      >
        <div className={styles.dialogBody}>
          <label className={styles.field}>
            <span className={styles.label}>流入元の名前</span>
            <TextField id="ad-cost-name" aria-invalid={Boolean(manualFieldErrors['ad-cost-name'])} aria-describedby={manualFieldErrors['ad-cost-name'] ? 'ad-cost-name-error' : undefined} value={manualLabel} onChange={(event) => { setManualLabel(event.target.value); setManualFieldErrors((old) => ({ ...old, 'ad-cost-name': '' })) }} placeholder="例: 駅前の看板" maxLength={100} title="同じ流入元・同じ日に入れ直すと上書きになります" />
            {manualFieldErrors['ad-cost-name'] ? <span id="ad-cost-name-error" className={styles.error} role="alert">{manualFieldErrors['ad-cost-name']}</span> : null}
          </label>
          <div className={styles.field}>
            <span className={styles.pickLabel}>計測リンク（分かれば）</span>
            <Select
              aria-label="計測リンク（分かれば）"
              size="full"
              value={manualRouteId}
              onChange={(value) => {
                setManualRouteId(value)
                const route = entryRoutes.find((item) => item.id === value)
                if (route && !manualLabel.trim()) setManualLabel(route.name)
              }}
              options={[{ value: '', label: '結びつけない' }, ...entryRoutes.map((route) => ({ value: route.id, label: route.name }))]}
            />
          </div>
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <span className={styles.label}>費用の日付</span>
              <DateField id="ad-cost-day" invalid={Boolean(manualFieldErrors['ad-cost-day'])} aria-describedby={manualFieldErrors['ad-cost-day'] ? 'ad-cost-day-error' : undefined} value={manualDay} onChange={(value) => { setManualDay(value); setManualFieldErrors((old) => ({ ...old, 'ad-cost-day': '' })) }} aria-label="費用の日付" />
              {manualFieldErrors['ad-cost-day'] ? <span id="ad-cost-day-error" className={styles.error} role="alert">{manualFieldErrors['ad-cost-day']}</span> : null}
            </div>
            <label className={styles.field}>
              <span className={styles.label}>費用（円）</span>
              <TextField id="ad-cost-amount" aria-invalid={Boolean(manualFieldErrors['ad-cost-amount'])} aria-describedby={manualFieldErrors['ad-cost-amount'] ? 'ad-cost-amount-error' : undefined} inputMode="numeric" value={manualAmount} onChange={(event) => { setManualAmount(event.target.value); setManualFieldErrors((old) => ({ ...old, 'ad-cost-amount': '' })) }} placeholder="例: 30000" />
              {manualFieldErrors['ad-cost-amount'] ? <span id="ad-cost-amount-error" className={styles.error} role="alert">{manualFieldErrors['ad-cost-amount']}</span> : null}
            </label>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={cancelTarget !== null}
        title="この費用を取り消す"
        description="取り消すと集計と「1人あたり」から外れます。記録そのものは残り、取り消した理由と日時が履歴に残ります。同じ流入元・同じ日に入れ直すと新しい記録として戻ります。"
        confirmLabel="取り消す"
        busy={cancelBusy}
        error={cancelError || undefined}
        onConfirm={() => void submitCancel()}
        onCancel={() => { if (!cancelBusy) setCancelTarget(null) }}
      >
        {cancelTarget ? (
          <div className={styles.dialogBody}>
            <p className={styles.dialogLead}>{`対象: ${cancelTarget.day} ／ ${cancelTarget.sourceLabel} ／ ${formatMinor(cancelTarget.amountMinor, cancelTarget.currency)}`}</p>
            <label className={styles.field}>
              <span className={styles.label}>取り消す理由（必須）</span>
              <TextField id="ad-cancel-reason" aria-invalid={Boolean(cancelReasonError)} aria-describedby={cancelReasonError ? 'ad-cancel-reason-error' : undefined} value={cancelReason} onChange={(event) => { setCancelReason(event.target.value); setCancelReasonError('') }} placeholder="例: 金額を間違えた" maxLength={200} />
              {cancelReasonError ? <span id="ad-cancel-reason-error" className={styles.error} role="alert">{cancelReasonError}</span> : null}
            </label>
          </div>
        ) : null}
      </Dialog>

      {connectionTarget && selectedAccountId ? (
        <AdConnectionDialog
          key={`${selectedAccountId}:${connectionTarget.key}`}
          provider={connectionTarget}
          platform={platforms.find((item) => item.name === connectionTarget.key)}
          accountId={selectedAccountId}
          onClose={() => setConnectionTarget(null)}
          onSaved={load}
        />
      ) : null}
    </DetailPage>
  )
}
