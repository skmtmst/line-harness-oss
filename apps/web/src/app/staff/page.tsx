'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import QRCode from 'qrcode'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import LoginAudit from '@/components/staff/login-audit'
import Button from '@/components/shared/button'
import Select from '@/components/shared/select'
import SearchField from '@/components/shared/search-field'
import { Tabs } from '@/components/shared/tabs'
import { TableHeadRow, Th } from '@/components/shared/table'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import StepUpDialog from '@/components/shared/step-up-dialog'
import NotificationSwitch from '@/components/ui/notification-switch'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import {
  ApiError,
  api,
  fetchApi,
  type AccessRoleBundle,
  type AccessRoleItem,
  type AccessUserItem,
  type AccessUserSummary,
  type AuditEventItem,
} from '@/lib/api'
import type { StaffMember } from '@line-crm/shared'
import { SCOPE_ITEMS, BUNDLE_PRESETS, type FeatureAccessLevel, type ScopeLevels } from '@line-crm/shared'
import { csvCell } from '@/lib/presentation'
import { isActiveAdministrator, matchStaffMember, staffActionPolicy } from './staff-actions'
import { CONVERSION_APPROVAL_EDIT_KEY, PERMISSION_LABELS, normalizeStaffPermissionKeys, permissionLabel, toggleStaffPermissionKey } from './permission-labels'

type Channel = { email: boolean; line: boolean }
type CopyableAccessUser = AccessUserItem & { roleBundle: Exclude<AccessRoleBundle, 'custom'> }
const ROLE_LABEL: Record<string, string> = { owner: '管理者', admin: '管理者', staff: '運用', viewer: '見るだけ' }
const ACCESS_ROLE_LABEL: Record<AccessRoleBundle, string> = {
  administrator: '管理者',
  operations: '運用',
  reception: '受付',
  view_only: '見るだけ',
  custom: '個別設定',
}
const EMPTY_ACCESS_SUMMARY: AccessUserSummary = {
  active: 0,
  invited: 0,
  expiredInvitations: 0,
  unused90Days: 0,
  mfaEnabled: 0,
  mfaRate: null,
  roleCounts: { administrator: 0, operations: 0, reception: 0, view_only: 0, custom: 0 },
}
const NOTIFICATIONS = [
  ['operations', '運用状態のエラー', '異常を検知したとき'], ['emergency', '緊急停止・復旧', '停止または復旧したとき'],
  ['security', 'ログイン・権限変更', 'ログインや権限が変わったとき'], ['updates', 'システム更新', '更新が完了したとき'],
] as const
/*
 * 編集窓で付け外しできる顔ぶれはこの21件のまま。追加画面の分類表とは
 * 載せる顔ぶれが違うが、表示名は `permission-labels.ts` が正本。
 * 載せる顔ぶれ自体をそろえるかは仕様判断が要るので変えない(#581)。
 * 操作権限（成果の承認）は別枠で1件だけ足す。表示21件には数えない。
 */
const EDIT_PERMISSION_PATHS = ['/', '/chats', '/friends', '/tags', '/scenarios', '/broadcasts', '/reminders', '/auto-replies', '/templates', '/rich-menus', '/form-submissions', '/contents/vars', '/contents', '/analytics', '/automations', '/webhooks', '/booking/bookings', '/ec-commerce', '/line-notifications', '/nen-campaigns', '/nen-members'] as const
const PERMISSIONS: Array<readonly [string, string]> = EDIT_PERMISSION_PATHS.map((path) => [path, PERMISSION_LABELS[path]] as const)
const STAFF_TAB_KEYS = [
  { key: 'members', label: 'いまいる人' }, { key: 'invited', label: '招待中' },
  { key: 'audit', label: '入った記録' }, { key: 'roles', label: '権限のかたまり' },
] as const

const LIST_SORT_OPTIONS = [
  { value: 'recent', label: '最後に入った日が新しい順' },
  { value: 'name', label: '名前順' },
]

function messageOf(error: unknown): string { return error instanceof ApiError || error instanceof Error ? error.message : '通信に失敗しました' }
/* KPI札の高さ105px・角丸18pxは固定値のまま。変えるときは設計の確認が要る(#581)。 */
function Kpi({ label, value, unit, note }: { label: string; value: string; unit?: string; note: string }) { return <div className="flex h-[105px] flex-col gap-[5px] rounded-[18px] border border-hairline bg-canvas p-[15px]"><p className="text-xs font-semibold leading-[1.45] text-ink-faint">{label}</p><div className="flex h-[29px] items-start gap-1"><p className="text-xl font-bold leading-[1.45] tabular-nums text-ink">{value}</p>{unit && <span className="mt-3 text-xs font-medium leading-[1.45] text-ink-faint">{unit}</span>}</div><p className="text-[11px] leading-[1.45] text-ink-faint">{note}</p></div> }
function auditActionLabel(action: string): string {
  const normalized = action.toLowerCase()
  if (normalized === 'auth.login' || normalized === 'login') return 'ログイン'
  if (normalized === 'auth.logout' || normalized === 'logout') return 'ログアウト'
  if (normalized.includes('delete')) return '削除'
  if (normalized.includes('send') || normalized.includes('publish')) return '配信'
  if (normalized.includes('update') || normalized.includes('change')) return '設定変更'
  return '操作記録'
}
function formatStaffDate(value: string | undefined): string { if (!value) return 'まだ入っていません'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '日時を取得できませんでした' : date.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
/* 一覧の StaffMember には招待期限が載っていない。再送口の返事を読むための形。 */
type StaffMemberWithInvite = StaffMember & { inviteExpiresAt?: string | null }
function formatInviteExpiry(value: string | null | undefined): string {
  if (!value) return '期限を取得できませんでした'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '期限を取得できませんでした'
  const text = date.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  return date.getTime() < Date.now() ? `期限切れ（${text}まででした）` : `${text}まで`
}
function permissionSummary(member: StaffMember): string { if (member.role === 'owner' || member.role === 'admin') return 'すべての画面'; if (member.permissionKeys.length === 0) return member.role === 'viewer' ? '閲覧できる画面は未設定' : '表示する機能は未設定'; const labels = member.permissionKeys.map((key) => permissionLabel(key)).filter(Boolean); return labels.length > 0 ? labels.join('・') : `${member.permissionKeys.length}機能` }
function downloadAuditCsv(rows: AuditEventItem[]): void {
  const body = [
    ['日時', 'ユーザー', '操作', '対象', '結果', '接続元'],
    ...rows.map((row) => [
      row.createdAt,
      row.actor.name ?? '',
      auditActionLabel(row.action),
      [row.target?.kind, row.target?.id].filter(Boolean).join(' / '),
      row.result,
      [row.ipPrefix, row.deviceFamily].filter(Boolean).join(' / '),
    ]),
  ].map((line) => line.map(csvCell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([`\uFEFF${body}`], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'access-audit.csv'
  anchor.click()
  URL.revokeObjectURL(url)
}

function accessScopeLabel(user: AccessUserItem, accountNames: Record<string, string>): string {
  if (user.accountScope.type === 'all') return 'すべてのLINEアカウント'
  const ids = new Set(user.accountScope.lineAccountIds)
  if (user.accountScope.assignedLineAccountId) ids.add(user.accountScope.assignedLineAccountId)
  const names = [...ids].map((id) => accountNames[id] ?? '不明なLINEアカウント')
  return names.length > 0 ? names.join('、') : '担当アカウント未設定'
}

function accessFeatureLabel(user: AccessUserItem): string {
  if (user.roleBundle === 'administrator') return 'すべての機能'
  if (user.featureCount === null) return '機能数を取得できませんでした'
  return `${user.featureCount}機能`
}
function RowActionButton({ label, onClick, qaOpen }: { label: string; onClick: () => void; qaOpen?: string }) { const marker = qaOpen ?? (label === '中身を見る' ? 'EOTS4' : undefined); return <Button onClick={onClick} {...(marker ? { 'data-qa-open': marker } : {})}>{label}</Button> }
function Modal({ children, onClose, wide = false }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) { return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4" role="dialog" aria-modal="true" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div className={`max-h-[90vh] w-full overflow-y-auto rounded-card bg-canvas p-6 shadow-xl ${wide ? 'max-w-3xl' : 'max-w-xl'}`}>{children}</div></div> }

function LoginHistoryNote({ count, loading, failed = false }: { count: number | null; loading: boolean; failed?: boolean }) {
  if (loading) return <p className="text-xs text-ink-secondary">ログイン履歴を確認中…</p>
  if (failed) return <p className="text-xs text-warning">ログイン履歴を取得できませんでした。操作は続けられます。</p>
  return <p className="text-xs font-medium text-ink-secondary">{count ? `このユーザーにはログイン履歴が ${count} 件あります` : 'ログイン履歴はありません'}</p>
}

/* 高危険操作が 428 で止まったとき、直前に立てる本人確認の窓（N-427）。 */
type StepUpPurpose = 'staff.permissions.change' | 'staff.two_factor.remove'
type StepUpRequest = { purpose: StepUpPurpose; retry: (token: string) => Promise<void> }

function isStepUpRequired(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'STEP_UP_REQUIRED'
}

function StepUpPrompt({ request, onDone, onClose }: { request: StepUpRequest; onDone: () => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const submit = async (code: string) => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const res = await api.staff.stepUp(code, request.purpose)
      if (!res.success) throw new Error(res.error)
      await request.retry(res.data.token)
      onDone()
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setBusy(false)
    }
  }
  return <StepUpDialog open action={request.purpose === 'staff.two_factor.remove' ? '二段階認証を解除する' : '権限を変更する'} busy={busy} error={error} onSubmit={(code) => void submit(code)} onCancel={onClose} />
}

/** 本人がいまログインしている端末の一覧と失効（N-427）。 */
function SessionsCard() {
  const [sessions, setSessions] = useState<Array<{ id: string; current: boolean; createdAt: string; expiresAt: string; userAgent: string | null; ipPrefix: string | null }> | null>(null)
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [revokingId, setRevokingId] = useState<string | null>(null), [confirmCurrent, setConfirmCurrent] = useState(false), [confirmOthers, setConfirmOthers] = useState(false)
  const load = useCallback(async () => {
    try {
      const res = await api.sessions.list()
      if (res.success) setSessions(res.data.sessions)
      else setError('ログイン中の端末を読み込めませんでした')
    } catch { setError('ログイン中の端末を読み込めませんでした') }
  }, [])
  useEffect(() => { void load() }, [load])
  const revoke = async (id: string, isCurrent: boolean) => {
    setRevokingId(id); setError(''); setNotice('')
    try {
      await api.sessions.revoke(id, { confirmCurrent: isCurrent })
      if (isCurrent) {
        // 自分のセッションを消したので、この画面はもう使えない。ログインへ戻す。
        window.location.assign('/login')
        return
      }
      setNotice('その端末のログインを終了しました')
      await load()
    } catch (caught) { setError(messageOf(caught)) } finally { setRevokingId(null) }
  }
  const revokeOthers = async () => {
    setRevokingId('others'); setError(''); setNotice('')
    try {
      const res = await api.sessions.revokeOthers()
      if (res.success) { setNotice(res.data.revoked > 0 ? `この端末以外の ${res.data.revoked} 件のログインを終了しました` : '他にログイン中の端末はありませんでした') }
      await load()
    } catch (caught) { setError(messageOf(caught)) } finally { setRevokingId(null); setConfirmOthers(false) }
  }
  const deviceLabel = (userAgent: string | null): string => {
    if (!userAgent) return '端末情報なし'
    const os = /iPhone|iPad/.test(userAgent) ? 'iPhone / iPad' : /Android/.test(userAgent) ? 'Android' : /Windows/.test(userAgent) ? 'Windows' : /Mac OS/.test(userAgent) ? 'Mac' : /Linux/.test(userAgent) ? 'Linux' : 'その他の端末'
    const browser = /Edg\//.test(userAgent) ? 'Edge' : /Chrome\//.test(userAgent) ? 'Chrome' : /Safari\//.test(userAgent) ? 'Safari' : /Firefox\//.test(userAgent) ? 'Firefox' : ''
    return browser ? `${os}・${browser}` : os
  }
  return <section className="mb-4 rounded-card border border-hairline bg-canvas p-4" aria-label="ログイン中の端末">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-bold text-ink">ログイン中の端末</h2><p className="mt-1 text-xs text-ink-secondary">あなたのアカウントでいまログインしている端末です。見覚えのない端末があれば「ログインを終了」で切り離せます。</p></div>
      {sessions && sessions.length > 1 && <Button variant="secondary" onClick={() => setConfirmOthers(true)}>この端末以外をすべて終了</Button>}</div>
    {error && <p className="mt-3 rounded-control bg-danger-bg p-3 text-sm text-danger" role="alert">{error}</p>}
    {notice && <p className="mt-3 rounded-control bg-info-bg p-3 text-sm font-medium text-accent" role="status">{notice}</p>}
    {sessions === null ? <p className="mt-3 text-xs text-ink-faint">読み込んでいます…</p> : sessions.length === 0 ? <p className="mt-3 text-xs text-ink-faint">ログイン中の端末はありません。</p> : (
      <ul className="mt-3 divide-y divide-hairline">
        {sessions.map((session) => <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="min-w-0"><p className="truncate text-sm font-medium text-ink" title={session.userAgent ?? undefined}>{deviceLabel(session.userAgent)}{session.current && <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">この端末</span>}</p>
            <p className="mt-0.5 text-xs text-ink-faint">ログイン：{formatStaffDate(session.createdAt)}{session.ipPrefix ? `　・　接続元：${session.ipPrefix}` : ''}</p></div>
          <Button variant="secondary" disabled={revokingId === session.id} onClick={() => (session.current ? setConfirmCurrent(true) : void revoke(session.id, false))}>{revokingId === session.id ? '終了中…' : 'ログインを終了'}</Button>
        </li>)}
      </ul>
    )}
    <ConfirmDialog
      open={confirmCurrent}
      title="この端末のログインを終了しますか？"
      description="いま使っているこの端末のログインが終わり、ログイン画面へ戻ります。"
      confirmLabel="この端末を終了する"
      busy={revokingId === sessions?.find((s) => s.current)?.id}
      onConfirm={() => { const current = sessions?.find((s) => s.current); if (current) { setConfirmCurrent(false); void revoke(current.id, true) } }}
      onCancel={() => setConfirmCurrent(false)}
    />
    <ConfirmDialog
      open={confirmOthers}
      title="この端末以外のログインをすべて終了しますか？"
      description="他の端末はすべてログイン画面へ戻ります。この端末のログインは続きます。"
      confirmLabel="すべて終了する"
      busy={revokingId === 'others'}
      onConfirm={() => void revokeOthers()}
      onCancel={() => { if (revokingId === 'others') return; setConfirmOthers(false) }}
    />
  </section>
}

const SCOPE_ROWS = [
  ['友だち', '名前・タグ・対応状況', 'すべて', 'すべて', '見るだけ'],
  ['個人情報', '電話番号・住所・メール', 'すべて', '伏せて表示', '見せない'],
  ['配信', '一斉配信・シナリオ・リマインダ', '作成・配信', '作成・配信', '見るだけ'],
  ['受信箱', '友だちとのやりとり', '返信できる', '返信できる', '見るだけ'],
  ['予約', '予約・イベントの受付', '変更できる', '変更できる', '見るだけ'],
  // N-411: 予約の細かい権限。SCOPE_ITEMS と同じ順で並べる（index で対応）。
  ['予約メニュー', 'メニューと担当の編集', '変更できる', '見るだけ', '見せない'],
  ['予約設定', '受付枠・資源・予約スタッフ', '変更できる', '見るだけ', '見せない'],
  ['本人の勤務', '自分のシフト・休憩・連携', '変更できる', '見るだけ', '見せない'],
  ['分析', '成果・流入・レポート', 'すべて', '見られる', '見られる'],
  ['設定', 'LINE・外部連携・ユーザー', '変更できる', '見せない', '見せない'],
  ['運用状態', '健全性・緊急停止・更新履歴', '操作できる', '見られる', '見られる'],
] as const

function PermissionScopeView({ user, memberId, canSave, copyCandidates, roleCounts, onClose, onSaved }: {
  user: AccessUserItem
  memberId: string | null
  canSave: boolean
  copyCandidates: CopyableAccessUser[]
  roleCounts: AccessUserSummary['roleCounts']
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [bundle, setBundle] = useState<Exclude<AccessRoleBundle, 'custom'>>(
    user.roleBundle === 'custom' ? 'reception' : user.roleBundle,
  )
  /*
   * 「項目ごとに決める」の上書き。null はbundle初期値のまま。
   * 1項目でも触ると個別設定（custom）として保存される。
   */
  const [customLevels, setCustomLevels] = useState<ScopeLevels | null>(null)
  const levels: ScopeLevels = customLevels ?? BUNDLE_PRESETS[bundle].levels
  const setLevel = (itemId: string, level: FeatureAccessLevel) =>
    setCustomLevels({ ...levels, [itemId]: level })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false)
  const [saveConfirmError, setSaveConfirmError] = useState('')
  const savingRef = useRef(false)
  const [copyOpen, setCopyOpen] = useState(false)
  const [copySourceId, setCopySourceId] = useState('')
  const [copyNotice, setCopyNotice] = useState('')
  const [stepUp, setStepUp] = useState<StepUpRequest | null>(null)
  /*
   * 「見せる範囲を保存」は更新口へつなぐ。閉じるだけにしない。
   * 受付に更新口の書き分けは無いので運用へ寄る(保存後に読み直すと
   * 「運用」と出る)。結び付いていない人・管理者以外は理由を出す。
   */
  const requestSave = () => {
    if (!memberId) return setSaveError('スタッフ情報と結び付いていないため保存できません。名前とメールを確認してください。')
    if (!canSave) return setSaveError('権限のかたまりは管理者だけが変えられます。')
    setSaveError('')
    setSaveConfirmError('')
    setSaveConfirmOpen(true)
  }
  const save = async (stepUpToken?: string) => {
    if (!memberId || !canSave || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setSaveError('')
    setSaveConfirmError('')
    try {
      // N-424: bundle 名をそのまま送る。role へ潰すと「受付」と「運用」が区別できない。
      // 項目を1つでも触っていたら3択表ごと送り、API側が個別設定として保存する。
      const piiLevel = customLevels?.pii
      const result = await api.staff.update(memberId, {
        roleBundle: bundle,
        permissionScope: customLevels ?? undefined,
        emailMask: piiLevel === 'edit' ? 'full' : piiLevel === 'view' ? 'masked' : piiLevel === 'none' ? 'none' : undefined,
      }, stepUpToken)
      if (!result.success) throw new Error(result.error)
      setSaveConfirmOpen(false)
      await onSaved()
      onClose()
    } catch (caught) {
      if (!stepUpToken && isStepUpRequired(caught)) {
        setStepUp({ purpose: 'staff.permissions.change', retry: save })
        return
      }
      const message = messageOf(caught)
      setSaveError(message)
      setSaveConfirmError(message)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }
  /*
   * かたまりごとの人数は固定文をやめ、実データ（roleCounts）から出す（LAY-09）。
   */
  const bundles = [
    ['administrator', '管理者', 'すべての設定と操作'],
    ['operations', '運用', '配信と日々の運用'],
    ['reception', '受付', '受信箱と予約を担当'],
    ['view_only', '見るだけ', '変更せず確認だけ'],
  ] as const
  const copyBundle = (sourceId: string) => {
    const source = copyCandidates.find((candidate) => candidate.id === sourceId)
    if (!source) return
    setCopySourceId(sourceId)
    setBundle(source.roleBundle)
    setSaveError('')
    setCopyNotice(`${source.name}の「${ACCESS_ROLE_LABEL[source.roleBundle]}」を下書きに反映しました。保存するまでは変更されません。`)
  }
  /*
   * LAY-09: 右欄の説明は選択中の権限（下書き）から組み立てる。
   * 「4項目」のような固定文は、実際の設定とずれるので置かない。
   * 個別設定の人の保存済み内訳はAPIが返さないため、差分は「未確認」と出す。
   */
  const featureItems = SCOPE_ITEMS.filter((item) => item.kind === 'feature')
  const visibleItems = featureItems.filter((item) => (levels[item.id] ?? 'none') !== 'none')
  const hiddenItems = featureItems.filter((item) => (levels[item.id] ?? 'none') === 'none')
  const piiLevel = levels.pii ?? 'none'
  const piiNote = piiLevel === 'edit'
    ? '個人情報（電話番号・住所・メール）もそのまま見えます'
    : piiLevel === 'view'
      ? '電話番号・住所・メールは伏せて表示します'
      : '電話番号・住所・メールは見せません'
  const savedLevels = user.roleBundle === 'custom' ? null : BUNDLE_PRESETS[user.roleBundle].levels
  const changedItems = savedLevels
    ? SCOPE_ITEMS.filter((item) => (levels[item.id] ?? 'none') !== (savedLevels[item.id] ?? 'none'))
    : null
  const dirty = customLevels !== null || bundle !== user.roleBundle
  return <div data-design-node="EOTS4" className="pb-28">
    <div className="mb-4 flex items-center justify-between"><nav className="text-xs text-ink-faint"><span className="font-bold text-action">ログインユーザー</span>　›　<span className="font-bold text-action">{user.name}</span>　›　見せる範囲</nav><Button variant="secondary" disabled={!canSave || copyCandidates.length === 0} onClick={() => setCopyOpen((current) => !current)}>ほかの人と同じにする</Button></div>
    {copyOpen && <section className="mb-4 rounded-card border border-hairline bg-canvas p-4" aria-label="ほかの人の権限をコピー"><p className="mb-2 text-xs text-ink-secondary">同じ組織の人を選ぶと、その人の権限のかたまりを下書きへ反映します。</p><Select aria-label="コピー元のログインユーザー" value={copySourceId} onChange={copyBundle} size="full" options={[{ value: '', label: 'コピー元を選ぶ', disabled: true }, ...copyCandidates.map((candidate) => ({ value: candidate.id, label: `${candidate.name}（${ACCESS_ROLE_LABEL[candidate.roleBundle]}）` }))]} />{copyNotice && <p className="mt-2 text-xs font-medium text-success" role="status">{copyNotice}</p>}</section>}
    {/*
      LAY-07: 狭い幅は1列で「いまの権限→変更項目→影響の確認」の順にする。
      説明欄（390px）と横に並べるのは、設定欄に十分な幅が残る1024px以上だけ。
      それ未満では説明欄は設定の下へ回り込む。
    */}
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_390px]">
      <main className="space-y-3">
        <section className="rounded-card border border-hairline bg-canvas p-4"><h2 className="text-base font-bold text-ink">いまの権限</h2><p className="mt-1 text-xs text-ink-secondary">{user.name}さんはいま「{ACCESS_ROLE_LABEL[user.roleBundle]}」です。{user.roleBundle === 'custom' ? '項目ごとの内訳は取得できていません（未確認）。' : ''}保存すると、対象者はもう一度ログインが必要です。</p></section>
        <section className="rounded-card border border-hairline bg-canvas p-4"><h2 className="text-base font-bold text-ink">かたまりから選ぶ</h2><p className="mt-1 text-xs text-ink-faint">よく使う組み合わせを用意しています。選んでから、下で細かく直せます。</p><div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">{bundles.map(([value, label, note]) => <button key={value} type="button" onClick={() => setBundle(value)} className={`rounded-control border p-3 text-left ${bundle === value ? 'border-accent bg-accent-soft' : 'border-divider-soft bg-canvas'}`}><span className="flex items-center justify-between"><span className="text-sm font-bold text-ink">{label}</span><span className="text-xs text-ink-faint">{roleCounts[value]}人</span></span><span className={`mt-2 block text-xs ${bundle === value ? 'font-semibold text-success' : 'text-ink-faint'}`}>{note}</span></button>)}</div></section>
        {/*
          LAY-07: 機能ごとにカードへ分け、その中に3択を置く。
          以前の3列140px固定の表形式は狭い幅で潰れていた。
          各選択肢は触れる高さ（min-h-11）を確保する。
        */}
        <section className="overflow-hidden rounded-card border border-hairline bg-canvas"><div className="px-4 py-4"><h2 className="text-base font-bold text-ink">項目ごとに決める</h2><p className="mt-1 text-xs text-ink-faint">「変えられる」「見えるだけ」「出さない」の3つから選びます。</p></div><div className="divide-y divide-hairline border-t border-hairline">{SCOPE_ROWS.map(([label, note, full, partial, none], index) => { const item = SCOPE_ITEMS[index]; const level = levels[item.id] ?? 'none'; return <div key={label} className="px-4 py-3"><div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><div className="min-w-0"><p className="text-xs font-bold text-ink">{label}</p><p className="mt-0.5 text-xs text-ink-faint">{note}</p></div>{item.hint ? <p className="text-xs font-semibold text-warning">{item.hint}</p> : null}</div><div className="mt-2 grid grid-cols-3 gap-2" role="group" aria-label={`${label}の見せ方`}>{([full, partial, none] as const).map((text, option) => { const optionLevel: FeatureAccessLevel = option === 0 ? 'edit' : option === 1 ? 'view' : 'none'; const selected = level === optionLevel; const optionLabel = option === 0 ? '変えられる' : option === 1 ? '見えるだけ' : '出さない'; return <button key={`${option}:${text}`} type="button" aria-label={`${label}を${text}`} aria-pressed={selected} disabled={!canSave} onClick={() => setLevel(item.id, optionLevel)} className={`min-h-11 rounded-control border px-2 py-2 text-center text-xs leading-tight ${selected ? 'border-accent bg-accent-soft font-semibold text-accent' : 'border-divider-soft bg-canvas text-ink-secondary'} ${canSave ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}><span className="block font-bold">{optionLabel}</span><span className="mt-0.5 block">{text}</span></button> })}</div></div> })}</div></section>
      </main>
      <aside className="space-y-3"><section className="rounded-card border border-hairline bg-canvas p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-bold text-ink">この決め方で、この人にはこう見えます</h2>{dirty ? <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">変更後の予定</span> : null}</div><div className="mt-3 space-y-3 text-xs text-ink-secondary"><p><b className="text-ink">◉　メニューに出るのは{visibleItems.length}項目</b><br />　　{visibleItems.length > 0 ? visibleItems.map((item) => item.label).join('・') : '出る項目はありません'}</p><p><b className="text-ink">◉　出さないのは{hiddenItems.length}項目</b><br />　　{hiddenItems.length > 0 ? `${hiddenItems.map((item) => item.label).join('・')}。URLを直に打っても「見る権限がありません」と出ます` : '出さない項目はありません'}</p><p><b className="text-ink">◉　{piiNote}</b></p>{changedItems === null ? <p><b className="text-ink">◉　いまの設定は個別に決められているため、ここから変わる項目の内訳は未確認です</b></p> : changedItems.length > 0 ? <p><b className="text-ink">◉　いまの設定から変わるのは{changedItems.length}項目</b><br />　　{changedItems.map((item) => item.label).join('・')}</p> : <p><b className="text-ink">◉　いまの設定と同じ内容です</b></p>}</div></section><section className="rounded-card border border-hairline bg-canvas p-4"><h2 className="text-sm font-bold text-ink">つながる先</h2>{/* LAY-10: 見た目だけの矢印をやめ、本物のリンクにする。開くと未保存の下書きは捨ててその画面へ移る（キャンセルと同じ扱い）。 */}<div className="mt-3 space-y-3 text-xs"><Link href="/settings" onClick={onClose} className="block font-bold text-action hover:underline">→ 機能設定</Link><Link href="/staff?tab=audit" onClick={onClose} className="block font-bold text-action hover:underline">→ 入った記録</Link><Link href="/emergency" onClick={onClose} className="block font-bold text-action hover:underline">→ 運用状態</Link><Link href="/booking/menus" onClick={onClose} className="block font-bold text-action hover:underline">→ 予約設定</Link></div></section><section className="rounded-card border border-warning bg-warning-bg p-4"><h2 className="text-sm font-bold text-warning">気をつけること</h2><p className="mt-2 text-xs font-bold text-warning">配信を出さないと、受信箱からの返信もできません</p><p className="mt-2 text-xs text-warning">保存すると、対象者はもう一度ログインする必要があります。</p></section></aside>
    </div>
    {/*
      LAY-08: バーはビュー幅に追従する。メニューが無い幅では全幅、
      PC（1280px以上）は実在するメニュー256pxぶんだけ左を空ける。
      狭い幅では説明は本文（いまの権限カード）へ移し、下部は操作だけに絞る。
      高さは固定せず、長いエラー文は折り返してボタンを隠さない。
    */}
    <div className="fixed inset-x-0 bottom-0 z-20 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-hairline bg-canvas px-4 py-3 shadow-lg sm:px-8 xl:left-64">{saveError ? <p className="min-w-0 flex-1 text-xs font-medium text-danger">{saveError}</p> : <p className="hidden min-w-0 flex-1 text-xs text-ink-faint md:block">{user.name}さんはいま「{ACCESS_ROLE_LABEL[user.roleBundle]}」です。保存前に、対象者が再ログインすることを確認します。</p>}<div className="ml-auto flex shrink-0 gap-2"><Button variant="secondary" onClick={onClose}>×　キャンセル</Button><Button disabled={saving} onClick={requestSave}>✓　{saving ? '保存中…' : '見せる範囲を保存'}</Button></div></div>
    <ConfirmDialog
      open={saveConfirmOpen}
      title={`${user.name}さんの見せる範囲を保存しますか？`}
      description="保存すると、対象者のすべてのログインが終了します。新しい権限で使うには、対象者がもう一度ログインする必要があります。"
      confirmLabel="保存する"
      busy={saving}
      error={saveConfirmError}
      onConfirm={() => void save()}
      onCancel={() => { if (saving) return; setSaveConfirmOpen(false); setSaveConfirmError('') }}
    />
    {stepUp && <StepUpPrompt request={stepUp} onDone={() => setStepUp(null)} onClose={() => setStepUp(null)} />}
  </div>
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
  /* 権限・利用状態・LINE連携の変更は 428 で止まる。止まったら本人確認の窓を立てて、grant を付けて同じ操作をやり直す。 */
  const [stepUp, setStepUp] = useState<StepUpRequest | null>(null)
  /* N-433: 本人のメール変更は確認メールを経て確定する。保存直後に旧アドレスのまま閉じると「変わった」ように見えるので、確認待ちを画面に残す。 */
  const [emailNotice, setEmailNotice] = useState('')
  const policy = staffActionPolicy({ member, currentUserId, administrator, activeAdministratorCount })
  useEffect(() => {
    if (!administrator) return
    let active = true
    void api.staff.loginSummary(member.id).then((result) => { if (active && result.success) setLoginCount(result.data.loginCount) }).catch(() => { if (active) setLoginHistoryFailed(true) }).finally(() => { if (active) setLoginHistoryLoading(false) })
    return () => { active = false }
  }, [administrator, member.id])
  const toggleNotification = (key: string, channel: keyof Channel) => setNotifications((current) => ({ ...current, [key]: { ...current[key], [channel]: !current[key][channel] } }))
  const save = async (stepUpToken?: string) => { if (!email.trim()) return setError('メールアドレスを入力してください'); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('正しいメールアドレスを入力してください'); setSaving(true); setError(''); try { const res = await api.staff.update(member.id, { name: administrator ? name.trim() : undefined, email: email.trim(), role: administrator ? role : undefined, permissionKeys: administrator && role === 'staff' ? normalizeStaffPermissionKeys(permissions) : undefined, notificationPreferences: notifications }, stepUpToken); await onSaved(); if (res.success && res.data.emailChangePending && res.data.pendingEmail) { setEmailNotice(`${res.data.pendingEmail} へ確認メールを送りました。届いたメールのリンクを開くと変更が完了します。`); return } onClose() } catch (caught) { if (!stepUpToken && isStepUpRequired(caught)) { setStepUp({ purpose: 'staff.permissions.change', retry: save }); return } setError(messageOf(caught)) } finally { setSaving(false) } }
  /**
   * LINE連携を外す。
   *
   * 処理中は受け付けない（二度押しで2回叩くと、2回目の返事で失敗に見える）。
   * 失敗は握りつぶさず、窓の中に運用者の言葉で出す。生のAPIエラーだと
   * 次に何をすればよいか読み取れない。
   */
  const unlinkLine = async (stepUpToken?: string) => { if (unlinking) return; setUnlinking(true); setUnlinkError(''); try { const res = await api.staff.update(member.id, { lineLinked: false }, stepUpToken); if (!res.success) throw new Error(res.error); setUnlinkOpen(false); await onSaved(); onClose() } catch (caught) { if (!stepUpToken && isStepUpRequired(caught)) { setStepUp({ purpose: 'staff.permissions.change', retry: unlinkLine }); return } setUnlinkError('LINE連携を解除できませんでした。状態を読み直してから、もう一度お試しください。') } finally { setUnlinking(false) } }
  const toggleActive = async (stepUpToken?: string) => { if (policy.statusBlockedReason) return; setStatusSaving(true); setError(''); try { await api.staff.update(member.id, { isActive: !member.isActive }, stepUpToken); await onSaved(); onClose() } catch (caught) { if (!stepUpToken && isStepUpRequired(caught)) { setStepUp({ purpose: 'staff.permissions.change', retry: toggleActive }); return } setError(messageOf(caught)) } finally { setStatusSaving(false) } }
  return <Modal onClose={onClose} wide><div data-design-node="EOTS4"><div className="flex items-start justify-between"><div><h2 className="text-xl font-bold text-ink">見せる範囲を決める</h2><p className="mt-1 text-xs text-ink-secondary">役割・表示機能・担当範囲を確認し、このユーザーに必要な範囲だけを設定します。</p></div><button onClick={onClose} className="cursor-pointer rounded-control p-2 text-ink-faint hover:bg-canvas-sunken">×</button></div>
    <div className="mt-5 rounded-control bg-canvas-sunken p-3"><p className="font-semibold text-ink">{member.name}</p><p className="text-xs text-ink-secondary">{ROLE_LABEL[member.role]}</p></div>{error && <p className="mt-4 rounded-control bg-danger-bg p-3 text-sm text-danger">{error}</p>}{emailNotice && <p role="status" className="mt-4 rounded-control bg-accent-soft p-3 text-sm text-accent-deep">{emailNotice}</p>}
    {policy.showAccountActions && <section className={`mt-5 rounded-card border p-4 ${member.isActive ? 'border-accent bg-accent-soft' : 'border-warning bg-warning-bg'}`} aria-label="ユーザーの利用状態"><div className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-sm font-bold text-ink">ログイン状態：{member.isActive ? '有効' : '無効'}</p><p className="mt-1 text-xs leading-5 text-ink-secondary">{member.isActive ? '無効にすると、このユーザーはログインできなくなります。' : '有効にすると、このユーザーは再びログインできます。'}</p><div className="mt-2"><LoginHistoryNote count={loginCount} loading={loginHistoryLoading} failed={loginHistoryFailed} /></div></div><button type="button" onClick={() => void toggleActive()} disabled={statusSaving || Boolean(policy.statusBlockedReason)} className={`min-w-48 rounded-control px-4 py-2.5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40 ${member.isActive ? 'border border-warning bg-canvas text-warning hover:bg-warning-bg' : 'bg-accent text-on-accent hover:bg-accent-hover'}`}>{statusSaving ? '変更中…' : member.isActive ? 'このユーザーを無効にする' : 'このユーザーを有効にする'}</button></div>{policy.statusBlockedReason && <p className="mt-3 rounded-control bg-canvas p-3 text-xs font-medium text-warning">{policy.statusBlockedReason}</p>}</section>}
    <div className="mt-5 grid gap-4 sm:grid-cols-2">{administrator && <label className="text-sm font-medium text-ink">名前 <span className="text-warning">必須</span><input value={name} onChange={(e) => setName(e.target.value)} className="mt-2 h-11 w-full rounded-control border border-hairline px-3 outline-none focus:border-accent" /></label>}<label className="text-sm font-medium text-ink">メールアドレス <span className="text-warning">必須</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-2 h-11 w-full rounded-control border border-hairline px-3 outline-none focus:border-accent" /></label></div>
    {administrator && <div className="mt-5"><p className="text-sm font-medium text-ink">役割</p><div className="mt-2 grid grid-cols-3 gap-2">{(['admin', 'staff', 'viewer'] as const).map((value) => <button key={value} onClick={() => setRole(value)} className={`cursor-pointer rounded-control border px-3 py-3 text-sm ${role === value ? 'border-accent bg-accent-soft font-medium text-accent' : 'border-hairline text-ink-secondary'}`}>{ROLE_LABEL[value]}</button>)}</div></div>}
    {administrator && role === 'staff' && <div className="mt-5"><p className="text-sm font-medium text-ink">スタッフに表示する機能</p><div className="mt-2 grid gap-2 sm:grid-cols-3">{PERMISSIONS.map(([key, label]) => <label key={key} className={`flex cursor-pointer items-center gap-2 rounded-control border p-2 text-xs ${permissions.includes(key) ? 'border-accent bg-accent-soft text-accent' : 'border-hairline text-ink-secondary'}`}><input type="checkbox" checked={permissions.includes(key)} onChange={() => setPermissions((current) => toggleStaffPermissionKey(current, key))} />{label}</label>)}</div><p className="mt-3 text-sm font-medium text-ink">成果の操作権限</p><p className="mt-1 text-xs text-ink-faint">選ぶと「成果とアフィリエイト」の表示も組で付きます。表示を外すと操作権限も外れます。</p><div className="mt-2 grid gap-2 sm:grid-cols-3"><label className={`flex cursor-pointer items-center gap-2 rounded-control border p-2 text-xs ${permissions.includes(CONVERSION_APPROVAL_EDIT_KEY) ? 'border-accent bg-accent-soft text-accent' : 'border-hairline text-ink-secondary'}`}><input type="checkbox" aria-label="成果を承認・却下する" checked={permissions.includes(CONVERSION_APPROVAL_EDIT_KEY)} onChange={() => setPermissions((current) => toggleStaffPermissionKey(current, CONVERSION_APPROVAL_EDIT_KEY))} />{PERMISSION_LABELS[CONVERSION_APPROVAL_EDIT_KEY]}</label></div></div>}
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
    {stepUp && <StepUpPrompt request={stepUp} onDone={() => setStepUp(null)} onClose={() => setStepUp(null)} />}
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
  const tab = useMergedTab(STAFF_TAB_KEYS, 'tab', 'members')
  const { selectedAccountId } = useAccount()
  const [members, setMembers] = useState<StaffMember[]>([])
  const [accessUsers, setAccessUsers] = useState<AccessUserItem[]>([])
  const [usersTotal, setUsersTotal] = useState(0)
  const [accessSummary, setAccessSummary] = useState<AccessUserSummary>(EMPTY_ACCESS_SUMMARY)
  const [accessRoles, setAccessRoles] = useState<AccessRoleItem[]>([])
  const [accountNames, setAccountNames] = useState<Record<string, string>>({})
  const [me, setMe] = useState<StaffMember | null>(null)
  const [audits, setAudits] = useState<AuditEventItem[]>([])
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<AccessRoleBundle | 'all'>('all')
  const [sort, setSort] = useState('recent')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<StaffMember | null>(null), [settingTwoFactor, setSettingTwoFactor] = useState<StaffMember | null>(null), [permissionTarget, setPermissionTarget] = useState<AccessUserItem | null>(null)
  const [userPage, setUserPage] = useState(1)
  const USER_PAGE_SIZE = 6
  /* ブラウザの `confirm()` をやめて、共通の確認窓へ移した（理由は EditModal と同じ）。 */
  const [disablingTarget, setDisablingTarget] = useState<StaffMember | null>(null), [disablingTwoFactor, setDisablingTwoFactor] = useState(false), [disableError, setDisableError] = useState('')
  const [removingTarget, setRemovingTarget] = useState<StaffMember | null>(null), [removing, setRemoving] = useState(false), [removeError, setRemoveError] = useState('')
  const [resendingId, setResendingId] = useState<string | null>(null), [resendNotice, setResendNotice] = useState(''), [resendError, setResendError] = useState('')
  /* 権限停止・二段階認証の解除が 428 で止まったときの本人確認窓。 */
  const [stepUp, setStepUp] = useState<StepUpRequest | null>(null)
  const [permissionSaveNotice, setPermissionSaveNotice] = useState('')
  /* 送信中の掛け金。state は次の描画まで古いままなので、素早い二度押しの2回目を止められない。 */
  const resendingRef = useRef(false)
  const removingRef = useRef(false)
  const administrator = me?.role === 'admin' || me?.role === 'owner'
  usePageTitle(permissionTarget ? `${permissionTarget.name}さんに見せる範囲` : 'ログインユーザー')
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const scope = selectedAccountId ?? undefined
      const [staffResult, meResult, accountsResult, usersResult, rolesResult] = await Promise.all([
        api.staff.list(),
        api.staff.me(),
        api.lineAccounts.list(),
        api.access.users({ lineAccountId: scope, limit: 200 }),
        api.access.roles(scope),
      ])
      if (!staffResult.success || !meResult.success || !accountsResult.success || !usersResult.success || !rolesResult.success) {
        throw new Error('必要な情報を取得できませんでした')
      }
      setMembers(staffResult.data)
      setMe(meResult.data)
      setAccountNames(Object.fromEntries(accountsResult.data.map((account) => [account.id, account.name])))
      setAccessUsers(usersResult.data.items)
      setUsersTotal(usersResult.data.pagination?.total ?? usersResult.data.items.length)
      setAccessSummary(usersResult.data.summary)
      setAccessRoles(rolesResult.data.items)
    } catch {
      setError('ログインユーザーを読み込めませんでした。時間をおいて、もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])
  useEffect(() => { void load() }, [load])
  /*
   * 入った記録は「入った記録」タブでだけ読む。最初に全部のタブぶんを
   * 先読みすると、表の中身(LoginAudit)が別に読み直す二重取りになる。
   */
  useEffect(() => {
    if (tab !== 'audit') return
    let alive = true
    setAudits([])
    void api.audit.events({ lineAccountId: selectedAccountId ?? undefined, limit: 200 })
      .then((result) => { if (alive && result.success) setAudits(result.data.items) })
      .catch(() => {})
    return () => { alive = false }
  }, [tab, selectedAccountId])
  const memberById = useMemo(() => {
    const map = new Map(members.map((member) => [member.id, member]))
    for (const user of accessUsers) {
      const member = matchStaffMember(members, user)
      if (member) map.set(user.id, member)
    }
    return map
  }, [accessUsers, members])
  const activeUsers = accessUsers.filter((user) => user.status === 'active')
  const openPermissions = (user: AccessUserItem) => { setPermissionSaveNotice(''); setPermissionTarget(user) }
  const finishPermissionSave = async () => {
    await load()
    setPermissionSaveNotice('見せる範囲を保存しました。対象者のすべてのログインを終了したため、新しい権限で使うにはもう一度ログインが必要です。')
  }
  const invitedUsers = accessUsers.filter((user) => user.status === 'invited' || user.status === 'expired')
  const staffTabs = [
    { key: 'members', label: `いまいる人 ${accessSummary.active}` },
    { key: 'invited', label: `招待中 ${accessSummary.invited}` },
    { key: 'audit', label: '入った記録' },
    { key: 'roles', label: `権限のかたまり ${accessRoles.length}` },
  ]
  const tabUsers = tab === 'invited' ? invitedUsers : activeUsers
  const filteredUsers = tabUsers.filter((user) => {
    const matchesQuery = `${user.name} ${user.email ?? ''} ${user.jobTitle ?? ''}`.toLowerCase().includes(query.toLowerCase())
    const matchesRole = roleFilter === 'all' || user.roleBundle === roleFilter
    return matchesQuery && matchesRole
  }).sort((a, b) => sort === 'name'
    ? a.name.localeCompare(b.name, 'ja')
    : (b.lastLoginAt ?? '').localeCompare(a.lastLoginAt ?? ''))
  const pageCount = Math.max(1, Math.ceil(filteredUsers.length / USER_PAGE_SIZE))
  const shown = filteredUsers.slice((userPage - 1) * USER_PAGE_SIZE, userPage * USER_PAGE_SIZE)
  useEffect(() => { setUserPage(1) }, [query, roleFilter, tab])
  const activeAdministratorCount = members.filter(isActiveAdministrator).length
  const missing = Math.max(accessSummary.active - accessSummary.mfaEnabled, 0)
  const canEdit = (member: StaffMember) => Boolean(administrator || (me?.role === 'staff' && me.id === member.id))
  const openTwoFactor = (member: StaffMember) => { if (member.twoFactorEnabled) { setDisableError(''); setDisablingTarget(member) } else setSettingTwoFactor(member) }
  /**
   * 二段階認証を外す。
   *
   * 処理中は受け付けない。失敗は握りつぶさず、窓の中に運用者の言葉で出す。
   */
  const runDisableTwoFactor = async (stepUpToken?: string) => { if (!disablingTarget || disablingTwoFactor) return; setDisablingTwoFactor(true); setDisableError(''); try { const res = await api.staff.disableTwoFactor(disablingTarget.id, stepUpToken); if (!res.success) throw new Error(res.error); setDisablingTarget(null); await load() } catch (caught) { if (!stepUpToken && isStepUpRequired(caught)) { setStepUp({ purpose: 'staff.two_factor.remove', retry: runDisableTwoFactor }); return } setDisableError('二段階認証を解除できませんでした。状態を読み直してから、もう一度お試しください。') } finally { setDisablingTwoFactor(false) } }
  /**
   * ログインユーザーを外す。
   *
   * 確認前は停止口を呼ばず、同じ描画中の二度押しも ref で止める。
   * 失敗時はサーバーが返した理由を確認窓に残し、運用者が判断できるようにする。
   */
  const runRemove = async (stepUpToken?: string) => {
    if (!removingTarget || removingRef.current) return
    removingRef.current = true
    setRemoving(true)
    setRemoveError('')
    try {
      const result = await api.staff.delete(removingTarget.id, stepUpToken)
      if (!result.success) throw new Error(result.error)
      setRemovingTarget(null)
      await load()
    } catch (caught) {
      if (!stepUpToken && isStepUpRequired(caught)) { setStepUp({ purpose: 'staff.permissions.change', retry: runRemove }); return }
      setRemoveError(messageOf(caught))
    } finally {
      removingRef.current = false
      setRemoving(false)
    }
  }
  /**
   * 招待を送り直す(N-425)。
   *
   * 処理中は受け付けない。2回叩くと2本目のトークンで1本目が上書きされ、
   * 先に届いたメールのリンクがその場で死ぬ。見た目を `disabled` にするだけでは
   * 同じ描画の中へ2回届く二度押しを止められないので、掛け金(ref)で締める。
   * 結果と新しい期限・次の対応は表の上の帯に出す。失敗は握りつぶさず理由を出す。
   */
  const runResend = async (member: StaffMember) => {
    if (resendingRef.current) return
    resendingRef.current = true
    setResendingId(member.id)
    setResendNotice('')
    setResendError('')
    try {
      const result = await fetchApi<{ success: boolean; data: StaffMemberWithInvite }>(`/api/staff/${member.id}/resend-invitation`, { method: 'POST' })
      const expiry = formatInviteExpiry(result.data.inviteExpiresAt)
      setResendNotice(`招待メールを送り直しました。新しい期限は${expiry}です。相手にメールを確認してもらってください。期限内に受諾がなければ、もう一度送り直せます。`)
      await load()
    } catch (caught) {
      setResendError(`${messageOf(caught)}。状態を読み直してから、もう一度お試しください。`)
    } finally {
      resendingRef.current = false
      setResendingId(null)
    }
  }
   const tabAction = administrator && tab === 'audit'
     ? <Button onClick={() => downloadAuditCsv(audits)} disabled={audits.length === 0}>CSVで書き出す</Button>
    : administrator && tab !== 'audit' ? <Link href="/staff/new" className="cursor-pointer rounded-control bg-accent-deep px-4 py-2 text-sm font-medium text-on-accent">人を追加する</Link> : null
  if (permissionTarget) {
    const copyCandidates = accessUsers.filter((candidate): candidate is CopyableAccessUser => (
      candidate.id !== permissionTarget.id && candidate.roleBundle !== 'custom'
    ))
    return <PermissionScopeView user={permissionTarget} memberId={memberById.get(permissionTarget.id)?.id ?? null} canSave={administrator} copyCandidates={copyCandidates} roleCounts={accessSummary.roleCounts} onClose={() => setPermissionTarget(null)} onSaved={finishPermissionSave} />
  }
  return <div data-design-node="e3jz3"><div className="mb-4" data-tabs-row><MergedTabs basePath="/staff" tabs={staffTabs} active={tab} defaultKey="members" actions={tabAction} /></div>
    {/*
      #972 U031: 390pxではタブの並びが右端の「人を追加する」に重なっていた。
      共通タブの形は変えず、この画面のタブ行だけ「収まらないとき折り返す」
      にする。収まる幅では1行のままで見た目は変わらない。役わりの絞り込み
      （下の Tabs）も同じ印で折り返す。
    */}
    <style>{`
      [data-tabs-row] nav:has(> span) { height: auto; flex-wrap: wrap; row-gap: 8px; }
      [data-tabs-row] nav:has(> span) > span { flex-wrap: wrap; row-gap: 0; }
      [data-tabs-row] nav:has(> span) > span + span { margin-left: auto; }
    `}</style>
    {tab === 'audit' ? <div data-design-node="jwVlo"><LoginAudit /></div> : <>
    {missing > 0 && <div className="mb-4 flex items-center rounded-control bg-warning-bg px-4 py-3 text-sm"><p>🔑　二段階認証が未設定のユーザーが <b>{missing}人</b> います。高い権限の人から設定してください。</p></div>}
    <div data-design="KPIs" className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4"><Kpi label="いまいる人" value={`${accessSummary.active}`} unit="人" note={`管理者 ${accessSummary.roleCounts.administrator}・運用 ${accessSummary.roleCounts.operations}・見るだけ ${accessSummary.roleCounts.view_only}`} /><Kpi label="招待して返事がない" value={`${accessSummary.invited}`} unit="人" note={`期限切れ ${accessSummary.expiredInvitations}人`} /><Kpi label="90日 入っていない" value={`${accessSummary.unused90Days}`} unit="人" note="最終ログインから90日以上" /><Kpi label="2段階の確認" value={`${accessSummary.mfaEnabled} / ${accessSummary.active}`} unit="人" note={`管理者は必ず入れてください${accessSummary.mfaRate === null ? '' : `（${accessSummary.mfaRate}%）`}`} /></div>
    <div className="mb-4 flex items-center justify-between gap-3 rounded-control bg-info-bg px-4 py-3 text-sm font-medium text-accent"><span>「見せる範囲」は、画面ごとに決められます。電話番号や住所など、必要な情報だけを見せると事故が減ります。</span></div>
    {error && <div className="mb-4 flex items-center justify-between gap-4 rounded-control bg-danger-bg p-3 text-sm text-danger"><p>{error}</p><Button variant="secondary" onClick={() => void load()}>もう一度読み込む</Button></div>}
    {resendNotice && <div className="mb-4 rounded-control bg-info-bg px-4 py-3 text-sm font-medium text-accent" role="status"><p>{resendNotice}</p></div>}
    {resendError && <div className="mb-4 rounded-control bg-danger-bg p-3 text-sm text-danger" role="alert"><p>{resendError}</p></div>}
    {permissionSaveNotice && <div className="mb-4 rounded-control bg-info-bg px-4 py-3 text-sm font-medium text-accent" role="status"><p>{permissionSaveNotice}</p></div>}
    {tab === 'members' && <SessionsCard />}
    {tab === 'roles' && <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">{accessRoles.map((role) => <div key={role.id} className="rounded-card border border-hairline bg-canvas p-4"><div className="flex items-start justify-between gap-2"><p className="font-semibold text-ink">{role.name}</p><span className="rounded-full bg-accent-soft px-2 py-1 text-[11px] font-semibold text-accent">{role.assignedUserCount}人</span></div><p className="mt-2 text-xs leading-5 text-ink-secondary">{role.description}</p><p className="mt-3 text-xs text-ink-faint">{role.requiresMfa ? '2段階の確認が必要' : role.featureAccess === 'view' ? '閲覧のみ' : role.featureAccess === 'custom' ? '機能ごとに設定' : '編集できる'}</p></div>)}</div>}
    <div className="mb-3 flex flex-wrap items-center gap-3"><SearchField value={query} onChange={setQuery} onClear={() => setQuery('')} placeholder="人の名前・メールで検索" className="min-w-64 flex-1" /><Select aria-label="並び順" value={sort} onChange={setSort} options={LIST_SORT_OPTIONS} /></div>
    <div className="mb-3" data-tabs-row><Tabs items={[{ label: 'すべて', count: tabUsers.length, current: roleFilter === 'all', onClick: () => setRoleFilter('all') }, ...(['administrator', 'operations', 'reception', 'view_only', 'custom'] as const).map((role) => ({ label: ACCESS_ROLE_LABEL[role], count: tabUsers.filter((user) => user.roleBundle === role).length, current: roleFilter === role, onClick: () => setRoleFilter(role) }))]} /></div>
    <div id="staff-list" className="overflow-hidden rounded-card border border-hairline bg-canvas"><table className="w-full table-fixed text-sm"><thead><TableHeadRow><Th className="w-1/4">人</Th><Th>役わり</Th><Th>職位</Th><Th className="w-1/5">見せる範囲</Th><Th>最後に入った</Th><Th>2段階の確認</Th><Th align="right">操作</Th></TableHeadRow></thead><tbody className="divide-y divide-hairline">{loading ? <tr><td colSpan={7} className="p-10 text-center text-ink-faint">ログインユーザーを読み込んでいます…</td></tr> : shown.length === 0 ? <tr><td colSpan={7} className="p-10 text-center text-ink-faint">条件に合うログインユーザーはいません。条件を変えてお試しください。</td></tr> : shown.map((user) => { const member = memberById.get(user.id); const editable = member ? canEdit(member) : false; const canChangeOwnTwoFactor = Boolean(member && me?.id === member.id); const scope = accessScopeLabel(user, accountNames); const twoFactorLabel = user.mfaEnabled ? '入れています' : user.status === 'active' ? '入れていません' : '—'; const warning = !user.mfaEnabled || user.status === 'expired' || user.status === 'suspended'; return <tr key={user.id} className="hover:bg-canvas-sunken"><td className="min-w-0 px-3 py-3"><p className="truncate font-semibold" title={user.name}>{user.name}</p><p className="truncate text-xs text-ink-faint" title={user.email ?? ''}>{user.email ?? 'メール未登録'}</p>{tab === 'invited' && member && member.inviteStatus !== 'active' && <p className="mt-1 truncate text-xs text-ink-faint">招待の期限：{formatInviteExpiry((member as StaffMemberWithInvite).inviteExpiresAt)}</p>}{warning && <span className="mt-1 inline-block rounded-full bg-warning-bg px-2 py-0.5 text-xs font-semibold text-warning">確認が必要</span>}</td><td className="px-3 py-3"><span className={`whitespace-nowrap font-semibold ${user.roleBundle === 'administrator' ? 'text-success' : 'text-ink-secondary'}`}>{ACCESS_ROLE_LABEL[user.roleBundle]}</span></td><td className="truncate px-3 py-3 text-xs text-ink-secondary" title={user.jobTitle ?? ''}>{user.jobTitle ?? '—'}</td><td className="px-3 py-3"><p className="truncate text-xs font-medium" title={`${accessFeatureLabel(user)}：${scope}`}>{accessFeatureLabel(user)}</p><p className="mt-1 truncate text-xs text-ink-faint" title={scope}>{scope}</p></td><td className="px-3 py-3"><p className="whitespace-nowrap text-ink-secondary">{formatStaffDate(user.lastLoginAt ?? undefined)}</p><p className="mt-1 truncate text-xs text-ink-faint" title={user.lastActionAt ? '操作記録あり' : '操作記録なし'}>{user.lastActionAt ? `最後の操作：${formatStaffDate(user.lastActionAt)}` : '操作記録なし'}</p></td><td className="px-3 py-3">{canChangeOwnTwoFactor && member ? <Button onClick={() => openTwoFactor(member)}>{twoFactorLabel}</Button> : <span className="whitespace-nowrap text-xs text-ink-faint">{twoFactorLabel}</span>}</td><td className="px-3 py-3"><div className="flex flex-wrap justify-end gap-1">{editable && member ? <><RowActionButton label="中身を見る" onClick={() => openPermissions(user)} /><RowActionButton label="変更する" onClick={() => setEditing(member)} />{administrator && member.id !== me?.id && <RowActionButton label="この人を外す" onClick={() => { setRemoveError(''); setRemovingTarget(member) }} />}</> : member || !administrator ? <span className="text-xs text-ink-faint">操作できません</span> : <span className="text-xs font-semibold text-warning" title="スタッフ情報と結び付いていないため操作できません。名前とメールを確認してください。">要確認</span>}{tab === 'invited' && administrator && member && member.inviteStatus !== 'active' && <Button disabled={resendingId !== null} onClick={() => void runResend(member)}>{resendingId === member.id ? '送信中…' : 'もう一度送る'}</Button>}</div></td></tr> })}</tbody></table><p className="border-t border-hairline bg-info-bg px-4 py-3 text-xs text-ink-secondary">権限・担当範囲・職位・最終ログイン・2段階認証はアクセス API の最新状態です。確認が必要な人には注意札を表示します。</p></div>
    {!loading && !error && <div className="mt-3 flex items-center justify-between text-xs text-ink-faint"><p>ログインユーザー {filteredUsers.length}人中 {shown.length}人を表示{usersTotal > accessUsers.length ? `（全${usersTotal}人中${accessUsers.length}人まで読み込み）` : ''}</p>{pageCount > 1 && <div className="flex items-center gap-2"><Button disabled={userPage === 1} onClick={() => setUserPage(userPage - 1)}>前へ</Button><span>{userPage} / {pageCount}</span><Button disabled={userPage === pageCount} onClick={() => setUserPage(userPage + 1)}>次へ</Button></div>}</div>}
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
    </ConfirmDialog>
    <ConfirmDialog
      open={removingTarget !== null}
      title={removingTarget ? `${removingTarget.name} をログインユーザーから外しますか？` : ''}
      description="このユーザーは管理画面へログインできなくなります。内容を確認してから実行してください。"
      confirmLabel="外す"
      busy={removing}
      error={removeError}
      onConfirm={() => void runRemove()}
      onCancel={() => { if (removing) return; setRemovingTarget(null); setRemoveError('') }}
    >
      <p className="text-ink-secondary text-sm">これまでの設定と操作記録は残ります。</p>
    </ConfirmDialog>
    {stepUp && <StepUpPrompt request={stepUp} onDone={() => setStepUp(null)} onClose={() => setStepUp(null)} />}
  </div>
}

export default function StaffPage() {
  return <Suspense fallback={<div className="p-6 text-sm text-ink-faint">読み込み中…</div>}><StaffPageHost /></Suspense>
}
