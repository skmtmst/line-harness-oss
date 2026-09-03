'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Header from '@/components/layout/header'
import ImageUploader from '@/components/shared/image-uploader'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import { bookingApi, type BookingStaff } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

const EMPTY: Partial<BookingStaff> = {
  name: '',
  display_name: '',
  role: '',
  profile_image_url: '',
  bio: '',
  sort_order: 0,
  is_designation_optional: 0,
  is_active: 1,
}

type LoadStatus = 'loading' | 'ready' | 'error'

export default function BookingStaffPage() {
  const { selectedAccountId } = useAccount()
  const [items, setItems] = useState<BookingStaff[]>([])
  const [editing, setEditing] = useState<Partial<BookingStaff> | null>(null)
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading')
  const loadRequestRef = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current
    if (!selectedAccountId) {
      setItems([])
      setLoadStatus('ready')
      return
    }
    setLoadStatus('loading')
    // アカウント切替時の stale state 防止（cross-account 表示/操作の事故防止）。
    setItems([])
    try {
      const r = await bookingApi.listStaff(selectedAccountId)
      if (requestId !== loadRequestRef.current) return
      setItems(r.staff)
      setLoadStatus('ready')
    } catch {
      if (requestId !== loadRequestRef.current) return
      setItems([])
      setLoadStatus('error')
    }
  }, [selectedAccountId])

  useEffect(() => {
    void load()
    return () => {
      loadRequestRef.current += 1
    }
  }, [load])

  async function save(s: Partial<BookingStaff>) {
    if (!selectedAccountId) return
    if (s.id) {
      await bookingApi.updateStaff(selectedAccountId, s.id, s)
    } else {
      await bookingApi.createStaff(selectedAccountId, s)
    }
    setEditing(null)
    await load()
  }

  async function remove(id: string) {
    if (!selectedAccountId) return
    if (!confirm('このスタッフを削除しますか？（既存予約は維持されます）')) return
    await bookingApi.deleteStaff(selectedAccountId, id)
    await load()
  }

  return (
    <div>
      <Header
        title="予約スタッフ"
        description="予約担当スタッフの管理（指名なし枠も含む）"
        action={
          <button
            onClick={() => setEditing(EMPTY)}
            disabled={!selectedAccountId || loadStatus !== 'ready'}
            className="bg-accent-deep text-on-accent rounded-control px-4 py-2 text-sm font-medium transition-colors hover:brightness-92 disabled:opacity-50"
          >
            + 新規スタッフ
          </button>
        }
      />

      {!selectedAccountId ? (
        <ListState kind="empty" title="LINEアカウントを選んでください" description="共通メニューで、予約スタッフを管理するLINEアカウントを選んでください。" />
      ) : loadStatus === 'loading' ? (
        <ListState kind="loading" title="予約スタッフを読み込んでいます" />
      ) : loadStatus === 'error' ? (
        <ListState
          kind="error"
          title="予約スタッフを表示できませんでした"
          description="登録したスタッフは消えていません。再読み込みしても直らない場合はエラー報告へ。"
          action={<Button variant="secondary" onClick={() => void load()}>予約スタッフを再読み込み</Button>}
        />
      ) : items.length === 0 ? (
        <ListState kind="empty" title="予約スタッフはまだいません" description="「＋ 新規スタッフ」から最初のスタッフを追加してください。" />
      ) : (
        <div className="bg-canvas rounded-card border border-hairline overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="bg-canvas-sunken border-b border-hairline">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase">スタッフ</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase">役職</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-ink-faint uppercase">指名なし枠</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-ink-faint uppercase">並び順</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-ink-faint uppercase">有効</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-ink-faint uppercase">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((s) => (
                  <tr key={s.id} className="hover:bg-canvas-sunken">
                    <td className="px-4 py-3 text-sm">
                      <div className="flex items-center gap-3">
                        {s.profile_image_url ? (
                          <img
                            src={s.profile_image_url}
                            alt={s.display_name}
                            className="w-9 h-9 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center text-ink-faint text-xs">
                            {s.display_name.slice(0, 1)}
                          </div>
                        )}
                        <div>
                          <div className="font-medium">{s.display_name}</div>
                          {s.name !== s.display_name && (
                            <div className="text-xs text-ink-faint">{s.name}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-ink-secondary">{s.role ?? '-'}</td>
                    <td className="px-4 py-3 text-center">
                      {s.is_designation_optional ? (
                        <span className="inline-block px-2 py-0.5 rounded bg-purple-100 text-purple-700 text-xs">指名なし</span>
                      ) : (
                        <span className="text-xs text-gray-300">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums text-ink-faint">{s.sort_order}</td>
                    <td className="px-4 py-3 text-center">
                      {s.is_active ? (
                        <span className="inline-block px-2 py-0.5 rounded bg-success-bg text-success text-xs">ON</span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded bg-canvas-sunken text-ink-faint text-xs">OFF</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-2 text-xs">
                        <button onClick={() => setEditing(s)} className="text-blue-600 hover:underline">編集</button>
                        <Link href={`/booking/staff/shifts?staff_id=${s.id}`} className="text-blue-600 hover:underline">
                          シフト
                        </Link>
                        <button onClick={() => remove(s.id)} className="text-red-600 hover:underline">削除</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing && <Modal staff={editing} onSave={save} onClose={() => setEditing(null)} />}
    </div>
  )
}

function Modal({
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
  const [err, setErr] = useState<string | null>(null)

  function set<K extends keyof BookingStaff>(k: K, v: BookingStaff[K]) {
    setForm((prev) => ({ ...prev, [k]: v }))
  }

  async function submit() {
    setSaving(true)
    setErr(null)
    try {
      await onSave(form)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-hairline">
          <h2 className="text-base font-semibold">{form.id ? 'スタッフ編集' : '新規スタッフ'}</h2>
        </div>
        <div className="px-6 py-4 space-y-4">
          <Field label="内部名（管理用）" required>
            <input
              type="text"
              value={form.name ?? ''}
              onChange={(e) => set('name', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="例: yamada-taro"
            />
          </Field>
          <Field label="表示名" required>
            <input
              type="text"
              value={form.display_name ?? ''}
              onChange={(e) => set('display_name', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="顧客に表示される名前"
            />
          </Field>
          <Field label="役職">
            <input
              type="text"
              value={form.role ?? ''}
              onChange={(e) => set('role', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="例: トップスタイリスト"
            />
          </Field>
          <ImageUploader
            mode="url"
            value={form.profile_image_url ? { mode: 'url', url: form.profile_image_url } : null}
            onChange={(v) => set('profile_image_url', v?.mode === 'url' ? v.url : '')}
            label="プロフィール画像"
          />
          <Field label="紹介文">
            <textarea
              value={form.bio ?? ''}
              onChange={(e) => set('bio', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-y"
              rows={2}
            />
          </Field>
          <Field label="並び順">
            <input
              type="number"
              value={form.sort_order ?? 0}
              onChange={(e) => set('sort_order', Number(e.target.value))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 tabular-nums"
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(form.is_designation_optional)}
              onChange={(e) => set('is_designation_optional', e.target.checked ? 1 : 0)}
              className="rounded"
            />
            <span>「指名なし」枠（仮想スタッフ）</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(form.is_active)}
              onChange={(e) => set('is_active', e.target.checked ? 1 : 0)}
              className="rounded"
            />
            <span>有効（顧客に表示する）</span>
          </label>
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
        <div className="px-6 py-4 border-t border-hairline flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-ink-secondary bg-canvas-sunken hover:bg-gray-200 rounded-lg"
          >
            キャンセル
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="bg-accent-deep text-on-accent rounded-control px-4 py-2 text-sm font-medium transition-colors hover:brightness-92 disabled:opacity-50"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-ink-secondary mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  )
}
