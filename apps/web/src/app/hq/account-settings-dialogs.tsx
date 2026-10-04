'use client'

/*
 * ★V8-B 統括のアカウントの3つの窓（板 `HMpVx`・`D6ljr`・`HFsO9`）。
 * 統括ホーム（`hq/page.tsx`）のカードの「設定」・「戻す」から開く。
 * 名前・保存・復帰は今の口（`api.lineAccounts`）だけを使う。
 * タグの付け外しは口が無いため入れない。
 * 本人確認は6桁コード（認証アプリ）を窓の中で受け、用途
 * `line_account.archive` で取り直した鍵を付けて送る。
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Dialog from '@/components/shared/dialog'
import Button from '@/components/shared/button'
import Select from '@/components/shared/select'
import { TextField } from '@/components/shared/text-field'
import { api, type LineAccountTag } from '@/lib/api'
import type { AccountWithStats } from '@/contexts/account-context'
import { Plus, TrendingUp, Users } from 'lucide-react'

/* 6桁コードの升。貼り付けに対応し、動きは付けない（HANDOFF §8）。 */
function CodeBoxes({ value, onChange, disabled, label }: {
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  label: string
}) {
  const boxes = useRef<Array<HTMLInputElement | null>>([])
  const setDigit = (index: number, raw: string) => {
    if (raw === '') {
      onChange(value.slice(0, index) + value.slice(index + 1))
      if (index > 0) boxes.current[index - 1]?.focus()
      return
    }
    const digit = raw.replace(/\D/g, '').slice(-1)
    if (!digit) return
    onChange((value.slice(0, index) + digit + value.slice(index + 1)).slice(0, 6))
    if (index < 5) boxes.current[index + 1]?.focus()
  }
  return (
    <div className="flex gap-2" role="group" aria-label={label}>
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <input
          key={index}
          ref={(node) => { boxes.current[index] = node }}
          className="h-12 w-11 rounded-control border border-hairline bg-canvas text-center text-lg font-bold text-ink"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={1}
          value={value[index] ?? ''}
          disabled={disabled}
          aria-label={`${label}${index + 1}文字目`}
          onChange={(event) => setDigit(index, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && !value[index] && index > 0) boxes.current[index - 1]?.focus()
          }}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
            if (!pasted) return
            event.preventDefault()
            onChange(pasted)
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

/* 板 `HMpVx`：アカウントの設定（名前・親・ほかの設定・アーカイブ）。 */
export function AccountSettingsDialog({ account, accounts, archived, onClose, onSaved, onArchive, onShowDetails }: {
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
  const handle = account.basicId || account.channelId
  return (
    <Dialog
      open
      title="アカウントの設定"
      description={`${account.displayName || account.name}（@${handle}）`}
      designNode="HMpVx"
      busy={busy}
      error={error || undefined}
      onCancel={onClose}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button type="button" variant={archived ? 'secondary' : 'danger'} onClick={onArchive}>
            {archived ? '戻す' : 'アーカイブ'}
          </Button>
          <div className="flex gap-2">
            <Button type="button" onClick={onClose} disabled={busy}>
              キャンセル
            </Button>
            <Button type="button" variant="primary" onClick={() => void save()} disabled={busy} busy={busy} busyLabel="保存中…">
              保存
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="hq-account-settings-name" className="text-label font-medium text-ink">名前</label>
          <TextField
            id="hq-account-settings-name"
            value={name}
            maxLength={100}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            className="w-full"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="hq-account-settings-parent" className="text-label font-medium text-ink">親アカウント</label>
          <Select
            id="hq-account-settings-parent"
            aria-label="親アカウント"
            value={parent}
            disabled={busy}
            onChange={setParent}
            options={[
              { value: '', label: '変えない' },
              { value: 'none', label: 'なしにする' },
              ...accounts.filter((item) => item.id !== account.id).map((item) => ({ value: item.id, label: item.displayName || item.name })),
            ]}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-label font-medium text-ink">タグ <span className="font-normal text-micro text-ink-faint">複数付けられます</span></span>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => {
              const selected = selectedTags.includes(tag.id)
              return (
                <button
                  key={tag.id}
                  type="button"
                  aria-pressed={selected}
                  disabled={busy}
                  onClick={() => toggleTag(tag.id)}
                  className={
                    selected
                      ? 'inline-flex items-center gap-1 rounded-pill bg-ink px-2.5 py-1 text-caption font-semibold text-white disabled:opacity-50'
                      : 'inline-flex items-center gap-1 rounded-pill border border-hairline bg-white px-2.5 py-1 text-caption text-ink-secondary hover:bg-canvas-sunken disabled:opacity-50'
                  }
                >
                  {tag.name}
                </button>
              )
            })}
            {!addingTag ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => { setNewTagName(''); setAddingTag(true) }}
                className="inline-flex items-center gap-1 rounded-pill border border-dashed border-hairline px-2.5 py-1 text-caption text-ink-secondary hover:bg-canvas-sunken disabled:opacity-50"
              >
                <Plus aria-hidden="true" className="h-3.5 w-3.5" />タグを追加
              </button>
            ) : null}
          </div>
          {addingTag ? (
            <div className="flex items-center gap-2">
              <TextField
                aria-label="新しいタグの名前"
                value={newTagName}
                maxLength={100}
                disabled={busy}
                placeholder="例: 渋谷エリア"
                onChange={(event) => setNewTagName(event.target.value)}
                className="w-full"
              />
              <Button type="button" variant="secondary" onClick={() => void createTag()} disabled={!newTagName.trim() || busy}>
                追加
              </Button>
            </div>
          ) : null}
          <p className="text-micro text-ink-faint">タグはアカウント一覧の左の列で絞り込みに使います</p>
        </div>
        <div className="grid gap-2 text-sm">
          <span className="font-bold text-ink">ほかの設定</span>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={onShowDetails}>
              <TrendingUp aria-hidden="true" className="h-4 w-4" />詳しい数値を見る
            </Button>
            <Button href="/hq/members" variant="secondary">
              <Users aria-hidden="true" className="h-4 w-4" />メンバー・担当範囲
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  )
}

/* 板 `D6ljr`：アカウントをアーカイブ（理由＋本人確認）。 */
export function AccountArchiveDialog({ account, onClose, onDone }: {
  account: AccountWithStats
  onClose: () => void
  onDone: () => void
}) {
  const [reason, setReason] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const archive = async () => {
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
      setError(caught instanceof Error ? caught.message : 'アーカイブできませんでした。')
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
      <div className="flex flex-col gap-4">
        <label className="grid gap-1 text-sm">
          <span className="font-bold text-ink">アーカイブの理由（任意）</span>
          <input
            className="rounded-control border border-hairline bg-canvas px-3 py-2 text-ink"
            value={reason}
            maxLength={200}
            disabled={busy}
            placeholder="例：テスト用。使わなくなったため"
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <div className="grid gap-1 text-sm">
          <span className="font-bold text-ink">本人確認（認証アプリの6桁）</span>
          <CodeBoxes value={code} onChange={setCode} disabled={busy} label="認証コード" />
        </div>
      </div>
    </Dialog>
  )
}

/* 板 `HFsO9`：アーカイブから戻す（本人確認）。戻った直後は止まっている状態。 */
export function AccountRestoreDialog({ account, onClose, onDone }: {
  account: AccountWithStats
  onClose: () => void
  onDone: () => void
}) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const restore = async () => {
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
      setError(caught instanceof Error ? caught.message : '戻せませんでした。')
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
      <div className="grid gap-1 text-sm">
        <span className="font-bold text-ink">本人確認（認証アプリの6桁）</span>
        <CodeBoxes value={code} onChange={setCode} disabled={busy} label="認証コード" />
        <Link href="/hq/members" className="text-xs text-action">
          戻すのはオーナー・本人確認のある人だけです
        </Link>
      </div>
    </Dialog>
  )
}
