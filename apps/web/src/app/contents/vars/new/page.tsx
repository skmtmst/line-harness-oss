'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { api, ApiError } from '@/lib/api'
import Header from '@/components/layout/header'

const TYPES: Array<{ key: string; label: string; note: string }> = [
  { key: 'text', label: '文字', note: '営業時間、あいさつ文など' },
  { key: 'url', label: 'URL', note: '予約ページ、地図など' },
  { key: 'image', label: '画像のURL', note: 'ロゴ、バナーなど' },
  { key: 'number', label: '数値', note: '料金、人数など' },
]

/**
 * 名前から差し込み名の候補を作る。
 *
 * 日本語からは作れないので、その場合は空にして人に決めてもらう。
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

export default function NewCommonVarPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [varKey, setVarKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [type, setType] = useState('text')
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async (andAnother: boolean) => {
    if (saving) return
    if (!name.trim()) {
      setError('名前を入力してください')
      return
    }
    if (!varKey.trim()) {
      setError('差し込み名を入力してください')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await api.commonVars.create({
        name: name.trim(),
        varKey: varKey.trim(),
        type,
        value,
      })
      if (!res.success) {
        setError(res.error)
        return
      }
      if (andAnother) {
        setName('')
        setVarKey('')
        setKeyTouched(false)
        setValue('')
        return
      }
      router.push('/contents?tab=vars')
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
      <Header
        title="共通情報を追加"
        description="「ブランド名」「営業時間」など、何度も使う情報を1か所にまとめます。テンプレートに差し込めるので、変更は1か所で済みます。"
      />

      <nav className="text-ink-faint mb-4 text-xs">
        <Link href="/contents?tab=vars" className="hover:underline">
          コンテンツ
        </Link>
        <span className="mx-1.5">›</span>
        <span>共通情報を追加</span>
      </nav>

      <div className="bg-canvas rounded-card border-hairline max-w-2xl space-y-5 border p-6">
        <p className="text-ink text-sm font-semibold">1. どの情報か</p>
        <div>
          <label htmlFor="cv-name" className="text-ink-secondary mb-1 block text-sm font-medium">
            共通情報名 <span className="text-danger">*</span>
          </label>
          <input
            id="cv-name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (!keyTouched) setVarKey(suggestKey(e.target.value))
            }}
            placeholder="例: 営業時間"
            className="border-hairline rounded-control focus:ring-accent w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
          />
          <p className="text-ink-faint mt-1 text-xs">画面に出る名前です。日本語で構いません。</p>
        </div>

        <div>
          <label htmlFor="cv-key" className="text-ink-secondary mb-1 block text-sm font-medium">
            差し込みキー <span className="text-danger">*</span>
          </label>
          <input
            id="cv-key"
            type="text"
            value={varKey}
            onChange={(e) => {
              setKeyTouched(true)
              setVarKey(e.target.value)
            }}
            placeholder="shop_hours"
            className="border-hairline rounded-control focus:ring-accent w-full border px-3 py-2 font-mono text-sm focus:ring-2 focus:outline-none"
          />
          <p className="text-ink-faint mt-1 text-xs leading-relaxed">
            半角の英小文字で始め、英小文字・数字・下線だけ、32文字まで。
            {varKey && (
              <>
                <br />
                テンプレートには{' '}
                <code className="bg-canvas-sunken rounded px-1">{`{{var.${varKey}}}`}</code> と書きます。
              </>
            )}
            <br />
            <strong>あとから変えられません。</strong>
            変えるとテンプレートの差し込みが空になるためです。
          </p>
        </div>

        <div>
          <label htmlFor="cv-type" className="text-ink-secondary mb-1 block text-sm font-medium">
            種類
          </label>
          <select
            id="cv-type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="border-hairline rounded-control border px-3 py-2 text-sm"
          >
            {TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
          <p className="text-ink-faint mt-1 text-xs">
            {TYPES.find((t) => t.key === type)?.note}
          </p>
        </div>

        <div>
          <label htmlFor="cv-value" className="text-ink-secondary mb-1 block text-sm font-medium">
            いまの値
          </label>
          <input
            id="cv-value"
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="例: 10時〜19時（水曜定休）"
            className="border-hairline rounded-control w-full border px-3 py-2 text-sm"
          />
          <p className="text-ink-faint mt-1 text-xs">
            あとから変えられます。日付を決めて自動で切り替えることもできます。
          </p>
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
            href="/contents?tab=vars"
            className="text-ink-secondary bg-canvas-sunken hover:bg-hairline rounded-control px-4 py-2 text-sm font-medium"
          >
            キャンセル
          </Link>
        </div>
        {/* 日付で値を切り替える仕組みが無い。値は1つだけ持つ。 */}
        <section className="border-hairline rounded-card border p-4">
          <p className="text-ink text-sm font-semibold">2. 日付で切り替える</p>
          <p className="text-ink-faint mt-1 text-xs leading-relaxed">
            決めた日から自動で値を変える設定は、いまはありません。値は1つだけ持ちます。切り替えたい日に、この画面から書き換えてください。
          </p>
        </section>
      </div>
    </div>
  )
}
