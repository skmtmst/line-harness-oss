'use client'

import { useCallback, useEffect, useState } from 'react'
import Header from '@/components/layout/header'
import { bookingApi, type BookingLocation } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

const EMPTY: Partial<BookingLocation> = {
  name: '',
  address: '',
  phone: '',
  access: '',
  sort_order: 0,
  is_active: 1,
}

export default function BookingLocationsPage() {
  const { selectedAccountId } = useAccount()
  const [locations, setLocations] = useState<BookingLocation[]>([])
  const [editing, setEditing] = useState<Partial<BookingLocation> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!selectedAccountId) return
    setLoading(true)
    setError(null)
    try {
      const res = await bookingApi.listLocations(selectedAccountId)
      setLocations(res.locations)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    void load()
  }, [load])

  async function save() {
    if (!selectedAccountId || !editing?.name?.trim()) {
      setError('店舗名を入力してください')
      return
    }
    try {
      if (editing.id) {
        await bookingApi.updateLocation(selectedAccountId, editing.id, editing)
      } else {
        await bookingApi.createLocation(selectedAccountId, editing)
      }
      setEditing(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function remove(location: BookingLocation) {
    if (!selectedAccountId) return
    if (!confirm(`店舗「${location.name}」を削除しますか？`)) return
    try {
      await bookingApi.deleteLocation(selectedAccountId, location.id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div>
      <Header
        title="店舗管理"
        description="予約で選択できる店舗を管理します"
        action={
          <button
            onClick={() => setEditing(EMPTY)}
            disabled={!selectedAccountId}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
            style={{ backgroundColor: '#06C755' }}
          >
            + 店舗を追加
          </button>
        }
      />

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {!selectedAccountId ? (
        <div className="bg-white rounded-lg border p-12 text-center text-sm text-gray-500">
          サイドバーでアカウントを選択してください
        </div>
      ) : loading ? (
        <div className="bg-white rounded-lg border p-12 text-center text-sm text-gray-500">
          読み込み中…
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {locations.map((location) => (
            <section key={location.id} className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-gray-900">{location.name}</h2>
                  <p className="mt-1 text-xs text-gray-500">{location.address || '住所未登録'}</p>
                  {location.phone && <p className="mt-1 text-xs text-gray-500">{location.phone}</p>}
                  {location.access && <p className="mt-2 text-sm text-gray-600">{location.access}</p>}
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-xs ${
                    location.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {location.is_active ? '有効' : '停止'}
                </span>
              </div>
              <div className="mt-4 flex justify-end gap-3 text-xs">
                <button onClick={() => setEditing(location)} className="text-blue-600 hover:underline">
                  編集
                </button>
                <button onClick={() => void remove(location)} className="text-red-600 hover:underline">
                  削除
                </button>
              </div>
            </section>
          ))}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-5">
            <h2 className="font-semibold">{editing.id ? '店舗を編集' : '店舗を追加'}</h2>
            <div className="mt-4 space-y-3">
              {[
                ['name', '店舗名', '甲府店'],
                ['address', '住所', '山梨県甲府市…'],
                ['phone', '電話番号', '000-0000-0000'],
                ['access', 'アクセス', '甲府駅から徒歩…'],
              ].map(([key, label, placeholder]) => (
                <label key={key} className="block">
                  <span className="text-xs text-gray-600">{label}</span>
                  <input
                    value={String(editing[key as keyof BookingLocation] ?? '')}
                    onChange={(e) => setEditing({ ...editing, [key]: e.target.value })}
                    placeholder={placeholder}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </label>
              ))}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editing.is_active !== 0}
                  onChange={(e) => setEditing({ ...editing, is_active: e.target.checked ? 1 : 0 })}
                />
                予約画面に表示する
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm border rounded-lg">
                キャンセル
              </button>
              <button
                onClick={() => void save()}
                className="px-4 py-2 text-sm text-white rounded-lg"
                style={{ backgroundColor: '#06C755' }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
