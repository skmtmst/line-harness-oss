'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Folder } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import StickyBar from '@/components/shared/sticky-bar'

/**
 * 共通情報の登録。
 *
 * Lステップの「共通情報登録」と同じ形。名前とフォルダを上に並べ、種別を
 * カードのラジオで選び、選んだ種別に合わせて値の入力欄の例が変わる。
 * 種別は登録後に変えられない（値の意味が変わるため）ので、その断りを
 * 見出しの横に出す。
 */

const TYPES: Array<{ key: string; label: string; mark: string; note: string; placeholder: string }> = [
  {
    key: 'text',
    label: '標準',
    mark: 'ああ',
    note: '電話番号、営業時間など固定の文字列を表示させたい時に選択します。',
    placeholder: '10:00-18:00、集客セミナー',
  },
  {
    key: 'number',
    label: '数値',
    mark: '+1',
    note: 'スケジュール更新で値を書き換えたい時に選択します。',
    placeholder: '10、124.3、30000',
  },
  {
    key: 'url',
    label: 'URL',
    mark: 'URL',
    note: '予約ページや地図など、リンク先を差し込みたい時に選択します。',
    placeholder: 'https://example.com/reserve',
  },
  {
    key: 'image',
    label: '画像',
    mark: 'IMG',
    note: 'ロゴやバナーなど、画像のURLを差し込みたい時に選択します。',
    placeholder: 'https://example.com/logo.png',
  },
]

const NAME_MAX = 200
const VALUE_MAX = 200

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
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const latestAccountRef = useRef(selectedAccountId)
  latestAccountRef.current = selectedAccountId
  const router = useRouter()
  const [folders, setFolders] = useState<Folder[]>([])
  const [name, setName] = useState('')
  const [folderId, setFolderId] = useState('')
  const [varKey, setVarKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [type, setType] = useState('text')
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void api.folders
      .list('common_var')
      .then((res) => {
        if (res.success) setFolders(res.data)
      })
      .catch(() => {
        // フォルダが読めなくても登録はできる（未分類になる）。
      })
  }, [])

  const spec = TYPES.find((t) => t.key === type)!

  const save = async () => {
    if (saving) return
    if (!selectedAccountId) {
      setError('LINEアカウントを選択してください')
      return
    }
    const accountAtRequest = selectedAccountId
    if (!name.trim()) {
      setError('共通情報名を入力してください')
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
        accountId: accountAtRequest,
        name: name.trim(),
        varKey: varKey.trim(),
        type,
        value,
        folderId: folderId || null,
      })
      if (accountAtRequest !== latestAccountRef.current) return
      if (!res.success) {
        setError(res.error)
        return
      }
      router.push('/contents/vars')
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
      {!accountLoading && !selectedAccountId && (
        <div className="bg-warning-bg text-warning mb-4 max-w-3xl rounded-card p-4 text-sm">
          共通情報を登録するLINEアカウントを選択してください。
        </div>
      )}
      <nav className="text-ink-faint mb-3 text-xs">
        <Link href="/contents/vars" className="text-info hover:underline">
          共通情報一覧
        </Link>
        <span className="mx-1.5">›</span>
        <span>共通情報登録</span>
      </nav>

      <div className="bg-canvas rounded-card border-hairline max-w-3xl space-y-6 border p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="cv-name" className="text-ink-secondary mb-1 block text-sm font-medium">
              共通情報名 <span className="text-danger">*</span>
            </label>
            <input
              id="cv-name"
              type="text"
              maxLength={NAME_MAX}
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (!keyTouched) setVarKey(suggestKey(e.target.value))
              }}
              placeholder="営業時間、予約受付人数、連絡先、店のオープン日"
              className="border-hairline rounded-control focus:ring-accent w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
            />
            <p className="text-ink-faint mt-1 text-right text-xs tabular-nums">
              {name.length}/{NAME_MAX}
            </p>
          </div>

          <div>
            <label htmlFor="cv-folder" className="text-ink-secondary mb-1 block text-sm font-medium">
              フォルダ
            </label>
            <select
              id="cv-folder"
              value={folderId}
              onChange={(e) => setFolderId(e.target.value)}
              className="border-hairline rounded-control w-full border px-3 py-2 text-sm"
            >
              <option value="">未分類</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="cv-key" className="text-ink-secondary mb-1 block text-sm font-medium">
            差し込み名 <span className="text-danger">*</span>
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
            className="border-hairline rounded-control focus:ring-accent w-full max-w-sm border px-3 py-2 font-mono text-sm focus:ring-2 focus:outline-none"
          />
          <p className="text-ink-faint mt-1 text-xs leading-relaxed">
            半角の英小文字で始め、英小文字・数字・下線だけ、32文字まで。
            {varKey && (
              <>
                <br />
                テンプレートには{' '}
                <code className="bg-canvas-sunken rounded px-1">{`{{var.${varKey}}}`}</code>{' '}
                と書きます。
              </>
            )}
            <br />
            <strong>あとから変えられません。</strong>
            変えるとテンプレートの差し込みが空になるためです。
          </p>
        </div>

        <fieldset>
          <legend className="text-ink-secondary mb-2 text-sm font-medium">
            種別{' '}
            <span className="text-ink-faint text-xs font-normal">※新規登録後は変更できません。</span>
          </legend>
          <div className="max-w-xl space-y-2">
            {TYPES.map((t) => (
              <label
                key={t.key}
                className={`rounded-control flex cursor-pointer items-center gap-3 border p-3 transition-colors ${
                  type === t.key
                    ? 'border-accent bg-accent-soft'
                    : 'border-hairline hover:bg-canvas-sunken'
                }`}
              >
                <input
                  type="radio"
                  name="cv-type"
                  value={t.key}
                  checked={type === t.key}
                  onChange={() => {
                    setType(t.key)
                    setValue('')
                  }}
                  className="accent-green-500"
                />
                <span
                  className="bg-canvas border-hairline text-ink-secondary flex h-8 w-11 shrink-0 items-center justify-center rounded border text-xs"
                  aria-hidden="true"
                >
                  {t.mark}
                </span>
                <span className="min-w-0">
                  <span className="text-ink block text-sm font-medium">{t.label}</span>
                  <span className="text-ink-faint block text-xs">{t.note}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="cv-value" className="text-ink-secondary mb-1 block text-sm font-medium">
            値
          </label>
          <input
            id="cv-value"
            type={type === 'number' ? 'number' : 'text'}
            maxLength={type === 'number' ? undefined : VALUE_MAX}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={spec.placeholder}
            className="border-hairline rounded-control w-full max-w-md border px-3 py-2 text-sm"
          />
          {type !== 'number' && (
            <p className="text-ink-faint mt-1 max-w-md text-right text-xs tabular-nums">
              {value.length}/{VALUE_MAX}
            </p>
          )}
          <p className="text-ink-faint mt-1 text-xs">
            日付を決めて自動で書き換える設定は、登録したあとの編集画面から足せます。
          </p>
        </div>

        {error && <p className="text-danger text-sm">{error}</p>}
      </div>

      <StickyBar
        actions={(
          <>
            <Button href="/contents/vars">共通情報一覧へ戻る</Button>
            <Button type="button" variant="primary" disabled={saving} onClick={() => void save()}>
              {saving ? '登録中…' : '登録'}
            </Button>
          </>
        )}
      />
    </div>
  )
}
