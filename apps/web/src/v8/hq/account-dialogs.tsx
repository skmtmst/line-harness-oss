'use client'

/*
 * ★V8 統括のアカウントの3つの窓（板 `HMpVx` 設定・`D6ljr` アーカイブ・`HFsO9` 戻す）。
 * 統括ホームのカードの「設定」・「戻す」から開く。
 * 読み書きの口・本人確認は v7（app/hq/account-settings-dialogs.tsx）と同じ（import できないので写した）。
 * 設定の窓だけ、見た目を絵 `HMpVx` どおりに組み直した。
 */
import { useEffect, useState } from 'react'
import { CircleHelp, RotateCcw, Users } from 'lucide-react'
import Dialog from '@/components/shared/dialog'
import OtpInput, { otpFailureMessage } from '@/components/shared/otp-input'
import Button from '@/components/shared/button'
import Select from '@/components/shared/select'
import { TextField } from '@/components/shared/text-field'
import { api } from '@/lib/api'
import type { Folder } from '@line-crm/shared'
import type { AccountWithStats } from '@/contexts/account-context'
import head from './dialog-head.module.css'
import styles from './account-dialogs.module.css'
import { FALLBACK_REASON, connectionReasons, lineHandle } from './connection-reasons'

/** 絵 `HMpVx` の窓の幅と上からの位置（px）。 */
const SETTINGS_WIDTH = 560
const SETTINGS_TOP = 200
/** 絵 `D6ljr`・`HFsO9` の窓の幅と上からの位置（px）。 */
const ARCHIVE_WIDTH = 520
const ARCHIVE_TOP = 240
const RESTORE_TOP = 220

async function stepUpToken(code: string): Promise<string> {
  const res = await api.auth.stepUp({ method: 'totp', value: code, purpose: 'line_account.archive' })
  if (!res.success) throw new Error(res.error || '認証コードを確認できませんでした。')
  return res.data.token
}

/** 窓に出す呼び名。「然 -NEN- 渋谷店（@nen-shibuya）」。@ は付けて返す（LINE の basicId は @ 付きで来るので二重にしない）。 */
export function accountHandle(account: AccountWithStats): string {
  return lineHandle(account)
}

/* 板 `HMpVx`：アカウントの設定（名前・親・フォルダ・ほかの設定・アーカイブ）。2026-10-08 タグ→フォルダ（1つだけ・API-17）。 */
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
  const initialFolder = (account as { folderId?: string | null }).folderId ?? ''
  const [folders, setFolders] = useState<Folder[]>([])
  const [folderId, setFolderId] = useState<string>(initialFolder)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void api.lineAccountFolders.list().then((res) => {
      if (!cancelled && res.success && Array.isArray(res.data?.folders)) setFolders([...res.data.folders].sort((a, b) => a.displayOrder - b.displayOrder))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

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
      if (folderId !== initialFolder) {
        const res = await api.lineAccountFolders.move(account.id, folderId || null)
        if (!res.success) {
          setError(res.error === 'ACCOUNT_ARCHIVED' ? 'アーカイブ済みのためフォルダを変えられません。' : res.error)
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
      description={`${account.displayName || account.name}（${accountHandle(account)}）`}
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
        <div className={styles.field}>
          <label htmlFor="hq-account-folder" className={styles.label}>フォルダ</label>
          <Select
            id="hq-account-folder"
            aria-label="フォルダ"
            size="full"
            value={folderId}
            disabled={busy}
            onChange={setFolderId}
            options={[{ value: '', label: '未分類' }, ...folders.map((item) => ({ value: item.id, label: item.name }))]}
          />
          <p className={styles.note}>アカウントは1つのフォルダに入ります。アカウント一覧の左の列で絞り込みに使います</p>
        </div>
        {!archived && account.connection?.status === 'warn' ? (
          /* 要確認のときだけ：引っかかった確認ごとの理由（URL は折り返して全文）。 */
          <div className={styles.field}>
            <p className={styles.label}>接続の確認</p>
            <ul className={styles.reasonList} aria-label="要確認の理由">
              {(connectionReasons(account).length > 0 ? connectionReasons(account).map((reason) => reason.detail) : [FALLBACK_REASON])
                .map((detail) => <li key={detail}>{detail}</li>)}
            </ul>
          </div>
        ) : null}
        <div className={styles.field}>
          <p className={styles.label}>ほかの設定</p>
          <div className={styles.buttonRow}>
            <Button type="button" onClick={onShowDetails}>
              <CircleHelp aria-hidden="true" className={styles.icon} />詳しい数値を見る
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
      designNode="D6ljr"
      designWidth={ARCHIVE_WIDTH}
      designTop={ARCHIVE_TOP}
      busy={busy}
      error={error || undefined}
      onCancel={onClose}
      footer={
        <div className={`${head.footer} ${head.footerEnd}`}>
          <Button type="button" onClick={onClose} disabled={busy}>キャンセル</Button>
          <Button type="button" variant="danger" onClick={() => void archive()} disabled={busy} busy={busy} busyLabel="アーカイブ中…">本人確認してアーカイブする</Button>
        </div>
      }
    >
      <div className={head.head}>
        <p className={styles.lead}>一覧から外します。送受信は止まり、友だちと履歴は残ります。あとで「戻す」で戻せます（オーナーのみ）。</p>
        <div className={styles.field}>
          <label htmlFor="hq-account-archive-reason" className={styles.labelLarge}>アーカイブの理由（任意）</label>
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
          <span className={styles.stepLabel}>本人確認（認証アプリの6桁）</span>
          <OtpInput visualLabel="認証コード（6桁）" label="認証コード" value={typedCode} onChange={(next) => { setCode(next); if (next && error) setError('') }} onComplete={(entered) => void archive(entered)} invalid={Boolean(error)} busy={busy} />
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
      designNode="HFsO9"
      designWidth={ARCHIVE_WIDTH}
      designTop={RESTORE_TOP}
      busy={busy}
      error={error || undefined}
      onCancel={onClose}
      footer={
        <div className={`${head.footer} ${head.footerEnd}`}>
          <Button type="button" onClick={onClose} disabled={busy}>キャンセル</Button>
          <Button type="button" variant="primary" onClick={() => void restore()} disabled={busy} busy={busy} busyLabel="戻しています…">
            <RotateCcw aria-hidden="true" className={styles.icon} />本人確認して戻す
          </Button>
        </div>
      }
    >
      <div className={head.head}>
        <p className={styles.lead}>戻した直後は「止まっている」状態です。送受信を始めるときは、アカウントの詳細で「動かす」を押します。</p>
        <div className={styles.field}>
          <span className={styles.stepLabel}>本人確認（認証アプリの6桁）</span>
          <OtpInput visualLabel="認証コード（6桁）" label="認証コード" value={typedCode} onChange={(next) => { setCode(next); if (next && error) setError('') }} onComplete={(entered) => void restore(entered)} invalid={Boolean(error)} busy={busy} />
        </div>
      </div>
    </Dialog>
  )
}
