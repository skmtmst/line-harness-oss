'use client'

import { useState } from 'react'
import { api, ApiError } from '@/lib/api'
import type { EntryRouteGenre } from '@line-crm/shared'

export default function GenreModal({
  genre,
  onClose,
  onSaved,
}: {
  genre: EntryRouteGenre | null
  onClose: () => void
  onSaved: (genre: EntryRouteGenre, previousName: string | null) => void
}) {
  const [name, setName] = useState(genre?.name ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    const normalized = name.trim()
    if (!normalized) return
    setSubmitting(true)
    setError('')
    try {
      const response = genre
        ? await api.entryRouteGenres.update(genre.id, normalized)
        : await api.entryRouteGenres.create(normalized)
      if (!response.success) {
        setSubmitting(false)
        setError(response.error || 'ジャンルの保存に失敗しました。')
        return
      }
      onSaved(response.data, genre?.name ?? null)
    } catch (err) {
      setSubmitting(false)
      setError(err instanceof ApiError && err.status === 409
        ? '同じ名前のジャンルが既にあります。'
        : 'ジャンルの保存に失敗しました。')
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h2 className="text-lg font-bold text-gray-900">
          {genre ? 'ジャンル名を編集' : '新しいジャンル'}
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          協力会社名や媒体グループなど、リンクをまとめる名前を入力してください。
        </p>
        {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <label className="mt-5 block text-sm font-medium text-gray-700" htmlFor="new-referral-genre">
          ジャンル名
        </label>
        <input
          id="new-referral-genre"
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && name.trim() && !submitting) save()
          }}
          maxLength={80}
          placeholder="例: A店"
          className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
        />
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-gray-600">
            キャンセル
          </button>
          <button
            onClick={save}
            disabled={!name.trim() || submitting}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {submitting ? '保存中…' : genre ? '変更を保存' : 'ジャンルを作成'}
          </button>
        </div>
      </div>
    </div>
  )
}
