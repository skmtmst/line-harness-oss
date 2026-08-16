'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'

interface AuditRow {
  id: string
  adminUserId: string | null
  action: string
  screen: string | null
  ip: string | null
  result: string
  createdAt: string
}

/** 操作の表示名。'view_personal' のままでは伝わらない。 */
const ACTION_LABELS: Record<string, string> = {
  login: 'ログイン',
  logout: 'ログアウト',
  fail: 'ログイン失敗',
  view_personal: '個人情報を表示',
  export: '書き出し',
}

const FILTERS = [
  { key: '', label: 'すべて' },
  { key: 'login', label: 'ログイン' },
  { key: 'fail', label: '失敗' },
  { key: 'view_personal', label: '個人情報' },
]

/**
 * ログイン履歴。
 *
 * 誰がいつ入ったか、誰が個人情報を開いたか。個人情報保護法上の
 * 利用記録として残しているものを、そのまま見せる。
 */
export default function LoginAudit({ userId }: { userId?: string }) {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [action, setAction] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.loginAudit.list({ userId, action: action || undefined, limit: 200 })
      if (res.success) setRows(res.data)
    } catch {
      // 権限が無ければ空のまま。画面の空欄で伝わる。
    } finally {
      setLoading(false)
    }
  }, [userId, action])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setAction(f.key)}
            className={`rounded-pill px-3 py-1 text-sm transition-colors ${
              action === f.key
                ? 'bg-accent text-on-accent'
                : 'bg-canvas-sunken text-ink-secondary hover:bg-hairline'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="bg-canvas rounded-card border-hairline overflow-hidden border">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="bg-canvas-sunken border-hairline border-b">
                <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold uppercase">
                  日時
                </th>
                <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold uppercase">
                  操作
                </th>
                <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold uppercase">
                  ユーザー
                </th>
                <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold uppercase">
                  画面
                </th>
                <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold uppercase">
                  接続元
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="text-ink-faint px-4 py-8 text-center text-sm">
                    読み込み中...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-ink-faint px-4 py-8 text-center text-sm">
                    記録がありません。
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="hover:bg-canvas-sunken">
                    <td className="text-ink-secondary px-4 py-3 text-sm tabular-nums whitespace-nowrap">
                      {row.createdAt.replace('T', ' ').slice(0, 19)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-pill px-2 py-0.5 text-xs ${
                          row.action === 'fail'
                            ? 'bg-danger-bg text-danger'
                            : row.action === 'view_personal'
                              ? 'bg-warning-bg text-warning'
                              : 'bg-canvas-sunken text-ink-secondary'
                        }`}
                      >
                        {ACTION_LABELS[row.action] ?? row.action}
                      </span>
                    </td>
                    <td className="text-ink-secondary px-4 py-3 text-sm">
                      {row.adminUserId ?? '—'}
                    </td>
                    <td className="text-ink-faint px-4 py-3 text-xs">{row.screen ?? '—'}</td>
                    <td className="text-ink-faint px-4 py-3 text-xs tabular-nums">
                      {row.ip ?? '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-ink-faint mt-3 text-xs leading-relaxed">
        接続元は末尾を伏せています。見たいのは「いつもと違うところから入っていないか」で、
        完全な値は要らないためです。
        個人情報の項目を開いたときは、値が入っている場合にだけ記録されます。
      </p>
    </div>
  )
}
