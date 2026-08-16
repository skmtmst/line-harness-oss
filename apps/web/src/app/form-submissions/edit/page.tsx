'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { FriendField, Tag } from '@line-crm/shared'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'
import { Field, inputClass } from '@/components/shared/create-page'

interface FormFieldDef {
  id?: string
  name?: string
  label?: string
  type?: string
  /** 回答の登録先。友だち情報欄の項目ID */
  friendFieldId?: string | null
}

function FormEditInner() {
  const router = useRouter()
  const params = useSearchParams()
  const id = params.get('id') ?? ''

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [fields, setFields] = useState<FormFieldDef[]>([])
  const [onSubmitTagId, setOnSubmitTagId] = useState('')
  const [tags, setTags] = useState<Tag[]>([])
  const [friendFields, setFriendFields] = useState<FriendField[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        const [tagRes, ffRes] = await Promise.all([api.tags.list(), api.friendFields.list()])
        if (tagRes.success) setTags(tagRes.data)
        if (ffRes.success) setFriendFields(ffRes.data)
        if (!id) return
        const res = await api.forms.get(id)
        if (res.success) {
          setName(res.data.name)
          setDescription(res.data.description ?? '')
          setOnSubmitTagId(res.data.onSubmitTagId ?? '')
          const raw = res.data.fields
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
          setFields(Array.isArray(parsed) ? (parsed as FormFieldDef[]) : [])
        }
      } catch {
        setError('読み込みに失敗しました')
      } finally {
        setLoading(false)
      }
    })()
  }, [id])

  const save = async () => {
    if (!name.trim()) {
      setError('フォーム名を入力してください')
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const res = await api.forms.update(id, {
        name: name.trim(),
        description: description.trim() || null,
        fields,
        onSubmitTagId: onSubmitTagId || null,
      })
      if (!res.success) {
        setError(res.error)
        return
      }
      setNotice('保存しました')
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  if (!id) {
    return (
      <div>
        <Header title="回答フォームの編集" />
        <p className="text-ink-faint bg-canvas rounded-card border-hairline border p-8 text-center text-sm">
          フォームが指定されていません。
          <Link href="/form-submissions" className="text-accent ml-1 hover:underline">
            一覧へ戻る
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div>
      <Header
        title="回答フォームの編集"
        description="項目の登録先を決めると、回答が友だち情報欄に入ります。"
      />

      <nav className="text-ink-faint mb-4 text-xs">
        <Link href="/form-submissions" className="hover:underline">
          回答フォーム
        </Link>
        <span className="mx-1.5">›</span>
        <span>編集</span>
      </nav>

      {loading ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          読み込み中...
        </div>
      ) : (
        <div className="bg-canvas rounded-card border-hairline max-w-3xl space-y-5 border p-6">
          <Field label="フォーム名" htmlFor="fm-name" required>
            <input
              id="fm-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="説明" htmlFor="fm-desc">
            <textarea
              id="fm-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={`${inputClass} resize-y`}
            />
          </Field>

          <div>
            <p className="text-ink-secondary mb-2 text-sm font-medium">項目と登録先</p>
            {fields.length === 0 ? (
              <p className="text-ink-faint text-sm">項目がありません。</p>
            ) : (
              <div className="space-y-2">
                {fields.map((field, i) => (
                  <div
                    key={field.id ?? i}
                    className="border-hairline flex flex-wrap items-center gap-3 rounded-lg border p-3"
                  >
                    <span className="text-ink min-w-[8rem] text-sm font-medium">
                      {field.label ?? field.name ?? `項目${i + 1}`}
                    </span>
                    <span className="text-ink-faint text-xs">→</span>
                    <select
                      value={field.friendFieldId ?? ''}
                      onChange={(e) =>
                        setFields((prev) =>
                          prev.map((f, j) =>
                            j === i ? { ...f, friendFieldId: e.target.value || null } : f,
                          ),
                        )
                      }
                      aria-label={`${field.label ?? field.name}の登録先`}
                      className="border-hairline rounded-control min-w-[12rem] flex-1 border px-2 py-1.5 text-sm"
                    >
                      <option value="">— 情報欄に入れない —</option>
                      {friendFields.map((ff) => (
                        <option key={ff.id} value={ff.id}>
                          {ff.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}
            <p className="text-ink-faint mt-2 text-xs leading-relaxed">
              登録先を決めると、回答が友だち情報欄に入り、友だち詳細に出て、テンプレートで差し込めるようになります。
              ECが正になっている項目には書き込まれません（次のEC同期で戻ってしまうため）。
            </p>
          </div>

          <Field
            label="回答したときに付けるタグ"
            htmlFor="fm-tag"
            note="このフォームに答えた人を、あとから絞り込めるようになります。"
          >
            <select
              id="fm-tag"
              value={onSubmitTagId}
              onChange={(e) => setOnSubmitTagId(e.target.value)}
              className={inputClass}
            >
              <option value="">— 付けない —</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>

          {error && <p className="text-danger text-sm">{error}</p>}
          {notice && <p className="text-success text-sm">{notice}</p>}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="bg-accent text-on-accent hover:bg-accent-hover rounded-control px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40"
            >
              {saving ? '保存中...' : '保存'}
            </button>
            <Link
              href="/form-submissions"
              className="text-ink-secondary bg-canvas-sunken hover:bg-hairline rounded-control px-4 py-2 text-sm font-medium"
            >
              一覧へ戻る
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

export default function FormEditPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <FormEditInner />
    </Suspense>
  )
}
