'use client'

import { useState } from 'react'
import { api } from '@/lib/api'
import CreatePage, { AsideCard, FormSection, Field, inputClass } from '@/components/shared/create-page'

type Role = 'admin' | 'staff' | 'viewer'
type Channel = { email: boolean; line: boolean }

const ROLES: Array<{ value: Role; label: string; note: string }> = [
  { value: 'admin', label: '管理者', note: 'すべての権限で設定・操作できます' },
  { value: 'staff', label: 'スタッフ', note: '選択した機能だけを操作できます' },
  { value: 'viewer', label: '閲覧のみ', note: 'すべて閲覧できますが、操作はできません' },
]

const PERMISSION_GROUPS = [
  { label: '基本', items: [['/', 'ダッシュボード'], ['/chats', '受信箱'], ['/friends', '友だち'], ['/tags', '友だち属性']] },
  { label: '配信', items: [['/scenarios', 'シナリオ配信'], ['/broadcasts', '一斉配信'], ['/reminders', 'リマインダ'], ['/auto-replies', '自動応答'], ['/friend-add-settings', '友だち追加時の配信'], ['/webinars', 'ウェビナー']] },
  { label: 'コンテンツ', items: [['/templates', 'テンプレート'], ['/rich-menus', 'リッチメニュー'], ['/form-submissions', '回答フォーム'], ['/contents', 'コンテンツ']] },
  { label: '成果と分析', items: [['/conversions', '成果とアフィリエイト'], ['/scoring', 'マイル'], ['/inflow-links', '流入と計測'], ['/analytics', '分析']] },
  { label: '自動化・予約', items: [['/automations', 'オートメーション'], ['/webhooks', '外部連携'], ['/booking/bookings', '予約管理'], ['/booking/menus', '予約設定'], ['/events', 'イベント予約']] },
  { label: '専用機能', items: [['/nen-campaigns', 'NEN配信'], ['/nen-members', '写真審査'], ['/ec-commerce', 'EC連携']] },
] as const

const NOTIFICATIONS = [
  ['operations', '運用状態のエラー', '異常を検知したとき'],
  ['emergency', '緊急停止・復旧', '停止または復旧したとき'],
  ['security', 'ログイン・権限変更', 'ログインや権限が変わったとき'],
  ['updates', 'システム更新', '更新が完了したとき'],
] as const

function Switch({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={onChange} className={`relative h-6 w-11 cursor-pointer rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-hairline'}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} /></button>
}

export default function NewStaffPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('admin')
  const [permissionKeys, setPermissionKeys] = useState<string[]>([])
  const [notifications, setNotifications] = useState<Record<string, Channel>>({
    operations: { email: true, line: true }, emergency: { email: true, line: true },
    security: { email: true, line: false }, updates: { email: false, line: true },
  })
  const togglePermission = (key: string) => setPermissionKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])
  const toggleChannel = (key: string, channel: keyof Channel) => setNotifications((current) => ({ ...current, [key]: { ...current[key], [channel]: !current[key][channel] } }))

  return <CreatePage
    title="ユーザーを追加する"
    description="管理画面にログインできる人を追加し、できることの範囲を決めます。"
    parent={['ログインユーザー', '/staff?tab=members']}
    saveLabel="招待メールを送る"
    validate={() => !name.trim() ? '名前を入力してください' : !email.trim() ? 'メールアドレスを入力してください' : role === 'staff' && permissionKeys.length === 0 ? 'スタッフに表示する機能を1つ以上選択してください' : null}
    onSave={async () => { const res = await api.staff.create({ name: name.trim(), email: email.trim(), role, permissionKeys, notificationPreferences: notifications }); if (!res.success) throw new Error(res.error); return res.data.id }}
    aside={<>
      <AsideCard title="追加後の流れ"><ol className="space-y-3 text-sm text-ink-secondary"><li><b className="text-accent">1.</b> 招待メールでアドレスを確認</li><li><b className="text-accent">2.</b> 続けて届くメールからLINE認証</li><li><b className="text-accent">3.</b> 連携完了後はLINEでログイン</li></ol></AsideCard>
      <AsideCard title="設定内容"><dl className="space-y-2 text-sm"><div className="flex justify-between"><dt className="text-ink-faint">役割</dt><dd className="text-ink">{ROLES.find((item) => item.value === role)?.label}</dd></div><div className="flex justify-between"><dt className="text-ink-faint">表示機能</dt><dd className="text-ink">{role === 'staff' ? `${permissionKeys.length}件` : 'すべて'}</dd></div></dl></AsideCard>
    </>}
  >
    <FormSection step={1} label="どなたを追加するか">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="名前" htmlFor="staff-name" required><input id="staff-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="山本 恭平" /></Field>
        <Field label="メールアドレス" htmlFor="staff-email" required note="このアドレスに招待メールが届きます。"><input id="staff-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="yamamoto@example.com" /></Field>
      </div>
    </FormSection>

    <FormSection step={2} label="役割" note="役割を選ぶと、できることの範囲が決まります。">
      <div className="grid gap-3 lg:grid-cols-3">{ROLES.map((item) => <button key={item.value} type="button" onClick={() => setRole(item.value)} className={`min-h-24 cursor-pointer rounded-card border p-4 text-left transition-colors ${role === item.value ? 'border-accent bg-accent-bg' : 'border-hairline hover:bg-canvas-sunken'}`}><span className="flex items-center gap-2 text-sm font-semibold text-ink"><span className={`h-4 w-4 rounded-full border-2 ${role === item.value ? 'border-accent bg-accent shadow-[inset_0_0_0_3px_white]' : 'border-hairline'}`} />{item.label}</span><span className="mt-2 block whitespace-nowrap text-xs text-ink-secondary">{item.note}</span></button>)}</div>
    </FormSection>

    {role === 'staff' && <FormSection step={3} label="スタッフに表示する機能" note="選択した機能だけが左のメニューに表示され、操作できます。">
      <div className="space-y-4">{PERMISSION_GROUPS.map((group) => <div key={group.label}><p className="mb-2 text-xs font-semibold text-ink-faint">{group.label}</p><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{group.items.map(([key, label]) => <label key={key} className={`flex cursor-pointer items-center gap-2 rounded-control border p-2.5 text-sm ${permissionKeys.includes(key) ? 'border-accent bg-accent-bg text-accent' : 'border-hairline text-ink-secondary'}`}><input type="checkbox" checked={permissionKeys.includes(key)} onChange={() => togglePermission(key)} className="accent-green-500" />{label}</label>)}</div></div>)}</div>
    </FormSection>}

    <FormSection step={role === 'staff' ? 4 : 3} label="通知先" note="通知の種類ごとに、メールとLINEへの送信を切り替えます。">
      <div className="divide-hairline overflow-hidden rounded-card border border-hairline divide-y">{NOTIFICATIONS.map(([key, label, note]) => <div key={key} className="grid grid-cols-[1fr_auto_auto] items-center gap-5 px-4 py-3"><div><p className="text-sm font-medium text-ink">{label}</p><p className="text-xs text-ink-faint">{note}</p></div><div className="flex items-center gap-2 text-xs text-ink-secondary"><span>メール</span><Switch checked={notifications[key].email} onChange={() => toggleChannel(key, 'email')} label={`${label}をメールで通知`} /></div><div className="flex items-center gap-2 text-xs text-ink-secondary"><span>LINE</span><Switch checked={notifications[key].line} onChange={() => toggleChannel(key, 'line')} label={`${label}をLINEで通知`} /></div></div>)}</div>
    </FormSection>
  </CreatePage>
}
