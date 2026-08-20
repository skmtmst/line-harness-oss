'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import EditDialog, { type AutoReplyDraft } from '@/components/auto-replies/edit-dialog'

interface EffectiveAccount {
  accountId: string
  accountName: string
  status: 'reply' | 'silent' | 'not_applicable'
  via: 'inline' | 'automation' | null
}

interface AutoReply {
  id: string
  keyword: string
  matchType: 'exact' | 'contains'
  responseType: string
  responseContent: string
  templateId: string | null
  lineAccountId: string | null
  isActive: boolean
  activeFrom: string | null
  activeUntil: string | null
  cooldownMinutes: number | null
  skipWhenOperatorActive: boolean
  priority: number
  messageKinds: string[] | null
  /** 151: 応答したときに順に実行すること。 */
  actions: unknown[] | null
  /** 151: 応答する曜日（0=日 … 6=土）。 */
  responseWeekdays: number[] | null
  responseHolidayRule: string | null
  oncePerFriend: boolean
  keywords: unknown[] | null
  friendConditions: unknown | null
  /** 157: キーワードを問わず、届いたメッセージすべてに応答する。 */
  respondToAll: boolean
  /** 152: 当たった回数（今月・累計）。 */
  hits?: { period: number; total: number }
  createdAt: string
  effectiveAccounts?: EffectiveAccount[]
}

/**
 * 応答したときに行うことを、短い言葉で並べる。
 *
 * 一覧に「タグを追加 → テキストを送信」と出す。設定を開かずに何をするルールか
 * 読めるようにするため。Lステップの一覧も同じ出し方をしている。
 */
const ACTION_SUMMARY_LABELS: Record<string, string> = {
  tag: 'タグ',
  friend_field: '友だち情報',
  support_mark: '対応マーク',
  scenario: 'シナリオ',
  common_var: '共通情報',
}

function actionSummary(rule: { actions: unknown[] | null }): string[] {
  if (!Array.isArray(rule.actions)) return []
  return rule.actions.flatMap((item): string[] => {
    if (!item || typeof item !== 'object') return []
    const r = item as Record<string, unknown>
    const type = r.actionType ?? r.action_type
    if (typeof type !== 'string') return []
    return [ACTION_SUMMARY_LABELS[type] ?? type]
  })
}

interface TemplateLite {
  id: string
  name: string
  messageType: string
  messageContent: string
}

const matchTypeLabel: Record<'exact' | 'contains', string> = { exact: '完全一致', contains: '包含' }

/**
 * 設定してある条件をその場で読める形にする。
 * 条件が無いものは何も出さない。「条件なし」と書くと、条件付きの行が
 * 埋もれてしまう。
 */
function conditionChips(r: AutoReply) {
  const chips: string[] = []
  if (r.activeFrom || r.activeUntil) {
    chips.push(`${r.activeFrom ?? ''}〜${r.activeUntil ?? ''}`)
  }
  if (r.cooldownMinutes) chips.push(`${r.cooldownMinutes}分あけて`)
  if (r.skipWhenOperatorActive) chips.push('対応中は止める')
  if (r.messageKinds && r.messageKinds.length > 0) {
    chips.push(`${r.messageKinds.join('・')}のみ`)
  }
  return chips
}

export default function AutoRepliesPage() {
  const { selectedAccountId, accounts } = useAccount()
  const [items, setItems] = useState<AutoReply[]>([])
  const [query, setQuery] = useState('')
  const [templates, setTemplates] = useState<TemplateLite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<AutoReplyDraft | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [arRes, tplRes] = await Promise.all([
        api.autoReplies.list({ accountId: selectedAccountId || undefined }),
        api.templates.list(),
      ])
      if (arRes.success) setItems(arRes.data)
      if (tplRes.success) setTemplates(tplRes.data.map((t) => ({
        id: t.id,
        name: t.name,
        messageType: t.messageType,
        messageContent: t.messageContent,
      })))
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => { load() }, [load])

  const templateById = new Map(templates.map((t) => [t.id, t]))
  const accountById = new Map(accounts.map((a) => [a.id, a]))

  const renderEffectiveCell = (r: AutoReply) => {
    if (!r.effectiveAccounts || r.effectiveAccounts.length === 0) {
      // 古い shape の fallback (effectiveAccounts 計算前)
      if (!r.lineAccountId) return <span className="text-ink-faint italic">全アカウント</span>
      const acc = accountById.get(r.lineAccountId)
      return <span className="text-ink-secondary">{acc?.displayName ?? acc?.name ?? r.lineAccountId.slice(0, 8)}</span>
    }
    return (
      <div className="flex flex-wrap gap-1">
        {r.effectiveAccounts.map((ea) => {
          const acc = accountById.get(ea.accountId)
          const label = acc?.displayName ?? acc?.name ?? ea.accountName
          if (ea.status === 'not_applicable') {
            return (
              <span
                key={ea.accountId}
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-canvas-sunken text-gray-300 line-through"
                title={`${label}: 適用外 (line_account_id 別アカ固定)`}
              >
                {label}
              </span>
            )
          }
          if (ea.status === 'reply') {
            return (
              <span
                key={ea.accountId}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-success-bg text-green-700 font-medium"
                title={`${label}: 返信あり (${ea.via === 'automation' ? 'automation 経由' : 'inline'})`}
              >
                ✓ {label}{ea.via === 'automation' && <span className="text-green-500">⚙</span>}
              </span>
            )
          }
          // silent
          return (
            <span
              key={ea.accountId}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-amber-50 text-amber-700"
              title={`${label}: silent (match するが返信なし — automation rule 未登録)`}
            >
              ⚠ {label}
            </span>
          )
        })}
      </div>
    )
  }

  const renderResponseCell = (r: AutoReply) => {
    if (r.responseType === 'silent') return <span className="text-ink-faint text-xs">silent</span>
    if (r.responseType === 'flex') return <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 text-[10px] font-medium">flex</span>
    if (r.responseType === 'image') return <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px] font-medium">image</span>
    return <span className="px-1.5 py-0.5 rounded bg-canvas-sunken text-ink-secondary text-[10px] font-medium">text</span>
  }

  const renderTemplateCell = (r: AutoReply) => {
    if (!r.templateId) return <span className="text-[11px] text-ink-faint italic">(inline)</span>
    const tpl = templateById.get(r.templateId)
    return (
      <a href="/templates" className="text-blue-600 hover:underline text-xs">
        {tpl?.name ?? `(未知 ${r.templateId.slice(0, 6)})`}
      </a>
    )
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このルールを削除しますか？')) return
    try {
      await api.autoReplies.delete(id)
      load()
    } catch {
      setError('削除に失敗しました')
    }
  }

  // ヒット数の合計（152）。KPI に出す。
  const monthlyHits = items.reduce((sum, r) => sum + (r.hits?.period ?? 0), 0)
  const totalHits = items.reduce((sum, r) => sum + (r.hits?.total ?? 0), 0)
  // 曜日か時間帯を決めているルール。「営業時間外だけ返す」の類がいくつあるか。
  const timeRestrictedCount = items.filter(
    (r) => r.activeFrom || r.activeUntil || (r.responseWeekdays?.length ?? 0) > 0,
  ).length
  const neverHitCount = items.filter((r) => (r.hits?.total ?? 0) === 0).length

  // キーワードと返す本文の両方を見る。名前を付けていないルールは
  // キーワードでしか探せない。
  const q = query.trim()
  const shown = q
    ? items.filter(
        (r) => r.keyword.includes(q) || (r.responseContent ?? '').includes(q),
      )
    : items

  return (
    <div>
      <div data-design="Head">
      <Header
        title="自動応答"
        description="受信したメッセージに自動で返します。キーワード・メッセージ種別・曜日や時間帯・友だち条件で出し分けできます。"
        action={
          <div className="flex flex-wrap gap-2">
          <button
            disabled
            title="マニュアルは準備中です"
            className="border-hairline text-ink-faint rounded-control border px-4 py-2 text-sm font-medium opacity-50"
          >
            マニュアル
          </button>
          <button
            disabled
            title="並び替えは準備中です"
            className="border-hairline text-ink-faint rounded-control border px-4 py-2 text-sm font-medium opacity-50"
          >
            並び替え
          </button>
          {/* 自動応答にフォルダを持たせる列が無い。 */}
          <button
            disabled
            title="フォルダは準備中です"
            className="border-hairline text-ink-faint rounded-control border px-4 py-2 text-sm font-medium opacity-50"
          >
            フォルダを追加
          </button>
          <button
            onClick={() => setEditing({
              keyword: '',
              matchType: 'exact',
              responseType: 'text',
              responseContent: '',
              templateId: null,
              lineAccountId: selectedAccountId,
              isActive: true,
            })}
            className="bg-accent text-on-accent transition-colors hover:bg-accent-hover rounded-control px-4 py-2 text-sm font-medium"
          >
            自動応答を作成
          </button>
          </div>
        }
      />
      </div>

      <div data-design="KPIs" className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">ルール</p>
          <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
            {items.length}
            <span className="text-ink-faint ml-0.5 text-xs font-normal">件</span>
          </p>
          <p className="text-ink-faint mt-0.5 text-xs">
            停止中 {items.filter((r) => !r.isActive).length}
          </p>
        </div>
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">今月のヒット</p>
          <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
            {monthlyHits}
            <span className="text-ink-faint ml-0.5 text-xs font-normal">回</span>
          </p>
          <p className="text-ink-faint mt-0.5 text-xs">
            累計 {totalHits} 回・ヒット数はルールごとに数えます
          </p>
        </div>
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">営業時間外の応答</p>
          <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
            {timeRestrictedCount}
            <span className="text-ink-faint ml-0.5 text-xs font-normal">件</span>
          </p>
          <p className="text-ink-faint mt-0.5 text-xs">曜日か時間帯を決めているルール</p>
        </div>
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">未ヒット</p>
          <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
            {neverHitCount}
            <span className="text-ink-faint ml-0.5 text-xs font-normal">件</span>
          </p>
          <p className="text-ink-faint mt-0.5 text-xs">
            一度も当たっていないルール（30日以上の絞り込みは準備中）
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-danger-bg border border-danger-bg rounded-lg text-danger text-sm">
          {error}
        </div>
      )}

      {/* 複数当てはまったときの挙動。書いていないと必ず問い合わせになる。 */}
      <div className="bg-info-bg text-info mb-4 rounded-lg p-3 text-xs leading-relaxed">
        上にあるルールから順に見て、<strong>最初に当てはまった1つだけ</strong>が動きます。
        時間帯や連投の設定で見送られたときは、その次のルールを見ます。
        並び順は「評価順」の数字で決まり、小さいほど先に見ます。
      </div>

      <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800 space-y-1">
        <p><span className="inline-flex items-center px-1.5 py-0.5 rounded bg-success-bg text-green-700">✓ アカ名</span> 返信あり (inline) / <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-success-bg text-green-700">✓ アカ名 ⚙</span> automation 経由</p>
        <p><span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">⚠ アカ名</span> silent rule のみ — match するが返信しない (同 keyword の automation rule 未登録)</p>
        <p><span className="inline-flex items-center px-1.5 py-0.5 rounded bg-canvas-sunken text-gray-300 line-through">アカ名</span> 適用外 (line_account_id が別アカに固定)</p>
      </div>

      <div
        data-design="Bar"
        className="bg-canvas rounded-card border-hairline mb-3 flex flex-wrap items-center gap-2 border p-3"
      >
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="自動応答名で検索"
          aria-label="自動応答名で検索"
          className="border-hairline rounded-control focus:ring-accent min-w-0 flex-1 border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
        />
        <span className="text-ink-faint text-xs whitespace-nowrap">並び順</span>
        <select
          disabled
          title="並び替えは準備中です"
          className="border-hairline rounded-control border px-2 py-2 text-sm opacity-50"
        >
          <option>ヒット数が多い順</option>
        </select>
        <span className="text-ink-faint text-xs whitespace-nowrap">表示</span>
        <select
          disabled
          title="表示件数の切り替えは準備中です"
          className="border-hairline rounded-control border px-2 py-2 text-sm opacity-50"
        >
          <option>20件</option>
        </select>
      </div>

      <div data-design="Saved" className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-ink-faint text-xs whitespace-nowrap">保存した条件</span>
        {['よく使う', '停止中のみ', '時間帯あり', '未ヒット'].map((label) => (
          <button
            key={label}
            disabled
            title="保存した条件は準備中です"
            className="border-hairline text-ink-faint rounded-pill border px-3 py-1 text-xs opacity-50"
          >
            {label}
          </button>
        ))}
      </div>

      <div data-design="Table" className="bg-canvas rounded-card border border-hairline overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px]">
            <thead>
              <tr className="bg-canvas-sunken border-b border-hairline">
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase">評価順</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase">自動応答名</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase">一致のしかた</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase">実行するアクション</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase">template</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase">応答条件</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase">適用アカウント</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase">ヒット数</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase">状態</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-ink-faint text-sm">読み込み中...</td></tr>
              ) : shown.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-ink-faint text-sm">自動返信ルールがありません</td></tr>
              ) : (
                shown.map((r) => (
                  <tr key={r.id} className="hover:bg-canvas-sunken">
                    <td className="px-4 py-3 text-sm text-ink-secondary tabular-nums">{r.priority}</td>
                    <td className="px-4 py-3 text-sm font-medium text-ink">
                      {r.respondToAll ? (
                        <span className="text-ink-secondary">すべてのメッセージ</span>
                      ) : (
                        r.keyword
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-secondary">{matchTypeLabel[r.matchType]}</td>
                    <td className="px-4 py-3">
                      <div className="space-y-0.5">
                        {renderResponseCell(r)}
                        {actionSummary(r).length > 0 && (
                          <div className="text-ink-secondary flex flex-wrap items-center gap-1 text-[11px]">
                            {actionSummary(r).map((label, i) => (
                              <span key={i} className="whitespace-nowrap">
                                {i > 0 && <span className="text-ink-faint mr-1">→</span>}
                                {label}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">{renderTemplateCell(r)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {conditionChips(r).map((label) => (
                          <span
                            key={label}
                            className="bg-canvas-sunken text-ink-secondary rounded-pill px-1.5 py-0.5 text-[10px] whitespace-nowrap"
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">{renderEffectiveCell(r)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-ink text-sm tabular-nums">{r.hits?.period ?? 0}</span>
                      <span className="text-ink-faint text-xs">回</span>
                      <span className="text-ink-faint ml-1 text-[10px]">
                        （累計 {r.hits?.total ?? 0}）
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${r.isActive ? 'bg-success-bg text-green-700' : 'bg-canvas-sunken text-ink-faint'}`}>
                        {r.isActive ? '有効' : '無効'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => setEditing({
                          id: r.id,
                          keyword: r.keyword,
                          matchType: r.matchType,
                          responseType: r.responseType,
                          responseContent: r.responseContent,
                          templateId: r.templateId,
                          lineAccountId: r.lineAccountId,
                          isActive: r.isActive,
                          priority: r.priority,
                          messageKinds: r.messageKinds,
                          respondToAll: r.respondToAll,
                          activeFrom: r.activeFrom,
                          activeUntil: r.activeUntil,
                          cooldownMinutes: r.cooldownMinutes,
                          skipWhenOperatorActive: r.skipWhenOperatorActive,
                          actions: r.actions,
                          responseWeekdays: r.responseWeekdays,
                          responseHolidayRule: r.responseHolidayRule,
                          oncePerFriend: r.oncePerFriend,
                          keywords: r.keywords,
                          friendConditions: r.friendConditions,
                        })}
                        className="px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-md"
                      >
                        編集
                      </button>
                      <button
                        onClick={() => handleDelete(r.id)}
                        className="ml-1 px-2.5 py-1 text-xs font-medium text-red-500 hover:bg-danger-bg rounded-md"
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <EditDialog
          draft={editing}
          templates={templates}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}
    </div>
  )
}
