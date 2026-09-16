'use client'

import { useEffect, useState } from 'react'
import { api, type OperatorHistoryRow } from '@/lib/api'

/**
 * 運営（musubo 提供元）がこの統括に対して行った操作の履歴。
 * ★V6 37-5 の決まり: 契約先に見せるのは**書き込みを伴った**操作だけ。
 * 閲覧だけの代理ログインはここに出ない。何も無ければ描かない。
 */
const LABEL: Record<string, string> = {
  'impersonation.write': '運営が代理ログインで設定を変更しました',
  'tenant.status.change': '運営が契約の状態を変更しました',
  'tenant.feature_packs.change': '運営が機能パックを変更しました',
}

export default function OperatorHistory() {
  const [rows, setRows] = useState<OperatorHistoryRow[]>([])

  useEffect(() => {
    let cancelled = false
    api.operatorHistory()
      .then((res) => { if (!cancelled && res.success) setRows(res.data) })
      .catch(() => { /* 読めなくても画面は使える */ })
    return () => { cancelled = true }
  }, [])

  if (rows.length === 0) return null

  return (
    <section className="mt-6 rounded-card border border-hairline bg-canvas px-5 py-4 shadow-sm" aria-labelledby="operator-history-title">
      <h2 id="operator-history-title" className="text-base font-bold text-ink">運営による操作</h2>
      <p className="mt-1 text-sm text-ink-secondary">musubo の運営が、この統括のデータを変更した記録です。閲覧だけの確認は含みません。</p>
      <ul className="mt-3 divide-y divide-hairline">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm">
            <span className="w-36 shrink-0 text-ink-faint">{row.createdAt.replace('T', ' ').slice(0, 16)}</span>
            <span className="font-semibold text-ink">{LABEL[row.action] ?? row.action}</span>
            <span className="text-ink-secondary">（{row.operatorName}）</span>
            {row.reason ? <span className="basis-full text-ink-secondary">理由：{row.reason}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
