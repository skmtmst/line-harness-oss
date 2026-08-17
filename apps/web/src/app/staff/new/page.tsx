'use client'

import { useState } from 'react'
import { api } from '@/lib/api'
import CreatePage, { Field, inputClass } from '@/components/shared/create-page'

const ROLES = [
  { value: 'admin', label: '管理者', note: '日々の運用と設定変更ができます' },
  { value: 'staff', label: 'スタッフ', note: '決められた範囲の操作ができます' },
  { value: 'viewer', label: '閲覧のみ', note: '内容を見られますが、変更はできません' },
] as const

export default function NewStaffPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'staff' | 'viewer'>('staff')

  return (
    <CreatePage
      title="ユーザーを追加する"
      description="管理画面にログインできる人を追加し、できることの範囲を決めます。"
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
      <p className="text-ink text-sm font-semibold">1. どなたを追加するか</p>

      <Field label="名前" htmlFor="st-name" required>
        <input
          id="st-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
      </Field>

      <Field label="メールアドレス" htmlFor="st-email" required note="このアドレスに招待メールが届きます。">
        <input
          id="st-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
      </Field>

      <p className="text-ink mt-2 text-sm font-semibold">2. 役割</p>

      <Field label="役割" htmlFor="st-role" required note="役割を選ぶと、できることの範囲が自動で決まります。">
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
        {/* オーナーは選択肢に無い。最初の1人だけが持つ役割で、画面から
            増やせない。設計には説明があるので、読めるようにしておく。 */}
        <p className="text-ink-faint mt-1 text-xs">
          オーナー：すべての設定を変更できます。請求と削除も可能です（画面からは追加できません）
        </p>
      </Field>

      <p className="text-ink-faint text-xs leading-relaxed">
        ユーザーの追加は<strong>オーナーだけ</strong>ができます。
        管理者やスタッフの権限では保存できません。
        <br />
        作成すると、一度だけログイン用の鍵が返ります。あとから見返すことはできないので、
        その場で本人に渡してください。
      </p>
      <section className="border-hairline rounded-card border p-4">
        <p className="text-ink text-sm font-semibold">気をつけること</p>
        <ul className="text-ink-faint mt-2 space-y-1.5 text-xs leading-relaxed">
          <li>・オーナーは1人以上必要です。最後の1人は役割を変更できません</li>
          <li>・閲覧のみの人には、配信の実行ボタンが表示されません</li>
          <li>・APIキーは発行時にしか表示されません。控えを保管してください</li>
        </ul>
      </section>
    </CreatePage>
  )
}
