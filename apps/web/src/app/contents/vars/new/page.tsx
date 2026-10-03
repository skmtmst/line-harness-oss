'use client'

import DateField from '@/components/shared/date-field'
import DateTimeField from '@/components/shared/date-time-field'
import Select from '@/components/shared/select'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Folder } from '@line-crm/shared'
import { api, ApiError, describeSaveFailure } from '@/lib/api'
import { commonVarValueError, COMMON_VAR_VALUE_REQUIRED, isSecretLikeVarValue } from '@/lib/common-vars'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import FeatureGate from '@/components/feature-gate'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import RadioCard from '@/components/shared/radio-card'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import Notice from '@/components/shared/notice'
import StickyBar from '@/components/shared/sticky-bar'
import { useAdminTheme } from '@/lib/use-admin-theme'
import NewCommonVarV8 from './new-v8'

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
  /** R36: 直し方は欄のすぐ下にも出す。全体の失敗文だけではどの欄か分からない。 */
  const [valueFieldError, setValueFieldError] = useState('')
  const [fallbackFieldError, setFallbackFieldError] = useState('')
  const [secretWarningFields, setSecretWarningFields] = useState<string[] | null>(null)
  const valueRef = useRef<HTMLInputElement>(null)
  const longValueRef = useRef<HTMLTextAreaElement>(null)
  const memoRef = useRef<HTMLTextAreaElement>(null)
  const secretWarningRef = useRef<HTMLDivElement>(null)
  // 入力欄と秘密値警告は「表示時のLINEアカウント」に紐づく。切替後は
  // 別アカウント向けの内容を残さない（前アカウントの値を誤って新アカウントへ
  // 登録しないため）。
  const boundAccountRef = useRef(selectedAccountId)

  /**
   * R593: フォルダの一覧は独立した取得状態にする。失敗を黙って握りつぶすと
   * 503でも正常な0件と同じ「未分類だけ」になり、失敗と気づけない。
   * 失敗を明示して再試行を付け、未分類のまま登録できることを伝える。
   */
  const [foldersError, setFoldersError] = useState(false)
  const loadFolders = useCallback(async () => {
    try {
      const res = await api.folders.list('common_var')
      if (res.success) {
        setFolders(res.data)
        setFoldersError(false)
      } else {
        setFoldersError(true)
      }
    } catch {
      // フォルダが読めなくても登録はできる（未分類になる）。
      setFoldersError(true)
    }
  }, [])

  useEffect(() => {
    void loadFolders()
  }, [loadFolders])

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

  /**
   * R594: 値・代替値の入力エラーは、欄の下と画面下部の両方に出る。
   * 直したら両方消す。欄の下だけ消すと、直ったのに画面下部で
   * 怒られているように見える。画面下部の一文は、値の入力エラーと
   * 同じ文のときだけ一緒に消す（別の失敗文は残す）。
   */
  const valueErrorMessageRef = useRef('')
  const fallbackErrorMessageRef = useRef('')
  useEffect(() => {
    setValueFieldError('')
    const message = valueErrorMessageRef.current
    valueErrorMessageRef.current = ''
    if (message) setError((current) => (current === message ? '' : current))
  }, [value, type])
  useEffect(() => {
    setFallbackFieldError('')
    const message = fallbackErrorMessageRef.current
    fallbackErrorMessageRef.current = ''
    if (message) setError((current) => (current === message ? '' : current))
  }, [fallbackValue, type])

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

  const save = async (allowSensitive = false, asDraft = false) => {
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
    // 理由は欄のすぐ下にも出す（R36）。
    const valueError = commonVarValueError(type, value)
    if (valueError) {
      setError(valueError)
      setValueFieldError(valueError)
      // R594: 直したら画面下部の一文も一緒に消せるよう、文を覚える。
      valueErrorMessageRef.current = valueError
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
        setFallbackFieldError(fallbackError)
        fallbackErrorMessageRef.current = fallbackError
        focusField('cv-fallback-value')
        return
      }
    }
    // Q: 鍵の形・長い乱数はサーバでも422で止まる。確認を通しても保存できない
    // ものはここで止め、理由を欄のすぐ下へ出す。
    const secretField = isSecretLikeVarValue(value)
      ? 'cv-value'
      : expiryBehavior === 'fallback' && isSecretLikeVarValue(fallbackValue)
        ? 'cv-fallback-value'
        : null
    if (secretField) {
      const message = '鍵やトークンのような秘密の値は共通情報に保存できません。外部連携の設定へ登録してください'
      setError(message)
      if (secretField === 'cv-value') {
        setValueFieldError(message)
        valueErrorMessageRef.current = message
      } else {
        setFallbackFieldError(message)
        fallbackErrorMessageRef.current = message
      }
      focusField(secretField)
      return
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
        status: asDraft ? 'draft' as const : 'active' as const,
      }
      const res = await api.commonVars.create(payload)
      if (accountAtRequest !== latestAccountRef.current) return
      if (!res.success) {
        setError(res.error)
        // 口で止まった理由も欄のすぐ下に映す（R36）。
        const target = focusTargetForReason(res.error)
        if (target === 'cv-value') {
          setValueFieldError(res.error)
          valueErrorMessageRef.current = res.error
        } else if (target === 'cv-fallback-value') {
          setFallbackFieldError(res.error)
          fallbackErrorMessageRef.current = res.error
        }
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
          if (target === 'cv-value') {
            setValueFieldError(e.message)
            valueErrorMessageRef.current = e.message
          } else if (target === 'cv-fallback-value') {
            setFallbackFieldError(e.message)
            fallbackErrorMessageRef.current = e.message
          }
        }
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* カード同士の縦の間隔はこの親の gap-4（16px）だけで作る。子ごとの mb/mt は付けない。 */}
      {!accountLoading && !selectedAccountId && (
        <Notice tone="warn" message="共通情報を登録するLINEアカウントを選択してください。" className="mb-4" />
      )}
      <nav className="text-ink-faint text-xs">
        <Link href="/contents/vars" className="text-info underline">
          共通情報一覧
        </Link>
        <span className="mx-1.5">›</span>
        <span>共通情報登録</span>
      </nav>

      {/* ★V7: ほかの新規画面と同じ「本体＋右の案内」の2列にする。右の文は画面内の既存の文だけを使う。注意は入力より先に読ませる（読み上げ順もこの順）。 */}
      <div className="grid items-start gap-4 xl:grid-cols-3">
      <aside className="space-y-4 xl:col-start-3 xl:row-start-1" aria-label="登録の案内">
        <Notice tone="warn">
          <p className="font-semibold">秘密値は保存しないでください</p>
          <p className="mt-1 leading-relaxed">
            パスワード、APIトークン、秘密鍵などは共通情報に入力しないでください。
            配信文へ誤って差し込まれるおそれがあります。
          </p>
        </Notice>
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
              className="border-hairline rounded-control w-full border px-3 py-2 text-sm"
            />
            <p className="text-ink-faint mt-1 text-right text-xs tabular-nums">
              {name.length}/{NAME_MAX}
            </p>
          </div>

          <div>
            <label htmlFor="cv-folder" className="text-ink-secondary mb-1 block text-sm font-medium">
              フォルダ
            </label>
            <Select
              aria-label="フォルダ"
              id="cv-folder"
              value={folderId}
              onChange={(value) => setFolderId(value)}
              options={[{ value: '', label: '未分類' }, ...folders.map((folder) => ({ value: folder.id, label: folder.name }))]}
            />
            {/*
              R593: 一覧が読めなくても「未分類だけ」とは言わない。失敗と
              再試行を欄の下に出し、未分類のまま登録を続けられることと、
              その影響（未分類で登録される）を伝える。赤は使わない。
            */}
            {foldersError ? (
              <div className="mt-1 space-y-1" data-folders-state="error">
                <p className="text-ink-secondary text-xs">
                  フォルダの一覧を読み込めませんでした。未分類のまま登録できます。
                </p>
                <Button type="button" onClick={() => void loadFolders()}>
                  再読み込み
                </Button>
              </div>
            ) : null}
          </div>
        </div>

        <fieldset className="border-hairline rounded-card max-w-xl space-y-4 border p-4">
          <legend className="text-ink-secondary px-1 text-sm font-medium">配信で使える期間</legend>
          <p className="text-ink-faint text-xs">予約配信は送信を始める時刻で判定します。空欄なら期間を制限しません。</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="cv-valid-from" className="text-ink-secondary mb-1 block text-xs font-medium">有効開始</label>
              <DateTimeField id="cv-valid-from" value={validFrom} onChange={setValidFrom} />
            </div>
            <div>
              <label htmlFor="cv-valid-until" className="text-ink-secondary mb-1 block text-xs font-medium">有効終了</label>
              <DateTimeField id="cv-valid-until" value={validUntil} onChange={setValidUntil} />
            </div>
          </div>
          <div>
            <label htmlFor="cv-expiry-behavior" className="text-ink-secondary mb-1 block text-xs font-medium">期間外の動作</label>
            <Select size="full" aria-label="期間外の動作" id="cv-expiry-behavior" value={expiryBehavior} onChange={(value) => setExpiryBehavior(value as 'stop' | 'fallback')} options={[{ value: 'stop', label: '配信を止める' }, { value: 'fallback', label: '代替値を使う' }]} />
          </div>
          {expiryBehavior === 'fallback' && (
            <div>
              <label htmlFor="cv-fallback-value" className="text-ink-secondary mb-1 block text-xs font-medium">代替値</label>
              {type === 'boolean' ? (
                <Select size="full" aria-label="代替値" id="cv-fallback-value" value={fallbackValue} onChange={(value) => setFallbackValue(value)} options={[{ value: '', label: '選んでください' }, { value: 'true', label: 'true' }, { value: 'false', label: 'false' }]} />
              ) : type === 'date' ? (
                <DateField id="cv-fallback-value" value={fallbackValue} onChange={setFallbackValue} />
              ) : type === 'datetime' ? (
                <DateTimeField id="cv-fallback-value" value={fallbackValue} onChange={setFallbackValue} />
              ) : (
                <input
                  id="cv-fallback-value"
                  type={type === 'number' ? 'number' : 'text'}
                  value={fallbackValue}
                  onChange={(e) => setFallbackValue(e.target.value)}
                  className="border-hairline rounded-control w-full border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-status-info"
                />
              )}
              {fallbackFieldError ? <p className="text-danger mt-1 text-xs">{fallbackFieldError}</p> : null}
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
            className="border-hairline rounded-control w-full max-w-sm border px-3 py-2 font-mono text-sm"
          />
          <p className="text-ink-faint mt-1 text-xs leading-relaxed">
            半角の英小文字で始め、英小文字・数字・下線だけ、32文字まで。
            {varKey && (
              <>
                <br />
                テンプレートには{' '}
                <code className="bg-canvas-sunken rounded-mini px-1">{`{{var.${varKey}}}`}</code>{' '}
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
              <RadioCard
                key={t.key}
                name="cv-type"
                value={t.key}
                checked={type === t.key}
                onChange={() => {
                  setType(t.key)
                  setValue('')
                }}
                title={t.label}
                note={
                  <>
                    <span
                      className="bg-canvas border-hairline text-ink-secondary mr-2 inline-flex h-8 w-11 items-center justify-center rounded-mini border text-xs"
                      aria-hidden="true"
                    >
                      {t.mark}
                    </span>
                    {t.note}
                  </>
                }
              />
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="cv-value" className="text-ink-secondary mb-1 block text-sm font-medium">
            値 {COMMON_VAR_VALUE_REQUIRED.has(type) && <span className="text-danger">*</span>}
          </label>
          {type === 'boolean' ? <Select size="full" aria-label="値" id="cv-value" value={value} onChange={(value) => { setValue(value); setSecretWarningFields(null) }} options={[{ value: '', label: '選んでください' }, { value: 'true', label: 'true' }, { value: 'false', label: 'false' }]} className="max-w-md" /> : type === 'long_text' ? <textarea
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
          /> : type === 'date' ? (
            <DateField
              id="cv-value"
              value={value}
              onChange={(v) => { setValue(v); setSecretWarningFields(null) }}
            />
          ) : type === 'datetime' ? (
            <DateTimeField
              id="cv-value"
              value={value}
              onChange={(v) => { setValue(v); setSecretWarningFields(null) }}
            />
          ) : <input
            ref={valueRef}
            id="cv-value"
            type={type === 'number' ? 'number' : 'text'}
            maxLength={type === 'number' ? undefined : VALUE_MAX}
            value={value}
            onChange={(e) => { setValue(e.target.value); setSecretWarningFields(null) }}
            placeholder={spec.placeholder}
            className="border-hairline rounded-control w-full max-w-md border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-status-info"
          />}
          {valueFieldError ? <p className="text-danger mt-1 max-w-md text-xs">{valueFieldError}</p> : null}
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
            {/* Q: まだ配信へ出したくないものは下書きで残せる。下書きは差し込みに使われない。 */}
            <Button type="button" disabled={saving} onClick={() => void save(false, true)}>
              下書きを保存する
            </Button>
            <Button type="button" variant="primary" disabled={saving} onClick={() => void save()} busy={saving} busyLabel="登録中…">登録する
            </Button>
          </>
        )}
      />

      <UnsavedLeaveDialog open={leaveTarget !== null} subject="入力した共通情報" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </div>
  )
}

/*
 * ★V8: data-theme="v8" のときだけ新しい登録画面（`p82v9`）を出す。
 * v7 の見た目は NewCommonVarInner のまま変えない。
 */
function NewCommonVarPageSwitch() {
  const theme = useAdminTheme()
  return theme === 'v8' ? <NewCommonVarV8 /> : <NewCommonVarInner />
}

export default function NewCommonVarPage() {
  // 直URLでも共通情報オフのaccountには画面を出さない。
  return (
    <FeatureGate feature="common_vars">
      <NewCommonVarPageSwitch />
    </FeatureGate>
  )
}
