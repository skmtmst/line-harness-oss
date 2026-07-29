'use client'

import { useCallback, useEffect, useState } from 'react'
import Header from '@/components/layout/header'
import { bookingApi, type BookingConsent } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

export default function BookingConsentPage() {
  const { selectedAccountId } = useAccount()
  const [draft, setDraft] = useState<BookingConsent | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!selectedAccountId) {
      setDraft(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await bookingApi.getConsent(selectedAccountId)
      setDraft(result.consent)
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
    if (!selectedAccountId || !draft) return
    if (!draft.title.trim() || !draft.body.trim()) {
      setError('タイトルと本文を入力してください')
      return
    }
    setSaving(true)
    setMessage(null)
    setError(null)
    try {
      const result = await bookingApi.updateConsent(selectedAccountId, {
        title: draft.title,
        body: draft.body,
        is_required: draft.is_required === 1,
        is_active: draft.is_active === 1,
      })
      setDraft(result.consent)
      setMessage(`保存しました（版 ${result.consent.version}）`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <Header
        title="同意書設定"
        description="予約確認画面に表示する注意事項と、同意チェックの必須設定を管理します"
      />

      {!selectedAccountId ? (
        <div className="rounded-lg border border-gray-200 bg-white p-12 text-center text-sm text-gray-500">
          サイドバーでLINEアカウントを選択してください
        </div>
      ) : loading || !draft ? (
        <div className="rounded-lg border border-gray-200 bg-white p-12 text-center text-sm text-gray-500">
          読み込み中…
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-gray-900">同意書の内容</h2>
                <p className="mt-1 text-xs text-gray-500">
                  保存するたびに版番号が上がり、お客様が同意した当時の文面は予約に保存されます。
                </p>
              </div>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
                現在の版 {draft.version}
              </span>
            </div>

            <label className="mb-5 block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700">見出し</span>
              <input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                maxLength={120}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-100"
              />
            </label>

            <label className="mb-5 block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700">本文</span>
              <textarea
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                maxLength={10000}
                rows={16}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm leading-7 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-100"
              />
              <span className="mt-1 block text-right text-xs text-gray-400">{draft.body.length} / 10,000</span>
            </label>

            <div className="mb-6 space-y-3">
              <Toggle
                checked={draft.is_active === 1}
                title="予約確認画面に表示する"
                description="OFFの場合、同意書とチェック欄を表示しません。"
                onChange={(checked) => setDraft({ ...draft, is_active: checked ? 1 : 0 })}
              />
              <Toggle
                checked={draft.is_required === 1}
                disabled={draft.is_active !== 1}
                title="同意チェックを必須にする"
                description="チェックするまで予約リクエストを送信できません。"
                onChange={(checked) => setDraft({ ...draft, is_required: checked ? 1 : 0 })}
              />
            </div>

            {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
            {message && <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">{message}</div>}
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="rounded-lg bg-green-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
            >
              {saving ? '保存中…' : '同意書を保存'}
            </button>
          </section>

          <aside className="self-start rounded-[28px] border-8 border-gray-900 bg-white p-5 shadow-xl xl:sticky xl:top-6">
            <p className="mb-4 text-center text-xs font-semibold text-gray-500">お客様画面プレビュー</p>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <h3 className="mb-3 text-sm font-bold text-slate-800">{draft.title}</h3>
              <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-xl bg-white p-3 text-xs leading-6 text-gray-600">
                {draft.body}
              </div>
              {draft.is_active === 1 && (
                <label className="mt-4 flex items-start gap-2 text-sm font-semibold text-slate-700">
                  <input type="checkbox" disabled className="mt-0.5 h-5 w-5" />
                  <span>{draft.title}に同意する{draft.is_required === 1 && <em className="ml-1 not-italic text-orange-600">必須</em>}</span>
                </label>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}

function Toggle({
  checked,
  disabled,
  title,
  description,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  title: string
  description: string
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-4">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-green-600 disabled:opacity-40"
      />
      <span>
        <span className="block text-sm font-medium text-gray-800">{title}</span>
        <span className="mt-1 block text-xs text-gray-500">{description}</span>
      </span>
    </label>
  )
}
