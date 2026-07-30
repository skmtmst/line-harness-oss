'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Header from '@/components/layout/header'
import {
  bookingApi,
  type BookingStaff,
  type StaffMenuMatrix,
} from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

export default function StaffMenusPage() {
  const sp = useSearchParams()
  const staffId = sp.get('staff_id') ?? ''
  const { selectedAccountId } = useAccount()
  const [staff, setStaff] = useState<BookingStaff | null>(null)
  const [menus, setMenus] = useState<StaffMenuMatrix[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    if (!selectedAccountId || !staffId) return
    setLoading(true)
    setError(null)
    try {
      const [staffResult, menuResult] = await Promise.all([
        bookingApi.listStaff(selectedAccountId),
        bookingApi.getStaffMenus(selectedAccountId, staffId),
      ])
      setStaff(staffResult.staff.find((item) => item.id === staffId) ?? null)
      setMenus(menuResult.matrix)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId, staffId])

  useEffect(() => {
    void load()
  }, [load])

  const selectedCount = menus.filter((menu) => menu.is_offered).length
  const groupedMenus = useMemo(() => {
    const groups = new Map<string, StaffMenuMatrix[]>()
    for (const menu of menus) {
      const category = menu.name.includes('小顔矯正')
        ? '小顔矯正'
        : menu.name.includes('ウルセラ')
          ? 'ウルセラ'
          : menu.name.includes('ハイフ')
            ? '造顔ハイフ'
            : 'その他'
      const items = groups.get(category) ?? []
      items.push(menu)
      groups.set(category, items)
    }
    return [...groups.entries()]
  }, [menus])

  function updateMenu(menuId: string, patch: Partial<StaffMenuMatrix>) {
    setSaved(false)
    setMenus((current) =>
      current.map((menu) => menu.menu_id === menuId ? { ...menu, ...patch } : menu),
    )
  }

  function setAll(offered: boolean) {
    setSaved(false)
    setMenus((current) =>
      current.map((menu) => ({ ...menu, is_offered: offered ? 1 : 0 })),
    )
  }

  async function save() {
    if (!selectedAccountId || !staffId) return
    setSaving(true)
    setError(null)
    try {
      await bookingApi.putStaffMenus(
        selectedAccountId,
        staffId,
        menus.map((menu) => ({
          menu_id: menu.menu_id,
          is_offered: Boolean(menu.is_offered),
          override_duration_minutes: menu.override_duration_minutes,
          override_price: menu.override_price,
        })),
      )
      setSaved(true)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <Header
        title="対応メニュー"
        description={
          staff
            ? `「${staff.display_name}」が担当できる施術を選択`
            : 'スタッフごとに担当できるメニューを設定'
        }
        action={
          <button
            onClick={() => void save()}
            disabled={saving || loading || !selectedAccountId || !staffId}
            className="px-5 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50"
            style={{ backgroundColor: '#06C755' }}
          >
            {saving ? '保存中…' : `選択した${selectedCount}件を保存`}
          </button>
        }
      />

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}
      {saved && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">
          対応メニューを保存しました。
        </div>
      )}

      {!selectedAccountId || !staffId ? (
        <div className="bg-white rounded-lg border p-12 text-center text-sm text-gray-500">
          <a href="/booking/staff" className="text-blue-600 underline">スタッフ一覧</a>
          からスタッフを選択してください。
        </div>
      ) : loading ? (
        <div className="bg-white rounded-lg border p-12 text-center text-sm text-gray-500">
          メニューを読み込み中…
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-gray-200 p-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-gray-700">
              全{menus.length}件中
              <strong className="mx-1 text-green-700">{selectedCount}件</strong>
              を担当可能に設定
            </p>
            <div className="flex gap-3 text-xs">
              <button onClick={() => setAll(true)} className="text-blue-600 hover:underline">
                すべて選択
              </button>
              <button onClick={() => setAll(false)} className="text-gray-600 hover:underline">
                すべて解除
              </button>
            </div>
          </div>

          {groupedMenus.map(([category, items]) => (
            <section key={category} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                <h2 className="text-sm font-semibold">{category}</h2>
              </div>
              <div className="divide-y divide-gray-100">
                {items.map((menu) => (
                  <div key={menu.menu_id} className="p-4">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(menu.is_offered)}
                        onChange={(e) =>
                          updateMenu(menu.menu_id, { is_offered: e.target.checked ? 1 : 0 })
                        }
                        className="mt-1 h-4 w-4"
                      />
                      <span className="font-medium text-sm text-gray-900">{menu.name}</span>
                    </label>
                    {menu.is_offered ? (
                      <div className="mt-3 ml-7 grid sm:grid-cols-2 gap-3 max-w-xl">
                        <label className="text-xs text-gray-600">
                          NANAさん用の所要時間（空欄＝基本設定）
                          <input
                            type="number"
                            min={1}
                            value={menu.override_duration_minutes ?? ''}
                            onChange={(e) =>
                              updateMenu(menu.menu_id, {
                                override_duration_minutes: e.target.value
                                  ? Number(e.target.value)
                                  : null,
                              })
                            }
                            className="mt-1 block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                          />
                        </label>
                        <label className="text-xs text-gray-600">
                          NANAさん用の料金（空欄＝基本設定）
                          <input
                            type="number"
                            min={0}
                            value={menu.override_price ?? ''}
                            onChange={(e) =>
                              updateMenu(menu.menu_id, {
                                override_price: e.target.value ? Number(e.target.value) : null,
                              })
                            }
                            className="mt-1 block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                          />
                        </label>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
