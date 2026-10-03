'use client'

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import Header from '@/components/layout/header'
import { useAccount, type AccountWithStats } from '@/contexts/account-context'
import { ApiError } from '@/lib/api'
import StoreContextBanner from './stores/store-context-banner'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import HelpTip from '@/components/shared/help-tip'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import Select from '@/components/shared/select'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import DateTimeField from '@/components/shared/date-time-field'
import {
  restaurantTestApi,
  type ReservationQuery,
  type RestaurantApproval,
  type RestaurantIntakeAddress,
  type RestaurantInventory,
  type RestaurantLineFlow,
  type RestaurantSnapshot,
  type RestaurantStore,
} from '@/lib/restaurant-test-api'
import { formatDateTime, formatTime, formatYen } from '@/lib/format'

const viewMeta = {
  dashboard: ['店舗ダッシュボード', '全店舗の予約・空席・連携状態を、本部からまとめて確認します。'],
  organization: ['組織・権限', '本部・店舗・スタッフの閲覧範囲と承認権限を管理します。'],
  approvals: ['承認ワークフロー', 'Google投稿・LINE配信・メニュー改定を公開前に確認します。'],
  reservations: ['予約台帳', '予約媒体・LINE・電話の予約を、一つの時間軸で確認します。'],
  tables: ['座席・卓管理', 'フロア配置、席種、収容人数、結合ルールを管理します。'],
  inventory: ['予約枠・在庫', '時間帯ごとの総枠と、媒体・LINE・当日枠の配分を確認します。'],
  menu: ['メニュー管理', 'コースと単品、価格、アレルギー、提供時間帯を管理します。'],
  'line-followup': ['LINE来店フォロー', '予約前・来店後・口コミ依頼・会員証をカード型で設計します。'],
} as const

type ViewKey = keyof typeof viewMeta

const sourceLabel: Record<string, string> = {
  restaurant_board: 'レストランボード', reszaiko: 'RESZAIKO', hotpepper: 'Hot Pepper',
  tabelog: '食べログ', gurunavi: 'ぐるなび', ikyu: '一休', retty: 'Retty',
  line: 'LINE', phone: '電話', manual: '手動', google_business_profile: 'Google',
}

const sourceTone: Record<string, string> = {
  restaurant_board: 'bg-success-bg text-success', reszaiko: 'bg-info-bg text-info',
  hotpepper: 'bg-danger-bg text-danger', tabelog: 'bg-warning-bg text-warning',
  gurunavi: 'bg-warning-bg text-warning', ikyu: 'bg-info-bg text-info',
  retty: 'bg-action-soft text-action', line: 'bg-accent-soft text-accent-deep',
  phone: 'bg-canvas-sunken text-ink-secondary', manual: 'bg-canvas-sunken text-ink-secondary',
}

function formatDate(value: string, withDate = true) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return withDate ? formatDateTime(date) : formatTime(date)
}

function yen(value: number) {
  return formatYen(value)
}

function safeArray(value: string): string[] {
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : [] } catch { return [] }
}

function Status({ value }: { value: string }) {
  const good = ['connected', 'active', 'approved', 'completed', 'visited', 'confirmed'].includes(value)
  const warning = ['warning', 'pending', 'draft', 'scheduled', 'unreplied'].includes(value)
  const labels: Record<string, string> = {
    connected: '正常', active: '有効', invited: '招待中', suspended: '停止中', archived: '保管済', approved: '承認済', completed: '完了', visited: '来店済',
    confirmed: '予約確定', warning: '要確認', pending: '承認待ち', draft: '下書き', scheduled: '予約済',
    unreplied: '未返信', unconfigured: '未設定', disabled: '無効', error: 'エラー', returned: '差戻し',
    seated: '来店中', cancelled: '取消', no_show: '無断キャンセル', preview_only: 'プレビューのみ',
  }
  return <span className={`inline-flex rounded-pill px-2 py-1 text-micro font-bold ${good ? 'bg-success-bg text-success' : warning ? 'bg-warning-bg text-warning' : 'bg-canvas-sunken text-ink-secondary'}`}>{labels[value] || value}</span>
}

function TestBoundary() {
  return <div className="mb-5 flex flex-col gap-3 rounded-card border border-nen-border bg-nen-ivory px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
    <div><span className="mr-2 inline-flex rounded-pill bg-nen-green px-2.5 py-1 text-xs font-medium text-on-accent">検証環境専用</span><span className="text-nen-copy">既存の運用とは分離された飲食店向けテスト領域です。</span></div>
    <div className="flex items-center gap-2 font-semibold text-nen-green"><span className="h-2 w-2 rounded-pill bg-nen-gold" />予約媒体は受信専用・外部更新なし</div>
  </div>
}

function Metric({ label, value, note, tone = 'normal', helpLabel, help }: { label: string; value: ReactNode; note: string; tone?: 'normal' | 'warning' | 'danger'; helpLabel?: string; help?: ReactNode }) {
  return <div className="rounded-card border border-hairline bg-canvas p-4 shadow-card">
    <p className="flex items-center gap-1 text-xs font-semibold text-ink-faint">{label}{help && helpLabel ? <HelpTip label={helpLabel}>{help}</HelpTip> : null}</p>
    <p className={`mt-2 text-2xl font-bold tabular-nums ${tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-ink'}`}>{value}</p>
    <p className="mt-1 text-xs text-ink-faint">{note}</p>
  </div>
}

function Panel({ title, description, action, children, className = '' }: { title: string; description?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`overflow-hidden rounded-card border border-hairline bg-canvas ${className}`}>
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-hairline px-5 py-4">
      <div><h2 className="font-bold text-ink">{title}</h2>{description && <p className="mt-1 text-xs text-ink-faint">{description}</p>}</div>{action}
    </div>
    <div>{children}</div>
  </section>
}

function EmptySetup() {
  return <div className="rounded-card border border-nen-border bg-canvas p-10 text-center">
    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-pill bg-nen-ivory text-2xl text-nen-gold">店</div>
    <h2 className="mt-5 text-xl font-bold text-nen-green">店舗が登録されていません</h2>
    <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-ink-secondary">統括から店舗を登録してください。</p>
  </div>
}

export default function RestaurantConsole({ view }: { view: string }) {
  const activeView: ViewKey = view in viewMeta ? view as ViewKey : 'dashboard'
  const { accounts, selectedAccountId } = useAccount()
  const [snapshot, setSnapshot] = useState<RestaurantSnapshot | null>(null)
  const [selectedStoreId, setSelectedStoreId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  /*
   * D024: 取得失敗を未登録（EmptySetup）と混ぜない。理由は帯に残し、
   * ここでは理由と読み直し口だけを出す。機能自体は変えない。
   */
  const [loadError, setLoadError] = useState<unknown>(null)
  // R103: 台帳の絞り込み条件は台帳画面が持ち、ダッシュボードは今後の有効予約だけを読む。
  const [todayStartIso] = useState(() => { const day = new Date(); day.setHours(0, 0, 0, 0); return day.toISOString() })
  const [ledgerQuery, setLedgerQuery] = useState<ReservationQuery | null>(null)
  const effectiveQuery = useMemo(() => activeView === 'reservations'
    ? (ledgerQuery ?? { from: todayStartIso, limit: 100, offset: 0 })
    : activeView === 'dashboard'
      ? { from: todayStartIso, status: 'pending,confirmed,seated,visited', limit: 500, offset: 0 }
      : undefined, [activeView, ledgerQuery, todayStartIso])

  const load = useCallback(async () => {
    if (!selectedAccountId) { setSnapshot(null); setLoadError(null); setLoading(false); return }
    setLoading(true)
    try {
      const res = await restaurantTestApi.snapshot(selectedAccountId, effectiveQuery)
      setSnapshot(res.data)
      setLoadError(null)
      setSelectedStoreId((current) => res.data.stores.some((item) => item.id === current)
        ? current
        : res.data.stores[0]?.id || '')
    } catch (caught) {
      /*
       * R619: 読み込み失敗は下の ListState の1枚に集める。ここで帯にも
       * 出すと「読めません」と「店舗未登録」が同時に並ぶ。操作の成否の
       * 帯（mutate 側）は残す。
       */
      setLoadError(caught)
    }
    finally { setLoading(false) }
  }, [selectedAccountId, effectiveQuery])
  useEffect(() => { void load() }, [load])

  const mutate = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true)
    try { await action(); await load(); setNotice({ tone: 'success', text: success }); return true }
    catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : '保存できませんでした。' }); return false }
    finally { setBusy(false) }
  }

  const store = selectedStoreId ? snapshot?.stores.find((item) => item.id === selectedStoreId) || null : null
  return <>
    <StoreContextBanner />
    <Header title={viewMeta[activeView][0]} description={viewMeta[activeView][1]} />
    <TestBoundary />
    {notice && <div className={`mb-4 rounded-control border px-4 py-3 text-sm ${notice.tone === 'success' ? 'border-success bg-success-bg text-success' : 'border-danger bg-danger-bg text-danger'}`}>{notice.text}</div>}
    {loading ? <div className="rounded-card border border-hairline bg-canvas p-16 text-center text-sm text-ink-faint">読み込み中…</div>
      : loadError !== null && !snapshot?.organization ? <ListState kind="error" error={loadError} onRetry={() => void load()} />
      : !snapshot?.organization ? <EmptySetup />
      : activeView === 'dashboard' ? <Dashboard data={snapshot} />
      : activeView === 'organization' ? <Organization
        accountId={selectedAccountId!}
        accounts={accounts}
        data={snapshot}
        selectedStoreId={selectedStoreId}
        busy={busy}
        create={(body) => mutate(() => restaurantTestApi.createMembership(selectedAccountId!, body), '飲食店向けの名簿へ追加しました。この登録だけではログイン権限は変わりません。')}
        update={(id, body) => mutate(() => restaurantTestApi.updateMembership(selectedAccountId!, id, body), '所属ユーザーを更新しました。ログイン権限は変わりません。')}
        createStore={(body) => mutate(() => restaurantTestApi.createStore(selectedAccountId!, body), '店舗を追加しました。')}
        updateStore={(id, body) => mutate(() => restaurantTestApi.updateStore(selectedAccountId!, id, body), '店舗情報を更新しました。')}
      />
      : activeView === 'approvals' ? <Approvals data={snapshot} busy={busy} decide={(id, action) => mutate(() => restaurantTestApi.decideApproval(selectedAccountId!, id, action), action === 'approve' ? '承認しました。外部公開は行っていません。' : '差し戻しました。')} />
      : activeView === 'reservations' ? <Reservations data={snapshot} store={store} busy={busy} query={effectiveQuery ?? { limit: 100, offset: 0 }} total={snapshot.reservationTotal ?? 0} todayStartIso={todayStartIso} onQueryChange={setLedgerQuery} create={(body) => mutate(() => restaurantTestApi.createReservation(selectedAccountId!, body), '予約台帳へ登録しました。')} importInbound={(body) => mutate(() => restaurantTestApi.importReservation(selectedAccountId!, body), '受信専用データとして取り込みました。')} update={(id, body, success) => mutate(() => restaurantTestApi.updateReservation(selectedAccountId!, id, body), success)} />
      : activeView === 'tables' ? <Tables data={snapshot} store={store} busy={busy} create={(body) => mutate(() => restaurantTestApi.createTable(selectedAccountId!, body), '卓を追加しました。')} update={(id, body) => mutate(() => restaurantTestApi.updateTable(selectedAccountId!, id, body), '卓を更新しました。')} />
      : activeView === 'inventory' ? <Inventory data={snapshot} store={store} busy={busy} save={(row, body) => mutate(() => restaurantTestApi.updateInventory(selectedAccountId!, row.id, body), '予約枠を更新しました。外部媒体へは反映していません。')} />
      : activeView === 'menu' ? <Menu data={snapshot} store={store} busy={busy} create={(body) => mutate(() => restaurantTestApi.createMenu(selectedAccountId!, body), 'メニューを追加しました。')} update={(id, body) => mutate(() => restaurantTestApi.updateMenu(selectedAccountId!, id, body), 'メニューを更新しました。')} />
      : <LineFollowup data={snapshot} store={store} busy={busy} save={(flow, patch) => mutate(() => restaurantTestApi.updateLineFlow(selectedAccountId!, flow.id, patch), 'LINEカード設定を保存しました。送信はまだ行いません。')} />}
  </>
}

function scoped<T extends { store_id: string }>(rows: T[], storeId: string) { return storeId ? rows.filter((row) => row.store_id === storeId) : rows }

function Dashboard({ data }: { data: RestaurantSnapshot }) {
  // R104: 集計は今日以降の有効予約だけを見る。過去の来店済みは含めない。
  const nowIso = new Date().toISOString()
  const upcoming = data.reservations.filter((r) => r.starts_at >= nowIso && !['cancelled', 'no_show'].includes(r.status))
  const guestCount = upcoming.reduce((sum, r) => sum + r.guest_count, 0)
  const totalCapacity = data.stores.reduce((sum, item) => sum + item.capacity, 0)
  const unreplied = data.reviews.filter((r) => r.reply_status === 'unreplied').length
  const priceOf = (courseId: string | null) => data.menuItems.find((m) => m.id === courseId)?.price ?? null
  const priced = upcoming.filter((r) => priceOf(r.course_id) !== null)
  const revenue = priced.reduce((sum, r) => sum + r.guest_count * (priceOf(r.course_id) || 0), 0)
  const lineIssues = data.stores.filter((item) => item.line_status === 'error').length
  const connectorIssues = data.connectors.filter((c) => ['error', 'warning'].includes(c.status)).length
  const issues = lineIssues + connectorIssues
  return <div className="space-y-5">
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <Metric label="予約数" value={`${upcoming.length}件`} note="今日以降の有効予約" helpLabel="予約数の説明" help="今日以降に開始する、取消・無断キャンセルでない予約の件数です。" />
      <Metric label="ご来店予定" value={`${guestCount}名`} note="今日以降の人数合計" helpLabel="ご来店予定の説明" help="今日以降の有効予約の人数の合計です。来店済みの過去分は含みません。" />
      <Metric label="空席率" value={`${Math.max(0, Math.round((1 - guestCount / Math.max(totalCapacity, 1)) * 100))}%`} note="全店舗の概算" helpLabel="空席率の説明" help="分母は全店舗の収容数の合計、分子は今日以降の有効予約の人数の合計です。時間帯ごとの空きではありません。" />
      <Metric label="売上予測" value={priced.length ? yen(revenue) : '—'} note={priced.length ? `コース設定 ${priced.length}件分` : 'コース設定がありません'} helpLabel="売上予測の説明" help="コース単価×人数の合計です。席のみ（コース未設定）の予約は含みません。固定の客単価では計算しません。" />
      <Metric label="未返信口コミ" value={`${unreplied}件`} note="Google口コミ" tone={unreplied ? 'warning' : 'normal'} />
    </div>
    <Panel title="店舗一覧" description="本部から全店の予約と接続状態を確認します。" action={<span className={`text-xs font-medium ${issues ? 'text-warning' : 'text-success'}`}>{issues ? `${issues}件の要確認` : 'すべて正常'}</span>}>
      <DataTable className="rounded-none border-0"><thead><TableHeadRow>{['店舗', 'エリア', '予約', '予定人数', '収容数', 'LINE', 'Google', '予約媒体'].map((h) => <Th key={h}>{h}</Th>)}</TableHeadRow></thead><tbody>{data.stores.map((item) => {
        const reservations = upcoming.filter((r) => r.store_id === item.id)
        const connector = data.connectors.find((c) => c.store_id === item.id && c.provider === 'restaurant_board')
        return <Tr key={item.id} interactive><Td className="font-semibold text-action">{item.name}<p className="mt-0.5 text-xs font-normal text-ink-faint">{item.code}</p></Td><Td>{item.area || '—'}</Td><Td className="font-semibold">{reservations.length}件</Td><Td>{reservations.reduce((s, r) => s + r.guest_count, 0)}名</Td><Td>{item.capacity}席</Td><Td><Status value={item.line_status} /></Td><Td><Status value={item.google_status} /></Td><Td><Status value={connector?.status || 'unconfigured'} /></Td></Tr>
      })}</tbody></DataTable>
    </Panel>
    <div className="grid gap-4 lg:grid-cols-2"><Panel title="全店アクション" description="検証中は下書き作成まで。外部配信は行いません。"><div className="grid gap-3 p-5 sm:grid-cols-2"><Button variant="secondary" className="bg-canvas-sunken px-4 py-3 font-bold text-ink-faint h-auto whitespace-normal" disabled>Google一斉投稿（未接続）</Button><Button variant="secondary" className="bg-canvas-sunken px-4 py-3 font-bold text-ink-faint h-auto whitespace-normal" disabled>LINE一斉配信（未接続）</Button></div></Panel><Panel title="同期方針" description="安全な検証のため固定しています。"><div className="p-5 text-sm leading-6 text-ink-secondary"><p className="font-bold text-nen-green">レストランボード中心の一方向受信</p><p className="mt-1">取得できない媒体は個別受信口を追加します。予約台帳から外部媒体への在庫・予約更新は0件です。</p></div></Panel></div>
  </div>
}

const roleLabel = { super_admin: 'SuperAdmin', store_manager: 'StoreManager', staff: 'Staff' }
function intakeAddressError(error: unknown): string {
  if (error instanceof ApiError && error.status === 503) return '取り込み用ドメインが未設定です'
  if (error instanceof ApiError && error.status === 403) return '取り込みアドレスはオーナーまたは管理者だけが確認できます。'
  return '取り込みアドレスを読み込めませんでした。'
}

function intakeDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '日時不明'
  return formatDateTime(date)
}

function IntakeAddressPanel({ accountId, store }: { accountId: string; store: RestaurantStore | null }) {
  const [addresses, setAddresses] = useState<RestaurantIntakeAddress[]>([])
  const [loading, setLoading] = useState(false)
  const [issuing, setIssuing] = useState(false)
  const [reissueOpen, setReissueOpen] = useState(false)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [copiedId, setCopiedId] = useState('')
  const storeId = store?.id || ''

  const loadAddresses = useCallback(async () => {
    if (!accountId || !storeId) {
      setAddresses([])
      setError('')
      setActionError('')
      setNotice('')
      return
    }
    setLoading(true)
    setError('')
    setActionError('')
    setNotice('')
    try {
      const response = await restaurantTestApi.listIntakeAddresses(accountId, storeId)
      setAddresses(response.data)
    } catch (caught) {
      setAddresses([])
      setError(intakeAddressError(caught))
    } finally {
      setLoading(false)
    }
  }, [accountId, storeId])

  useEffect(() => { void loadAddresses() }, [loadAddresses])

  /*
    **確認はブラウザの `confirm()` を使わない。**
    見た目がブラウザ任せで設計の確認窓と違ううえ、**画像比較に写らない**ので
    確認の絵をそもそも撮れない。共通の確認窓（`ConfirmDialog`）で出す。
  */
  const issue = async () => {
    if (!storeId || error) return
    setReissueOpen(false)
    setIssuing(true)
    setNotice('')
    setActionError('')
    try {
      await restaurantTestApi.issueIntakeAddress(accountId, storeId)
      await loadAddresses()
      setNotice(addresses.length > 0 ? '新しいアドレスを発行しました。旧アドレスは90日後に失効します。' : '取り込みアドレスを発行しました。')
    } catch (caught) {
      setActionError(intakeAddressError(caught))
    } finally {
      setIssuing(false)
    }
  }

  const copy = async (item: RestaurantIntakeAddress) => {
    setActionError('')
    try {
      await navigator.clipboard.writeText(item.address)
      setCopiedId(item.id)
      window.setTimeout(() => setCopiedId((current) => current === item.id ? '' : current), 1500)
    } catch {
      setActionError('コピーできませんでした。アドレスを選択して手動でコピーしてください。')
    }
  }

  return <Panel title="予約メール取り込みアドレス" description="予約媒体から届く通知メールの転送先として設定します。">
    <div className="space-y-4 p-5">
      {!store ? <p className="text-sm text-ink-secondary">上部の店舗選択から、設定する店舗を選んでください。</p>
        : loading ? <p className="text-sm text-ink-faint">取り込みアドレスを確認中…</p>
        : error ? <div className="rounded-control border border-danger bg-danger-bg px-4 py-3 text-sm font-semibold text-danger">{error}</div>
        : <>
          <div className="rounded-control border border-warning/30 bg-warning-bg px-4 py-3 text-xs leading-5 text-warning">
            このアドレスは予約メールの専用受信口です。第三者へ共有せず、予約媒体の通知設定だけに使用してください。
          </div>
          {notice && <div className="rounded-control border border-success bg-success-bg px-4 py-3 text-sm font-semibold text-success">{notice}</div>}
          {actionError && <div className="rounded-control border border-danger bg-danger-bg px-4 py-3 text-sm font-semibold text-danger">{actionError}</div>}
          {addresses.length === 0 ? <div className="rounded-control border border-dashed border-hairline px-4 py-6 text-center"><p className="font-bold text-ink">未発行</p></div>
            : <div className="space-y-3">{addresses.map((item) => <div key={item.id} className="rounded-control border border-hairline bg-canvas-sunken p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-ink-secondary">{item.revokedAt ? `${intakeDate(item.revokedAt)}まで有効` : '現在使用中'}</p>
                <Status value={item.status} />
              </div>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input aria-label={`${store.name}の取り込みアドレス`} readOnly value={item.address} className="min-w-0 flex-1 select-all rounded-control border border-hairline bg-canvas px-3 py-2 font-mono text-xs text-ink" />
                <button type="button" onClick={() => void copy(item)} className="whitespace-nowrap rounded-control border border-action px-4 py-2 text-xs font-semibold text-action hover:bg-action-soft">{copiedId === item.id ? 'コピー済み' : 'コピー'}</button>
              </div>
              <p className="mt-2 text-micro text-ink-faint">発行日時: {intakeDate(item.createdAt)}</p>
            </div>)}</div>}
          <div className="flex justify-end"><button type="button" disabled={issuing} onClick={() => { if (addresses.length > 0) setReissueOpen(true); else void issue() }} className="rounded-control bg-nen-green px-5 py-2.5 text-sm font-bold text-on-accent disabled:opacity-50">{issuing ? '発行中…' : 'アドレスを発行'}</button></div>
        </>}
    </div>
    <ConfirmDialog
      open={reissueOpen}
      title="新しい取り込みアドレスを発行しますか？"
      description="いまのアドレスは90日後に失効します。それまでに、媒体側の通知先を新しいアドレスへ変えてください。変えないと予約の取り込みが止まります。"
      confirmLabel="発行する"
      busy={issuing}
      onCancel={() => setReissueOpen(false)}
      onConfirm={() => void issue()}
    />
  </Panel>
}

type StoreCreateInput = {
  name: string; code: string; area: string; capacity: number; timezone: string; lineAccountId: string
}
type StoreUpdateInput = {
  name: string; code: string; area: string; capacity: number;
  status: RestaurantStore['status']; lineAccountId: string
}

function DefaultSelect({ name, ariaLabel, defaultValue, options }: {
  name: string
  ariaLabel: string
  defaultValue: string
  options: { value: string; label: string; disabled?: boolean }[]
}) {
  const [value, setValue] = useState(defaultValue)
  return <Select name={name} aria-label={ariaLabel} value={value} onChange={setValue} size="full" className="mt-1" options={options} />
}

function StoreLineAccountSelect({ accounts, stores, currentStore }: { accounts: AccountWithStats[]; stores: RestaurantStore[]; currentStore?: RestaurantStore }) {
  const usedByAccount = new Map(stores.filter((item) => item.line_account_id).map((item) => [item.line_account_id!, item.id]))
  return <label className="text-xs font-medium text-ink-secondary">LINE公式アカウント<span className="text-danger"> *</span>
    <DefaultSelect name="lineAccountId" ariaLabel="LINE公式アカウント" defaultValue={currentStore?.line_account_id || ''} options={[{ value: '', label: '選択してください' }, ...accounts.map((account) => {
        const usedStoreId = usedByAccount.get(account.id)
        const usedElsewhere = Boolean(usedStoreId && usedStoreId !== currentStore?.id)
        return { value: account.id, label: `${account.displayName || account.name}${usedElsewhere ? '（他店舗で使用中）' : ''}`, disabled: usedElsewhere }
      })]} />
  </label>
}

function StoreManagement({ accounts, data, busy, createStore, updateStore }: {
  accounts: AccountWithStats[]
  data: RestaurantSnapshot
  busy: boolean
  createStore: (body: StoreCreateInput) => void
  updateStore: (id: string, body: StoreUpdateInput) => void
}) {
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState('')
  const editingStore = data.stores.find((item) => item.id === editingId)
  const submitCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    createStore({
      name: String(form.get('name') || ''),
      code: String(form.get('code') || ''),
      area: String(form.get('area') || ''),
      capacity: Number(form.get('capacity')),
      timezone: String(form.get('timezone') || 'Asia/Tokyo'),
      lineAccountId: String(form.get('lineAccountId') || ''),
    })
  }
  const submitEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editingStore) return
    const form = new FormData(event.currentTarget)
    updateStore(editingStore.id, {
      name: String(form.get('name') || ''),
      code: String(form.get('code') || ''),
      area: String(form.get('area') || ''),
      capacity: Number(form.get('capacity')),
      status: String(form.get('status')) as RestaurantStore['status'],
      lineAccountId: String(form.get('lineAccountId') || ''),
    })
  }
  return <Panel title="店舗管理" description="1店舗につき1つのLINE公式アカウントを割り当てます。" action={<Button variant="primary" className="px-4 py-2 text-xs border-0 h-auto whitespace-normal" type="button" onClick={() => setShowCreate((value) => !value)}>店舗を追加する</Button>}>
    <div className="space-y-4 p-5">
      {showCreate && <InlineForm title="新しい店舗"><form onSubmit={submitCreate} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="店舗名" name="name" required />
        <Field label="店舗コード" name="code" required />
        <Field label="エリア" name="area" />
        <Field label="収容人数" name="capacity" type="number" defaultValue="24" required />
        <Field label="タイムゾーン" name="timezone" defaultValue="Asia/Tokyo" required />
        <StoreLineAccountSelect accounts={accounts} stores={data.stores} />
        <div className="flex items-end sm:col-span-2"><button disabled={busy} className="w-full rounded-control bg-nen-green px-4 py-2 text-sm font-bold text-on-accent disabled:opacity-50">店舗を登録する</button></div>
      </form></InlineForm>}
      {editingStore && <InlineForm title={`${editingStore.name}を編集`}><form key={editingStore.id} onSubmit={submitEdit} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="店舗名" name="name" defaultValue={editingStore.name} required />
        <Field label="店舗コード" name="code" defaultValue={editingStore.code} required />
        <Field label="エリア" name="area" defaultValue={editingStore.area || ''} />
        <Field label="収容人数" name="capacity" type="number" defaultValue={String(editingStore.capacity)} required />
        <label className="text-xs font-medium text-ink-secondary">状態<DefaultSelect name="status" ariaLabel="状態" defaultValue={editingStore.status} options={[{ value: 'active', label: '有効' }, { value: 'paused', label: '一時停止' }, { value: 'archived', label: 'アーカイブ' }]} /></label>
        <StoreLineAccountSelect accounts={accounts} stores={data.stores} currentStore={editingStore} />
        <div className="flex items-end sm:col-span-2"><button disabled={busy} className="w-full rounded-control bg-nen-green px-4 py-2 text-sm font-bold text-on-accent disabled:opacity-50">保存する</button></div>
      </form></InlineForm>}
      <div className="divide-y divide-hairline rounded-control border border-hairline">{data.stores.map((store) => <div key={store.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div><div className="flex items-center gap-2"><p className="font-semibold text-ink">{store.name}</p><Status value={store.status} /></div><p className="mt-1 text-xs text-ink-faint">{store.code} · {store.area || 'エリア未設定'} · {store.capacity}席</p><p className="mt-1 text-xs font-semibold text-action">LINE: {store.line_account_name || '未設定'}</p></div>
        <button type="button" onClick={() => setEditingId((value) => value === store.id ? '' : store.id)} className="rounded-control border border-action px-4 py-2 text-xs font-semibold text-action">編集</button>
      </div>)}</div>
    </div>
  </Panel>
}

function Organization({ accountId, accounts, data, selectedStoreId, busy, create, update, createStore, updateStore }: {
  accountId: string
  accounts: AccountWithStats[]
  data: RestaurantSnapshot
  selectedStoreId: string
  busy: boolean
  create: (body: Record<string, unknown>) => void
  update: (id: string, body: Record<string, unknown>) => Promise<boolean>
  createStore: (body: StoreCreateInput) => void
  updateStore: (id: string, body: StoreUpdateInput) => void
}) {
  const members = selectedStoreId ? data.memberships.filter((m) => !m.store_id || m.store_id === selectedStoreId) : data.memberships
  const selectedStore = data.stores.find((item) => item.id === selectedStoreId) || null
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState('')
  const [stopId, setStopId] = useState('')
  const editing = members.find((member) => member.id === editingId)
  const stopping = members.find((member) => member.id === stopId)
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const fd = new FormData(event.currentTarget); create({ storeId: fd.get('storeId') || null, staffName: fd.get('staffName'), email: fd.get('email'), role: fd.get('role'), lineUid: fd.get('lineUid'), googleEmail: fd.get('googleEmail') }) }
  const submitEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editing) return
    const fd = new FormData(event.currentTarget)
    if (await update(editing.id, { storeId: fd.get('storeId') || null, staffName: fd.get('staffName'), email: fd.get('email'), role: fd.get('role'), lineUid: fd.get('lineUid'), googleEmail: fd.get('googleEmail') })) setEditingId('')
  }
  return <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
    <Panel title="組織階層"><div className="p-4"><p className="mb-2 text-xs font-semibold text-ink-faint">統括: {data.organization?.tenant_name || '未設定'}</p><div className="rounded-control bg-accent-soft px-4 py-3 font-semibold text-accent-deep">{data.organization?.name}</div><div className="ml-5 border-l border-hairline pl-4 pt-2">{data.stores.map((s) => <div key={s.id} className="my-2 rounded-control border border-hairline px-3 py-2 text-sm"><span className="font-semibold">{s.name}</span><Status value={s.status} /></div>)}</div></div></Panel>
    <div className="space-y-5"><StoreManagement accounts={accounts} data={data} busy={busy} createStore={createStore} updateStore={updateStore} /><IntakeAddressPanel accountId={accountId} store={selectedStore} /><div className="grid gap-4 sm:grid-cols-3"><Metric label="所属ユーザー" value={`${members.length}名`} note="名簿に載っている人数" /><Metric label="店舗管理者" value={`${members.filter((m) => m.role === 'store_manager').length}名`} note="名簿上の役割（操作権限は別）" /><Metric label="連携アカウント" value={`${members.filter((m) => m.line_uid || m.google_email).length}件`} note="LINE UID / Google" /></div>
      <div className="flex justify-end"><Button variant="primary" className="px-4 py-2 font-bold border-0 h-auto whitespace-normal" onClick={() => setShowForm(!showForm)}>ユーザーを追加する</Button></div>
      {showForm && <InlineForm title="飲食店向けユーザー"><form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><Field label="氏名" name="staffName" required /><Field label="メール" name="email" type="email" /><label className="text-xs font-medium text-ink-secondary">役割<DefaultSelect name="role" ariaLabel="役割" defaultValue="staff" options={[{ value: 'staff', label: 'Staff' }, { value: 'store_manager', label: 'StoreManager' }, { value: 'super_admin', label: 'SuperAdmin' }]} /></label><label className="text-xs font-medium text-ink-secondary">担当店舗<DefaultSelect name="storeId" ariaLabel="担当店舗" defaultValue="" options={[{ value: '', label: '全店舗' }, ...data.stores.map((s) => ({ value: s.id, label: s.name }))]} /></label><Field label="LINE通知UID" name="lineUid" /><Field label="Googleメール" name="googleEmail" type="email" /><div className="sm:col-span-2 xl:col-span-6 flex justify-end"><Button variant="primary" className="px-5 py-2 font-medium border-0 h-auto whitespace-normal" disabled={busy} type="submit">追加する</Button></div></form></InlineForm>}
      {editing && <InlineForm title={`${editing.staff_name}を変更`}>
        <form key={editing.id} onSubmit={(event) => void submitEdit(event)} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <Field label="氏名" name="staffName" defaultValue={editing.staff_name} required />
          <Field label="メール" name="email" type="email" defaultValue={editing.email ?? ''} />
          <label className="text-xs font-medium text-ink-secondary">役割
            <DefaultSelect name="role" ariaLabel="役割" defaultValue={editing.role} options={[{ value: 'staff', label: 'Staff' }, { value: 'store_manager', label: 'StoreManager' }, { value: 'super_admin', label: 'SuperAdmin' }]} />
          </label>
          <label className="text-xs font-medium text-ink-secondary">担当店舗
            <DefaultSelect name="storeId" ariaLabel="担当店舗" defaultValue={editing.store_id ?? ''} options={[{ value: '', label: '全店舗' }, ...data.stores.map((s) => ({ value: s.id, label: s.name }))]} />
          </label>
          <Field label="LINE通知UID" name="lineUid" defaultValue={editing.line_uid ?? ''} />
          <Field label="Googleメール" name="googleEmail" type="email" defaultValue={editing.google_email ?? ''} />
          <div className="flex justify-end gap-2 sm:col-span-2 xl:col-span-6">
            <Button type="button" onClick={() => setEditingId('')}>キャンセル</Button>
            <Button type="submit" variant="primary" disabled={busy}>保存する</Button>
          </div>
        </form>
      </InlineForm>}
      <ConfirmDialog open={Boolean(stopping)} title="この所属ユーザーを停止しますか？" description="名簿には残り、再開できます。この名簿だけではログイン権限は変わりません。" confirmLabel="停止する" busy={busy} onCancel={() => setStopId('')} onConfirm={() => { if (stopping) void update(stopping.id, { status: 'suspended' }).then(() => setStopId('')) }} />
      <Panel title="アカウント一覧" description="この一覧は名簿です。ここでの役割・担当店舗の登録だけではログイン権限は変わりません。実際の操作は、ログイン中のスタッフの役割（オーナー・管理者・スタッフ）で決まります。"><DataTable className="rounded-none border-0"><thead><TableHeadRow>{['氏名', '役割', '担当店舗', 'LINE通知UID', 'Google連携', '状態'].map((h) => <Th key={h}>{h}</Th>)}</TableHeadRow></thead><tbody>{members.map((m) => <Tr key={m.id}><Td className="font-semibold">{m.staff_name}<p className="text-xs font-normal text-ink-faint">{m.email || 'メール未設定'}</p></Td><Td><span className="rounded-pill bg-action-soft px-2 py-1 text-xs font-medium text-action">{roleLabel[m.role]}</span></Td><Td>{data.stores.find((s) => s.id === m.store_id)?.name || '全店舗'}</Td><Td>{m.line_uid ? '設定済' : '未設定'}</Td><Td>{m.google_email || '未設定'}</Td><Td><div className="flex flex-wrap items-center gap-2"><Status value={m.status} /><Button size="compact" disabled={busy} onClick={() => { setEditingId(m.id); setShowForm(false) }}>変更</Button>{m.status === 'suspended' ? <Button size="compact" disabled={busy} onClick={() => void update(m.id, { status: 'active' })}>再開</Button> : <Button size="compact" disabled={busy} onClick={() => setStopId(m.id)}>停止</Button>}</div></Td></Tr>)}</tbody></DataTable></Panel>
      <Panel title="権限マトリクス" description="想定の役割分担です。実際の操作可否は、ログイン中のスタッフの役割（オーナー・管理者・スタッフ）で決まります。"><DataTable className="rounded-none border-0"><thead><TableHeadRow><Th>操作</Th><Th>SuperAdmin</Th><Th>StoreManager</Th><Th>Staff</Th></TableHeadRow></thead><tbody>{[['全店閲覧・契約設定', true, false, false], ['担当店舗の設定・承認', true, true, false], ['予約入力・配席', true, true, true], ['Google/LINE公開承認', true, true, false]].map(([label, ...values]) => <Tr key={String(label)}><Td>{label}</Td>{values.map((v, i) => <Td key={i} align="center" className="font-bold">{v ? <span className="text-success">✓</span> : <span className="text-ink-faint">—</span>}</Td>)}</Tr>)}</tbody></DataTable></Panel>
    </div>
  </div>
}

function Approvals({ data, busy, decide }: { data: RestaurantSnapshot; busy: boolean; decide: (id: string, action: 'approve' | 'return') => void }) {
  const pending = data.approvals.filter((item) => item.status === 'pending')
  return <div className="space-y-5"><div className="grid gap-4 sm:grid-cols-4"><Metric label="承認待ち" value={pending.length} note="対応が必要" tone={pending.length ? 'warning' : 'normal'} /><Metric label="Google投稿" value={data.approvals.filter((a) => a.kind === 'gbp_post').length} note="投稿下書き" /><Metric label="LINE配信" value={data.approvals.filter((a) => a.kind === 'line_message').length} note="配信下書き" /><Metric label="メニュー改定" value={data.approvals.filter((a) => a.kind === 'menu_change').length} note="価格・内容変更" /></div>
    <div className="space-y-3">{data.approvals.map((item) => <ApprovalCard key={item.id} item={item} data={data} store={data.stores.find((s) => s.id === item.store_id)} busy={busy} decide={decide} />)}{data.approvals.length === 0 && <Panel title="承認キュー"><p className="p-8 text-center text-sm text-ink-faint">承認待ちはありません。</p></Panel>}</div>
    <Panel title="公開境界" description="承認しても検証中は外部公開しません。"><p className="p-5 text-sm leading-6 text-ink-secondary">状態は「承認済」まで進みます。Google投稿、LINE送信、メニュー媒体反映は、接続承認後に別工程として有効化します。</p></Panel>
  </div>
}
function approvalPayload(item: RestaurantApproval): Record<string, unknown> {
  try {
    const parsed = item.payload_json ? JSON.parse(item.payload_json) : {}
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch { return {} }
}

/** R105: 承認する中身（投稿文・配信文・改定前後）を見せてから判断できるようにする。 */
function ApprovalContent({ item, data }: { item: RestaurantApproval; data: RestaurantSnapshot }) {
  const payload = approvalPayload(item)
  if (item.kind === 'gbp_post' && typeof payload.postId === 'string') {
    const post = data.posts.find((p) => p.id === payload.postId)
    if (!post) return <p className="text-sm text-ink-secondary">投稿の内容を読み込めませんでした。</p>
    const typeLabel = { standard: '通常の投稿', event: 'イベント', offer: 'クーポン' }[post.post_type] || post.post_type
    return <div className="space-y-2"><p className="text-xs font-medium text-ink-secondary">種別: {typeLabel}</p><p className="text-sm font-semibold text-ink">{post.title}</p><p className="whitespace-pre-line text-sm leading-6 text-ink-secondary">{post.body}</p></div>
  }
  if (item.kind === 'line_message' && typeof payload.flowId === 'string') {
    const flow = data.lineFlows.find((f) => f.id === payload.flowId)
    if (!flow) return <p className="text-sm text-ink-secondary">配信の内容を読み込めませんでした。</p>
    return <div className="space-y-2"><p className="text-sm font-bold text-ink">{flow.title}</p><p className="whitespace-pre-line text-sm leading-6 text-ink-secondary">{flow.body}</p></div>
  }
  if (item.kind === 'menu_change') {
    const before = typeof payload.before === 'string' ? payload.before : null
    const after = typeof payload.after === 'string' ? payload.after : null
    if (before === null && after === null) return <p className="text-sm text-ink-secondary">改定の前後が記録されていません。申請者に確認してください。</p>
    return <div className="space-y-2"><div className="flex flex-wrap items-center gap-2 text-sm"><span className="text-ink-faint">変更前:</span><span className="text-ink-secondary">{before || '—'}</span><span className="text-ink-faint">→</span><span className="font-bold text-ink">{after || '—'}</span></div></div>
  }
  return <p className="text-sm text-ink-secondary">内容の詳細は申請者に確認してください。</p>
}

function ApprovalCard({ item, data, store, busy, decide }: { item: RestaurantApproval; data: RestaurantSnapshot; store?: RestaurantStore; busy: boolean; decide: (id: string, action: 'approve' | 'return') => void }) {
  const kind = { gbp_post: 'Google投稿', line_message: 'LINE配信', menu_change: 'メニュー改定' }[item.kind]
  return <article className={`rounded-card border bg-canvas p-5 ${item.status === 'pending' ? 'border-accent' : 'border-hairline'}`}><div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="rounded-pill bg-accent-soft px-2 py-1 text-xs font-bold text-accent-deep">{kind}</span><Status value={item.status} /><span className="text-xs text-ink-faint">{store?.name || '全店舗'}</span></div><h3 className="mt-3 font-bold text-ink">{item.title}</h3><p className="mt-1 text-xs text-ink-faint">申請: {item.requested_by || '—'} ・ {formatDate(item.created_at)}</p><div className="mt-3 rounded-control border border-hairline bg-canvas-sunken p-4"><p className="mb-2 text-xs font-bold text-ink-secondary">変更内容</p><ApprovalContent item={item} data={data} /></div>{item.review_comment && <p className="mt-3 rounded-control bg-warning-bg px-3 py-2 text-sm text-warning">{item.review_comment}</p>}</div>{item.status === 'pending' && <div className="flex shrink-0 gap-2"><Button variant="danger" className="px-4 py-2 font-bold text-danger disabled:opacity-50 h-auto whitespace-normal" disabled={busy} onClick={() => decide(item.id, 'return')}>差戻し</Button><Button variant="primary" className="px-4 py-2 font-bold disabled:opacity-50 border-0 h-auto whitespace-normal" disabled={busy} onClick={() => decide(item.id, 'approve')}>承認する</Button></div>}</div></article>
}

function toLocalInput(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const LEDGER_STATUS_OPTIONS = [
  { value: 'all', label: 'すべての状態' },
  { value: 'pending,confirmed,seated,visited', label: '有効のみ' },
  { value: 'cancelled,no_show', label: '取消・無断のみ' },
]

function Reservations({ data, store, busy, query, total, todayStartIso, onQueryChange, create, importInbound, update }: {
  data: RestaurantSnapshot; store: RestaurantStore | null; busy: boolean;
  query: ReservationQuery; total: number; todayStartIso: string;
  onQueryChange: (query: ReservationQuery) => void;
  create: (body: Record<string, unknown>) => void; importInbound: (body: Record<string, unknown>) => void;
  update: (id: string, body: Record<string, unknown>, success: string) => void;
}) {
  const rows = scoped(data.reservations, store?.id || '')
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [editingId, setEditingId] = useState('')
  const [cancelId, setCancelId] = useState('')
  const editing = rows.find((r) => r.id === editingId) || null
  const limit = query.limit ?? 100
  const page = Math.floor((query.offset ?? 0) / limit) + 1
  const pageCount = Math.max(1, Math.ceil(total / limit))
  const periodValue = query.to && !query.from ? 'past' : query.from ? 'upcoming' : 'all'
  const changePeriod = (value: string) => {
    if (value === 'past') onQueryChange({ ...query, from: undefined, to: todayStartIso, offset: 0 })
    else if (value === 'upcoming') onQueryChange({ ...query, from: todayStartIso, to: undefined, offset: 0 })
    else onQueryChange({ ...query, from: undefined, to: undefined, offset: 0 })
  }
  const changeStatus = (value: string) => onQueryChange({ ...query, status: value === 'all' ? undefined : value, offset: 0 })
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!store) return
    const fd = new FormData(event.currentTarget)
    const startsAt = new Date(String(fd.get('startsAt'))).toISOString()
    const ends = new Date(new Date(startsAt).getTime() + 120 * 60_000).toISOString()
    create({ storeId: store.id, customerName: fd.get('customerName'), customerPhone: fd.get('phone'), guestCount: Number(fd.get('guestCount')), startsAt, endsAt: ends, courseId: fd.get('courseId') || null, allergyNote: fd.get('allergyNote') })
  }
  const importSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!store) return
    const fd = new FormData(event.currentTarget)
    const startsAt = new Date(String(fd.get('startsAt'))).toISOString()
    importInbound({ storeId: store.id, provider: fd.get('provider'), eventId: `ui-${Date.now()}`, reservation: { externalId: String(fd.get('externalId')), customerName: String(fd.get('customerName')), guestCount: Number(fd.get('guestCount')), startsAt, endsAt: new Date(new Date(startsAt).getTime() + 120 * 60_000).toISOString() } })
  }
  const submitEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!editing) return
    const fd = new FormData(event.currentTarget)
    const startsAt = new Date(String(fd.get('startsAt'))).toISOString()
    const endsAt = new Date(String(fd.get('endsAt'))).toISOString()
    const tableId = String(fd.get('tableId') || '')
    update(editing.id, {
      customerName: fd.get('customerName'), customerPhone: fd.get('customerPhone') || null,
      guestCount: Number(fd.get('guestCount')), startsAt, endsAt,
      tableId: tableId || null, courseId: String(fd.get('courseId') || '') || null,
      allergyNote: fd.get('allergyNote') || null,
    }, '予約を変更しました。')
    setEditingId('')
  }
  const storeTables = data.tables.filter((t) => !store || t.store_id === store.id)
  return <div className="space-y-5"><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><Metric label="予約" value={`${total}件`} note={`表示中 ${rows.length}件`} helpLabel="予約件数の説明" help="条件に合う予約の総件数です。表には1ページ分だけを表示します。" /><Metric label="ご来店人数" value={`${rows.reduce((s, r) => s + r.guest_count, 0)}名`} note="表示中の合計" /><Metric label="LINE予約" value={rows.filter((r) => r.source === 'line').length} note="自社導線" /><Metric label="媒体予約" value={rows.filter((r) => !['line', 'phone', 'manual'].includes(r.source)).length} note="受信した予約" /><Metric label="未配席" value={rows.filter((r) => !r.table_id).length} note="卓の割当が必要" tone={rows.some((r) => !r.table_id) ? 'warning' : 'normal'} /></div>
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-ink-secondary">期間<Select aria-label="期間" value={periodValue} onChange={changePeriod} size="full" className="mt-1" options={[{ value: 'upcoming', label: '今後の予約' }, { value: 'all', label: 'すべての期間' }, { value: 'past', label: '過去の予約' }]} /></label>
        <label className="text-xs font-medium text-ink-secondary">状態<Select aria-label="状態" value={query.status ?? 'all'} onChange={changeStatus} size="full" className="mt-1" options={LEDGER_STATUS_OPTIONS} /></label>
      </div>
      <div className="flex flex-wrap justify-end gap-2"><button onClick={() => setShowImport(!showImport)} className="rounded-control border border-nen-border bg-nen-ivory px-4 py-2 text-sm font-bold text-nen-green">受信データを試す</button><Button variant="primary" className="px-4 py-2 font-bold border-0 h-auto whitespace-normal" onClick={() => setShowForm(!showForm)}>手動予約を登録する</Button></div>
    </div>
    {showForm && <InlineForm title="手動予約"><form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><Field label="お客様名" name="customerName" required /><Field label="電話番号" name="phone" /><Field label="人数" name="guestCount" type="number" defaultValue="2" required /><Field label="開始日時" name="startsAt" type="datetime-local" required /><label className="text-xs font-medium text-ink-secondary">コース<DefaultSelect name="courseId" ariaLabel="コース" defaultValue="" options={[{ value: '', label: '未選択' }, ...data.menuItems.filter((m) => (!store || m.store_id === store.id) && m.status === 'active').map((m) => ({ value: m.id, label: m.name }))]} /></label><Field label="アレルギー・特記事項" name="allergyNote" /><div className="sm:col-span-2 xl:col-span-6 flex justify-end"><Button variant="primary" className="px-5 py-2 font-medium border-0 h-auto whitespace-normal" disabled={busy} type="submit">台帳へ登録する</Button></div></form></InlineForm>}
    {showImport && <InlineForm title="媒体受信シミュレーター（外部への書戻しなし）"><form onSubmit={importSubmit} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><label className="text-xs font-medium text-ink-secondary">受信元<DefaultSelect name="provider" ariaLabel="受信元" defaultValue="restaurant_board" options={[{ value: 'restaurant_board', label: 'レストランボード' }, { value: 'hotpepper', label: 'Hot Pepper' }, { value: 'tabelog', label: '食べログ' }]} /></label><Field label="外部予約ID" name="externalId" defaultValue={`DEMO-${Date.now()}`} required /><Field label="お客様名" name="customerName" required /><Field label="人数" name="guestCount" type="number" defaultValue="2" required /><Field label="開始日時" name="startsAt" type="datetime-local" required /><div className="flex items-end"><button disabled={busy} className="w-full rounded-control bg-nen-green px-4 py-2 text-sm font-medium text-on-accent">受信として取込</button></div></form></InlineForm>}
    {editing && <InlineForm title={`${editing.customer_name}の予約を変更`}><form key={editing.id} onSubmit={submitEdit} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><Field label="お客様名" name="customerName" defaultValue={editing.customer_name} required /><Field label="電話番号" name="customerPhone" defaultValue={editing.customer_phone || ''} /><Field label="人数" name="guestCount" type="number" defaultValue={String(editing.guest_count)} required /><Field label="開始日時" name="startsAt" type="datetime-local" defaultValue={toLocalInput(editing.starts_at)} required /><Field label="終了日時" name="endsAt" type="datetime-local" defaultValue={toLocalInput(editing.ends_at)} required /><label className="text-xs font-medium text-ink-secondary">卓<DefaultSelect name="tableId" ariaLabel="卓" defaultValue={editing.table_id || ''} options={[{ value: '', label: '未配席' }, ...storeTables.filter((t) => t.is_active === 1 || t.id === editing.table_id).map((t) => ({ value: t.id, label: `${t.code}・${t.label}（${t.min_capacity}〜${t.max_capacity}名）` }))]} /></label><label className="text-xs font-medium text-ink-secondary">コース<DefaultSelect name="courseId" ariaLabel="コース" defaultValue={editing.course_id || ''} options={[{ value: '', label: '席のみ' }, ...data.menuItems.filter((m) => (!store || m.store_id === store.id) && (m.status === 'active' || m.id === editing.course_id)).map((m) => ({ value: m.id, label: m.name }))]} /></label><Field label="アレルギー・特記事項" name="allergyNote" defaultValue={editing.allergy_note || ''} /><div className="sm:col-span-2 xl:col-span-6 flex justify-end gap-2"><Button onClick={() => setEditingId('')}>キャンセル</Button><Button variant="primary" type="submit" disabled={busy}>保存する</Button></div></form></InlineForm>}
    <Panel title="予約タイムライン" description="媒体別の色と、配席・コースを同時に確認します。"><DataTable className="rounded-none border-0"><colgroup><col className="w-32" /><col className="w-28" /><col /><col className="w-16" /><col className="w-24" /><col className="w-24" /><col className="w-32" /><col className="w-24" /><col className="w-32" /></colgroup><thead><TableHeadRow>{['時刻', '予約元', 'お客様', '人数', '卓', 'コース', '注意事項', '状態', '操作'].map((h) => <Th key={h}>{h}</Th>)}</TableHeadRow></thead><tbody>{rows.map((r) => <Tr key={r.id}><Td className="whitespace-nowrap font-semibold">{formatDate(r.starts_at)}</Td><Td><span className={`rounded-pill px-2 py-1 text-xs font-semibold ${sourceTone[r.source] || 'bg-canvas-sunken text-ink-secondary'}`}>{sourceLabel[r.source] || r.source}</span></Td><Td className="truncate font-semibold" title={`${r.customer_name} ${r.customer_phone || ''}`}>{r.customer_name}<p className="truncate text-xs font-normal text-ink-faint">{r.customer_phone || '電話未登録'}</p></Td><Td className="whitespace-nowrap">{r.guest_count}名</Td><Td className="truncate" title={r.table_label || undefined}>{r.table_label || <span className="text-warning">未配席</span>}</Td><Td className="truncate" title={r.course_name || undefined}>{r.course_name || '席のみ'}</Td><Td className="truncate text-xs text-danger" title={r.allergy_note || undefined}>{r.allergy_note || '—'}</Td><Td><Status value={r.status} /></Td><Td><div className="flex gap-1"><button type="button" onClick={() => { setEditingId(r.id); setShowForm(false) }} className="whitespace-nowrap rounded-control border border-action px-2 py-1 text-xs font-semibold text-action">変更</button>{['cancelled', 'no_show'].includes(r.status) ? <Button size="compact" disabled={busy} onClick={() => update(r.id, { status: 'confirmed' }, '予約を有効に戻しました。')}>復活</Button> : <Button variant="danger" className="whitespace-nowrap px-2 py-1 text-xs text-danger h-auto" type="button" onClick={() => setCancelId(r.id)}>取消</Button>}</div></Td></Tr>)}</tbody></DataTable>{rows.length === 0 && <p className="p-8 text-center text-sm text-ink-faint">条件に合う予約はありません。</p>}<div className="flex justify-center p-4"><Pagination page={page} pageCount={pageCount} onPageChange={(next) => onQueryChange({ ...query, offset: (next - 1) * limit })} ariaLabel="予約台帳のページ送り" /></div></Panel>
    <ConfirmDialog open={cancelId !== ''} title="この予約を取り消しますか？" description="台帳には取消として残ります。時間帯の在庫は人数分だけ戻ります。" confirmLabel="取り消す" busy={busy} onCancel={() => setCancelId('')} onConfirm={() => { if (cancelId) update(cancelId, { status: 'cancelled' }, '予約を取り消しました。'); setCancelId('') }} />
    <Panel title="顧客カルテ" description="電話番号またはLINE UIDで名寄せする設計です。"><div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">{rows.slice(0, 6).map((r) => <div key={r.id} className="rounded-control border border-hairline p-4"><p className="font-semibold">{r.customer_name}</p><p className="mt-1 text-xs text-ink-faint">{r.customer_phone || r.line_uid || '連絡先未登録'}</p><p className="mt-3 text-sm text-ink-secondary">直近: {formatDate(r.starts_at)} / {r.guest_count}名</p></div>)}</div></Panel>
  </div>
}


function Field({ label, name, type = 'text', defaultValue, required = false }: { label: string; name: string; type?: string; defaultValue?: string; required?: boolean }) {
  if (type === 'datetime-local') {
    return <span className="text-xs font-medium text-ink-secondary">{label}<DateTimeField name={name} defaultValue={defaultValue} required={required} aria-label={label} className="mt-1" /></span>
  }
  return <label className="text-xs font-medium text-ink-secondary">{label}<input name={name} type={type} defaultValue={defaultValue} required={required} className="mt-1 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm font-normal text-ink" /></label>
}
function InlineForm({ title, children }: { title: string; children: ReactNode }) { return <section className="rounded-card border border-accent bg-accent-soft/40 p-5"><h2 className="mb-4 font-bold text-accent-deep">{title}</h2>{children}</section> }

function Tables({ data, store, busy, create, update }: { data: RestaurantSnapshot; store: RestaurantStore | null; busy: boolean; create: (body: Record<string, unknown>) => void; update: (id: string, body: Record<string, unknown>) => Promise<boolean> }) {
  const rows = scoped(data.tables, store?.id || '')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState('')
  const [stopId, setStopId] = useState('')
  const editing = rows.find((row) => row.id === editingId)
  const stopping = rows.find((row) => row.id === stopId)
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!store) return; const fd = new FormData(event.currentTarget); create({ storeId: store.id, code: fd.get('code'), label: fd.get('label'), seatType: fd.get('seatType'), minCapacity: Number(fd.get('minCapacity')), maxCapacity: Number(fd.get('maxCapacity')) }) }
  const submitEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editing) return
    const fd = new FormData(event.currentTarget)
    if (await update(editing.id, { code: fd.get('code'), label: fd.get('label'), seatType: fd.get('seatType'), minCapacity: Number(fd.get('minCapacity')), maxCapacity: Number(fd.get('maxCapacity')) })) setEditingId('')
  }
  return <div className="space-y-5"><div className="grid gap-4 sm:grid-cols-4"><Metric label="卓数" value={rows.length} note="稼働・停止を含む" /><Metric label="総席数" value={rows.reduce((s, t) => s + t.max_capacity, 0)} note="最大収容人数" /><Metric label="結合可能" value={new Set(rows.filter((t) => t.join_group).map((t) => t.join_group)).size} note="結合グループ" /><Metric label="個室" value={rows.filter((t) => t.seat_type === 'private_room').length} note="個室卓" /></div>
    <div className="flex justify-end"><Button variant="primary" className="px-4 py-2 font-bold border-0 h-auto whitespace-normal" onClick={() => setShowForm(!showForm)}>卓を追加する</Button></div>
    {showForm && <InlineForm title="新しい卓"><form onSubmit={submit} className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6"><Field label="卓番" name="code" required /><Field label="表示名" name="label" required /><label className="text-xs font-medium text-ink-secondary">席種<DefaultSelect name="seatType" ariaLabel="席種" defaultValue="table" options={[{ value: 'table', label: 'テーブル' }, { value: 'counter', label: 'カウンター' }, { value: 'private_room', label: '個室' }, { value: 'terrace', label: 'テラス' }]} /></label><Field label="最小人数" name="minCapacity" type="number" defaultValue="1" required /><Field label="最大人数" name="maxCapacity" type="number" defaultValue="4" required /><div className="flex items-end"><Button variant="primary" className="w-full px-4 py-2 font-medium border-0 h-auto whitespace-normal" disabled={busy} type="submit">追加する</Button></div></form></InlineForm>}
    {editing && <InlineForm title={`${editing.code}・${editing.label}を変更`}>
      <form key={editing.id} onSubmit={(event) => void submitEdit(event)} className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Field label="卓番" name="code" defaultValue={editing.code} required />
        <Field label="表示名" name="label" defaultValue={editing.label} required />
        <label className="text-xs font-medium text-ink-secondary">席種
          <DefaultSelect name="seatType" ariaLabel="席種" defaultValue={editing.seat_type} options={[{ value: 'table', label: 'テーブル' }, { value: 'counter', label: 'カウンター' }, { value: 'private_room', label: '個室' }, { value: 'terrace', label: 'テラス' }]} />
        </label>
        <Field label="最小人数" name="minCapacity" type="number" defaultValue={String(editing.min_capacity)} required />
        <Field label="最大人数" name="maxCapacity" type="number" defaultValue={String(editing.max_capacity)} required />
        <div className="flex items-end gap-2">
          <Button type="button" onClick={() => setEditingId('')}>キャンセル</Button>
          <Button type="submit" variant="primary" disabled={busy}>保存する</Button>
        </div>
      </form>
    </InlineForm>}
    <ConfirmDialog open={Boolean(stopping)} title="この卓を停止しますか？" description="予約履歴と卓の情報は残ります。停止中の卓は自動配席の候補から外れ、後で再開できます。" confirmLabel="停止する" busy={busy} onCancel={() => setStopId('')} onConfirm={() => { if (stopping) void update(stopping.id, { isActive: false }).then(() => setStopId('')) }} />
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_330px]"><Panel title="フロアマップ" description="ドラッグ配置は切り離し後の専用サーバーで永続化します。"><div className="relative m-5 min-h-[420px] rounded-card border border-dashed border-hairline bg-canvas-sunken p-5"><div className="grid grid-cols-3 gap-6">{rows.map((t) => <div key={t.id} className={`flex min-h-28 flex-col items-center justify-center rounded-card border-2 p-3 text-center ${t.join_group ? 'border-accent bg-accent-soft' : 'border-hairline bg-canvas'}`}><p className="text-xs font-medium text-ink-faint">{t.code}</p><p className="mt-1 font-semibold">{t.label}</p><p className="mt-2 text-xs text-ink-secondary">{t.min_capacity}〜{t.max_capacity}名</p>{t.join_group && <span className="mt-2 rounded-pill bg-canvas px-2 py-1 text-nano font-medium text-accent-deep">結合 {t.join_group}</span>}</div>)}</div></div></Panel>
      <Panel title="卓の詳細"><div className="divide-y divide-hairline">{rows.map((t) => <div key={t.id} className="p-4"><div className="flex justify-between"><p className="font-semibold">{t.code} · {t.label}</p><Status value={t.is_active ? 'active' : 'suspended'} /></div><p className="mt-1 text-xs text-ink-faint">{t.seat_type} / {t.min_capacity}〜{t.max_capacity}名</p><div className="mt-2 flex flex-wrap gap-2"><Button size="compact" disabled={busy} onClick={() => { setEditingId(t.id); setShowForm(false) }}>変更</Button>{t.is_active ? <Button size="compact" disabled={busy} onClick={() => setStopId(t.id)}>停止</Button> : <Button size="compact" disabled={busy} onClick={() => void update(t.id, { isActive: true })}>再開</Button>}</div></div>)}</div></Panel></div>
    <Panel title="自動配席ルール"><div className="p-5 text-sm leading-6 text-ink-secondary"><p className="font-bold text-nen-green">収容差が最小の卓を優先</p><p>少人数予約で大型卓を占有しないよう、人数を収容できる卓のうち余剰席が最も少ない卓を候補にします。結合卓は同一グループとして次段階で評価します。</p></div></Panel>
  </div>
}

function Inventory({ data, store, busy, save }: { data: RestaurantSnapshot; store: RestaurantStore | null; busy: boolean; save: (row: RestaurantInventory, body: Record<string, unknown>) => void }) {
  const rows = scoped(data.inventory, store?.id || '')
  return <div className="space-y-5"><div className="grid gap-4 sm:grid-cols-5"><Metric label="総受入枠" value={rows.reduce((s, r) => s + r.total_capacity, 0)} note="表示時間帯の延べ枠" /><Metric label="予約済" value={rows.reduce((s, r) => s + r.reserved_count, 0)} note="受信・手動の合計" /><Metric label="OTA枠" value={rows.reduce((s, r) => s + r.ota_capacity, 0)} note="媒体向け配分" /><Metric label="LINE専用" value={rows.reduce((s, r) => s + r.line_capacity, 0)} note="自社予約枠" /><Metric label="当日保持" value={rows.reduce((s, r) => s + r.walk_in_capacity, 0)} note="ウォークイン" /></div>
    <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_340px]"><Panel title="時間帯別の在庫" description="30分単位。媒体別枠を編集しても外部へは書き戻しません。"><DataTable className="rounded-none border-0"><thead><TableHeadRow>{['時間', '利用状況', '予約済', '総数', 'OTA', 'LINE', '当日枠', '保存'].map((h) => <Th key={h}>{h}</Th>)}</TableHeadRow></thead><tbody>{rows.map((r) => <InventoryEditor key={r.id} row={r} busy={busy} save={save} />)}</tbody></DataTable></Panel>
      <div className="space-y-4"><Panel title="媒体別配分"><div className="space-y-4 p-5">{[['OTA', rows.reduce((s, r) => s + r.ota_capacity, 0), 'bg-warning'], ['LINE', rows.reduce((s, r) => s + r.line_capacity, 0), 'bg-accent'], ['当日', rows.reduce((s, r) => s + r.walk_in_capacity, 0), 'bg-info']].map(([label, value, color]) => <div key={String(label)}><div className="flex justify-between text-xs"><span>{label}</span><span className="font-semibold">{value}</span></div><div className="mt-1 h-2 rounded-pill bg-canvas-sunken"><div className={`h-full rounded-pill ${color}`} style={{ width: `${Math.min(100, Number(value) / Math.max(rows.reduce((s, r) => s + r.total_capacity, 0), 1) * 100)}%` }} /></div></div>)}</div></Panel><Panel title="オーバーブッキング防止"><div className="p-5 text-sm leading-6 text-ink-secondary"><p className="font-semibold text-nen-green">検証中は外部在庫を更新しません</p><p className="mt-1">満席判定と内部ロックだけを確認します。OTA在庫0更新は本接続時の承認工程で有効化します。</p></div></Panel></div>
    </div>
  </div>
}

function InventoryEditor({ row, busy, save }: { row: RestaurantInventory; busy: boolean; save: (row: RestaurantInventory, body: Record<string, unknown>) => void }) {
  const [total, setTotal] = useState(row.total_capacity)
  const [ota, setOta] = useState(row.ota_capacity)
  const [line, setLine] = useState(row.line_capacity)
  const [walkIn, setWalkIn] = useState(row.walk_in_capacity)
  const ratio = Math.min(100, Math.round(row.reserved_count / Math.max(total, 1) * 100))
  const input = 'w-16 rounded-control border border-hairline px-2 py-1.5 text-right text-sm tabular-nums'
  return <Tr><Td className="font-semibold">{formatDate(row.starts_at, false)}</Td><Td className="w-40"><div className="h-2 rounded-pill bg-canvas-sunken"><div className={`h-full rounded-pill ${ratio >= 90 ? 'bg-danger' : ratio >= 70 ? 'bg-warning' : 'bg-accent'}`} style={{ width: `${Math.max(4, ratio)}%` }} /></div></Td><Td className="font-semibold">{row.reserved_count}</Td><Td><input aria-label="総数" type="number" value={total} onChange={(e) => setTotal(Number(e.target.value))} className={input} /></Td><Td><input aria-label="OTA枠" type="number" value={ota} onChange={(e) => setOta(Number(e.target.value))} className={input} /></Td><Td><input aria-label="LINE枠" type="number" value={line} onChange={(e) => setLine(Number(e.target.value))} className={input} /></Td><Td><input aria-label="当日枠" type="number" value={walkIn} onChange={(e) => setWalkIn(Number(e.target.value))} className={input} /></Td><Td><Button variant="primary" className="px-3 py-1.5 text-xs border-0 h-auto whitespace-normal" disabled={busy || ota + line + walkIn > total} onClick={() => save(row, { totalCapacity: total, otaCapacity: ota, lineCapacity: line, walkInCapacity: walkIn })}>保存する</Button></Td></Tr>
}

function Menu({ data, store, busy, create, update }: { data: RestaurantSnapshot; store: RestaurantStore | null; busy: boolean; create: (body: Record<string, unknown>) => void; update: (id: string, body: Record<string, unknown>) => Promise<boolean> }) {
  const rows = scoped(data.menuItems, store?.id || '')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState('')
  const [stopId, setStopId] = useState('')
  const editing = rows.find((row) => row.id === editingId)
  const stopping = rows.find((row) => row.id === stopId)
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!store) return; const fd = new FormData(event.currentTarget); create({ storeId: store.id, kind: fd.get('kind'), name: fd.get('name'), price: Number(fd.get('price')), allergens: String(fd.get('allergens') || '').split(',').map((s) => s.trim()).filter(Boolean), servicePeriods: [fd.get('period')] }) }
  const submitEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editing) return
    const fd = new FormData(event.currentTarget)
    const period = fd.get('period')
    if (await update(editing.id, { kind: fd.get('kind'), name: fd.get('name'), price: Number(fd.get('price')), allergens: String(fd.get('allergens') || '').split(',').map((item) => item.trim()).filter(Boolean), servicePeriods: period === 'both' ? ['lunch', 'dinner'] : [period] })) setEditingId('')
  }
  return <div className="space-y-5"><div className="grid gap-4 sm:grid-cols-5"><Metric label="全メニュー" value={rows.length} note="公開・下書き・保管済み" /><Metric label="コース" value={rows.filter((m) => m.kind === 'course').length} note="予約時に選択" /><Metric label="単品" value={rows.filter((m) => m.kind === 'a_la_carte').length} note="アラカルト" /><Metric label="要承認" value={data.approvals.filter((a) => a.kind === 'menu_change' && a.status === 'pending').length} note="価格・内容改定" tone="warning" /><Metric label="アレルギー登録" value={rows.filter((m) => safeArray(m.allergens_json).length).length} note="注意品目あり" /></div>
    <div className="flex justify-end"><Button variant="primary" className="px-4 py-2 font-bold border-0 h-auto whitespace-normal" onClick={() => setShowForm(!showForm)}>メニューを追加する</Button></div>
    {showForm && <InlineForm title="新しいメニュー"><form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><label className="text-xs font-medium text-ink-secondary">種類<DefaultSelect name="kind" ariaLabel="種類" defaultValue="course" options={[{ value: 'course', label: 'コース' }, { value: 'a_la_carte', label: '単品' }]} /></label><Field label="メニュー名" name="name" required /><Field label="価格（税込）" name="price" type="number" required /><Field label="アレルギー（カンマ区切り）" name="allergens" /><label className="text-xs font-medium text-ink-secondary">提供時間<DefaultSelect name="period" ariaLabel="提供時間" defaultValue="lunch" options={[{ value: 'lunch', label: 'ランチ' }, { value: 'dinner', label: 'ディナー' }]} /></label><div className="flex items-end"><Button variant="primary" className="w-full px-4 py-2 font-medium border-0 h-auto whitespace-normal" disabled={busy} type="submit">追加する</Button></div></form></InlineForm>}
    {editing && <InlineForm title={`${editing.name}を変更`}>
      <form key={editing.id} onSubmit={(event) => void submitEdit(event)} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <label className="text-xs font-medium text-ink-secondary">種類
          <DefaultSelect name="kind" ariaLabel="種類" defaultValue={editing.kind} options={[{ value: 'course', label: 'コース' }, { value: 'a_la_carte', label: '単品' }]} />
        </label>
        <Field label="メニュー名" name="name" defaultValue={editing.name} required />
        <Field label="価格（税込）" name="price" type="number" defaultValue={String(editing.price)} required />
        <Field label="アレルギー（カンマ区切り）" name="allergens" defaultValue={safeArray(editing.allergens_json).join(', ')} />
        <label className="text-xs font-medium text-ink-secondary">提供時間
          <DefaultSelect name="period" ariaLabel="提供時間" defaultValue={safeArray(editing.service_periods_json).length > 1 ? 'both' : safeArray(editing.service_periods_json)[0] || 'dinner'} options={[{ value: 'lunch', label: 'ランチ' }, { value: 'dinner', label: 'ディナー' }, { value: 'both', label: 'ランチ・ディナー' }]} />
        </label>
        <div className="flex items-end gap-2">
          <Button type="button" onClick={() => setEditingId('')}>キャンセル</Button>
          <Button type="submit" variant="primary" disabled={busy}>保存する</Button>
        </div>
      </form>
    </InlineForm>}
    <ConfirmDialog open={Boolean(stopping)} title="このメニューを停止しますか？" description="メニューは保管され、予約履歴の参照は残ります。後で再開できます。" confirmLabel="停止する" busy={busy} onCancel={() => setStopId('')} onConfirm={() => { if (stopping) void update(stopping.id, { status: 'archived' }).then(() => setStopId('')) }} />
    <Panel title="メニュー一覧" description="予約台帳・Google投稿・LINEカードで同じマスターを参照します。"><DataTable className="rounded-none border-0"><thead><TableHeadRow>{['メニュー', '種類', '価格', '提供時間', '所要時間', 'アレルギー', '状態'].map((h) => <Th key={h}>{h}</Th>)}</TableHeadRow></thead><tbody>{rows.map((m) => <Tr key={m.id}><Td className="font-bold text-action">{m.name}</Td><Td>{m.kind === 'course' ? 'コース' : '単品'}</Td><Td className="font-bold">{yen(m.price)}</Td><Td>{safeArray(m.service_periods_json).map((p) => p === 'lunch' ? 'ランチ' : 'ディナー').join('・')}</Td><Td>{m.duration_minutes ? `${m.duration_minutes}分` : '—'}</Td><Td>{safeArray(m.allergens_json).join('・') || 'なし'}</Td><Td><div className="flex flex-wrap items-center gap-2"><Status value={m.status} /><Button size="compact" disabled={busy} onClick={() => { setEditingId(m.id); setShowForm(false) }}>変更</Button>{m.status === 'archived' ? <Button size="compact" disabled={busy} onClick={() => void update(m.id, { status: 'active' })}>再開</Button> : <Button size="compact" disabled={busy} onClick={() => setStopId(m.id)}>停止</Button>}</div></Td></Tr>)}</tbody></DataTable></Panel>
  </div>
}

function LineFollowup({ data, store, busy, save }: { data: RestaurantSnapshot; store: RestaurantStore | null; busy: boolean; save: (flow: RestaurantLineFlow, patch: Record<string, unknown>) => void }) {
  const flows = data.lineFlows.filter((f) => !store || !f.store_id || f.store_id === store.id)
  return <div className="space-y-5"><div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-6"><Metric label="フロー" value={flows.length} note="カードテンプレート" /><Metric label="予約24時間前" value={flows.some((f) => f.flow_type === 'reservation_24h') ? '準備済' : '未作成'} note="変更・取消導線" /><Metric label="予約2時間前" value={flows.some((f) => f.flow_type === 'reservation_2h') ? '準備済' : '未作成'} note="当日のご案内" /><Metric label="来店後" value={flows.some((f) => f.flow_type === 'post_visit') ? '準備済' : '未作成'} note="お礼メッセージ" /><Metric label="口コミ依頼" value={flows.some((f) => f.flow_type === 'review_request') ? '準備済' : '未作成'} note="GBP導線" /><Metric label="本送信" value="停止中" note="プレビューのみ" tone="warning" /></div>
    <div className="grid gap-4 xl:grid-cols-2">{flows.map((flow) => <LineFlowCard key={flow.id} flow={flow} busy={busy} save={save} />)}</div>
    <Panel title="LINEミニアプリ連携" description="将来の切り離しを前提に、予約・会員証の境界を分離しています。"><div className="grid gap-4 p-5 md:grid-cols-2"><div className="rounded-card border border-nen-border bg-nen-ivory p-5"><p className="text-xs font-bold tracking-widest text-nen-label">DIGITAL MEMBERSHIP</p><h3 className="mt-2 text-lg font-bold text-nen-green">デジタル会員証</h3><p className="mt-2 text-sm leading-6 text-nen-copy">スタンプカード・会員ランク・来店履歴を、LINEミニアプリへ表示する設計です。</p></div><div className="rounded-card border border-nen-border bg-nen-ivory p-5"><p className="text-xs font-bold tracking-widest text-nen-label">ONE TAP BOOKING</p><h3 className="mt-2 text-lg font-bold text-nen-green">前回と同じ内容で予約</h3><p className="mt-2 text-sm leading-6 text-nen-copy">顧客カルテの過去履歴から、店舗・人数・コースを差し込む1タップ予約です。</p></div></div></Panel>
  </div>
}

function LineFlowCard({ flow, busy, save }: { flow: RestaurantLineFlow; busy: boolean; save: (flow: RestaurantLineFlow, patch: Record<string, unknown>) => void }) {
  const [title, setTitle] = useState(flow.title)
  const [body, setBody] = useState(flow.body)
  const timing = flow.timing_minutes === null ? '常設' : flow.timing_minutes < 0 ? `${Math.abs(flow.timing_minutes) / 60}時間前` : `${flow.timing_minutes / 60}時間後`
  return <article className="overflow-hidden rounded-card border border-nen-border bg-canvas"><div className="border-b border-nen-border bg-nen-ivory px-5 py-4"><div className="flex items-center justify-between gap-3"><div><p className="text-nano font-medium tracking-[0.18em] text-nen-label">RESTAURANT</p><h2 className="mt-1 font-medium text-nen-green">{flow.title}</h2></div><Status value={flow.delivery_mode} /></div></div><div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_220px]"><div className="space-y-3"><label className="block text-xs font-medium text-ink-secondary">タイトル<input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded-control border border-hairline px-3 py-2 text-sm font-normal" /></label><label className="block text-xs font-medium text-ink-secondary">本文<textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} className="mt-1 w-full rounded-control border border-hairline px-3 py-2 text-sm font-normal leading-6" /></label><div className="flex items-center justify-between"><span className="text-xs font-medium text-nen-label">配信: {timing}</span><button disabled={busy} onClick={() => save(flow, { title, body, timingMinutes: flow.timing_minutes, isEnabled: Boolean(flow.is_enabled) })} className="rounded-control bg-nen-green px-4 py-2 text-xs font-medium text-on-accent disabled:opacity-50">下書きを保存する</button></div></div><div className="rounded-card bg-nen-green p-4 text-on-accent shadow-float"><p className="text-micro tracking-[0.2em] text-nen-gold-soft">サンプル店舗</p><p className="mt-3 text-sm font-medium">{title}</p><p className="mt-2 text-xs leading-5 text-on-accent/80">{body}</p><div className="mt-4 rounded-control bg-canvas/10 px-3 py-2 text-center text-xs font-medium">予約内容を確認</div></div></div></article>
}
