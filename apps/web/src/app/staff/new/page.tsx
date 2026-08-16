'use client'

import { useState } from 'react'
import { api } from '@/lib/api'
import CreatePage, { Field, inputClass } from '@/components/shared/create-page'

const ROLES = [
  { value: 'admin', label: '管理者', note: '設定を含めてほとんどの操作ができます' },
  { value: 'staff', label: 'スタッフ', note: '日々の対応ができます。設定は触れません' },
  { value: 'viewer', label: '閲覧のみ', note: '見るだけ。更新も削除もできません' },
] as const

export default function NewStaffPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'staff' | 'viewer'>('staff')

  return (
    <CreatePage
      title="ユーザーを追加する"
      description="管理画面に入れる人を増やします。"
      parent={['ログインユーザー', '/staff']}
      validate={() => (name.trim() ? null : '名前を入力してください')}
      onReset={() => {
        setName('')
        setEmail('')
      }}
      onSave={async () => {
        const res = await api.staff.create({
          name: name.trim(),
          email: email.trim() || undefined,
          role,
        })
        if (!res.success) throw new Error(res.error)
        return res.data.id
      }}
    >
      <Field label="名前" htmlFor="st-name" required>
        <input
          id="st-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
      </Field>

      <Field label="メールアドレス" htmlFor="st-email" note="連絡用です。ログインには使いません。">
        <input
          id="st-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
      </Field>

      <Field label="権限" htmlFor="st-role" required>
        <select
          id="st-role"
          value={role}
          onChange={(e) => setRole(e.target.value as typeof role)}
          className={inputClass}
        >
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <p className="text-ink-faint mt-1 text-xs">
          {ROLES.find((r) => r.value === role)?.note}
        </p>
      </Field>

      <p className="text-ink-faint text-xs leading-relaxed">
        ユーザーの追加は<strong>オーナーだけ</strong>ができます。
        管理者やスタッフの権限では保存できません。
        <br />
        作成すると、一度だけログイン用の鍵が返ります。あとから見返すことはできないので、
        その場で本人に渡してください。
      </p>
    </CreatePage>
  )
}
