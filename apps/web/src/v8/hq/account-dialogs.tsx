'use client'

/*
 * ★V8 統括のアカウントの3つの窓（板 `HMpVx` 設定・`D6ljr` アーカイブ・`HFsO9` 戻す）。
 * 統括ホームのカードの「設定」・「戻す」から開く。
 * 読み書きの口・本人確認は v7（app/hq/account-settings-dialogs.tsx）と同じ（import できないので写した）。
 * 設定の窓だけ、見た目を絵 `HMpVx` どおりに組み直した。
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { CircleDot, Star, TrendingUp, Users } from 'lucide-react'
import Dialog from '@/components/shared/dialog'
import { otpDigits, otpFailureMessage } from '@/components/shared/otp-input'
import Button from '@/components/shared/button'
import FilterChip from '@/components/shared/filter-chip'
import Select from '@/components/shared/select'
import { TextField } from '@/components/shared/text-field'
import { api, type LineAccountTag } from '@/lib/api'
import type { AccountWithStats } from '@/contexts/account-context'
import head from './dialog-head.module.css'
import styles from './account-dialogs.module.css'

/** 絵 `HMpVx` の窓の幅と上からの位置（px）。 */
const SETTINGS_WIDTH = 560
const SETTINGS_TOP = 200

/* 6桁コードの升。貼り付けに対応し、動きは付けない（HANDOFF §8）。 */
function CodeBoxes({ value, onChange, onComplete, disabled, invalid = false, label }: {
  value: string
  onChange: (next: string) => void
  /** 6桁そろった瞬間に1回（送るボタンを押させない。動きの点検・6）。 */
  onComplete?: (code: string) => void
  disabled?: boolean
  /** 違った。6桁を消して1枠目へ戻す。 */
  invalid?: boolean
  label: string
}) {
  const boxes = useRef<Array<HTMLInputElement | null>>([])
  const write = (next: string) => {
    const clean = otpDigits(next).slice(0, 6)
    onChange(clean)
    if (clean.length === 6 && value.length !== 6 && !disabled) onComplete?.(clean)
  }
  useEffect(() => {
    if (!invalid) return
    onChange('')
    boxes.current[0]?.focus()
    // 違ったと分かった瞬間だけ。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invalid])
  const setDigit = (index: number, raw: string) => {
    if (raw === '') {
      onChange(value.slice(0, index) + value.slice(index + 1))
      if (index > 0) boxes.current[index - 1]?.focus()
      return
    }
    // 全角の数字は半角に。自動入力で1枠に6桁まとめて来たら、全部の枠へ振り分ける。
    const digits = otpDigits(raw)
    if (!digits) return
    if (digits.length > 1) {
      write(value.slice(0, index) + digits)
      boxes.current[Math.min(index + digits.length, 5)]?.focus()
      return
    }
    write(value.slice(0, index) + digits + value.slice(index + 1))
    if (index < 5) boxes.current[index + 1]?.focus()
  }
  return (
    <div className={styles.codeBoxes} role="group" aria-label={label}>
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <input
          key={index}
          ref={(node) => { boxes.current[index] = node }}
          className={styles.codeBox}
          inputMode="numeric"
          autoComplete="one-time-code"
          value={value[index] ?? ''}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-label={`${label}${index + 1}文字目`}
          onChange={(event) => setDigit(index, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && !value[index] && index > 0) boxes.current[index - 1]?.focus()
          }}
          onPaste={(event) => {
            const pasted = otpDigits(event.clipboardData.getData('text')).slice(0, 6)
            if (!pasted) return
            event.preventDefault()
            write(pasted)
            boxes.current[Math.min(pasted.length, 5)]?.focus()
          }}
        />
      ))}
    </div>
  )
}

async function stepUpToken(code: string): Promise<string> {
  const res = await api.auth.stepUp({ method: 'totp', value: code, purpose: 'line_account.archive' })
  if (!res.success) throw new Error(res.error || '認証コードを確認できませんでした。')
  return res.data.token
}

/** 窓に出す呼び名。「然 -NEN- 渋谷店（@nen-shibuya）」。 */
export function accountHandle(account: AccountWithStats): string {
  return account.basicId || account.channelId
}

/* 板 `HMpVx`：アカウントの設定（名前・親・タグ・ほかの設定・アーカイブ）。 */
export function AccountSettingsDialogV8({ account, accounts, archived, onClose, onSaved, onArchive, onShowDetails }: {
  account: AccountWithStats
  accounts: AccountWithStats[]
  archived: boolean
  onClose: () => void
  onSaved: () => void
  onArchive: () => void
  onShowDetails: () => void
}) {
  const [name, setName] = useState(account.name)
  const [parent, setParent] = useState('')
  const [tags, setTags] = useState<LineAccountTag[]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>(() => (account.tags ?? []).map((tag) => tag.id))
  const [addingTag, setAddingTag] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void api.lineAccountTags.list().then((res) => {
      if (!cancelled && res.success && Array.isArray(res.data)) setTags(res.data)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const toggleTag = (id: string) => {
    setSelectedTags((prev) => (prev.includes(id) ? prev.filter((tagId) => tagId !== id) : [...prev, id]))
  }

  const createTag = async () => {
    const tagName = newTagName.trim()
    if (!tagName || busy) return
    setBusy(true)
    setError('')
    try {
      const res = await api.lineAccountTags.create(tagName)
      if (!res.success) {
        setError(res.error)
        return
      }
      setTags((prev) => [...prev, res.data])
      setSelectedTags((prev) => (prev.includes(res.data.id) ? prev : [...prev, res.data.id]))
      setNewTagName('')
      setAddingTag(false)
    } catch {
      setError('タグを追加できませんでした。通信を確認して、もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (busy) return
    if (!name.trim()) {
      setError('名前を入力してください。')
      return
    }
    setBusy(true)
    setError('')
    try {
      if (name.trim() !== account.name) {
        const res = await api.lineAccounts.update(account.id, { name: name.trim() })
        if (!res.success) {
          setError(res.error)
          return
        }
      }
      if (parent !== '') {
        const res = await api.lineAccounts.updateHierarchy([
          { id: account.id, parentLineAccountId: parent === 'none' ? null : parent },
        ])
        if (!res.success) {
          setError(res.error)
          return
        }
      }
      const before = new Set((account.tags ?? []).map((tag) => tag.id))
      const after = new Set(selectedTags)
      const changed = before.size !== after.size || [...after].some((id) => !before.has(id))
      if (changed) {
        const res = await api.lineAccountTags.replace(account.id, selectedTags)
        if (!res.success) {
          setError(res.error === 'ACCOUNT_ARCHIVED' ? 'アーカイブ済みのためタグを変えられません。' : res.error)
          return
        }
      }
      onSaved()
    } catch {
      setError('保存できませんでした。通信を確認して、もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  /* 親アカウントの選ぶ欄。今の親があればそれを最初に見せる（絵は「然 -NEN- 本店」）。 */
  const currentParent = (account as { parentLineAccountId?: string | null }).parentLineAccountId ?? null
  const parentName = currentParent ? accounts.find((item) => item.id === currentParent) : null
  return (
    <Dialog
      open
      title="アカウントの設定"
      description={`${account.displayName || account.name}（@${accountHandle(account)}）`}
      designNode="HMpVx"
      designWidth={SETTINGS_WIDTH}
      designTop={SETTINGS_TOP}
      busy={busy}
      error={error || undefined}
      onCancel={onClose}
      footer={
        <div className={`${head.footer} ${head.footerSplit}`}>
          <Button type="button" variant={archived ? 'secondary' : 'danger'} onClick={onArchive}>
            {archived ? '戻す' : 'アーカイブ'}
          </Button>
          <div className={head.footerGroup}>
            <Button type="button" onClick={onClose} disabled={busy}>キャンセル</Button>
            <Button type="button" variant="primary" onClick={() => void save()} disabled={busy} busy={busy} busyLabel="保存中…">保存</Button>
          </div>
        </div>
      }
    >
      <div className={head.head}>
        <div className={styles.field}>
          <label htmlFor="hq-account-settings-name" className={styles.labelLarge}>名前</label>
          <TextField
            id="hq-account-settings-name"
            value={name}
            maxLength={100}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            className={styles.full}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="hq-account-settings-parent" className={styles.label}>親アカウント</label>
          <Select
            id="hq-account-settings-parent"
            aria-label="親アカウント"
            size="full"
            value={parent}
            disabled={busy}
            onChange={setParent}
            options={[
              { value: '', label: parentName ? (parentName.displayName || parentName.name) : '変えない' },
              { value: 'none', label: 'なしにする' },
              ...accounts.filter((item) => item.id !== account.id && item.id !== currentParent).map((item) => ({ value: item.id, label: item.displayName || item.name })),
            ]}
          />
        </div>
        <div className={styles.tagField}>
          <p className={styles.labelRow}><span className={styles.label}>タグ</span><span className={styles.note}>複数つけられます</span></p>
          <div className={styles.tagRow}>
            {tags.map((tag) => (
              <FilterChip
                key={tag.id}
                selected={selectedTags.includes(tag.id)}
                icon={selectedTags.includes(tag.id) ? <CircleDot size={14} aria-hidden="true" /> : <Star size={14} aria-hidden="true" />}
                disabled={busy}
                onChange={() => toggleTag(tag.id)}
              >
                {tag.name}
              </FilterChip>
            ))}
            {!addingTag ? (
              <Button type="button" disabled={busy} onClick={() => { setNewTagName(''); setAddingTag(true) }}>タグを追加</Button>
            ) : null}
          </div>
          {addingTag ? (
            <div className={styles.addRow}>
              <TextField
                aria-label="新しいタグの名前"
                value={newTagName}
                maxLength={100}
                disabled={busy}
                placeholder="例: 渋谷エリア"
                onChange={(event) => setNewTagName(event.target.value)}
                className={styles.full}
              />
              <Button type="button" onClick={() => void createTag()} disabled={!newTagName.trim() || busy}>追加</Button>
            </div>
          ) : null}
          <p className={styles.note}>タグは アカウント一覧の左の列で絞り込みに使います</p>
        </div>
        <div className={styles.field}>
          <p className={styles.label}>ほかの設定</p>
          <div className={styles.buttonRow}>
            <Button type="button" onClick={onShowDetails}>
              <TrendingUp aria-hidden="true" className={styles.icon} />詳しい数値を見る
            </Button>
            <Button href="/hq/members">
              <Users aria-hidden="true" className={styles.icon} />メンバー・担当範囲
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  )
}

/* 板 `D6ljr`：アカウントをアーカイブ（理由＋本人確認）。 */
export function AccountArchiveDialogV8({ account, onClose, onDone }: {
  account: AccountWithStats
  onClose: () => void
  onDone: () => void
}) {
  const [reason, setReason] = useState('')
  const [typedCode, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /* 6桁目が入った瞬間にも送る（entered）。送っている間は二重に送らない。 */
  const archive = async (entered?: string) => {
    const code = entered ?? typedCode
    if (busy) return
    if (code.replace(/\D/g, '').length !== 6) {
      setError('認証アプリの6桁コードを入力してください。')
      return
    }
    setBusy(true)
    setError('')
    try {
      const token = await stepUpToken(code)
      const res = await api.lineAccounts.archive(account.id, reason.trim() || undefined, token)
      if (!res.success) {
        setError(res.error)
        return
      }
      onDone()
    } catch (caught) {
      setError(caught instanceof Error ? otpFailureMessage(caught.message) : 'アーカイブできませんでした。')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      title={`「${account.name}」をアーカイブしますか？`}
      description="一覧から外します。送受信は止まり、友だちと履歴は残ります。あとで「戻す」で戻せます（オーナーのみ）。"
      tone="destructive"
      designNode="D6ljr"
      confirmLabel="本人確認してアーカイブする"
      busy={busy}
      error={error || undefined}
      onConfirm={() => void archive()}
      onCancel={onClose}
    >
      <div className={styles.stack}>
        <div className={styles.field}>
          <label htmlFor="hq-account-archive-reason" className={styles.label}>アーカイブの理由（任意）</label>
          <TextField
            id="hq-account-archive-reason"
            value={reason}
            maxLength={200}
            disabled={busy}
            placeholder="例：テスト用。使わなくなったため"
            onChange={(event) => setReason(event.target.value)}
            className={styles.full}
          />
        </div>
        <div className={styles.field}>
          <span className={styles.label}>本人確認（認証アプリの6桁）</span>
          <CodeBoxes value={typedCode} onChange={(next) => { setCode(next); if (next && error) setError('') }} onComplete={(entered) => void archive(entered)} invalid={Boolean(error)} disabled={busy} label="認証コード" />
        </div>
      </div>
    </Dialog>
  )
}

/* 板 `HFsO9`：アーカイブから戻す（本人確認）。戻った直後は止まっている状態。 */
export function AccountRestoreDialogV8({ account, onClose, onDone }: {
  account: AccountWithStats
  onClose: () => void
  onDone: () => void
}) {
  const [typedCode, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /* 6桁目が入った瞬間にも送る（entered）。送っている間は二重に送らない。 */
  const restore = async (entered?: string) => {
    const code = entered ?? typedCode
    if (busy) return
    if (code.replace(/\D/g, '').length !== 6) {
      setError('認証アプリの6桁コードを入力してください。')
      return
    }
    setBusy(true)
    setError('')
    try {
      const token = await stepUpToken(code)
      const res = await api.lineAccounts.restore(account.id, token)
      if (!res.success) {
        setError(res.error)
        return
      }
      onDone()
    } catch (caught) {
      setError(caught instanceof Error ? otpFailureMessage(caught.message) : '戻せませんでした。')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      title={`「${account.name}」をアーカイブから戻しますか？`}
      description="戻した直後は「止まっている」状態です。送受信を始めるときは、アカウントの詳細で「動かす」を押します。"
      designNode="HFsO9"
      confirmLabel="本人確認して戻す"
      busy={busy}
      error={error || undefined}
      onConfirm={() => void restore()}
      onCancel={onClose}
    >
      <div className={styles.field}>
        <span className={styles.label}>本人確認（認証アプリの6桁）</span>
        <CodeBoxes value={typedCode} onChange={(next) => { setCode(next); if (next && error) setError('') }} onComplete={(entered) => void restore(entered)} invalid={Boolean(error)} disabled={busy} label="認証コード" />
        <Link href="/hq/members" className={styles.link}>戻すのはオーナー・本人確認のある人だけです</Link>
      </div>
    </Dialog>
  )
}
