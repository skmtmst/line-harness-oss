'use client'

/*
 * 予約スタッフの作成・編集の窓。v7 一覧（staff/page.tsx）と V8 予約設定の
 * 担当スタッフタブ（menus/settings-v8.tsx）の両方から使う。
 * 見た目・入力検査（parseBookingStaffInput）・紐づけ候補の取り方は変えない。
 */
import { Field } from '@/components/shared/form-controls'
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { BOOKING_STAFF_LIMITS, parseBookingStaffInput, type StaffMember } from '@line-crm/shared'
import ImageUploader from '@/components/shared/image-uploader'
import Select from '@/components/shared/select'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Dialog from '@/components/shared/dialog'
import { api, type BookingStaff } from '@/lib/api'
import NumberInput from '@/components/shared/number-field'

export function StaffEditModal({
  staff,
  onSave,
  onClose,
}: {
  staff: Partial<BookingStaff>
  onSave: (s: Partial<BookingStaff>) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState<Partial<BookingStaff>>(staff)
  const [saving, setSaving] = useState(false)
  /* V8 のときだけボタンの内側の保存中表示へ。v7 は従来の文字のまま。 */
  const busySave = saving
  const [err, setErr] = useState<string | null>(null)
  // 保存の途中で窓だけ消えないよう、送信中はEscapeを止める。
  // N-411 本人勤務: 予約スタッフをログインユーザーへ紐づけるための一覧。
  const [members, setMembers] = useState<StaffMember[]>([])

  useEffect(() => {
    let cancelled = false
    api.staff.list()
      .then((res) => {
        if (!cancelled && res.success) setMembers(res.data.filter((m) => m.isActive))
      })
      .catch(() => { /* 一覧が取れなくても紐づけ以外の編集は続けられる */ })
    return () => { cancelled = true }
  }, [])

  function set<K extends keyof BookingStaff>(k: K, v: BookingStaff[K]) {
    setForm((prev) => ({ ...prev, [k]: v }))
  }

  async function submit() {
    setErr(null)
    const parsed = parseBookingStaffInput(form, form.id ? 'update' : 'create')
    if (!parsed.ok) {
      setErr(parsed.error)
      return
    }
    setSaving(true)
    try {
      await onSave(form.id ? { id: form.id, ...parsed.value } : parsed.value)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open title={form.id ? 'スタッフ編集' : '新規スタッフ'} onCancel={onClose} onConfirm={() => void submit()} confirmLabel="保存する" busy={saving} designWidth={560}>
        <div className="px-6 py-4 space-y-4">
          <Field label="内部名（管理用）" required>
            <input
              type="text"
              value={form.name ?? ''}
              onChange={(e) => set('name', e.target.value)}
              maxLength={BOOKING_STAFF_LIMITS.name}
              className="w-full border border-hairline rounded-control px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              placeholder="例：yamada-taro"
            />
          </Field>
          <Field label="表示名" required>
            <input
              type="text"
              value={form.display_name ?? ''}
              onChange={(e) => set('display_name', e.target.value)}
              maxLength={BOOKING_STAFF_LIMITS.displayName}
              className="w-full border border-hairline rounded-control px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              placeholder="顧客に表示される名前"
            />
          </Field>
          <Field label="役職">
            <input
              type="text"
              value={form.role ?? ''}
              onChange={(e) => set('role', e.target.value)}
              maxLength={BOOKING_STAFF_LIMITS.role}
              className="w-full border border-hairline rounded-control px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              placeholder="例：トップスタイリスト"
            />
          </Field>
          <ImageUploader
            mode="url"
            value={form.profile_image_url ? { mode: 'url', url: form.profile_image_url } : null}
            onChange={(v) => set('profile_image_url', v?.mode === 'url' ? v.url : '')}
            label="プロフィール画像"
            title="プロフィール画像を追加"
          />
          <p className="text-ink-faint -mt-3 text-xs">
            http:// または https:// で始まるURLを入力してください。
          </p>
          <Field label="紹介文">
            <textarea
              value={form.bio ?? ''}
              onChange={(e) => set('bio', e.target.value)}
              maxLength={BOOKING_STAFF_LIMITS.bio}
              className="w-full border border-hairline rounded-control px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent resize-y"
              rows={2}
            />
          </Field>
          <Field label="並び順">
            <NumberInput
              type="number"
              value={form.sort_order ?? 0}
              onChange={(e) => set('sort_order', Number(e.target.value))}
              min={BOOKING_STAFF_LIMITS.sortOrderMin}
              max={BOOKING_STAFF_LIMITS.sortOrderMax}
              step={1}
              className="w-full border border-hairline rounded-control px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent tabular-nums"
            />
          </Field>
          <Checkbox
            checked={Boolean(form.is_designation_optional)}
            onCheckedChange={(checked) => set('is_designation_optional', checked ? 1 : 0)}
          >「指名なし」枠（仮想スタッフ）</Checkbox>
          <Checkbox
            checked={Boolean(form.is_active)}
            onCheckedChange={(checked) => set('is_active', checked ? 1 : 0)}
          >有効（顧客に表示する）</Checkbox>
          <Field label="ログインユーザー（本人の勤務）">
            <Select
              aria-label="ログインユーザーとの紐づけ"
              size="full"
              value={form.staff_member_id ?? ''}
              onChange={(v) => set('staff_member_id', v || null)}
              options={[
                { value: '', label: '紐づけない' },
                ...members.map((m) => ({ value: m.id, label: `${m.name}${m.email ? `（${m.email}）` : ''}` })),
              ]}
            />
            <span className="text-ink-faint mt-1 block text-xs">
              紐づけると、そのログインユーザーが「本人の勤務」としてこの担当者のシフト・休憩・外部連携を管理できます。
            </span>
          </Field>
          {err && <p className="text-xs text-danger">{err}</p>}
        </div>
    </Dialog>
  )
}

export const EMPTY_STAFF: Partial<BookingStaff> = {
  name: '',
  display_name: '',
  role: '',
  profile_image_url: '',
  bio: '',
  sort_order: 0,
  is_designation_optional: 0,
  is_active: 1,
}
