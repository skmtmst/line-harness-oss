'use client'

import ListState from '@/components/shared/list-state'
import '@/app/hq/readonly-v8.css'
import { useAdminTheme } from '@/lib/use-admin-theme'
import { useEffect, useState } from 'react'
import { api, type OperatorHistoryRow } from '@/lib/api'

/**
 * 運営（musubo 提供元）がこの統括に対して行った操作の履歴。
 * ★V6 37-5 の決まり: 契約先に見せるのは**書き込みを伴った**操作だけ。
 * 閲覧だけの代理ログインはここに出ない。何も無ければ描かない。
 *
 * 2026-10-06 利用者指定により、どの画面からもこの部品を外している（将来また出す可能性があるため残置）。
 * 記録づくりと `/api/hq/operator-history` は従来どおり動いているので、
 * 出すときは `/hq` か `/hq/settings` に `<OperatorHistory />` を戻すだけでよい。
 */
const LABEL: Record<string, string> = {
  'impersonation.write': '運営が代理ログインで設定を変更しました',
  'tenant.status.change': '運営が契約の状態を変更しました',
  'tenant.feature_packs.change': '運営が機能パックを変更しました',
}

function historyDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ja-JP', {timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date)
}

export default function OperatorHistory() {
  const theme = useAdminTheme()
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [rows, setRows] = useState<OperatorHistoryRow[]>([])

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    setError(false)
    api.operatorHistory()
      .then((res) => { if (!cancelled) { if (res.success) setRows(res.data); else setError(true) } })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [reloadKey])

  if (theme !== 'v8' && rows.length === 0) return null

  return (
    <section className="v8-ro-hq-history mt-6 rounded-card border border-hairline bg-canvas px-5 py-4 shadow-card" aria-labelledby="operator-history-title">
      <h2 id="operator-history-title" className="text-base font-bold text-ink">運営による操作</h2>
      <p className="mt-1 text-sm text-ink-secondary">musubo の運営が、この統括のデータを変更した記録です。閲覧だけの確認は含みません。</p>
      {theme === 'v8' && (!loaded ? <ListState kind="loading" title="操作の記録を読み込んでいます" /> : error ? <ListState kind="error" title="操作の記録を読み込めませんでした" onRetry={() => setReloadKey(key => key + 1)} /> : rows.length === 0 ? <p className="mt-3 text-caption text-ink-faint">運営による変更の記録はありません。</p> : null)}
      <ul className="mt-3 divide-y divide-hairline">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm">
            <span className="w-36 shrink-0 text-ink-faint">{theme === 'v8' ? historyDate(row.createdAt) : row.createdAt.replace('T', ' ').slice(0, 16)}</span>
            <span className="font-semibold text-ink">{LABEL[row.action] ?? row.action}</span>
            <span className="text-ink-secondary">（{row.operatorName}）</span>
            {row.reason ? <span className="basis-full text-ink-secondary">理由：{row.reason}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
