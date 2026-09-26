'use client'

import { useEffect, useState } from 'react'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'

const API_URL = process.env.NEXT_PUBLIC_API_URL!
// self-update を構成した環境 (create-line-harness セットアップ) でのみ設定される。
// 未設定 = 自動アップデート非構成環境なので、この画面は fetch せず案内のみ表示する。
const ADMIN_KEY = process.env.NEXT_PUBLIC_ADMIN_API_KEY
const MANUAL_UPDATE_GUIDE_URL =
  'https://github.com/Shudesu/line-harness-oss/blob/main/docs/wiki/26-Manual-Update.md' 

interface Row {
  id: string
  started_at: number
  completed_at: number | null
  from_version: string
  to_version: string
  status: string
  error: string | null
  rollback_expires_at: number | null
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; rows: Row[] }
  | { kind: 'unconfigured' }
  | { kind: 'error'; message: string }

async function fetchHistory(adminKey: string): Promise<Row[]> {
  const r = await fetch(`${API_URL}/admin/update/history`, {
    headers: { 'x-admin-api-key': adminKey },
  })
  if (!r.ok) throw new Error(`history fetch ${r.status}`)
  const j = (await r.json()) as { history: Row[] }
  return j.history
}

export default function UpdatesPage() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  useEffect(() => {
    if (!ADMIN_KEY) {
      setState({ kind: 'unconfigured' })
      return
    }
    fetchHistory(ADMIN_KEY)
      .then((rows) => setState({ kind: 'ready', rows }))
      .catch((e) => {
        // 401/403 = キー不一致 or 未構成。ネットワーク失敗も含め、
        // 運用者を驚かせる赤エラーではなく状況の説明を出す。
        const msg = e instanceof Error ? e.message : String(e)
        if (/ 40[13]$/.test(msg)) setState({ kind: 'unconfigured' })
        else setState({ kind: 'error', message: msg })
      })
  }, [])

  const rows = state.kind === 'ready' ? state.rows : []

  return (
    <div className="flex flex-col gap-4">
      {/* カード同士の縦の間隔はこの親の gap-4（16px）だけで作る。子ごとの mb/mt は付けない。 */}
      <h1 className="text-ink text-xl font-semibold">アップデート履歴</h1>
      {state.kind === 'unconfigured' && (
        <>
          <div><NoteBar>この環境では自動アップデートが構成されていないため、履歴はありません。</NoteBar></div>
          <section className="bg-canvas rounded-card border-hairline border">
            <ListState
              kind="empty"
              emptyPreset="readonly"
              title="更新履歴はまだありません"
              description="自動アップデートは create-line-harness でセットアップした環境で利用できます。自前でデプロイしている場合は手動アップデートガイドをご覧ください。"
              action={<Button href={MANUAL_UPDATE_GUIDE_URL} target="_blank" rel="noreferrer">手動アップデートガイドを開く</Button>}
            />
          </section>
        </>
      )}
      {state.kind === 'error' && (
        <div className="bg-status-warn-soft text-status-warn-deep rounded-control p-3 text-sm">
          履歴を取得できませんでした（{state.message}）。時間をおいて再読み込みしてください。
        </div>
      )}
      {state.kind === 'ready' && rows.length === 0 && (
        <p className="text-ink-faint text-sm">履歴はまだありません。</p>
      )}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-ink-faint border-hairline border-b text-left">
              <tr>
                <th className="py-2 pr-4 font-medium">開始</th>
                <th className="py-2 pr-4 font-medium">From → To</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 font-medium">Rollback</th>
              </tr>
            </thead>
            <tbody className="divide-hairline divide-y">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="text-ink-secondary whitespace-nowrap px-0 py-2 pr-4 tabular-nums">
                    {new Date(r.started_at).toLocaleString('ja-JP', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">
                    <span className="block truncate" title={`${r.from_version} → ${r.to_version}`}>
                      {r.from_version} → {r.to_version}
                    </span>
                  </td>
                  <td className="py-2 pr-4">
                    <StatusBadge tone={statusTone(r.status)} size="compact">
                      {r.status}
                    </StatusBadge>
                  </td>
                  <td className="py-2">
                    {r.status === 'success' &&
                    r.rollback_expires_at &&
                    Date.now() < r.rollback_expires_at ? (
                      /*
                        **押しても何も起きない口を置かない**（`docs/v6-common-rules.md`
                        §7-10「出す＝使える」）。戻す仕組みは画面から使えないので、
                        押し口ではなく文で理由を出す。以前はブラウザの `alert()` で
                        「rollback not implemented in MVP — use CLI」と内部語を出していた。
                      */
                      <span className="text-ink-faint text-xs">
                        戻せる期間内ですが、この画面からは戻せません
                      </span>
                    ) : (
                      <span className="text-ink-faint text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function statusTone(s: string): StatusBadgeTone {
  if (s === 'success') return 'success'
  if (s === 'rolled_back') return 'warning'
  if (s === 'failed') return 'danger'
  if (s === 'running') return 'info'
  return 'neutral'
}
