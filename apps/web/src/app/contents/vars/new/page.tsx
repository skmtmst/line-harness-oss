'use client'

import SelectField from '@/components/shared/select-field'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Folder } from '@line-crm/shared'
import { api, ApiError, describeSaveFailure } from '@/lib/api'
import { commonVarValueError, COMMON_VAR_VALUE_REQUIRED } from '@/lib/common-vars'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import FeatureGate from '@/components/feature-gate'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
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
  { key: 'long_text', label: '長文', mark: '長文', note: '案内文など、200文字を超える文章を差し込みます。', placeholder: '詳しいご案内' },
  { key: 'date', label: '年月日', mark: '日付', note: '日付を差し込みます。', placeholder: '2026-09-16' },
  { key: 'datetime', label: '日時', mark: '日時', note: '日時を差し込みます。', placeholder: '2026-09-16T10:00' },
  { key: 'boolean', label: '真偽', mark: '真偽', note: 'true または false を差し込みます。', placeholder: 'true' },
]

const NAME_MAX = 200
const VALUE_MAX = 200
const MEMO_MAX = 1000

/**
 * 秘密値ラベル(日本語)。ここに無い言い回しは検知できないため、書式側
 * (JP_SECRET_SEPARATOR / JP_SECRET_VALUE)で「限定語彙+区切り記号必須」
 * という設計そのものの弱さを補う(#687 再差し戻し)。
 */
const JP_SECRET_LABELS = [
  'パスワード', '合言葉', '暗証番号', 'ピン', 'PIN',
  '秘密鍵', 'シークレット', 'クライアントシークレット',
  'トークン', 'アクセストークン', 'リフレッシュトークン',
  'APIキー', 'API鍵', 'アクセスキー', '認証コード',
] as const

/**
 * ラベルと値の間。区切り記号(`=` `:` `：`)・空白・助詞(「は」「が」、
 * 「〜のパスワードは」のような「の」付きも可)のどれかを許し、無くても
 * 良い(「パスワードhunter2」のように直接続く自然文にも当たるため)。
 * 「」『』などの引用符も、区切りの直後にあれば読み飛ばす。
 */
const JP_SECRET_SEPARATOR = String.raw`(?:\s*[=:：]\s*|[\s　]+|の?は\s*|が\s*)?[「『"'　]*`

/**
 * 値らしいトークン。ASCII英数字始まりで4文字以上。日本語の地の文
 * (「使い方」「分かりません」など)はこの形に当たらないため、
 * 「パスワードの使い方」のような通常文では続けて誤検知しない。
 */
const JP_SECRET_VALUE = String.raw`[A-Za-z0-9][A-Za-z0-9_.+/=-]{3,}`

const SENSITIVE_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b(?:password|passwd|pwd|secret|token|api[_ -]?key|access[_ -]?key|channel[_ -]?secret)\s*[=:：]\s*\S{4,}/i,
  // 日本語のラベルは \w に含まれず \b が成立しないため、英字ラベルとは別条にする。
  new RegExp(`(?:${JP_SECRET_LABELS.join('|')})${JP_SECRET_SEPARATOR}${JP_SECRET_VALUE}`),
  /\b(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{12,}\b/i,
] as const

/**
 * 共通情報は配信文へ差し込む場所なので、接続用の鍵を置かない。
 *
 * 一般的な文章まで止めないよう、「token」という単語だけでは警告せず、
 * 値を伴う書式か、代表的な秘密値の形式に合う場合だけを対象にする。
 */
function looksLikeSensitiveValue(input: string): boolean {
  return SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(input))
}

function sensitiveFieldLabels(value: string, memo: string): string[] {
  return [
    ...(looksLikeSensitiveValue(value) ? ['値'] : []),
    ...(looksLikeSensitiveValue(memo) ? ['社内メモ'] : []),
  ]
}

/** エラーを出した欄へカーソルを戻す（VAR-06）。 */
function focusField(id: string) {
  document.getElementById(id)?.focus()
}

/** 400の理由文から、直す欄を引く。 */
function focusTargetForReason(message: string): string | null {
  if (message.includes('代替値')) return 'cv-fallback-value'
  if (message.includes('有効開始')) return 'cv-valid-from'
  if (message.includes('有効終了')) return 'cv-valid-until'
  if (message.includes('名前')) return 'cv-name'
  if (message.includes('メモ')) return 'cv-memo'
  if (message.includes('値')) return 'cv-value'
  return null
}

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

function NewCommonVarInner() {
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
  const [memo, setMemo] = useState('')
  const [validFrom, setValidFrom] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [expiryBehavior, setExpiryBehavior] = useState<'stop' | 'fallback'>('stop')
  const [fallbackValue, setFallbackValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [secretWarningFields, setSecretWarningFields] = useState<string[] | null>(null)
  const valueRef = useRef<HTMLInputElement>(null)
  const longValueRef = useRef<HTMLTextAreaElement>(null)
  const memoRef = useRef<HTMLTextAreaElement>(null)
  const secretWarningRef = useRef<HTMLDivElement>(null)
  // 入力欄と秘密値警告は「表示時のLINEアカウント」に紐づく。切替後は
  // 別アカウント向けの内容を残さない（前アカウントの値を誤って新アカウントへ
  // 登録しないため）。
  const boundAccountRef = useRef(selectedAccountId)

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

  useEffect(() => {
    if (selectedAccountId === boundAccountRef.current) return
    const hadDraft = Boolean(name || varKey || value || memo || secretWarningFields)
    boundAccountRef.current = selectedAccountId
    setName('')
    setFolderId('')
    setVarKey('')
    setKeyTouched(false)
    setType('text')
    setValue('')
    setMemo('')
    setValidFrom('')
    setValidUntil('')
    setExpiryBehavior('stop')
    setFallbackValue('')
    setSecretWarningFields(null)
    setSaving(false)
    setError(hadDraft ? 'LINEアカウントが切り替わったため、入力をやり直してください' : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 切替検知のみに使うため、フォーム値は依存に入れない
  }, [selectedAccountId])

  useEffect(() => {
    if (secretWarningFields) secretWarningRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [secretWarningFields])

  /*
   * 入力中に画面の外へ出る操作を止める（VAR-01 監査）。リッチメニュー・
   * ウェビナーと同じ `useUnsavedGuard`＋確認ダイアログの形で、一覧リンク・
   * 左メニュー・ブラウザの戻る・再読込を捕まえる。登録が終わると一覧へ
   * router.push するので、成功後にこの警告は出ない。
   * 初期値（全て空・種別は標準・期間外は配信停止）から1か所でも変わって
   * いれば未保存とみなす。名前を入れると差し込み名は自動で付くが、どちらも
   * 入力なので dirty として素直に数える。
   */
  const dirty = Boolean(
    name || varKey || value || memo || folderId ||
    validFrom || validUntil || fallbackValue ||
    type !== 'text' || expiryBehavior !== 'stop'
  )
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: saving })

  // 種別は内部stateからのみ選ぶが、見つからないときは先頭へ倒す（非null断言を使わない）。
  const spec = TYPES.find((t) => t.key === type) ?? TYPES[0]

  const save = async (allowSensitive = false) => {
    if (saving) return
    if (!selectedAccountId) {
      setError('LINEアカウントを選択してください')
      return
    }
    if (selectedAccountId !== boundAccountRef.current) {
      // 表示中の入力・警告は別アカウント向けなので、そのまま確認扱いにしない。
      setSecretWarningFields(null)
      setError('LINEアカウントが切り替わったため、入力をやり直してください')
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
    // VAR-06: 空欄不可の種別（真偽・年月日・日時）や形式違いは、APIを呼ぶ
    // 前に理由を出して値の欄へ戻す。400を一律の失敗文へ置き換えない。
    const valueError = commonVarValueError(type, value)
    if (valueError) {
      setError(valueError)
      focusField('cv-value')
      return
    }
    if (validFrom && validUntil && validFrom >= validUntil) {
      setError('有効終了は有効開始より後にしてください')
      return
    }
    if (expiryBehavior === 'fallback') {
      if (!fallbackValue) {
        setError('期限切れ時に使う代替値を入力してください')
        focusField('cv-fallback-value')
        return
      }
      const fallbackError = commonVarValueError(type, fallbackValue, '代替値')
      if (fallbackError) {
        setError(fallbackError)
        focusField('cv-fallback-value')
        return
      }
    }
    const sensitiveFields = sensitiveFieldLabels(value, memo)
    if (sensitiveFields.length > 0 && !allowSensitive) {
      setSecretWarningFields(sensitiveFields)
      setError('')
      return
    }
    setSaving(true)
    setSecretWarningFields(null)
    setError('')
    try {
      const payload = {
        accountId: accountAtRequest,
        name: name.trim(),
        varKey: varKey.trim(),
        type,
        value,
        memo,
        folderId: folderId || null,
        validFrom: validFrom || null,
        validUntil: validUntil || null,
        expiryBehavior,
        fallbackValue: expiryBehavior === 'fallback' ? fallbackValue : null,
      }
      const res = await api.commonVars.create(payload)
      if (accountAtRequest !== latestAccountRef.current) return
      if (!res.success) {
        setError(res.error)
        return
      }
      router.push('/contents/vars')
    } catch (e) {
      // VAR-06: 400（型不一致など安全な入力エラー）は口の理由をそのまま出し、
      // 直す欄へ戻す。通信障害・権限不足・競合とは文を分ける(describeSaveFailure)。
      if (e instanceof ApiError && e.status === 409) {
        setError('その差し込み名は既に使われています')
        focusField('cv-key')
      } else {
        setError(describeSaveFailure(e))
        if (e instanceof ApiError && (e.status === 400 || e.status === 422)) {
          const target = e.status === 422 ? 'cv-key' : focusTargetForReason(e.message)
          if (target) focusField(target)
        }
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      {!accountLoading && !selectedAccountId && (
        <div className="bg-warning-bg text-warning mb-4 rounded-card p-4 text-sm">
          共通情報を登録するLINEアカウントを選択してください。
        </div>
      )}
      <nav className="text-ink-faint mb-3 text-xs">
        <Link href="/contents/vars" className="text-info underline">
          共通情報一覧
        </Link>
        <span className="mx-1.5">›</span>
        <span>共通情報登録</span>
      </nav>

      {/* ★V7: ほかの新規画面と同じ「本体＋右の案内」の2列にする。右の文は画面内の既存の文だけを使う。注意は入力より先に読ませる（読み上げ順もこの順）。 */}
      <div className="grid items-start gap-4 xl:grid-cols-3">
      <aside className="space-y-4 xl:col-start-3 xl:row-start-1" aria-label="登録の案内">
        <div className="bg-warning-bg text-warning rounded-card border border-current/20 p-4 text-sm" role="note">
          <p className="font-semibold">秘密値は保存しないでください</p>
          <p className="mt-1 leading-relaxed">
            パスワード、APIトークン、秘密鍵などは共通情報に入力しないでください。
            配信文へ誤って差し込まれるおそれがあります。
          </p>
        </div>
        <section className="bg-canvas rounded-card border-hairline border p-4">
          <h2 className="text-ink text-sm font-bold">差し込み名の決めかた</h2>
          <p className="text-ink-faint mt-1 text-xs leading-relaxed">
            半角の英小文字で始め、英小文字・数字・下線だけ、32文字まで。テンプレートには差し込み名で書きます。
          </p>
          <p className="text-ink-faint mt-1 text-xs leading-relaxed">
            <strong>あとから変えられません。</strong>
            変えるとテンプレートの差し込みが空になるためです。
          </p>
        </section>
      </aside>
      <div className="bg-canvas rounded-card border-hairline min-w-0 space-y-6 border p-6 xl:col-span-2 xl:col-start-1 xl:row-start-1">
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
              className="border-hairline rounded-control focus:ring-accent w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-status-info"
            />
            <p className="text-ink-faint mt-1 text-right text-xs tabular-nums">
              {name.length}/{NAME_MAX}
            </p>
          </div>

          <div>
            <label htmlFor="cv-folder" className="text-ink-secondary mb-1 block text-sm font-medium">
              フォルダ
            </label>
            <SelectField
              id="cv-folder"
              value={folderId}
              onChange={(e) => setFolderId(e.target.value)}
              options={[{ value: '', label: '未分類' }, ...folders.map((folder) => ({ value: folder.id, label: folder.name }))]}
            />
          </div>
        </div>

        <fieldset className="border-hairline rounded-card max-w-xl space-y-4 border p-4">
          <legend className="text-ink-secondary px-1 text-sm font-medium">配信で使える期間</legend>
          <p className="text-ink-faint text-xs">予約配信は送信を始める時刻で判定します。空欄なら期間を制限しません。</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="cv-valid-from" className="text-ink-secondary mb-1 block text-xs font-medium">有効開始</label>
              <input id="cv-valid-from" type="datetime-local" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} className="border-hairline rounded-control w-full border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-status-info" />
            </div>
            <div>
              <label htmlFor="cv-valid-until" className="text-ink-secondary mb-1 block text-xs font-medium">有効終了</label>
              <input id="cv-valid-until" type="datetime-local" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="border-hairline rounded-control w-full border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-status-info" />
            </div>
          </div>
          <div>
            <label htmlFor="cv-expiry-behavior" className="text-ink-secondary mb-1 block text-xs font-medium">期間外の動作</label>
            <SelectField id="cv-expiry-behavior" value={expiryBehavior} onChange={(e) => setExpiryBehavior(e.target.value as 'stop' | 'fallback')} options={[{ value: 'stop', label: '配信を止める' }, { value: 'fallback', label: '代替値を使う' }]} className="w-full" />
          </div>
          {expiryBehavior === 'fallback' && (
            <div>
              <label htmlFor="cv-fallback-value" className="text-ink-secondary mb-1 block text-xs font-medium">代替値</label>
              {type === 'boolean' ? (
                <SelectField
                  id="cv-fallback-value"
                  value={fallbackValue}
                  onChange={(e) => setFallbackValue(e.target.value)}
                  options={[{ value: '', label: '選んでください' }, { value: 'true', label: 'true' }, { value: 'false', label: 'false' }]}
                  className="w-full"
                />
              ) : (
                <input
                  id="cv-fallback-value"
                  type={type === 'number' ? 'number' : type === 'date' ? 'date' : type === 'datetime' ? 'datetime-local' : 'text'}
                  value={fallbackValue}
                  onChange={(e) => setFallbackValue(e.target.value)}
                  className="border-hairline rounded-control w-full border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-status-info"
                />
              )}
            </div>
          )}
        </fieldset>

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
            className="border-hairline rounded-control focus:ring-accent w-full max-w-sm border px-3 py-2 font-mono text-sm focus:ring-2 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-status-info"
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
            値 {COMMON_VAR_VALUE_REQUIRED.has(type) && <span className="text-danger">*</span>}
          </label>
          {type === 'boolean' ? <SelectField id="cv-value" value={value} onChange={(e) => { setValue(e.target.value); setSecretWarningFields(null) }} options={[{ value: '', label: '選んでください' }, { value: 'true', label: 'true' }, { value: 'false', label: 'false' }]} className="w-full max-w-md" /> : type === 'long_text' ? <textarea
            ref={longValueRef}
            id="cv-value"
            maxLength={10000}
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setSecretWarningFields(null)
            }}
            placeholder={spec.placeholder}
            className="border-hairline rounded-control w-full max-w-md border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-status-info"
          /> : <input
            ref={valueRef}
            id="cv-value"
            type={type === 'number' ? 'number' : type === 'date' ? 'date' : type === 'datetime' ? 'datetime-local' : 'text'}
            maxLength={type === 'number' ? undefined : VALUE_MAX}
            value={value}
            onChange={(e) => { setValue(e.target.value); setSecretWarningFields(null) }}
            placeholder={spec.placeholder}
            className="border-hairline rounded-control w-full max-w-md border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-status-info"
          />}
          {type !== 'number' && type !== 'boolean' && (
            <p className="text-ink-faint mt-1 max-w-md text-right text-xs tabular-nums">
              {value.length}/{type === 'long_text' ? 10000 : VALUE_MAX}
            </p>
          )}
          <p className="text-ink-faint mt-1 text-xs">
            日付を決めて自動で書き換える設定は、登録したあとの編集画面から足せます。
          </p>
        </div>

        <div>
          <label htmlFor="cv-memo" className="text-ink-secondary mb-1 block text-sm font-medium">
            社内メモ <span className="text-ink-faint text-xs font-normal">任意</span>
          </label>
          <textarea
            ref={memoRef}
            id="cv-memo"
            rows={3}
            maxLength={MEMO_MAX}
            value={memo}
            onChange={(e) => {
              setMemo(e.target.value)
              setSecretWarningFields(null)
            }}
            placeholder="この共通情報を使う目的や、更新時の注意点"
            className="border-hairline rounded-control w-full max-w-xl border px-3 py-2 text-sm"
          />
          <p className="text-ink-faint mt-1 max-w-xl text-right text-xs tabular-nums">
            {memo.length}/{MEMO_MAX}
          </p>
          <p className="text-ink-faint mt-1 text-xs">友だちには表示されません。</p>
        </div>

        {secretWarningFields && (
          <div
            ref={secretWarningRef}
            role="alertdialog"
            aria-labelledby="cv-secret-warning-title"
            aria-describedby="cv-secret-warning-description"
            className="border-danger bg-danger-bg rounded-card border p-4"
          >
            <h2 id="cv-secret-warning-title" className="text-danger text-base font-bold">
              秘密値の可能性がある内容を確認してください
            </h2>
            <p id="cv-secret-warning-description" className="text-ink-secondary mt-2 text-sm leading-relaxed">
              {secretWarningFields.join('・')}に、パスワードやトークンなどの秘密値らしい内容があります。
              共通情報には保存せず、安全な保管場所へ移してください。
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  const firstField = secretWarningFields[0]
                  setSecretWarningFields(null)
                  if (firstField === '社内メモ') memoRef.current?.focus()
                  else valueRef.current?.focus()
                }}
              >
                入力に戻って修正する
              </Button>
              <Button type="button" disabled={saving} onClick={() => void save(true)}>
                内容を確認して登録する
              </Button>
            </div>
          </div>
        )}

        {error && <p className="text-danger text-sm" role="alert">{error}</p>}
      </div>
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

      <ConfirmDialog
        open={leaveTarget !== null}
        title="保存していない変更があります"
        description="このまま移動すると、入力した共通情報は失われます。保存せずに移動しますか？"
        confirmLabel="保存せずに移動"
        cancelLabel="編集を続ける"
        onConfirm={confirmLeave}
        onCancel={cancelLeave}
      />
    </div>
  )
}

export default function NewCommonVarPage() {
  // 直URLでも共通情報オフのaccountには画面を出さない。
  return (
    <FeatureGate feature="common_vars">
      <NewCommonVarInner />
    </FeatureGate>
  )
}
