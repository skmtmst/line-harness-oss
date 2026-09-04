'use client'

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import Header from '@/components/layout/header'
import { useAccount, type AccountWithStats } from '@/contexts/account-context'
import { ApiError } from '@/lib/api'
import StoreContextBanner from './stores/store-context-banner'
import {
  restaurantTestApi,
  type RestaurantApproval,
  type RestaurantIntakeAddress,
  type RestaurantInventory,
  type RestaurantLineFlow,
  type RestaurantSnapshot,
  type RestaurantStore,
} from '@/lib/restaurant-test-api'

const viewMeta = {
  dashboard: ['店舗ダッシュボード', '全店舗の予約・空席・連携状態を、本部からまとめて確認します。'],
  organization: ['組織・権限', '本部・店舗・スタッフの閲覧範囲と承認権限を管理します。'],
  approvals: ['承認ワークフロー', 'Google投稿・LINE配信・メニュー改定を公開前に確認します。'],
  reservations: ['予約台帳', '予約媒体・LINE・電話の予約を、一つの時間軸で確認します。'],
  tables: ['座席・卓管理', 'フロア配置、席種、収容人数、結合ルールを管理します。'],
  inventory: ['予約枠・在庫', '時間帯ごとの総枠と、媒体・LINE・当日枠の配分を確認します。'],
  menu: ['メニュー管理', 'コースと単品、価格、アレルギー、提供時間帯を管理します。'],
  google: ['Google・口コミ', '口コミ返信とGoogle最新情報を、承認前の下書きとして整えます。'],
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
  retty: 'bg-action-soft text-action', line: 'bg-accent-soft text-accent',
  phone: 'bg-canvas-sunken text-ink-secondary', manual: 'bg-canvas-sunken text-ink-secondary',
}

function formatDate(value: string, withDate = true) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ja-JP', withDate
    ? { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' }
    : { hour: '2-digit', minute: '2-digit' }).format(date)
}

function yen(value: number) {
  return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 }).format(value)
}

function safeArray(value: string): string[] {
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : [] } catch { return [] }
}

function Status({ value }: { value: string }) {
  const good = ['connected', 'active', 'approved', 'completed', 'visited', 'confirmed'].includes(value)
  const warning = ['warning', 'pending', 'draft', 'scheduled', 'unreplied'].includes(value)
  const labels: Record<string, string> = {
    connected: '正常', active: '有効', approved: '承認済', completed: '完了', visited: '来店済',
    confirmed: '予約確定', warning: '要確認', pending: '承認待ち', draft: '下書き', scheduled: '予約済',
    unreplied: '未返信', unconfigured: '未設定', disabled: '無効', error: 'エラー', returned: '差戻し',
    seated: '来店中', cancelled: '取消', no_show: '無断キャンセル', preview_only: 'プレビューのみ',
  }
  return <span className={`inline-flex rounded-pill px-2 py-1 text-[11px] font-bold ${good ? 'bg-success-bg text-success' : warning ? 'bg-warning-bg text-warning' : 'bg-canvas-sunken text-ink-secondary'}`}>{labels[value] || value}</span>
}

function TestBoundary() {
  return <div className="mb-5 flex flex-col gap-3 rounded-card border border-nen-border bg-nen-ivory px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
    <div><span className="mr-2 inline-flex rounded-pill bg-nen-green px-2.5 py-1 text-xs font-bold text-on-accent">検証環境専用</span><span className="text-nen-copy">既存の然-NEN運用とは分離された飲食店向けテスト領域です。</span></div>
    <div className="flex items-center gap-2 font-semibold text-nen-green"><span className="h-2 w-2 rounded-full bg-nen-gold" />予約媒体は受信専用・外部更新なし</div>
  </div>
}

function Metric({ label, value, note, tone = 'normal' }: { label: string; value: ReactNode; note: string; tone?: 'normal' | 'warning' | 'danger' }) {
  return <div className="rounded-card border border-hairline bg-canvas p-4 shadow-sm">
    <p className="text-xs font-semibold text-ink-faint">{label}</p>
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
    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-nen-ivory text-2xl text-nen-gold">然</div>
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

  const load = useCallback(async () => {
    if (!selectedAccountId) { setSnapshot(null); setLoading(false); return }
    setLoading(true)
    try {
      const res = await restaurantTestApi.snapshot(selectedAccountId)
      setSnapshot(res.data)
      setSelectedStoreId((current) => res.data.stores.some((item) => item.id === current)
        ? current
        : res.data.stores[0]?.id || '')
    } catch { setNotice({ tone: 'error', text: '飲食店向けテストデータを読み込めませんでした。' }) }
    finally { setLoading(false) }
  }, [selectedAccountId])
  useEffect(() => { void load() }, [load])

  const mutate = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true)
    try { await action(); await load(); setNotice({ tone: 'success', text: success }) }
    catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : '保存できませんでした。' }) }
    finally { setBusy(false) }
  }

  const store = selectedStoreId ? snapshot?.stores.find((item) => item.id === selectedStoreId) || null : null
  return <>
    <StoreContextBanner />
    <Header title={viewMeta[activeView][0]} description={viewMeta[activeView][1]} />
    <TestBoundary />
    {notice && <div className={`mb-4 rounded-control border px-4 py-3 text-sm ${notice.tone === 'success' ? 'border-success bg-success-bg text-success' : 'border-danger bg-danger-bg text-danger'}`}>{notice.text}</div>}
    {loading ? <div className="rounded-card border border-hairline bg-canvas p-16 text-center text-sm text-ink-faint">読み込み中…</div>
      : !snapshot?.organization ? <EmptySetup />
      : activeView === 'dashboard' ? <Dashboard data={snapshot} />
      : activeView === 'organization' ? <Organization
        accountId={selectedAccountId!}
        accounts={accounts}
        data={snapshot}
        selectedStoreId={selectedStoreId}
        busy={busy}
        create={(body) => mutate(() => restaurantTestApi.createMembership(selectedAccountId!, body), 'ログインユーザーを飲食店向け領域へ追加しました。')}
        createStore={(body) => mutate(() => restaurantTestApi.createStore(selectedAccountId!, body), '店舗を追加しました。')}
        updateStore={(id, body) => mutate(() => restaurantTestApi.updateStore(selectedAccountId!, id, body), '店舗情報を更新しました。')}
      />
      : activeView === 'approvals' ? <Approvals data={snapshot} busy={busy} decide={(id, action) => mutate(() => restaurantTestApi.decideApproval(selectedAccountId!, id, action), action === 'approve' ? '承認しました。外部公開は行っていません。' : '差し戻しました。')} />
      : activeView === 'reservations' ? <Reservations data={snapshot} store={store} busy={busy} create={(body) => mutate(() => restaurantTestApi.createReservation(selectedAccountId!, body), '予約台帳へ登録しました。')} importInbound={(body) => mutate(() => restaurantTestApi.importReservation(selectedAccountId!, body), '受信専用データとして取り込みました。')} />
      : activeView === 'tables' ? <Tables data={snapshot} store={store} busy={busy} create={(body) => mutate(() => restaurantTestApi.createTable(selectedAccountId!, body), '卓を追加しました。')} />
      : activeView === 'inventory' ? <Inventory data={snapshot} store={store} busy={busy} save={(row, body) => mutate(() => restaurantTestApi.updateInventory(selectedAccountId!, row.id, body), '予約枠を更新しました。外部媒体へは反映していません。')} />
      : activeView === 'menu' ? <Menu data={snapshot} store={store} busy={busy} create={(body) => mutate(() => restaurantTestApi.createMenu(selectedAccountId!, body), 'メニューを追加しました。')} />
      : activeView === 'google' ? <GooglePanel data={snapshot} store={store} busy={busy} createPost={(body) => mutate(() => restaurantTestApi.createGbpPost(selectedAccountId!, body), 'Google投稿の下書きを承認キューへ追加しました。公開はしていません。')} saveReply={(id, draft) => mutate(() => restaurantTestApi.updateReviewDraft(selectedAccountId!, id, draft), '口コミ返信案を保存しました。送信はしていません。')} />
      : <LineFollowup data={snapshot} store={store} busy={busy} save={(flow, patch) => mutate(() => restaurantTestApi.updateLineFlow(selectedAccountId!, flow.id, patch), 'LINEカード設定を保存しました。送信はまだ行いません。')} />}
  </>
}

function scoped<T extends { store_id: string }>(rows: T[], storeId: string) { return storeId ? rows.filter((row) => row.store_id === storeId) : rows }

function Dashboard({ data }: { data: RestaurantSnapshot }) {
  const activeReservations = data.reservations.filter((r) => !['cancelled', 'no_show'].includes(r.status))
  const guestCount = activeReservations.reduce((sum, r) => sum + r.guest_count, 0)
  const totalCapacity = data.stores.reduce((sum, item) => sum + item.capacity, 0)
  const unreplied = data.reviews.filter((r) => r.reply_status === 'unreplied').length
  const issues = data.connectors.filter((c) => ['error', 'warning'].includes(c.status)).length
  return <div className="space-y-5">
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <Metric label="予約数" value={`${activeReservations.length}件`} note="台帳にある有効予約" />
      <Metric label="ご来店予定" value={`${guestCount}名`} note="予約人数の合計" />
      <Metric label="空席率" value={`${Math.max(0, Math.round((1 - guestCount / Math.max(totalCapacity, 1)) * 100))}%`} note="全店舗の概算" />
      <Metric label="売上予測" value={yen(guestCount * 8800)} note="予約人数×平均客単価" />
      <Metric label="未返信口コミ" value={`${unreplied}件`} note="Google口コミ" tone={unreplied ? 'warning' : 'normal'} />
    </div>
    <Panel title="店舗一覧" description="本部から全店の予約と接続状態を確認します。" action={<span className={`text-xs font-bold ${issues ? 'text-warning' : 'text-success'}`}>{issues ? `${issues}件の要確認` : 'すべて正常'}</span>}>
      <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead className="bg-canvas-sunken text-left text-xs text-ink-faint"><tr>{['店舗', 'エリア', '予約', '予定人数', '収容数', 'LINE', 'Google', '予約媒体'].map((h) => <th key={h} className="px-5 py-3 font-semibold">{h}</th>)}</tr></thead><tbody className="divide-y divide-hairline">{data.stores.map((item) => {
        const reservations = data.reservations.filter((r) => r.store_id === item.id && !['cancelled', 'no_show'].includes(r.status))
        const connector = data.connectors.find((c) => c.store_id === item.id && c.provider === 'restaurant_board')
        return <tr key={item.id} className="hover:bg-canvas-sunken/60"><td className="px-5 py-4 font-bold text-action">{item.name}<p className="mt-0.5 text-xs font-normal text-ink-faint">{item.code}</p></td><td className="px-5 py-4">{item.area || '—'}</td><td className="px-5 py-4 font-bold">{reservations.length}件</td><td className="px-5 py-4">{reservations.reduce((s, r) => s + r.guest_count, 0)}名</td><td className="px-5 py-4">{item.capacity}席</td><td className="px-5 py-4"><Status value={item.line_status} /></td><td className="px-5 py-4"><Status value={item.google_status} /></td><td className="px-5 py-4"><Status value={connector?.status || 'unconfigured'} /></td></tr>
      })}</tbody></table></div>
    </Panel>
    <div className="grid gap-4 lg:grid-cols-2"><Panel title="全店アクション" description="検証中は下書き作成まで。外部配信は行いません。"><div className="grid gap-3 p-5 sm:grid-cols-2"><button disabled className="rounded-control border border-hairline bg-canvas-sunken px-4 py-3 text-sm font-bold text-ink-faint">Google一斉投稿（未接続）</button><button disabled className="rounded-control border border-hairline bg-canvas-sunken px-4 py-3 text-sm font-bold text-ink-faint">LINE一斉配信（未接続）</button></div></Panel><Panel title="同期方針" description="安全な検証のため固定しています。"><div className="p-5 text-sm leading-6 text-ink-secondary"><p className="font-bold text-nen-green">レストランボード中心の一方向受信</p><p className="mt-1">取得できない媒体は個別受信口を追加します。予約台帳から外部媒体への在庫・予約更新は0件です。</p></div></Panel></div>
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
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date)
}

function IntakeAddressPanel({ accountId, store }: { accountId: string; store: RestaurantStore | null }) {
  const [addresses, setAddresses] = useState<RestaurantIntakeAddress[]>([])
  const [loading, setLoading] = useState(false)
  const [issuing, setIssuing] = useState(false)
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

  const issue = async () => {
    if (!storeId || error) return
    if (addresses.length > 0 && !confirm('新しい取り込みアドレスを発行しますか？\n旧アドレスは90日後に失効します。媒体側の通知先を新しいアドレスへ変更してください。')) return
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
                <p className="text-xs font-bold text-ink-secondary">{item.revokedAt ? `${intakeDate(item.revokedAt)}まで有効` : '現在使用中'}</p>
                <Status value={item.status} />
              </div>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input aria-label={`${store.name}の取り込みアドレス`} readOnly value={item.address} className="min-w-0 flex-1 select-all rounded-control border border-hairline bg-canvas px-3 py-2 font-mono text-xs text-ink" />
                <button type="button" onClick={() => void copy(item)} className="whitespace-nowrap rounded-control border border-action px-4 py-2 text-xs font-bold text-action hover:bg-action-soft">{copiedId === item.id ? 'コピー済み' : 'コピー'}</button>
              </div>
              <p className="mt-2 text-[11px] text-ink-faint">発行日時: {intakeDate(item.createdAt)}</p>
            </div>)}</div>}
          <div className="flex justify-end"><button type="button" disabled={issuing} onClick={() => void issue()} className="rounded-control bg-nen-green px-5 py-2.5 text-sm font-bold text-on-accent disabled:opacity-50">{issuing ? '発行中…' : 'アドレスを発行'}</button></div>
        </>}
    </div>
  </Panel>
}

type StoreCreateInput = {
  name: string; code: string; area: string; capacity: number; timezone: string; lineAccountId: string
}
type StoreUpdateInput = {
  name: string; code: string; area: string; capacity: number;
  status: RestaurantStore['status']; lineAccountId: string
}

function StoreLineAccountSelect({ accounts, stores, currentStore }: { accounts: AccountWithStats[]; stores: RestaurantStore[]; currentStore?: RestaurantStore }) {
  const usedByAccount = new Map(stores.filter((item) => item.line_account_id).map((item) => [item.line_account_id!, item.id]))
  return <label className="text-xs font-bold text-ink-secondary">LINE公式アカウント<span className="text-danger"> *</span>
    <select name="lineAccountId" required defaultValue={currentStore?.line_account_id || ''} className="mt-1 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm">
      <option value="">選択してください</option>
      {accounts.map((account) => {
        const usedStoreId = usedByAccount.get(account.id)
        const usedElsewhere = Boolean(usedStoreId && usedStoreId !== currentStore?.id)
        return <option key={account.id} value={account.id} disabled={usedElsewhere}>
          {account.displayName || account.name}{usedElsewhere ? '（他店舗で使用中）' : ''}
        </option>
      })}
    </select>
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
  return <Panel title="店舗管理" description="1店舗につき1つのLINE公式アカウントを割り当てます。" action={<button type="button" onClick={() => setShowCreate((value) => !value)} className="rounded-control bg-accent-deep px-4 py-2 text-xs font-bold text-on-accent">店舗を追加</button>}>
    <div className="space-y-4 p-5">
      {showCreate && <InlineForm title="新しい店舗"><form onSubmit={submitCreate} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="店舗名" name="name" required />
        <Field label="店舗コード" name="code" required />
        <Field label="エリア" name="area" />
        <Field label="収容人数" name="capacity" type="number" defaultValue="24" required />
        <Field label="タイムゾーン" name="timezone" defaultValue="Asia/Tokyo" required />
        <StoreLineAccountSelect accounts={accounts} stores={data.stores} />
        <div className="flex items-end sm:col-span-2"><button disabled={busy} className="w-full rounded-control bg-nen-green px-4 py-2 text-sm font-bold text-on-accent disabled:opacity-50">店舗を登録</button></div>
      </form></InlineForm>}
      {editingStore && <InlineForm title={`${editingStore.name}を編集`}><form key={editingStore.id} onSubmit={submitEdit} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="店舗名" name="name" defaultValue={editingStore.name} required />
        <Field label="店舗コード" name="code" defaultValue={editingStore.code} required />
        <Field label="エリア" name="area" defaultValue={editingStore.area || ''} />
        <Field label="収容人数" name="capacity" type="number" defaultValue={String(editingStore.capacity)} required />
        <label className="text-xs font-bold text-ink-secondary">状態<select name="status" defaultValue={editingStore.status} className="mt-1 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm"><option value="active">有効</option><option value="paused">一時停止</option><option value="archived">アーカイブ</option></select></label>
        <StoreLineAccountSelect accounts={accounts} stores={data.stores} currentStore={editingStore} />
        <div className="flex items-end sm:col-span-2"><button disabled={busy} className="w-full rounded-control bg-nen-green px-4 py-2 text-sm font-bold text-on-accent disabled:opacity-50">変更を保存</button></div>
      </form></InlineForm>}
      <div className="divide-y divide-hairline rounded-control border border-hairline">{data.stores.map((store) => <div key={store.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div><div className="flex items-center gap-2"><p className="font-bold text-ink">{store.name}</p><Status value={store.status} /></div><p className="mt-1 text-xs text-ink-faint">{store.code} · {store.area || 'エリア未設定'} · {store.capacity}席</p><p className="mt-1 text-xs font-semibold text-action">LINE: {store.line_account_name || '未設定'}</p></div>
        <button type="button" onClick={() => setEditingId((value) => value === store.id ? '' : store.id)} className="rounded-control border border-action px-4 py-2 text-xs font-bold text-action">編集</button>
      </div>)}</div>
    </div>
  </Panel>
}

function Organization({ accountId, accounts, data, selectedStoreId, busy, create, createStore, updateStore }: {
  accountId: string
  accounts: AccountWithStats[]
  data: RestaurantSnapshot
  selectedStoreId: string
  busy: boolean
  create: (body: Record<string, unknown>) => void
  createStore: (body: StoreCreateInput) => void
  updateStore: (id: string, body: StoreUpdateInput) => void
}) {
  const members = selectedStoreId ? data.memberships.filter((m) => !m.store_id || m.store_id === selectedStoreId) : data.memberships
  const selectedStore = data.stores.find((item) => item.id === selectedStoreId) || null
  const [showForm, setShowForm] = useState(false)
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const fd = new FormData(event.currentTarget); create({ storeId: fd.get('storeId') || null, staffName: fd.get('staffName'), email: fd.get('email'), role: fd.get('role'), lineUid: fd.get('lineUid'), googleEmail: fd.get('googleEmail') }) }
  return <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
    <Panel title="組織階層"><div className="p-4"><p className="mb-2 text-xs font-semibold text-ink-faint">統括: {data.organization?.tenant_name || '未設定'}</p><div className="rounded-control bg-accent-soft px-4 py-3 font-bold text-accent">{data.organization?.name}</div><div className="ml-5 border-l border-hairline pl-4 pt-2">{data.stores.map((s) => <div key={s.id} className="my-2 rounded-control border border-hairline px-3 py-2 text-sm"><span className="font-semibold">{s.name}</span><Status value={s.status} /></div>)}</div></div></Panel>
    <div className="space-y-5"><StoreManagement accounts={accounts} data={data} busy={busy} createStore={createStore} updateStore={updateStore} /><IntakeAddressPanel accountId={accountId} store={selectedStore} /><div className="grid gap-4 sm:grid-cols-3"><Metric label="所属ユーザー" value={`${members.length}名`} note="本部・店舗の合計" /><Metric label="店舗管理者" value={`${members.filter((m) => m.role === 'store_manager').length}名`} note="承認権限あり" /><Metric label="連携アカウント" value={`${members.filter((m) => m.line_uid || m.google_email).length}件`} note="LINE UID / Google" /></div>
      <div className="flex justify-end"><button onClick={() => setShowForm(!showForm)} className="rounded-control bg-accent-deep px-4 py-2 text-sm font-bold text-on-accent">ユーザーを追加</button></div>
      {showForm && <InlineForm title="飲食店向けユーザー"><form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><Field label="氏名" name="staffName" required /><Field label="メール" name="email" type="email" /><label className="text-xs font-bold text-ink-secondary">役割<select name="role" className="mt-1 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm"><option value="staff">Staff</option><option value="store_manager">StoreManager</option><option value="super_admin">SuperAdmin</option></select></label><label className="text-xs font-bold text-ink-secondary">担当店舗<select name="storeId" className="mt-1 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm"><option value="">全店舗</option>{data.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><Field label="LINE通知UID" name="lineUid" /><Field label="Googleメール" name="googleEmail" type="email" /><div className="sm:col-span-2 xl:col-span-6 flex justify-end"><button disabled={busy} className="rounded-control bg-accent-deep px-5 py-2 text-sm font-bold text-on-accent">追加</button></div></form></InlineForm>}
      <Panel title="アカウント一覧" description="権限は飲食店向け領域の中だけに適用します。"><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="bg-canvas-sunken text-left text-xs text-ink-faint"><tr>{['氏名', '役割', '担当店舗', 'LINE通知UID', 'Google連携', '状態'].map((h) => <th key={h} className="px-5 py-3">{h}</th>)}</tr></thead><tbody className="divide-y divide-hairline">{members.map((m) => <tr key={m.id}><td className="px-5 py-4 font-bold">{m.staff_name}<p className="text-xs font-normal text-ink-faint">{m.email || 'メール未設定'}</p></td><td className="px-5 py-4"><span className="rounded-pill bg-action-soft px-2 py-1 text-xs font-bold text-action">{roleLabel[m.role]}</span></td><td className="px-5 py-4">{data.stores.find((s) => s.id === m.store_id)?.name || '全店舗'}</td><td className="px-5 py-4">{m.line_uid ? '設定済' : '未設定'}</td><td className="px-5 py-4">{m.google_email || '未設定'}</td><td className="px-5 py-4"><Status value={m.status} /></td></tr>)}</tbody></table></div></Panel>
      <Panel title="権限マトリクス"><div className="overflow-x-auto"><table className="w-full min-w-[660px] text-sm"><thead className="bg-canvas-sunken"><tr><th className="px-5 py-3 text-left">操作</th><th>SuperAdmin</th><th>StoreManager</th><th>Staff</th></tr></thead><tbody className="divide-y divide-hairline">{[['全店閲覧・契約設定', true, false, false], ['担当店舗の設定・承認', true, true, false], ['予約入力・配席', true, true, true], ['Google/LINE公開承認', true, true, false]].map(([label, ...values]) => <tr key={String(label)}><td className="px-5 py-3">{label}</td>{values.map((v, i) => <td key={i} className="px-5 py-3 text-center font-bold">{v ? <span className="text-success">✓</span> : <span className="text-ink-faint">—</span>}</td>)}</tr>)}</tbody></table></div></Panel>
    </div>
  </div>
}

function Approvals({ data, busy, decide }: { data: RestaurantSnapshot; busy: boolean; decide: (id: string, action: 'approve' | 'return') => void }) {
  const pending = data.approvals.filter((item) => item.status === 'pending')
  return <div className="space-y-5"><div className="grid gap-4 sm:grid-cols-4"><Metric label="承認待ち" value={pending.length} note="対応が必要" tone={pending.length ? 'warning' : 'normal'} /><Metric label="Google投稿" value={data.approvals.filter((a) => a.kind === 'gbp_post').length} note="投稿下書き" /><Metric label="LINE配信" value={data.approvals.filter((a) => a.kind === 'line_message').length} note="配信下書き" /><Metric label="メニュー改定" value={data.approvals.filter((a) => a.kind === 'menu_change').length} note="価格・内容変更" /></div>
    <div className="space-y-3">{data.approvals.map((item) => <ApprovalCard key={item.id} item={item} store={data.stores.find((s) => s.id === item.store_id)} busy={busy} decide={decide} />)}{data.approvals.length === 0 && <Panel title="承認キュー"><p className="p-8 text-center text-sm text-ink-faint">承認待ちはありません。</p></Panel>}</div>
    <Panel title="公開境界" description="承認しても検証中は外部公開しません。"><p className="p-5 text-sm leading-6 text-ink-secondary">状態は「承認済」まで進みます。Google投稿、LINE送信、メニュー媒体反映は、接続承認後に別工程として有効化します。</p></Panel>
  </div>
}
function ApprovalCard({ item, store, busy, decide }: { item: RestaurantApproval; store?: RestaurantStore; busy: boolean; decide: (id: string, action: 'approve' | 'return') => void }) {
  const kind = { gbp_post: 'Google投稿', line_message: 'LINE配信', menu_change: 'メニュー改定' }[item.kind]
  return <article className={`rounded-card border bg-canvas p-5 ${item.status === 'pending' ? 'border-accent' : 'border-hairline'}`}><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><span className="rounded-pill bg-accent-soft px-2 py-1 text-xs font-bold text-accent">{kind}</span><Status value={item.status} /><span className="text-xs text-ink-faint">{store?.name || '全店舗'}</span></div><h3 className="mt-3 font-bold text-ink">{item.title}</h3><p className="mt-1 text-xs text-ink-faint">申請: {item.requested_by || '—'} ・ {formatDate(item.created_at)}</p>{item.review_comment && <p className="mt-3 rounded-control bg-warning-bg px-3 py-2 text-sm text-warning">{item.review_comment}</p>}</div>{item.status === 'pending' && <div className="flex gap-2"><button disabled={busy} onClick={() => decide(item.id, 'return')} className="rounded-control border border-danger px-4 py-2 text-sm font-bold text-danger disabled:opacity-50">差戻し</button><button disabled={busy} onClick={() => decide(item.id, 'approve')} className="rounded-control bg-accent-deep px-4 py-2 text-sm font-bold text-on-accent disabled:opacity-50">承認する</button></div>}</div></article>
}

function Reservations({ data, store, busy, create, importInbound }: { data: RestaurantSnapshot; store: RestaurantStore | null; busy: boolean; create: (body: Record<string, unknown>) => void; importInbound: (body: Record<string, unknown>) => void }) {
  const rows = scoped(data.reservations, store?.id || '')
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
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
  return <div className="space-y-5"><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><Metric label="予約" value={`${rows.length}件`} note="表示範囲" /><Metric label="ご来店人数" value={`${rows.reduce((s, r) => s + r.guest_count, 0)}名`} note="取消を含む" /><Metric label="LINE予約" value={rows.filter((r) => r.source === 'line').length} note="自社導線" /><Metric label="媒体予約" value={rows.filter((r) => !['line', 'phone', 'manual'].includes(r.source)).length} note="受信した予約" /><Metric label="未配席" value={rows.filter((r) => !r.table_id).length} note="卓の割当が必要" tone={rows.some((r) => !r.table_id) ? 'warning' : 'normal'} /></div>
    <div className="flex flex-wrap justify-end gap-2"><button onClick={() => setShowImport(!showImport)} className="rounded-control border border-nen-border bg-nen-ivory px-4 py-2 text-sm font-bold text-nen-green">受信データを試す</button><button onClick={() => setShowForm(!showForm)} className="rounded-control bg-accent-deep px-4 py-2 text-sm font-bold text-on-accent">手動予約を登録</button></div>
    {showForm && <InlineForm title="手動予約"><form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><Field label="お客様名" name="customerName" required /><Field label="電話番号" name="phone" /><Field label="人数" name="guestCount" type="number" defaultValue="2" required /><Field label="開始日時" name="startsAt" type="datetime-local" required /><label className="text-xs font-bold text-ink-secondary">コース<select name="courseId" className="mt-1 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm"><option value="">未選択</option>{data.menuItems.filter((m) => !store || m.store_id === store.id).map((m) => <option value={m.id} key={m.id}>{m.name}</option>)}</select></label><Field label="アレルギー・特記事項" name="allergyNote" /><div className="sm:col-span-2 xl:col-span-6 flex justify-end"><button disabled={busy} className="rounded-control bg-accent-deep px-5 py-2 text-sm font-bold text-on-accent">台帳へ登録</button></div></form></InlineForm>}
    {showImport && <InlineForm title="媒体受信シミュレーター（外部への書戻しなし）"><form onSubmit={importSubmit} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><label className="text-xs font-bold text-ink-secondary">受信元<select name="provider" className="mt-1 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm"><option value="restaurant_board">レストランボード</option><option value="hotpepper">Hot Pepper</option><option value="tabelog">食べログ</option></select></label><Field label="外部予約ID" name="externalId" defaultValue={`DEMO-${Date.now()}`} required /><Field label="お客様名" name="customerName" required /><Field label="人数" name="guestCount" type="number" defaultValue="2" required /><Field label="開始日時" name="startsAt" type="datetime-local" required /><div className="flex items-end"><button disabled={busy} className="w-full rounded-control bg-nen-green px-4 py-2 text-sm font-bold text-on-accent">受信として取込</button></div></form></InlineForm>}
    <Panel title="予約タイムライン" description="媒体別の色と、配席・コースを同時に確認します。"><div className="overflow-x-auto"><table className="w-full min-w-[980px] text-sm"><thead className="bg-canvas-sunken text-left text-xs text-ink-faint"><tr>{['時刻', '予約元', 'お客様', '人数', '卓', 'コース', '注意事項', '状態'].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}</tr></thead><tbody className="divide-y divide-hairline">{rows.map((r) => <tr key={r.id}><td className="px-4 py-4 font-bold">{formatDate(r.starts_at)}</td><td className="px-4 py-4"><span className={`rounded-pill px-2 py-1 text-xs font-bold ${sourceTone[r.source] || 'bg-canvas-sunken text-ink-secondary'}`}>{sourceLabel[r.source] || r.source}</span></td><td className="px-4 py-4 font-bold">{r.customer_name}<p className="text-xs font-normal text-ink-faint">{r.customer_phone || '電話未登録'}</p></td><td className="px-4 py-4">{r.guest_count}名</td><td className="px-4 py-4">{r.table_label || <span className="text-warning">未配席</span>}</td><td className="px-4 py-4">{r.course_name || '席のみ'}</td><td className="max-w-48 truncate px-4 py-4 text-xs text-danger">{r.allergy_note || '—'}</td><td className="px-4 py-4"><Status value={r.status} /></td></tr>)}</tbody></table></div></Panel>
    <Panel title="顧客カルテ" description="電話番号またはLINE UIDで名寄せする設計です。"><div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">{rows.slice(0, 6).map((r) => <div key={r.id} className="rounded-control border border-hairline p-4"><p className="font-bold">{r.customer_name}</p><p className="mt-1 text-xs text-ink-faint">{r.customer_phone || r.line_uid || '連絡先未登録'}</p><p className="mt-3 text-sm text-ink-secondary">直近: {formatDate(r.starts_at)} / {r.guest_count}名</p></div>)}</div></Panel>
  </div>
}

function Field({ label, name, type = 'text', defaultValue, required = false }: { label: string; name: string; type?: string; defaultValue?: string; required?: boolean }) {
  return <label className="text-xs font-bold text-ink-secondary">{label}<input name={name} type={type} defaultValue={defaultValue} required={required} className="mt-1 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm font-normal text-ink" /></label>
}
function InlineForm({ title, children }: { title: string; children: ReactNode }) { return <section className="rounded-card border border-accent bg-accent-soft/40 p-5"><h2 className="mb-4 font-bold text-accent">{title}</h2>{children}</section> }

function Tables({ data, store, busy, create }: { data: RestaurantSnapshot; store: RestaurantStore | null; busy: boolean; create: (body: Record<string, unknown>) => void }) {
  const rows = scoped(data.tables, store?.id || '')
  const [showForm, setShowForm] = useState(false)
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!store) return; const fd = new FormData(event.currentTarget); create({ storeId: store.id, code: fd.get('code'), label: fd.get('label'), seatType: fd.get('seatType'), minCapacity: Number(fd.get('minCapacity')), maxCapacity: Number(fd.get('maxCapacity')) }) }
  return <div className="space-y-5"><div className="grid gap-4 sm:grid-cols-4"><Metric label="卓数" value={rows.length} note="稼働・停止を含む" /><Metric label="総席数" value={rows.reduce((s, t) => s + t.max_capacity, 0)} note="最大収容人数" /><Metric label="結合可能" value={new Set(rows.filter((t) => t.join_group).map((t) => t.join_group)).size} note="結合グループ" /><Metric label="個室" value={rows.filter((t) => t.seat_type === 'private_room').length} note="個室卓" /></div>
    <div className="flex justify-end"><button onClick={() => setShowForm(!showForm)} className="rounded-control bg-accent-deep px-4 py-2 text-sm font-bold text-on-accent">卓を追加</button></div>
    {showForm && <InlineForm title="新しい卓"><form onSubmit={submit} className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6"><Field label="卓番" name="code" required /><Field label="表示名" name="label" required /><label className="text-xs font-bold text-ink-secondary">席種<select name="seatType" className="mt-1 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm"><option value="table">テーブル</option><option value="counter">カウンター</option><option value="private_room">個室</option><option value="terrace">テラス</option></select></label><Field label="最小人数" name="minCapacity" type="number" defaultValue="1" required /><Field label="最大人数" name="maxCapacity" type="number" defaultValue="4" required /><div className="flex items-end"><button disabled={busy} className="w-full rounded-control bg-accent-deep px-4 py-2 text-sm font-bold text-on-accent">追加</button></div></form></InlineForm>}
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_330px]"><Panel title="フロアマップ" description="ドラッグ配置は切り離し後の専用サーバーで永続化します。"><div className="relative m-5 min-h-[420px] rounded-card border border-dashed border-hairline bg-canvas-sunken p-5"><div className="grid grid-cols-3 gap-6">{rows.map((t) => <div key={t.id} className={`flex min-h-28 flex-col items-center justify-center rounded-card border-2 p-3 text-center ${t.join_group ? 'border-accent bg-accent-soft' : 'border-hairline bg-canvas'}`}><p className="text-xs font-bold text-ink-faint">{t.code}</p><p className="mt-1 font-bold">{t.label}</p><p className="mt-2 text-xs text-ink-secondary">{t.min_capacity}〜{t.max_capacity}名</p>{t.join_group && <span className="mt-2 rounded-pill bg-canvas px-2 py-1 text-[10px] font-bold text-accent">結合 {t.join_group}</span>}</div>)}</div></div></Panel>
      <Panel title="卓の詳細"><div className="divide-y divide-hairline">{rows.map((t) => <div key={t.id} className="p-4"><div className="flex justify-between"><p className="font-bold">{t.code} · {t.label}</p><Status value={t.is_active ? 'active' : 'disabled'} /></div><p className="mt-1 text-xs text-ink-faint">{t.seat_type} / {t.min_capacity}〜{t.max_capacity}名</p></div>)}</div></Panel></div>
    <Panel title="自動配席ルール"><div className="p-5 text-sm leading-6 text-ink-secondary"><p className="font-bold text-nen-green">収容差が最小の卓を優先</p><p>少人数予約で大型卓を占有しないよう、人数を収容できる卓のうち余剰席が最も少ない卓を候補にします。結合卓は同一グループとして次段階で評価します。</p></div></Panel>
  </div>
}

function Inventory({ data, store, busy, save }: { data: RestaurantSnapshot; store: RestaurantStore | null; busy: boolean; save: (row: RestaurantInventory, body: Record<string, unknown>) => void }) {
  const rows = scoped(data.inventory, store?.id || '')
  return <div className="space-y-5"><div className="grid gap-4 sm:grid-cols-5"><Metric label="総受入枠" value={rows.reduce((s, r) => s + r.total_capacity, 0)} note="表示時間帯の延べ枠" /><Metric label="予約済" value={rows.reduce((s, r) => s + r.reserved_count, 0)} note="受信・手動の合計" /><Metric label="OTA枠" value={rows.reduce((s, r) => s + r.ota_capacity, 0)} note="媒体向け配分" /><Metric label="LINE専用" value={rows.reduce((s, r) => s + r.line_capacity, 0)} note="自社予約枠" /><Metric label="当日保持" value={rows.reduce((s, r) => s + r.walk_in_capacity, 0)} note="ウォークイン" /></div>
    <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_340px]"><Panel title="時間帯別の在庫" description="30分単位。媒体別枠を編集しても外部へは書き戻しません。"><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead className="bg-canvas-sunken text-left text-xs text-ink-faint"><tr>{['時間', '利用状況', '予約済', '総数', 'OTA', 'LINE', '当日枠', '保存'].map((h) => <th key={h} className="px-3 py-3">{h}</th>)}</tr></thead><tbody className="divide-y divide-hairline">{rows.map((r) => <InventoryEditor key={r.id} row={r} busy={busy} save={save} />)}</tbody></table></div></Panel>
      <div className="space-y-4"><Panel title="媒体別配分"><div className="space-y-4 p-5">{[['OTA', rows.reduce((s, r) => s + r.ota_capacity, 0), 'bg-warning'], ['LINE', rows.reduce((s, r) => s + r.line_capacity, 0), 'bg-accent'], ['当日', rows.reduce((s, r) => s + r.walk_in_capacity, 0), 'bg-info']].map(([label, value, color]) => <div key={String(label)}><div className="flex justify-between text-xs"><span>{label}</span><span className="font-bold">{value}</span></div><div className="mt-1 h-2 rounded-full bg-canvas-sunken"><div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, Number(value) / Math.max(rows.reduce((s, r) => s + r.total_capacity, 0), 1) * 100)}%` }} /></div></div>)}</div></Panel><Panel title="オーバーブッキング防止"><div className="p-5 text-sm leading-6 text-ink-secondary"><p className="font-bold text-nen-green">検証中は外部在庫を更新しません</p><p className="mt-1">満席判定と内部ロックだけを確認します。OTA在庫0更新は本接続時の承認工程で有効化します。</p></div></Panel></div>
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
  return <tr><td className="px-3 py-4 font-bold">{formatDate(row.starts_at, false)}</td><td className="w-40 px-3 py-4"><div className="h-2 rounded-full bg-canvas-sunken"><div className={`h-full rounded-full ${ratio >= 90 ? 'bg-danger' : ratio >= 70 ? 'bg-warning' : 'bg-accent'}`} style={{ width: `${Math.max(4, ratio)}%` }} /></div></td><td className="px-3 py-4 font-bold">{row.reserved_count}</td><td className="px-3 py-4"><input aria-label="総数" type="number" value={total} onChange={(e) => setTotal(Number(e.target.value))} className={input} /></td><td className="px-3 py-4"><input aria-label="OTA枠" type="number" value={ota} onChange={(e) => setOta(Number(e.target.value))} className={input} /></td><td className="px-3 py-4"><input aria-label="LINE枠" type="number" value={line} onChange={(e) => setLine(Number(e.target.value))} className={input} /></td><td className="px-3 py-4"><input aria-label="当日枠" type="number" value={walkIn} onChange={(e) => setWalkIn(Number(e.target.value))} className={input} /></td><td className="px-3 py-4"><button disabled={busy || ota + line + walkIn > total} onClick={() => save(row, { totalCapacity: total, otaCapacity: ota, lineCapacity: line, walkInCapacity: walkIn })} className="rounded-control bg-accent-deep px-3 py-1.5 text-xs font-bold text-on-accent disabled:opacity-40">保存</button></td></tr>
}

function Menu({ data, store, busy, create }: { data: RestaurantSnapshot; store: RestaurantStore | null; busy: boolean; create: (body: Record<string, unknown>) => void }) {
  const rows = scoped(data.menuItems, store?.id || '')
  const [showForm, setShowForm] = useState(false)
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!store) return; const fd = new FormData(event.currentTarget); create({ storeId: store.id, kind: fd.get('kind'), name: fd.get('name'), price: Number(fd.get('price')), allergens: String(fd.get('allergens') || '').split(',').map((s) => s.trim()).filter(Boolean), servicePeriods: [fd.get('period')] }) }
  return <div className="space-y-5"><div className="grid gap-4 sm:grid-cols-5"><Metric label="全メニュー" value={rows.length} note="公開・下書き" /><Metric label="コース" value={rows.filter((m) => m.kind === 'course').length} note="予約時に選択" /><Metric label="単品" value={rows.filter((m) => m.kind === 'a_la_carte').length} note="アラカルト" /><Metric label="要承認" value={data.approvals.filter((a) => a.kind === 'menu_change' && a.status === 'pending').length} note="価格・内容改定" tone="warning" /><Metric label="アレルギー登録" value={rows.filter((m) => safeArray(m.allergens_json).length).length} note="注意品目あり" /></div>
    <div className="flex justify-end"><button onClick={() => setShowForm(!showForm)} className="rounded-control bg-accent-deep px-4 py-2 text-sm font-bold text-on-accent">メニューを追加</button></div>
    {showForm && <InlineForm title="新しいメニュー"><form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><label className="text-xs font-bold text-ink-secondary">種類<select name="kind" className="mt-1 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm"><option value="course">コース</option><option value="a_la_carte">単品</option></select></label><Field label="メニュー名" name="name" required /><Field label="価格（税込）" name="price" type="number" required /><Field label="アレルギー（カンマ区切り）" name="allergens" /><label className="text-xs font-bold text-ink-secondary">提供時間<select name="period" className="mt-1 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm"><option value="lunch">ランチ</option><option value="dinner">ディナー</option></select></label><div className="flex items-end"><button disabled={busy} className="w-full rounded-control bg-accent-deep px-4 py-2 text-sm font-bold text-on-accent">追加</button></div></form></InlineForm>}
    <Panel title="メニュー一覧" description="予約台帳・Google投稿・LINEカードで同じマスターを参照します。"><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead className="bg-canvas-sunken text-left text-xs text-ink-faint"><tr>{['メニュー', '種類', '価格', '提供時間', '所要時間', 'アレルギー', '状態'].map((h) => <th key={h} className="px-5 py-3">{h}</th>)}</tr></thead><tbody className="divide-y divide-hairline">{rows.map((m) => <tr key={m.id}><td className="px-5 py-4 font-bold text-action">{m.name}</td><td className="px-5 py-4">{m.kind === 'course' ? 'コース' : '単品'}</td><td className="px-5 py-4 font-bold">{yen(m.price)}</td><td className="px-5 py-4">{safeArray(m.service_periods_json).map((p) => p === 'lunch' ? 'ランチ' : 'ディナー').join('・')}</td><td className="px-5 py-4">{m.duration_minutes ? `${m.duration_minutes}分` : '—'}</td><td className="px-5 py-4">{safeArray(m.allergens_json).join('・') || 'なし'}</td><td className="px-5 py-4"><Status value={m.status} /></td></tr>)}</tbody></table></div></Panel>
  </div>
}

function GooglePanel({ data, store, busy, createPost, saveReply }: { data: RestaurantSnapshot; store: RestaurantStore | null; busy: boolean; createPost: (body: Record<string, unknown>) => void; saveReply: (id: string, draft: string) => void }) {
  const reviews = scoped(data.reviews, store?.id || '')
  const connectors = scoped(data.connectors, store?.id || '').filter((c) => c.provider === 'google_business_profile')
  const average = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0
  const postSubmit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!store) return; const fd = new FormData(event.currentTarget); createPost({ storeId: store.id, postType: fd.get('postType'), title: fd.get('title'), body: fd.get('body'), ctaType: 'book' }) }
  return <div className="space-y-5"><div className="grid gap-4 sm:grid-cols-5"><Metric label="平均評価" value={average ? average.toFixed(1) : '—'} note="取得済み口コミ" /><Metric label="口コミ" value={reviews.length} note="キャッシュ24時間" /><Metric label="未返信" value={reviews.filter((r) => r.reply_status === 'unreplied').length} note="返信が必要" tone="warning" /><Metric label="投稿下書き" value={data.approvals.filter((a) => a.kind === 'gbp_post').length} note="承認キュー連携" /><Metric label="Google接続" value={<Status value={connectors[0]?.status || store?.google_status || 'unconfigured'} />} note="送信は無効" /></div>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_350px]"><Panel title="クチコミ一元管理" description="返信案は下書きまで。Googleへの送信は行いません。"><div className="divide-y divide-hairline">{reviews.map((r) => <ReviewEditor key={r.id} review={r} busy={busy} save={saveReply} />)}</div></Panel>
      <div className="space-y-4"><Panel title="投稿マネージャー"><form onSubmit={postSubmit} className="space-y-3 p-5"><label className="block text-xs font-bold text-ink-secondary">投稿種別<select name="postType" className="mt-1 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm"><option value="standard">最新情報</option><option value="event">イベント</option><option value="offer">クーポン</option></select></label><Field label="タイトル" name="title" required /><label className="block text-xs font-bold text-ink-secondary">本文<textarea name="body" required rows={5} className="mt-1 w-full rounded-control border border-hairline px-3 py-2 text-sm font-normal leading-6" /></label><p className="text-xs text-ink-faint">画像は1200×900px推奨。現段階では下書きのみ保存します。</p><button disabled={busy || !store} className="w-full rounded-control bg-nen-green px-4 py-2 text-sm font-bold text-on-accent disabled:opacity-40">承認キューへ追加</button></form></Panel><Panel title="安全設定"><div className="p-5 text-sm leading-6 text-ink-secondary"><p className="font-bold text-nen-green">公開操作は無効</p><p>Places APIの読取キャッシュと、GBP投稿/返信の承認キューだけを先に検証します。</p></div></Panel></div>
    </div>
  </div>
}

function ReviewEditor({ review, busy, save }: { review: RestaurantSnapshot['reviews'][number]; busy: boolean; save: (id: string, draft: string) => void }) {
  const suggestion = `${review.author_name || 'お客様'}、このたびはご来店いただき、また温かいお言葉をお寄せくださり誠にありがとうございます。季節のお料理と接客をお楽しみいただけたことを、スタッフ一同大変嬉しく拝読しました。またのお越しを心よりお待ちしております。`
  const [draft, setDraft] = useState(review.reply_draft || suggestion)
  return <article className="p-5"><div className="flex flex-wrap justify-between gap-3"><div><p className="font-bold">{review.author_name || 'Googleユーザー'}</p><p className="mt-1 text-sm tracking-widest text-nen-gold">{'★'.repeat(review.rating)}<span className="text-hairline">{'★'.repeat(5 - review.rating)}</span></p></div><div className="flex items-center gap-2"><Status value={review.reply_status} /><span className="text-xs text-ink-faint">{formatDate(review.reviewed_at)}</span></div></div><p className="mt-4 text-sm leading-6 text-ink-secondary">{review.comment || 'コメントなし'}</p><div className="mt-4 rounded-control border border-nen-border bg-nen-ivory p-4"><p className="text-xs font-bold text-nen-label">返信アシスタント（検証用下書き）</p><p className="mt-1 text-xs text-nen-copy">感情: {review.sentiment === 'positive' ? '好意的' : review.sentiment || '未分析'}。LLM接続前は丁寧な定型案を編集できます。</p><textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={5} className="mt-3 w-full rounded-control border border-nen-border bg-canvas px-3 py-2 text-sm leading-6" /><div className="mt-3 flex justify-end"><button disabled={busy || !draft.trim()} onClick={() => save(review.id, draft)} className="rounded-control bg-nen-green px-4 py-2 text-xs font-bold text-on-accent disabled:opacity-40">返信案を保存</button></div></div></article>
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
  return <article className="overflow-hidden rounded-card border border-nen-border bg-canvas"><div className="border-b border-nen-border bg-nen-ivory px-5 py-4"><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-bold tracking-[0.18em] text-nen-label">NEN RESTAURANT</p><h2 className="mt-1 font-bold text-nen-green">{flow.title}</h2></div><Status value={flow.delivery_mode} /></div></div><div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_220px]"><div className="space-y-3"><label className="block text-xs font-bold text-ink-secondary">タイトル<input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded-control border border-hairline px-3 py-2 text-sm font-normal" /></label><label className="block text-xs font-bold text-ink-secondary">本文<textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} className="mt-1 w-full rounded-control border border-hairline px-3 py-2 text-sm font-normal leading-6" /></label><div className="flex items-center justify-between"><span className="text-xs font-bold text-nen-label">配信: {timing}</span><button disabled={busy} onClick={() => save(flow, { title, body, timingMinutes: flow.timing_minutes, isEnabled: Boolean(flow.is_enabled) })} className="rounded-control bg-nen-green px-4 py-2 text-xs font-bold text-on-accent disabled:opacity-50">下書きを保存</button></div></div><div className="rounded-card bg-nen-green p-4 text-on-accent shadow-lg"><p className="text-[9px] tracking-[0.2em] text-nen-gold-soft">然 NEN</p><p className="mt-3 text-sm font-bold">{title}</p><p className="mt-2 text-xs leading-5 text-on-accent/80">{body}</p><div className="mt-4 rounded-control bg-canvas/10 px-3 py-2 text-center text-xs font-bold">予約内容を確認</div></div></div></article>
}
