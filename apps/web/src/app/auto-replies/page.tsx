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
  createdAt: string
  effectiveAccounts?: EffectiveAccount[]
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
  return chips
}

export default function AutoRepliesPage() {
  const { selectedAccountId, accounts } = useAccount()
  const [items, setItems] = useState<AutoReply[]>([])
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
    if (r.responseType === 'flex') return <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 text-[10px] font-medium">📋 flex</span>
    if (r.responseType === 'image') return <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px] font-medium">🖼️ image</span>
    return <span className="px-1.5 py-0.5 rounded bg-canvas-sunken text-ink-secondary text-[10px] font-medium">📝 text</span>
  }

  const renderTemplateCell = (r: AutoReply) => {
    if (!r.templateId) return <span className="text-[11px] text-ink-faint italic">(inline)</span>
    const tpl = templateById.get(r.templateId)
    return (
      <a href="/templates" className="text-blue-600 hover:underline text-xs">
        🔗 {tpl?.name ?? `(未知 ${r.templateId.slice(0, 6)})`}
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

  return (
    <div>
      <Header
        title="自動返信ルール"
        action={
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
            + 新規ルール
          </button>
        }
      />

      {error && (
        <div className="mb-4 p-4 bg-danger-bg border border-danger-bg rounded-lg text-danger text-sm">
          {error}
        </div>
      )}

      <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800 space-y-1">
        <p><span className="inline-flex items-center px-1.5 py-0.5 rounded bg-success-bg text-green-700">✓ アカ名</span> 返信あり (inline) / <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-success-bg text-green-700">✓ アカ名 ⚙</span> automation 経由</p>
        <p><span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">⚠ アカ名</span> silent rule のみ — match するが返信しない (同 keyword の automation rule 未登録)</p>
        <p><span className="inline-flex items-center px-1.5 py-0.5 rounded bg-canvas-sunken text-gray-300 line-through">アカ名</span> 適用外 (line_account_id が別アカに固定)</p>
      </div>

      <div className="bg-canvas rounded-card border border-hairline overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px]">
            <thead>
              <tr className="bg-canvas-sunken border-b border-hairline">
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase">keyword</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase">match</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase">response</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase">template</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase">返す条件</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase">適用アカウント</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint uppercase">状態</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-ink-faint text-sm">読み込み中...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-ink-faint text-sm">自動返信ルールがありません</td></tr>
              ) : (
                items.map((r) => (
                  <tr key={r.id} className="hover:bg-canvas-sunken">
                    <td className="px-4 py-3 text-sm font-medium text-ink">{r.keyword}</td>
                    <td className="px-4 py-3 text-xs text-ink-secondary">{matchTypeLabel[r.matchType]}</td>
                    <td className="px-4 py-3">{renderResponseCell(r)}</td>
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
                          activeFrom: r.activeFrom,
                          activeUntil: r.activeUntil,
                          cooldownMinutes: r.cooldownMinutes,
                          skipWhenOperatorActive: r.skipWhenOperatorActive,
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
