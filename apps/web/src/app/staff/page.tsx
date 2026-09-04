'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import QRCode from 'qrcode'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import LoginAudit from '@/components/staff/login-audit'
import Select from '@/components/shared/select'
import { TableHeadRow, Th } from '@/components/shared/table'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import NotificationSwitch from '@/components/ui/notification-switch'
import { ApiError, api } from '@/lib/api'
import type { StaffMember } from '@line-crm/shared'
import { isActiveAdministrator, staffActionPolicy } from './staff-actions'

type AuditRow = { id: string; adminUserId: string | null; userName: string; action: string; screen: string | null; connectionSource: string | null; createdAt: string }
type Channel = { email: boolean; line: boolean }
const ROLE_LABEL: Record<string, string> = { owner: '管理者', admin: '管理者', staff: 'スタッフ', viewer: '閲覧のみ' }
const NOTIFICATIONS = [
  ['operations', '運用状態のエラー', '異常を検知したとき'], ['emergency', '緊急停止・復旧', '停止または復旧したとき'],
  ['security', 'ログイン・権限変更', 'ログインや権限が変わったとき'], ['updates', 'システム更新', '更新が完了したとき'],
] as const
const PERMISSIONS = [
  ['/', 'ダッシュボード'], ['/chats', '受信箱'], ['/friends', '友だち'], ['/tags', '友だち属性'], ['/scenarios', 'シナリオ配信'], ['/broadcasts', '一斉配信'], ['/reminders', 'リマインダ'], ['/auto-replies', '自動応答'], ['/templates', 'テンプレート'], ['/rich-menus', 'リッチメニュー'], ['/form-submissions', '回答フォーム'], ['/contents/vars', '共通情報'], ['/contents', '登録メディア一覧'], ['/analytics', '分析'], ['/automations', 'オートメーション'], ['/webhooks', '外部連携'], ['/booking/bookings', '予約管理'], ['/ec-commerce', 'ECデータ連携'], ['/line-notifications', 'LINE通知'], ['/nen-campaigns', 'フォロー配信'], ['/nen-members', '投稿写真審査'],
] as const
const STAFF_TABS = [
  { key: 'members', label: 'ログインユーザー' },
  { key: 'audit', label: '入った記録' },
] as const

function messageOf(error: unknown): string { return error instanceof ApiError || error instanceof Error ? error.message : '通信に失敗しました' }
function Kpi({ label, value, unit, note }: { label: string; value: string; unit?: string; note: string }) { return <div className="flex h-[105px] flex-col gap-[5px] rounded-[18px] border border-hairline bg-canvas p-[15px]"><p className="text-xs font-semibold leading-[1.45] text-ink-faint">{label}</p><div className="flex h-[29px] items-start gap-1"><p className="text-xl font-bold leading-[1.45] tabular-nums text-ink">{value}</p>{unit && <span className="mt-3 text-xs font-medium leading-[1.45] text-ink-faint">{unit}</span>}</div><p className="text-[11px] leading-[1.45] text-ink-faint">{note}</p></div> }
function Modal({ children, onClose, wide = false }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) { return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4" role="dialog" aria-modal="true" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div className={`max-h-[90vh] w-full overflow-y-auto rounded-card bg-canvas p-6 shadow-xl ${wide ? 'max-w-3xl' : 'max-w-xl'}`}>{children}</div></div> }

function LoginHistoryNote({ count, loading, failed = false }: { count: number | null; loading: boolean; failed?: boolean }) {
  if (loading) return <p className="text-xs text-ink-secondary">ログイン履歴を確認中…</p>
  if (failed) return <p className="text-xs text-warning">ログイン履歴を取得できませんでした。操作は続けられます。</p>
  return <p className="text-xs font-medium text-ink-secondary">{count ? `このユーザーにはログイン履歴が ${count} 件あります` : 'ログイン履歴はありません'}</p>
}

function EditModal({ member, administrator, currentUserId, activeAdministratorCount, onClose, onSaved }: { member: StaffMember; administrator: boolean; currentUserId: string | null; activeAdministratorCount: number; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(member.name), [email, setEmail] = useState(member.email ?? '')
  const [role, setRole] = useState<'admin' | 'staff' | 'viewer'>(member.role === 'owner' ? 'admin' : member.role)
  const [permissions, setPermissions] = useState(member.permissionKeys)
  const [notifications, setNotifications] = useState<Record<string, Channel>>(() => Object.fromEntries(NOTIFICATIONS.map(([key]) => [key, member.notificationPreferences[key] ?? { email: true, line: true }])))
  const [saving, setSaving] = useState(false), [statusSaving, setStatusSaving] = useState(false), [error, setError] = useState('')
  const [loginCount, setLoginCount] = useState<number | null>(null), [loginHistoryLoading, setLoginHistoryLoading] = useState(administrator), [loginHistoryFailed, setLoginHistoryFailed] = useState(false)
  /*
   * **ブラウザの `confirm()` を使わない。**
   *
   * 見た目がブラウザ任せで設計の確認窓（`J6x4Q` / `H2S1T4`）と違ううえ、
   * 画像比較にも写らない。連携を外すと何が届かなくなるのかを本文で読ませたい
   * ので、共通の `ConfirmDialog` へ移した。
   */
  const [unlinkOpen, setUnlinkOpen] = useState(false), [unlinking, setUnlinking] = useState(false), [unlinkError, setUnlinkError] = useState('')
  const policy = staffActionPolicy({ member, currentUserId, administrator, activeAdministratorCount })
  useEffect(() => {
    if (!administrator) return
    let active = true
    void api.staff.loginSummary(member.id).then((result) => { if (active && result.success) setLoginCount(result.data.loginCount) }).catch(() => { if (active) setLoginHistoryFailed(true) }).finally(() => { if (active) setLoginHistoryLoading(false) })
    return () => { active = false }
  }, [administrator, member.id])
  const toggleNotification = (key: string, channel: keyof Channel) => setNotifications((current) => ({ ...current, [key]: { ...current[key], [channel]: !current[key][channel] } }))
  const save = async () => { if (!email.trim()) return setError('メールアドレスを入力してください'); setSaving(true); setError(''); try { await api.staff.update(member.id, { name: administrator ? name.trim() : undefined, email: email.trim(), role: administrator ? role : undefined, permissionKeys: administrator && role === 'staff' ? permissions : undefined, notificationPreferences: notifications }); await onSaved(); onClose() } catch (caught) { setError(messageOf(caught)) } finally { setSaving(false) } }
  /**
   * LINE連携を外す。
   *
   * 処理中は受け付けない（二度押しで2回叩くと、2回目の返事で失敗に見える）。
   * 失敗は握りつぶさず、窓の中に運用者の言葉で出す。生のAPIエラーだと
   * 次に何をすればよいか読み取れない。
   */
  const unlinkLine = async () => { if (unlinking) return; setUnlinking(true); setUnlinkError(''); try { const res = await api.staff.update(member.id, { lineLinked: false }); if (!res.success) throw new Error(res.error); setUnlinkOpen(false); await onSaved(); onClose() } catch { setUnlinkError('LINE連携を解除できませんでした。状態を読み直してから、もう一度お試しください。') } finally { setUnlinking(false) } }
  const toggleActive = async () => { if (policy.statusBlockedReason) return; setStatusSaving(true); setError(''); try { await api.staff.update(member.id, { isActive: !member.isActive }); await onSaved(); onClose() } catch (caught) { setError(messageOf(caught)) } finally { setStatusSaving(false) } }
  return <Modal onClose={onClose} wide><div data-design-node="EOTS4"><div className="flex items-start justify-between"><div><h2 className="text-xl font-bold text-ink">見せる範囲を決める</h2><p className="mt-1 text-xs text-ink-secondary">役割・表示機能・担当範囲を確認し、このユーザーに必要な範囲だけを設定します。</p></div><button onClick={onClose} className="cursor-pointer rounded-control p-2 text-ink-faint hover:bg-canvas-sunken">×</button></div>
    <div className="mt-5 rounded-control bg-canvas-sunken p-3"><p className="font-semibold text-ink">{member.name}</p><p className="text-xs text-ink-secondary">{ROLE_LABEL[member.role]}</p></div>{error && <p className="mt-4 rounded-control bg-danger-bg p-3 text-sm text-danger">{error}</p>}
    {policy.showAccountActions && <section className={`mt-5 rounded-card border p-4 ${member.isActive ? 'border-accent bg-accent-soft' : 'border-warning bg-warning-bg'}`} aria-label="ユーザーの利用状態"><div className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-sm font-bold text-ink">ログイン状態：{member.isActive ? '有効' : '無効'}</p><p className="mt-1 text-xs leading-5 text-ink-secondary">{member.isActive ? '無効にすると、このユーザーはログインできなくなります。' : '有効にすると、このユーザーは再びログインできます。'}</p><div className="mt-2"><LoginHistoryNote count={loginCount} loading={loginHistoryLoading} failed={loginHistoryFailed} /></div></div><button type="button" onClick={() => void toggleActive()} disabled={statusSaving || Boolean(policy.statusBlockedReason)} className={`min-w-48 rounded-control px-4 py-2.5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40 ${member.isActive ? 'border border-warning bg-canvas text-warning hover:bg-warning-bg' : 'bg-accent text-on-accent hover:bg-accent-hover'}`}>{statusSaving ? '変更中…' : member.isActive ? 'このユーザーを無効にする' : 'このユーザーを有効にする'}</button></div>{policy.statusBlockedReason && <p className="mt-3 rounded-control bg-canvas p-3 text-xs font-medium text-warning">{policy.statusBlockedReason}</p>}</section>}
    <div className="mt-5 grid gap-4 sm:grid-cols-2">{administrator && <label className="text-sm font-medium text-ink">名前 <span className="text-warning">必須</span><input value={name} onChange={(e) => setName(e.target.value)} className="mt-2 h-11 w-full rounded-control border border-hairline px-3 outline-none focus:border-accent" /></label>}<label className="text-sm font-medium text-ink">メールアドレス <span className="text-warning">必須</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-2 h-11 w-full rounded-control border border-hairline px-3 outline-none focus:border-accent" /></label></div>
    {administrator && <div className="mt-5"><p className="text-sm font-medium text-ink">役割</p><div className="mt-2 grid grid-cols-3 gap-2">{(['admin', 'staff', 'viewer'] as const).map((value) => <button key={value} onClick={() => setRole(value)} className={`cursor-pointer rounded-control border px-3 py-3 text-sm ${role === value ? 'border-accent bg-accent-soft font-medium text-accent' : 'border-hairline text-ink-secondary'}`}>{ROLE_LABEL[value]}</button>)}</div></div>}
    {administrator && role === 'staff' && <div className="mt-5"><p className="text-sm font-medium text-ink">スタッフに表示する機能</p><div className="mt-2 grid gap-2 sm:grid-cols-3">{PERMISSIONS.map(([key, label]) => <label key={key} className={`flex cursor-pointer items-center gap-2 rounded-control border p-2 text-xs ${permissions.includes(key) ? 'border-accent bg-accent-soft text-accent' : 'border-hairline text-ink-secondary'}`}><input type="checkbox" checked={permissions.includes(key)} onChange={() => setPermissions((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])} />{label}</label>)}</div></div>}
    <div className="mt-5"><p className="text-sm font-medium text-ink">LINE連携</p><div className={`mt-2 flex items-center justify-between rounded-control border p-3 ${member.lineLinked ? 'border-accent bg-accent-soft' : 'border-hairline'}`}><div><p className={`text-sm font-medium ${member.lineLinked ? 'text-success' : 'text-ink-secondary'}`}>{member.lineLinked ? '連携済み' : '未連携'}</p><p className="text-xs text-ink-faint">{member.lineLinked ? `LINE：${member.name}` : '招待メールからLINE認証を行います'}</p></div>{member.lineLinked && <button onClick={() => { setUnlinkError(''); setUnlinkOpen(true) }} className="cursor-pointer rounded-control border border-hairline bg-canvas px-3 py-1.5 text-xs">連携解除</button>}</div></div>
    <div className="mt-5"><p className="text-sm font-medium text-ink">通知設定</p><div className="mt-2 divide-y divide-hairline overflow-hidden rounded-card border border-hairline">{NOTIFICATIONS.map(([key, label, note]) => <div key={key} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 p-3"><div><p className="text-sm text-ink">{label}</p><p className="text-xs text-ink-faint">{note}</p></div><div className="flex items-center gap-2 text-xs">メール<NotificationSwitch checked={notifications[key].email} onChange={() => toggleNotification(key, 'email')} label={`${label}メール`} /></div><div className="flex items-center gap-2 text-xs">LINE<NotificationSwitch checked={notifications[key].line} onChange={() => toggleNotification(key, 'line')} label={`${label}LINE`} /></div></div>)}</div></div>
    <div className="mt-6 flex justify-end gap-2"><button onClick={onClose} className="cursor-pointer rounded-control border border-hairline px-4 py-2 text-sm">キャンセル</button><button onClick={() => void save()} disabled={saving} className="cursor-pointer rounded-control bg-accent-deep px-4 py-2 text-sm font-medium text-on-accent disabled:opacity-50">✓ {saving ? '保存中…' : '変更を保存'}</button></div>
    {/* 連携はあとから張り直せる。赤は本当に戻せない操作に取っておく。 */}
    <ConfirmDialog
      open={unlinkOpen}
      title={`${member.name} のLINE連携を解除しますか？`}
      description="このユーザーへのLINE通知が止まります。ログインや権限はそのままで、招待メールからLINE認証をやり直せば、また繋がります。"
      confirmLabel="解除する"
      busy={unlinking}
      error={unlinkError}
      onConfirm={() => void unlinkLine()}
      onCancel={() => { if (unlinking) return; setUnlinkOpen(false); setUnlinkError('') }}
    >
      <p className="text-ink-secondary text-sm">通知設定でLINEを選んでいるお知らせは、解除したあと届かなくなります。メールを選んでいるぶんはそのまま届きます。</p>
    </ConfirmDialog>
  </div></Modal>
}

function TwoFactorModal({ member, onClose, onSaved }: { member: StaffMember; onClose: () => void; onSaved: () => Promise<void> }) {
  const [uri, setUri] = useState(''), [manualKey, setManualKey] = useState(''), [qr, setQr] = useState(''), [code, setCode] = useState(''), [error, setError] = useState(''), [saving, setSaving] = useState(false)
  useEffect(() => { void (async () => { try { const res = await api.staff.beginTwoFactorSetup(member.id); if (res.success) { setUri(res.data.provisioningUri); setManualKey(res.data.manualKey) } } catch (caught) { setError(messageOf(caught)) } })() }, [member.id])
  useEffect(() => { if (uri) void QRCode.toDataURL(uri, { width: 240, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } }).then(setQr) }, [uri])
  const save = async () => { if (!/^\d{6}$/.test(code)) return setError('6桁の認証コードを入力してください'); setSaving(true); setError(''); try { await api.staff.confirmTwoFactorSetup(member.id, code); await onSaved(); onClose() } catch (caught) { setError(messageOf(caught)) } finally { setSaving(false) } }
  return <Modal onClose={onClose} wide><div className="flex items-start justify-between"><div><h2 className="text-xl font-bold text-ink">二段階認証を設定</h2><p className="mt-1 text-xs text-ink-secondary">認証アプリを登録して、ログインを安全にします。</p></div><button onClick={onClose} className="cursor-pointer p-2 text-ink-faint">×</button></div>
    <div className="mt-5 grid grid-cols-2 gap-2 text-sm"><div className="rounded-control bg-accent-soft px-4 py-3 font-medium text-accent">1　QRコードを読み取る</div><div className="rounded-control bg-canvas-sunken px-4 py-3 text-ink-secondary">2　6桁コードを入力</div></div>{error && <p className="mt-4 rounded-control bg-danger-bg p-3 text-sm text-danger">{error}</p>}
    <div className="mt-5 grid gap-5 sm:grid-cols-[220px_1fr]">{qr ? <img src={qr} alt="Authenticator登録用QRコード" className="h-[220px] w-[220px] rounded-control border border-hairline" /> : <div className="h-[220px] animate-pulse rounded-control bg-canvas-sunken" />}<div><h3 className="font-semibold text-ink">認証アプリで読み取る</h3><p className="mt-3 text-sm leading-6 text-ink-secondary">Google Authenticator、Microsoft AuthenticatorなどでQRコードを読み取ってください。</p><div className="mt-4 rounded-control bg-info-bg p-3"><p className="text-xs text-ink-secondary">読み取れない場合はキーを手動入力</p><p className="mt-1 break-all font-mono text-sm font-bold tracking-wider text-ink">{manualKey || '—'}</p></div></div></div>
    <label className="mt-5 block text-sm font-medium text-ink">認証アプリに表示された6桁コード<input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" className="mt-2 h-12 w-full rounded-control border border-hairline px-4 text-center text-xl font-bold tracking-[0.5em] outline-none focus:border-accent" placeholder="000000" /></label><p className="mt-4 rounded-control bg-info-bg p-3 text-xs text-ink-secondary">登録後はLINEログインのあとに認証アプリのコード入力が必要です。</p>
    <div className="mt-6 flex justify-end gap-2"><button onClick={onClose} className="cursor-pointer rounded-control border border-hairline px-4 py-2 text-sm">キャンセル</button><button onClick={() => void save()} disabled={saving || !uri} className="cursor-pointer rounded-control bg-accent-deep px-4 py-2 text-sm font-medium text-on-accent disabled:opacity-50">✓ {saving ? '確認中…' : '設定を完了'}</button></div></Modal>
}

function StaffPageHost() {
  const tab = useMergedTab(STAFF_TABS, 'tab', 'members')
  const [members, setMembers] = useState<StaffMember[]>([]), [accountNames, setAccountNames] = useState<Record<string, string>>({}), [me, setMe] = useState<StaffMember | null>(null), [audits, setAudits] = useState<AuditRow[]>([]), [query, setQuery] = useState(''), [roleFilter, setRoleFilter] = useState('all'), [statusFilter, setStatusFilter] = useState('all'), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [editing, setEditing] = useState<StaffMember | null>(null), [settingTwoFactor, setSettingTwoFactor] = useState<StaffMember | null>(null)
  /* ブラウザの `confirm()` をやめて、共通の確認窓へ移した（理由は EditModal と同じ）。 */
  const [disablingTarget, setDisablingTarget] = useState<StaffMember | null>(null), [disablingTwoFactor, setDisablingTwoFactor] = useState(false), [disableError, setDisableError] = useState('')
  const administrator = me?.role === 'admin' || me?.role === 'owner'
  const load = useCallback(async () => { setLoading(true); setError(''); try { const [staffResult, meResult, accountsResult] = await Promise.all([api.staff.list(), api.staff.me(), api.lineAccounts.list()]); if (staffResult.success) setMembers(staffResult.data); if (accountsResult.success) setAccountNames(Object.fromEntries(accountsResult.data.map((account) => [account.id, account.name]))); if (meResult.success) { setMe(meResult.data); if (meResult.data.role === 'admin' || meResult.data.role === 'owner') { const auditResult = await api.loginAudit.list({ limit: 200 }); if (auditResult.success) setAudits(auditResult.data) } } } catch (caught) { setError(messageOf(caught)) } finally { setLoading(false) } }, [])
  useEffect(() => { void load() }, [load])
  const shown = useMemo(() => members.filter((member) => {
    const matchesQuery = `${member.name} ${member.email ?? ''}`.toLowerCase().includes(query.toLowerCase())
    const matchesRole = roleFilter === 'all' || (roleFilter === 'admin' ? member.role === 'admin' || member.role === 'owner' : member.role === roleFilter)
    const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' ? member.isActive : !member.isActive)
    return matchesQuery && matchesRole && matchesStatus
  }), [members, query, roleFilter, statusFilter])
  const activeAdministratorCount = members.filter(isActiveAdministrator).length
  const missing = members.filter((member) => member.isActive && !member.twoFactorEnabled).length, loginAudits = audits.filter((row) => row.action === 'login')
  const canEdit = (member: StaffMember) => Boolean(administrator || (me?.role === 'staff' && me.id === member.id))
  const openTwoFactor = (member: StaffMember) => { if (member.twoFactorEnabled) { setDisableError(''); setDisablingTarget(member) } else setSettingTwoFactor(member) }
  /**
   * 二段階認証を外す。
   *
   * 処理中は受け付けない。失敗は握りつぶさず、窓の中に運用者の言葉で出す。
   */
  const runDisableTwoFactor = async () => { if (!disablingTarget || disablingTwoFactor) return; setDisablingTwoFactor(true); setDisableError(''); try { const res = await api.staff.disableTwoFactor(disablingTarget.id); if (!res.success) throw new Error(res.error); setDisablingTarget(null); await load() } catch { setDisableError('二段階認証を解除できませんでした。状態を読み直してから、もう一度お試しください。') } finally { setDisablingTwoFactor(false) } }
  return <div data-design-node="e3jz3"><div className="mb-4"><MergedTabs basePath="/staff" tabs={STAFF_TABS} active={tab} defaultKey="members" actions={administrator && tab === 'members' ? <Link href="/staff/new" className="cursor-pointer rounded-control bg-accent-deep px-4 py-2 text-sm font-medium text-on-accent">ユーザーを追加</Link> : null} /></div>
    {tab === 'audit' ? <div data-design-node="jwVlo"><LoginAudit /></div> : <>
    {missing > 0 && <div className="mb-4 flex items-center rounded-card bg-warning-bg px-4 py-3 text-sm"><p>🔑　二段階認証が未設定のユーザーが <b>{missing}人</b> います</p></div>}
    <div data-design="KPIs" className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4"><Kpi label="管理スタッフ" value={`${members.length}`} unit="人" note={`管理者 ${members.filter((m) => m.role === 'admin' || m.role === 'owner').length}・その他 ${members.filter((m) => m.role !== 'admin' && m.role !== 'owner').length}`} /><Kpi label="二要素認証" value={`${members.filter((m) => m.twoFactorEnabled).length} / ${members.length}`} note={`未設定 ${missing}人`} /><Kpi label="この30日のログイン" value={`${loginAudits.length}`} unit="回" note={`失敗 ${audits.filter((row) => row.action === 'fail').length}`} /><Kpi label="最終ログイン" value={loginAudits[0]?.createdAt ? new Date(loginAudits[0].createdAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '—'} note={loginAudits[0]?.userName ?? '記録なし'} /></div>
    {error && <p className="mb-4 rounded-control bg-danger-bg p-3 text-sm text-danger">{error}</p>}
    <div id="staff-list" className="min-h-[540px] rounded-card border border-hairline bg-canvas"><div className="flex flex-wrap gap-3 border-b border-hairline p-4"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="名前・メールで検索" className="min-w-64 flex-1 rounded-control border border-hairline px-3 py-2 text-sm outline-none focus:border-accent" /><Select aria-label="役割で絞り込む" value={roleFilter} onChange={setRoleFilter} options={[{ value: 'all', label: 'すべての役割' }, { value: 'admin', label: '管理者' }, { value: 'staff', label: 'スタッフ' }, { value: 'viewer', label: '閲覧のみ' }]} /><Select aria-label="利用状態で絞り込む" value={statusFilter} onChange={setStatusFilter} options={[{ value: 'all', label: 'すべての利用状態' }, { value: 'active', label: '有効' }, { value: 'inactive', label: '無効' }]} /></div>
      <div><table className="w-full table-fixed text-sm"><thead><TableHeadRow><Th className="w-1/4">ユーザー</Th><Th className="w-1/8">役割</Th><Th className="w-1/5">担当範囲</Th><Th className="w-1/8">LINE連携</Th><Th className="w-1/8">二段階認証</Th><Th className="w-1/12">利用状態</Th><Th className="w-1/12" align="right">操作</Th></TableHeadRow></thead><tbody className="divide-y divide-hairline">{loading ? <tr><td colSpan={7} className="p-10 text-center text-ink-faint">読み込み中…</td></tr> : shown.length === 0 ? <tr><td colSpan={7} className="p-10 text-center text-ink-faint">条件に合うユーザーはいません。</td></tr> : shown.map((member) => <tr key={member.id} className="hover:bg-canvas-sunken"><td className="min-w-0 px-3 py-3"><p className="truncate font-semibold" title={member.name}>{member.name}</p><p className="truncate text-xs text-ink-faint" title={member.email ?? ''}>{member.email ?? '—'}</p></td><td className="px-3 py-3"><span className="whitespace-nowrap rounded-pill bg-info-bg px-2 py-1 text-xs text-accent">{ROLE_LABEL[member.role]}</span></td><td className="truncate px-3 py-3 text-xs" title={member.accountScope !== 'accounts' ? '全店舗' : (member.scopedLineAccountIds ?? []).map((id) => accountNames[id] ?? '不明な店舗').join('、')}>{member.accountScope !== 'accounts' ? '全店舗' : (member.scopedLineAccountIds ?? []).map((id) => accountNames[id] ?? '不明な店舗').join('、')}</td><td className="px-3 py-3"><span className={`whitespace-nowrap rounded-pill px-2 py-1 text-xs ${member.lineLinked ? 'bg-accent-soft text-success' : 'bg-warning-bg text-warning'}`}>{member.lineLinked ? '連携済み' : '未連携'}</span></td><td className="px-3 py-3">{canEdit(member) ? <button onClick={() => openTwoFactor(member)} className={`cursor-pointer whitespace-nowrap rounded-pill px-2 py-1 text-xs ${member.twoFactorEnabled ? 'bg-accent-soft text-success' : 'bg-canvas-sunken text-warning hover:bg-warning-bg'}`}>{member.twoFactorEnabled ? '設定済み' : '未設定'}</button> : <span className="whitespace-nowrap rounded-pill bg-canvas-sunken px-2 py-1 text-xs text-ink-faint">{member.twoFactorEnabled ? '設定済み' : '未設定'}</span>}</td><td className="px-3 py-3"><span className={`whitespace-nowrap rounded-pill px-2 py-1 text-xs ${member.isActive ? 'bg-accent-soft text-success' : 'bg-danger-bg text-danger'}`}>{member.isActive ? '有効' : '無効'}</span></td><td className="px-3 py-3 text-right">{canEdit(member) ? <button onClick={() => setEditing(member)} className="cursor-pointer whitespace-nowrap rounded-control border border-accent px-3 py-1.5 text-xs font-medium text-success hover:bg-accent-soft">範囲を編集</button> : <span className="text-xs text-ink-faint">不可</span>}</td></tr>)}</tbody></table></div><p className="border-t border-hairline bg-info-bg px-4 py-3 text-xs text-ink-secondary">編集では、役割・見せる機能・LINE連携・通知設定・利用状態を変更できます。</p></div>
    {editing && <EditModal member={editing} administrator={Boolean(administrator)} currentUserId={me?.id ?? null} activeAdministratorCount={activeAdministratorCount} onClose={() => setEditing(null)} onSaved={load} />}{settingTwoFactor && <TwoFactorModal member={settingTwoFactor} onClose={() => setSettingTwoFactor(null)} onSaved={load} />}</>}
    {/* 設定し直せる操作なので赤にしない。赤は本当に戻せない操作のために空けておく。 */}
    <ConfirmDialog
      open={disablingTarget !== null}
      title={disablingTarget ? `${disablingTarget.name} の二段階認証を解除しますか？` : ''}
      description="このユーザーはLINEログインだけでログインできるようになります。登録済みの認証アプリは使えなくなります。あとから「未設定」を押せば、設定し直せます。"
      confirmLabel="解除する"
      busy={disablingTwoFactor}
      error={disableError}
      onConfirm={() => void runDisableTwoFactor()}
      onCancel={() => { if (disablingTwoFactor) return; setDisablingTarget(null); setDisableError('') }}
    >
      <p className="text-ink-secondary text-sm">解除しても、権限・担当範囲・ログインの記録は変わりません。</p>
    </ConfirmDialog></div>
}

export default function StaffPage() {
  return <Suspense fallback={<div className="p-6 text-sm text-ink-faint">読み込み中…</div>}><StaffPageHost /></Suspense>
}
