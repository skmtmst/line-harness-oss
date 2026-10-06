'use client'

/*
 * ★V8 共通情報を作る（板 `p82v9`）。
 *
 * 型は作る（CreatePage）：頭（戻る・題・説明）→ 左に3枚のカード（名前と差し込み名・
 * 種別と中身・使える期間）と社内メモ、右の列に秘密値の注意と差し込んだときの見え方、
 * 下の帯にキャンセル・下書きを保存・保存して公開。
 * データの口・入力検査・秘密値の守り・下書き保存は `app/contents/vars/new/new-v8.tsx`
 * から写した（import はしない）。動きの一覧は同じ場所の BEHAVIOR.md。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlignLeft,
  ArrowLeft,
  CalendarClock,
  CalendarDays,
  Copy,
  Eye,
  Hash,
  Image as ImageIcon,
  Link2,
  ToggleLeft,
  Type,
  Upload,
} from 'lucide-react'
import type { Folder } from '@line-crm/shared'
import { api, ApiError, describeSaveFailure } from '@/lib/api'
import { commonVarValueError, COMMON_VAR_VALUE_REQUIRED, isSecretLikeVarValue } from '@/lib/common-vars'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { useAccount } from '@/contexts/account-context'
import { isOwnerOrAdmin } from '@/lib/staff-capability'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { CreatePage } from '@/components/templates'
import Button from '@/components/shared/button'
import DateField from '@/components/shared/date-field'
import DateTimeField from '@/components/shared/date-time-field'
import LinePreview from '@/components/shared/line-preview'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import styles from './new.module.css'

/*
 * 種別8つ。板 `p82v9` のカードの並び（標準・長文・数値・URL／
 * 画像・年月日・日時・はい／いいえ）にそろえる。種別は登録後に
 * 変えられない（値の意味が変わるため）。
 */
const TYPES: Array<{ key: string; label: string; desc: string; icon: typeof Type; placeholder: string }> = [
  { key: 'text', label: '標準', desc: '電話番号・営業時間', icon: Type, placeholder: '10:00-18:00、集客セミナー' },
  { key: 'long_text', label: '長文', desc: '200文字をこえる案内', icon: AlignLeft, placeholder: '詳しいご案内' },
  { key: 'number', label: '数値', desc: '日ごとに書き換える', icon: Hash, placeholder: '10、124.3、30000' },
  { key: 'url', label: 'URL', desc: '予約ページ・地図', icon: Link2, placeholder: 'https://example.com/reserve' },
  { key: 'image', label: '画像', desc: 'ロゴ・バナーのURL', icon: ImageIcon, placeholder: 'https://example.com/logo.png' },
  { key: 'date', label: '年月日', desc: '日付', icon: CalendarDays, placeholder: '2026-09-16' },
  { key: 'datetime', label: '日時', desc: '日付と時刻', icon: CalendarClock, placeholder: '2026-09-16T10:00' },
  { key: 'boolean', label: 'はい／いいえ', desc: 'true / false', icon: ToggleLeft, placeholder: 'true' },
]

const NAME_MAX = 200
const VALUE_MAX = 200
const MEMO_MAX = 1000

const JP_SECRET_LABELS = [
  'パスワード', '合言葉', '暗証番号', 'ピン', 'PIN',
  '秘密鍵', 'シークレット', 'クライアントシークレット',
  'トークン', 'アクセストークン', 'リフレッシュトークン',
  'APIキー', 'API鍵', 'アクセスキー', '認証コード',
] as const

const JP_SECRET_SEPARATOR = String.raw`(?:\s*[=:：]\s*|[\s　]+|の?は\s*|が\s*)?[「『"'　]*`
const JP_SECRET_VALUE = String.raw`[A-Za-z0-9][A-Za-z0-9_.+/=-]{3,}`

const SENSITIVE_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b(?:password|passwd|pwd|secret|token|api[_ -]?key|access[_ -]?key|channel[_ -]?secret)\s*[=:：]\s*\S{4,}/i,
  new RegExp(`(?:${JP_SECRET_LABELS.join('|')})${JP_SECRET_SEPARATOR}${JP_SECRET_VALUE}`),
  /\b(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{12,}\b/i,
] as const

function looksLikeSensitiveValue(input: string): boolean {
  return SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(input))
}

function sensitiveFieldLabels(value: string, memo: string): string[] {
  return [
    ...(looksLikeSensitiveValue(value) ? ['値'] : []),
    ...(looksLikeSensitiveValue(memo) ? ['社内メモ'] : []),
  ]
}

function focusField(id: string) {
  document.getElementById(id)?.focus()
}

function focusTargetForReason(message: string): string | null {
  if (message.includes('代替値')) return 'cv-fallback-value'
  if (message.includes('有効開始')) return 'cv-valid-from'
  if (message.includes('有効終了')) return 'cv-valid-until'
  if (message.includes('名前')) return 'cv-name'
  if (message.includes('メモ')) return 'cv-memo'
  if (message.includes('値')) return 'cv-value'
  return null
}

/* 1欄ぶんの確かめ。文は「何をすれば直るか」を1文で書く。 */
function validateVarName(value: string): string | null {
  return value.trim() ? null : '共通情報名を入力してください'
}

const VAR_KEY_PATTERN = /^[a-z][a-z0-9_]{0,31}$/

function validateVarKey(value: string): string | null {
  if (!value.trim()) return '差し込み名を入力してください'
  return VAR_KEY_PATTERN.test(value.trim())
    ? null
    : '差し込み名は半角の英小文字で始め、英小文字・数字・下線だけで32文字までにしてください'
}

/*
 * 欄の下の赤い1行。4欄で同じ形にするため1か所にまとめる。
 * 直書きの className を欄ごとに増やさない（design-debt の計数）。
 */
function VarFieldError({ message }: { message: string }) {
  if (!message) return null
  return <p className={styles.fieldError} role="alert">{message}</p>
}

function suggestKey(name: string): string {
  const ascii = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!ascii || !/^[a-z]/.test(ascii)) return ''
  return ascii.slice(0, 32)
}

export default function NewCommonVarV8() {
  const [copied, setCopied] = useState(false)
  usePageTitle('共通情報を作る')
  usePageCrumbs([
    { label: 'ホーム', href: '/' },
    { label: '共通情報', href: '/contents/vars' },
  ])
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const latestAccountRef = useRef(selectedAccountId)
  latestAccountRef.current = selectedAccountId
  const router = useRouter()

  /*
   * 登録の口は `requireRole('owner', 'admin')` で閉じている。staff には
   * 閲覧のみの帯を出して保存の押し口を押せない形にする（閉さない）。
   */
  const [canWrite] = useState(() =>
    typeof window === 'undefined' ? true : isOwnerOrAdmin())

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
  const [valueFieldError, setValueFieldError] = useState('')
  const [fallbackFieldError, setFallbackFieldError] = useState('')
  /* 名前・差し込み名は欄から離れたとき（blur）に確かめ、直したらその場で消す。 */
  const [nameFieldError, setNameFieldError] = useState('')
  const [keyFieldError, setKeyFieldError] = useState('')
  const [secretWarningFields, setSecretWarningFields] = useState<string[] | null>(null)
  const valueRef = useRef<HTMLInputElement>(null)
  const memoRef = useRef<HTMLTextAreaElement>(null)
  const secretWarningRef = useRef<HTMLDivElement>(null)
  const boundAccountRef = useRef(selectedAccountId)

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

  const dirty = Boolean(
    name || varKey || value || memo || folderId ||
    validFrom || validUntil || fallbackValue ||
    type !== 'text' || expiryBehavior !== 'stop',
  )
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: saving })

  const spec = TYPES.find((t) => t.key === type) ?? TYPES[0]

  const save = async (allowSensitive = false, asDraft = false) => {
    if (saving) return
    if (!selectedAccountId) {
      setError('LINEアカウントを選択してください')
      return
    }
    if (selectedAccountId !== boundAccountRef.current) {
      setSecretWarningFields(null)
      setError('LINEアカウントが切り替わったため、入力をやり直してください')
      return
    }
    const accountAtRequest = selectedAccountId
    if (!name.trim()) {
      setError('共通情報名を入力してください')
      focusField('cv-name')
      return
    }
    if (!varKey.trim()) {
      setError('差し込み名を入力してください')
      focusField('cv-key')
      return
    }
    const valueError = commonVarValueError(type, value)
    if (valueError) {
      setError(valueError)
      setValueFieldError(valueError)
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

  const saveDisabled = saving || !canWrite
  const previewName = name.trim() || '共通情報'

  const copyKey = async () => {
    const key = varKey.trim()
    if (!key) return
    try {
      await navigator.clipboard.writeText(`{{var.${key}}}`)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setError('コピーできませんでした。差し込み名の欄の文字を選んでコピーしてください。')
    }
  }

  const preview = (
    <>
      <div className={styles.secretCard}>
        <p className={styles.secretTitle}>秘密の値は入れないでください</p>
        <p className={styles.secretText}>
          パスワード・APIキー・トークンなどは保存できません（入れると止めます）。配信文に誤って差し込まれるおそれがあります。外部連携の設定に登録してください。
        </p>
      </div>
      <LinePreview caption="差し込んだ例" accountName="然 - NEN -" note="差し込んだときの見え方です。名前と中身を入れると、ここが変わります。">
        <div className={styles.talkRow}>
          <span className={styles.talkIcon} aria-hidden="true">然</span>
          <div className={styles.talkCol}>
            <span className={styles.talkName}>然 - NEN -</span>
            <div className={styles.talkBubbleRow}>
              <p className={styles.talkBubble}>
                {`いつもありがとうございます。\n${previewName}は ${value || '（未入力）'} です。`}
              </p>
              <span className={styles.talkTime}>10:00</span>
            </div>
          </div>
        </div>
      </LinePreview>
    </>
  )

  return (
    <CreatePage
      boardId="p82v9"
      title="共通情報を作る"
      description="保存しただけでは差し込まれません。公開すると使えるようになります"
      identity={<Link href="/contents/vars" className={styles.backLink}><ArrowLeft size={14} aria-hidden="true" />共通情報へ</Link>}
      preview={preview}
      footerActions={(
        <>
          <Button href="/contents/vars">キャンセル</Button>
          {/* 閲覧のみには押せない保存を置かない（隠す）。 */}
          {canWrite ? (
            <>
              <Button type="button" disabled={saveDisabled} onClick={() => void save(false, true)}>
                下書きを保存
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={saveDisabled}
                onClick={() => void save()}
                busy={saving}
                busyLabel="保存中…"
              >
                <Upload size={14} aria-hidden="true" />
                保存して公開
              </Button>
            </>
          ) : null}
        </>
      )}
    >
      {canWrite ? null : (
        <div className={styles.roBand} role="status">
          <Eye size={16} aria-hidden="true" />
          <span>閲覧のみで見ています。変える操作は管理者に頼んでください。</span>
        </div>
      )}

      {!accountLoading && !selectedAccountId && (
        <Notice tone="warn" message="共通情報を登録するLINEアカウントを選択してください。" />
      )}

      <section className={styles.card} aria-labelledby="cv-new-name-heading">
        <div className={styles.cardHead}>
          <h2 id="cv-new-name-heading" className={styles.cardTitle}>名前と差し込み名</h2>
        </div>
        <div className={styles.nameRow}>
          <div className={styles.field}>
            <label htmlFor="cv-name" className={styles.fieldLabelStrong}>
              共通情報名（友だちには見えません）
            </label>
            <input
              id="cv-name"
              type="text"
              maxLength={NAME_MAX}
              value={name}
              onChange={(e) => {
                const next = e.target.value
                setName(next)
                if (!keyTouched) setVarKey(suggestKey(next))
                if (nameFieldError && validateVarName(next) === null) setNameFieldError('')
              }}
              onBlur={() => setNameFieldError(validateVarName(name) ?? '')}
              placeholder="営業時間"
              className={styles.fieldInput}
              aria-invalid={nameFieldError ? true : undefined}
              title={`${name.length}/${NAME_MAX}文字`}
            />
            <VarFieldError message={nameFieldError} />
          </div>
          <div className={`${styles.field} ${styles.folderField}`}>
            <label htmlFor="cv-folder" className={styles.fieldLabel}>フォルダ</label>
            <div className={styles.selectBox}>
              <Select
                aria-label="フォルダ"
                id="cv-folder"
                value={folderId}
                onChange={(value) => setFolderId(value)}
                options={[{ value: '', label: '未分類' }, ...folders.map((folder) => ({ value: folder.id, label: folder.name }))]}
              />
            </div>
            {foldersError ? (
              <div className={styles.folderError} data-folders-state="error">
                <p className={styles.fieldHint}>フォルダの一覧を読み込めませんでした。未分類のまま登録できます。</p>
                <Button type="button" onClick={() => void loadFolders()}>
                  再読み込み
                </Button>
              </div>
            ) : null}
          </div>
        </div>
        <div className={styles.field}>
          <label htmlFor="cv-key" className={styles.fieldLabel}>
            差し込み名（あとから変えられません）
          </label>
          <div className={styles.keyRow}>
            <span className={styles.keyBox}>
              <span className={styles.keyMark} aria-hidden="true">{'{{var.'}</span>
              <input
                id="cv-key"
                type="text"
                value={varKey}
                onChange={(e) => {
                  const next = e.target.value
                  setKeyTouched(true)
                  setVarKey(next)
                  if (keyFieldError && validateVarKey(next) === null) setKeyFieldError('')
                }}
                onBlur={() => setKeyFieldError(validateVarKey(varKey) ?? '')}
                placeholder="shop_hours"
                className={styles.keyInput}
                aria-invalid={keyFieldError ? true : undefined}
              />
              <span className={styles.keyMark} aria-hidden="true">{'}}'}</span>
            </span>
            <Button variant="text" type="button" onClick={() => void copyKey()} disabled={!varKey.trim()} aria-label="差し込み名をコピー">
              <Copy size={14} aria-hidden="true" />
              {copied ? 'コピー済み' : 'コピー'}
            </Button>
          </div>
          <VarFieldError message={keyFieldError} />
          <p className={styles.fieldHint}>
            半角の英小文字で始め、英小文字・数字・下線だけ・32文字まで。変えるとテンプレートの差し込みが空になるため、あとから変えられません。
          </p>
        </div>
      </section>

      <section className={styles.card} aria-labelledby="cv-new-type-heading">
        <div className={styles.cardHead}>
          <h2 id="cv-new-type-heading" className={styles.cardTitle}>種別と中身</h2>
          <p className={styles.cardNote}>種別は作ったあと変えられません</p>
        </div>
        <div className={styles.typeGrid} role="radiogroup" aria-label="種別">
          {TYPES.map((entry) => {
            const Icon = entry.icon
            const checked = type === entry.key
            return (
              <button
                key={entry.key}
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => {
                  setType(entry.key)
                  setValue('')
                }}
                className={styles.typeCard}
              >
                <span className={styles.typeTop}>
                  <Icon size={14} aria-hidden="true" />
                  <span className={styles.typeLabel}>{entry.label}</span>
                </span>
                <span className={styles.typeDesc} title={entry.desc}>{entry.desc}</span>
              </button>
            )
          })}
        </div>
        <div className={styles.field}>
          <label htmlFor="cv-value" className={styles.fieldLabelStrong}>
            中身 {COMMON_VAR_VALUE_REQUIRED.has(type) && <span className={styles.required}>*</span>}
          </label>
          {type === 'boolean' ? (
            <Select size="full" aria-label="中身" id="cv-value" value={value} onChange={(next) => { setValue(next); setSecretWarningFields(null) }} options={[{ value: '', label: '選んでください' }, { value: 'true', label: 'true' }, { value: 'false', label: 'false' }]} />
          ) : type === 'long_text' ? (
            <textarea
              id="cv-value"
              maxLength={10000}
              value={value}
              onChange={(e) => {
                setValue(e.target.value)
                setSecretWarningFields(null)
              }}
              placeholder={spec.placeholder}
              className={styles.fieldArea}
              rows={3}
              title={`${value.length}/10000文字`}
            />
          ) : type === 'date' ? (
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
          ) : (
            <input
              ref={valueRef}
              id="cv-value"
              type={type === 'number' ? 'number' : 'text'}
              maxLength={type === 'number' ? undefined : VALUE_MAX}
              value={value}
              onChange={(e) => { setValue(e.target.value); setSecretWarningFields(null) }}
              placeholder={spec.placeholder}
              className={styles.fieldInput}
              title={type === 'number' ? undefined : `${value.length}/${VALUE_MAX}文字`}
            />
          )}
          <VarFieldError message={valueFieldError} />
        </div>
      </section>

      <section className={styles.card} aria-labelledby="cv-new-period-heading">
        <div className={styles.cardHead}>
          <h2 id="cv-new-period-heading" className={styles.cardTitle}>使える期間</h2>
          <p className={styles.cardNote}>空なら期間を決めません。予約した配信は、送り始める時刻で判断します</p>
        </div>
        <div className={styles.periodGrid}>
          <label htmlFor="cv-valid-from" className={styles.fieldLabel}>始まり</label>
          <label htmlFor="cv-valid-until" className={styles.fieldLabel}>終わり</label>
          <label htmlFor="cv-expiry-behavior" className={styles.fieldLabel}>期間の外では</label>
          <DateTimeField id="cv-valid-from" value={validFrom} onChange={setValidFrom} />
          <DateTimeField id="cv-valid-until" value={validUntil} onChange={setValidUntil} />
          <div className={styles.selectBox}>
            <Select size="full" aria-label="期間の外では" id="cv-expiry-behavior" value={expiryBehavior} onChange={(next) => setExpiryBehavior(next as 'stop' | 'fallback')} options={[{ value: 'stop', label: '配信を止める' }, { value: 'fallback', label: '代替値を使う' }]} />
          </div>
        </div>
        {expiryBehavior === 'fallback' && (
          <div className={styles.field}>
            <label htmlFor="cv-fallback-value" className={styles.fieldLabel}>代替値</label>
            {type === 'boolean' ? (
              <Select size="full" aria-label="代替値" id="cv-fallback-value" value={fallbackValue} onChange={(next) => setFallbackValue(next)} options={[{ value: '', label: '選んでください' }, { value: 'true', label: 'true' }, { value: 'false', label: 'false' }]} />
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
                className={styles.fieldInput}
              />
            )}
            <VarFieldError message={fallbackFieldError} />
          </div>
        )}
      </section>

      <div className={styles.field}>
        <label htmlFor="cv-memo" className={styles.fieldLabelStrong}>
          社内メモ <span className={styles.optional}>任意</span>
        </label>
        <input
          id="cv-memo"
          type="text"
          maxLength={MEMO_MAX}
          value={memo}
          onChange={(e) => {
            setMemo(e.target.value)
            setSecretWarningFields(null)
          }}
          placeholder="臨時休業のときは「臨時のお知らせ」も直す"
          className={styles.fieldInput}
        />
      </div>

      {secretWarningFields && (
        <div
          ref={secretWarningRef}
          role="alertdialog"
          aria-labelledby="cv-secret-warning-title"
          aria-describedby="cv-secret-warning-description"
          className={styles.secretConfirm}
        >
          <h2 id="cv-secret-warning-title" className={styles.secretConfirmTitle}>
            秘密値の可能性がある内容を確認してください
          </h2>
          <p id="cv-secret-warning-description" className={styles.secretConfirmText}>
            {secretWarningFields.join('・')}に、パスワードやトークンなどの秘密値らしい内容があります。
            共通情報には保存せず、安全な保管場所へ移してください。
          </p>
          <div className={styles.secretConfirmActions}>
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

      {error && <p className={styles.formError} role="alert">{error}</p>}

      <UnsavedLeaveDialog open={leaveTarget !== null} subject="入力した共通情報" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </CreatePage>
  )
}
