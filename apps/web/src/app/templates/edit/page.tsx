'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'
import { Field, inputClass } from '@/components/shared/create-page'

const TYPES = [
  { value: 'text', label: 'テキスト' },
  { value: 'flex', label: 'Flex（JSON）' },
  { value: 'image', label: '画像' },
]

function TemplateEditInner() {
  const router = useRouter()
  const params = useSearchParams()
  const id = params.get('id')

  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [messageType, setMessageType] = useState('text')
  const [messageContent, setMessageContent] = useState('')
  const [loading, setLoading] = useState(Boolean(id))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    void api.templates
      .get(id)
      .then((res) => {
        if (res.success) {
          setName(res.data.name)
          setCategory(res.data.category ?? '')
          setMessageType(res.data.messageType)
          setMessageContent(res.data.messageContent)
        }
      })
      .finally(() => setLoading(false))
  }, [id])

  const save = async () => {
    if (!name.trim()) {
      setError('名前を入力してください')
      return
    }
    if (!messageContent.trim()) {
      setError('中身を入力してください')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = id
        ? await api.templates.update(id, { name: name.trim(), category, messageType, messageContent })
        : await api.templates.create({ name: name.trim(), category, messageType, messageContent })
      if (!res.success) {
        setError(res.error)
        return
      }
      router.push('/templates')
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <Header
        title={id ? 'テンプレートを編集' : 'テンプレートを作る'}
        description="何度も送る文面を保存しておきます。"
      />

      <nav className="text-ink-faint mb-4 text-xs">
        <Link href="/templates" className="hover:underline">
          テンプレート
        </Link>
        <span className="mx-1.5">›</span>
        <span>{id ? '編集' : '作成'}</span>
      </nav>

      {loading ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          読み込み中...
        </div>
      ) : (
        <div className="bg-canvas rounded-card border-hairline max-w-3xl space-y-5 border p-6">
          <Field label="名前" htmlFor="tp-name" required>
            <input
              id="tp-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="分類" htmlFor="tp-category" note="一覧での並びに使います。">
            <input
              id="tp-category"
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={inputClass}
            />
          </Field>

          <Field
            label="種類"
            htmlFor="tp-type"
            note={
              id ? '作ったあとに種類を変えると、中身の書き方も変える必要があります。' : undefined
            }
          >
            <select
              id="tp-type"
              value={messageType}
              onChange={(e) => setMessageType(e.target.value)}
              className={inputClass}
            >
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="中身"
            htmlFor="tp-content"
            required
            note={
              <>
                差し込みが使えます。{'{{name}}'} は友だちの表示名、
                {'{{field.差し込み名}}'} は友だち情報欄、{'{{var.差し込み名}}'} は共通情報です。
                <br />
                カルーセルを作るときは{' '}
                <Link href="/templates/carousel" className="text-accent hover:underline">
                  カルーセルの編集
                </Link>{' '}
                を使ってください。
              </>
            }
          >
            <textarea
              id="tp-content"
              rows={messageType === 'flex' ? 14 : 6}
              value={messageContent}
              onChange={(e) => setMessageContent(e.target.value)}
              className={`${inputClass} resize-y ${messageType === 'flex' ? 'font-mono text-xs' : ''}`}
            />
          </Field>

          {error && <p className="text-danger text-sm">{error}</p>}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="bg-accent text-on-accent hover:bg-accent-hover rounded-control px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40"
            >
              {saving ? '保存中...' : '保存'}
            </button>
            <Link
              href="/templates"
              className="text-ink-secondary bg-canvas-sunken hover:bg-hairline rounded-control px-4 py-2 text-sm font-medium"
            >
              キャンセル
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

export default function TemplateEditPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <TemplateEditInner />
    </Suspense>
  )
}
