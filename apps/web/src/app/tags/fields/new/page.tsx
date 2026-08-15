'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { FriendFieldType } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import Header from '@/components/layout/header'
import { FIELD_TYPE_LABELS } from '@/components/friend-fields/field-list'

const TYPES = Object.keys(FIELD_TYPE_LABELS) as FriendFieldType[]

/** 選択肢が要る種類。ここでだけ選択肢の入力欄を出す。 */
const NEEDS_OPTIONS = new Set<FriendFieldType>(['select', 'multi_select'])

/**
 * 項目名から差し込み名の候補を作る。
 *
 * 日本語の項目名からは作れないので、その場合は空のままにして人に決めてもらう。
 * 適当なローマ字を当てると、あとから読めない差し込み名が残る。
 */
function suggestKey(name: string): string {
  const ascii = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!ascii || !/^[a-z]/.test(ascii)) return ''
  return ascii.slice(0, 32)
}

function NewFriendFieldForm() {
  const router = useRouter()
  const params = useSearchParams()
  // 友だち詳細から来たときは、保存後にそこへ戻す。
  const back = params.get('back')

  const [name, setName] = useState('')
  const [fieldKey, setFieldKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [type, setType] = useState<FriendFieldType>('text')
  const [options, setOptions] = useState('')
  const [defaultValue, setDefaultValue] = useState('')
  const [isPersonal, setIsPersonal] = useState(false)
  const [isStarred, setIsStarred] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const optionList = options
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

  const save = async (andAnother: boolean) => {
    if (saving) return
    if (!name.trim()) {
      setError('項目名を入力してください')
      return
    }
    if (!fieldKey.trim()) {
      setError('差し込み名を入力してください')
      return
    }
    if (NEEDS_OPTIONS.has(type) && optionList.length === 0) {
      setError('選択肢を1つ以上入力してください')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await api.friendFields.create({
        name: name.trim(),
        fieldKey: fieldKey.trim(),
        type,
        options: NEEDS_OPTIONS.has(type) ? optionList : null,
        defaultValue: defaultValue.trim() || null,
        isPersonal,
        isStarred,
      })
      if (!res.success) {
        setError(res.error)
        return
      }
      if (andAnother) {
        // 続けて作るときは、種類と取り扱いは残す。同じ性質の項目を
        // まとめて作ることが多い。
        setName('')
        setFieldKey('')
        setKeyTouched(false)
        setOptions('')
        setDefaultValue('')
        return
      }
      router.push(back ?? `/tags?tab=fields&highlight=${res.data.id}`)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError('その差し込み名は既に使われています')
      } else if (e instanceof ApiError && e.status === 422) {
        setError(e.message)
      } else {
        setError('保存に失敗しました')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <Header title="項目を追加" description="友だちごとに持たせる情報の入れ物を作ります。" />

      <nav className="text-ink-faint mb-4 text-xs">
        <Link href="/tags?tab=fields" className="hover:underline">
          友だち属性
        </Link>
        <span className="mx-1.5">›</span>
        <span>項目を追加</span>
      </nav>

      <div className="bg-canvas rounded-card border-hairline max-w-2xl space-y-5 border p-6">
        <div>
          <label htmlFor="ff-name" className="text-ink-secondary mb-1 block text-sm font-medium">
            項目名 <span className="text-danger">*</span>
          </label>
          <input
            id="ff-name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (!keyTouched) setFieldKey(suggestKey(e.target.value))
            }}
            placeholder="例: ペットの名前"
            className="border-hairline rounded-control focus:ring-accent w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
          />
          <p className="text-ink-faint mt-1 text-xs">画面に出る名前です。日本語で構いません。</p>
        </div>

        <div>
          <label htmlFor="ff-key" className="text-ink-secondary mb-1 block text-sm font-medium">
            差し込み名 <span className="text-danger">*</span>
          </label>
          <input
            id="ff-key"
            type="text"
            value={fieldKey}
            onChange={(e) => {
              setKeyTouched(true)
              setFieldKey(e.target.value)
            }}
            placeholder="pet_name"
            className="border-hairline rounded-control focus:ring-accent w-full border px-3 py-2 font-mono text-sm focus:ring-2 focus:outline-none"
          />
          <p className="text-ink-faint mt-1 text-xs leading-relaxed">
            半角の英小文字で始め、英小文字・数字・下線だけ、32文字まで。
            {fieldKey && (
              <>
                <br />
                テンプレートには{' '}
                <code className="bg-canvas-sunken rounded px-1">{`{{field.${fieldKey}}}`}</code>{' '}
                と書きます。
              </>
            )}
            <br />
            <strong>あとから変えられません。</strong>変えるとテンプレートの差し込みが空になるためです。
          </p>
        </div>

        <div>
          <label htmlFor="ff-type" className="text-ink-secondary mb-1 block text-sm font-medium">
            種類 <span className="text-danger">*</span>
          </label>
          <select
            id="ff-type"
            value={type}
            onChange={(e) => setType(e.target.value as FriendFieldType)}
            className="border-hairline rounded-control border px-3 py-2 text-sm"
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {FIELD_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <p className="text-ink-faint mt-1 text-xs">
            <strong>あとから変えられません。</strong>すでに入っている値の意味が変わるためです。
          </p>
        </div>

        {NEEDS_OPTIONS.has(type) && (
          <div>
            <label htmlFor="ff-options" className="text-ink-secondary mb-1 block text-sm font-medium">
              選択肢 <span className="text-danger">*</span>
            </label>
            <textarea
              id="ff-options"
              rows={5}
              value={options}
              onChange={(e) => setOptions(e.target.value)}
              placeholder={'犬\n猫\nうさぎ'}
              className="border-hairline rounded-control w-full resize-y border px-3 py-2 text-sm"
            />
            <p className="text-ink-faint mt-1 text-xs">1行に1つ。あとから増やせます。</p>
          </div>
        )}

        <div>
          <label htmlFor="ff-default" className="text-ink-secondary mb-1 block text-sm font-medium">
            初期値
          </label>
          <input
            id="ff-default"
            type="text"
            value={defaultValue}
            onChange={(e) => setDefaultValue(e.target.value)}
            className="border-hairline rounded-control w-full border px-3 py-2 text-sm"
          />
          <p className="text-ink-faint mt-1 text-xs">
            値が入っていない人の差し込みに使われます。空欄なら何も入りません。
          </p>
        </div>

        <div className="border-hairline space-y-3 rounded-lg border p-3">
          <p className="text-ink-secondary text-sm font-semibold">取り扱い</p>
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={isPersonal}
              onChange={(e) => setIsPersonal(e.target.checked)}
              className="mt-0.5 rounded border-gray-300"
            />
            <span className="text-ink-secondary text-sm">
              個人情報として扱う
              <span className="text-ink-faint block text-xs">
                オーナーと管理者だけが見られます。開いたことが記録に残ります。本名・電話番号・住所など。
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={isStarred}
              onChange={(e) => setIsStarred(e.target.checked)}
              className="mt-0.5 rounded border-gray-300"
            />
            <span className="text-ink-secondary text-sm">
              よく使う項目にする
              <span className="text-ink-faint block text-xs">友だち詳細の上の方に出ます。</span>
            </span>
          </label>
        </div>

        {error && <p className="text-danger text-sm">{error}</p>}

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => save(false)}
            disabled={saving}
            className="bg-accent text-on-accent hover:bg-accent-hover rounded-control px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40"
          >
            {saving ? '保存中...' : '保存'}
          </button>
          <button
            onClick={() => save(true)}
            disabled={saving}
            className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-4 py-2 text-sm font-medium disabled:opacity-40"
          >
            保存して続けて作る
          </button>
          <Link
            href={back ?? '/tags?tab=fields'}
            className="text-ink-secondary bg-canvas-sunken rounded-control px-4 py-2 text-sm font-medium hover:bg-hairline"
          >
            キャンセル
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function NewFriendFieldPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <NewFriendFieldForm />
    </Suspense>
  )
}
