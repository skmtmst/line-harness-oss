'use client'

/*
 * ★V8 LINEアカウントの詳細から開く窓（送受信を止める CFAyf・資格情報を差し替える Msb1j・
 * アーカイブ WOfBN・登録の内容を編集する n9Z2P）。
 *
 * 窓の枠は共通の Dialog。絵の幅・上からの位置は designWidth・designTop で渡す。
 * 中身（帯・入力欄・下の操作）はここで並べる。保存の口・本人確認の流れは今の画面
 * （app/accounts/detail・components/accounts/account-edit-modal）と同じ。
 */
import { useId, useState, type ReactNode } from 'react'
import { Check, ShieldCheck } from 'lucide-react'
import type { LineAccount } from '@line-crm/shared'
import { api, ApiError, describeSaveFailure } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { readSessionSnapshot } from '@/lib/session-snapshot'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import OtpInput from '@/components/shared/otp-input'
import { TextField } from '@/components/shared/text-field'
import StepUpPrompt, { isStepUpRequired, stepUpFailureMessage, type StepUpRequest } from '@/components/step-up-prompt'
import TestRecipientsSetting from '@/components/accounts/test-recipients-setting'
import { ARCHIVE_BLOCKER_MESSAGES, parseCount, type AccountDetailView } from './view'
import styles from './dialogs.module.css'

/** 窓の枠。題・右上の×・中身・下の操作（右寄せ）。 */
function Frame({ open, node, width, top, title, busy, onCancel, actions, children }: {
  open: boolean
  node?: string
  width: number
  top?: number
  title: string
  busy?: boolean
  onCancel: () => void
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <Dialog
      open={open}
      title={title}
      designNode={node}
      designWidth={width}
      designTop={top}
      busy={busy}
      onCancel={onCancel}
      footer={actions ? <div className={styles.footer}>{actions}</div> : undefined}
    >
      <div className={styles.body}>{children}</div>
    </Dialog>
  )
}

function Field({ label, children, htmlFor }: { label: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  )
}

function ErrorLine({ message }: { message: string }) {
  return message ? <p role="alert" className={styles.error}>{message}</p> : null
}

/* ------------------------------------------------------------------ */
/* 送受信を止める・再開する（CFAyf）。理由は必須。 */

export function StopDialog({ account, onClose, onDone }: {
  account: LineAccount | null
  onClose: () => void
  onDone: () => Promise<void> | void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [stepUp, setStepUp] = useState<StepUpRequest | null>(null)
  const inputId = useId()
  const stopping = account?.isActive ?? true

  const close = () => {
    if (busy) return
    setReason('')
    setError('')
    onClose()
  }

  const run = async (stepUpToken?: string) => {
    if (!account) return
    const trimmed = reason.trim()
    if (!trimmed) {
      setError('理由を入れてください。あとから「なぜ止めたか」を追えるようにします。')
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = stopping
        ? await api.lineAccounts.deactivate(account.id, trimmed, stepUpToken)
        : await api.lineAccounts.activate(account.id, trimmed, stepUpToken)
      if (!res.success) throw new Error(res.error)
      setReason('')
      onClose()
      await onDone()
    } catch (caught) {
      // 大事な操作。本人確認を求められたら窓を立ててやり直す（V-1）。
      if (!stepUpToken && isStepUpRequired(caught)) {
        setStepUp({
          purpose: 'line_account.credentials',
          action: stopping ? 'アカウントの送受信を止める' : 'アカウントの送受信を再開する',
          retry: run,
        })
        return
      }
      // 接続が通らなくて再開できない等の理由は、API の言葉をそのまま見せる。
      setError(describeSaveFailure(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Frame
        open={account !== null}
        node={stopping ? 'CFAyf' : undefined}
        width={520}
        top={260}
        title={stopping ? `「${account?.name ?? ''}」の送受信を止めますか？` : `「${account?.name ?? ''}」の送受信を再開しますか？`}
        busy={busy}
        onCancel={close}
        actions={<>
          <Button type="button" onClick={close} disabled={busy}>キャンセル</Button>
          <Button type="button" variant={stopping ? 'danger' : 'primary'} onClick={() => void run()} disabled={busy} busy={busy} busyLabel="処理中…">
            {stopping ? '送受信を止める' : '送受信を再開する'}
          </Button>
        </>}
      >
        <p className={styles.warnBand}>
          {stopping
            ? '止めているあいだ、配信も受信もしません。予約した配信は送られません。'
            : '再開の前にLINEとの接続を確かめます。止めているあいだに予約していた配信は、自動で送り直しません。'}
        </p>
        <Field label={stopping ? '止める理由（必須）' : '再開する理由（必須）'} htmlFor={inputId}>
          <TextField
            id={inputId}
            maxLength={500}
            placeholder={stopping ? '例: 乗り換えの準備のため' : '例: 接続を直したので再開する'}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={busy}
          />
        </Field>
        <ErrorLine message={error} />
      </Frame>
      {stepUp && <StepUpPrompt request={stepUp} onDone={() => setStepUp(null)} onClose={() => setStepUp(null)} />}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* アーカイブ（WOfBN）。理由は任意。本人確認は窓の中で済ませる。 */

/** アーカイブできない理由（API の blockers）を、運用者の言葉で。 */
function archiveFailureMessage(caught: unknown): string {
  if (caught instanceof ApiError && caught.code === 'LINE_ACCOUNT_ARCHIVE_BLOCKED') {
    const blockers = (caught.data as { blockers?: string[] } | undefined)?.blockers ?? []
    const messages = blockers
      .map((key) => ARCHIVE_BLOCKER_MESSAGES[key])
      .filter((message): message is string => Boolean(message))
    if (messages.length > 0) return messages.join(' / ')
    return 'このアカウントはいまアーカイブできません。止まっているか、既定でないかを確かめてください。'
  }
  return describeSaveFailure(caught)
}

export function ArchiveDialog({ account, onClose, onDone }: {
  account: LineAccount | null
  onClose: () => void
  onDone: () => Promise<void> | void
}) {
  const [reason, setReason] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const reasonId = useId()
  const secretId = useId()
  const method = readSessionSnapshot()?.stepUpMethod ?? 'totp'
  const ready = method === 'none' || (method === 'totp' ? /^\d{6}$/.test(secret) : secret.length > 0)

  const close = () => {
    if (busy) return
    setReason('')
    setSecret('')
    setError('')
    onClose()
  }

  const run = async () => {
    if (!account || !ready) return
    setBusy(true)
    setError('')
    let token: string | undefined
    if (method !== 'none') {
      try {
        const res = await api.auth.stepUp({ method, value: secret, purpose: 'line_account.archive' })
        if (!res.success) throw new Error(res.error)
        token = res.data.token
      } catch (caught) {
        setError(stepUpFailureMessage(caught))
        setSecret('')
        setBusy(false)
        return
      }
    }
    try {
      const res = await api.lineAccounts.archive(account.id, reason.trim() || undefined, token)
      if (!res.success) throw new Error(res.error)
      setReason('')
      setSecret('')
      onClose()
      await onDone()
    } catch (caught) {
      setError(archiveFailureMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Frame
      open={account !== null}
      node="WOfBN"
      width={520}
      top={240}
      title={`「${account?.name ?? ''}」をアーカイブしますか？`}
      busy={busy}
      onCancel={close}
      actions={<>
        <Button type="button" onClick={close} disabled={busy}>キャンセル</Button>
        <Button type="button" variant="danger" onClick={() => void run()} disabled={busy || !ready} busy={busy} busyLabel="処理中…">
          {method === 'none' ? 'アーカイブする' : '本人確認してアーカイブする'}
        </Button>
      </>}
    >
      <p className={styles.infoBand}>一覧から外します。送受信は止まり、友だちと履歴は残ります。</p>
      <Field label="アーカイブの理由（任意）" htmlFor={reasonId}>
        <TextField
          id={reasonId}
          maxLength={500}
          placeholder="例: 使わなくなったため"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={busy}
        />
      </Field>
      {method === 'totp' ? (
        <div className={styles.verify}>
          <p className={styles.sub} id={secretId}>本人確認（認証アプリの6桁）</p>
          <div className={styles.otp}>
            <OtpInput value={secret} onChange={setSecret} visualLabel="認証コード（6桁）" labelledBy={secretId} invalid={Boolean(error)} disabled={busy} />
          </div>
        </div>
      ) : method === 'password' ? (
        <Field label="本人確認（パスワード）" htmlFor={secretId}>
          <TextField id={secretId} type="password" autoComplete="current-password" value={secret} onChange={(event) => setSecret(event.target.value)} disabled={busy} />
        </Field>
      ) : (
        <p className={styles.infoBand}>本人確認の方法（2段階認証・パスワード）が登録されていません。そのままアーカイブします。</p>
      )}
      <ErrorLine message={error} />
    </Frame>
  )
}

/* ------------------------------------------------------------------ */
/* アーカイブから戻す。戻った直後は「止まっている」状態。 */

export function RestoreDialog({ account, onClose, onDone }: {
  account: LineAccount | null
  onClose: () => void
  onDone: () => Promise<void> | void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [stepUp, setStepUp] = useState<StepUpRequest | null>(null)
  const close = () => {
    if (busy) return
    setError('')
    onClose()
  }
  const run = async (stepUpToken?: string) => {
    if (!account) return
    setBusy(true)
    setError('')
    try {
      const res = await api.lineAccounts.restore(account.id, stepUpToken)
      if (!res.success) throw new Error(res.error)
      onClose()
      await onDone()
    } catch (caught) {
      if (!stepUpToken && isStepUpRequired(caught)) {
        setStepUp({ purpose: 'line_account.credentials', action: `「${account.name}」をアーカイブから戻す`, retry: run })
        return
      }
      setError(describeSaveFailure(caught))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Frame
        open={account !== null}
        width={520}
        top={260}
        title={`「${account?.name ?? ''}」をアーカイブから戻しますか？`}
        busy={busy}
        onCancel={close}
        actions={<>
          <Button type="button" onClick={close} disabled={busy}>キャンセル</Button>
          <Button type="button" variant="primary" onClick={() => void run()} disabled={busy} busy={busy} busyLabel="処理中…">アーカイブから戻す</Button>
        </>}
      >
        <p className={styles.infoBand}>一覧へ戻します。戻った直後は「止まっている」状態です。送受信を始めるには、接続を確かめてから「送受信を再開する」を使います。</p>
        <ErrorLine message={error} />
      </Frame>
      {stepUp && <StepUpPrompt request={stepUp} onDone={() => setStepUp(null)} onClose={() => setStepUp(null)} />}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* 資格情報を差し替える（Msb1j）。空の欄は送らない（今の値を消さない）。 */

export type CredentialKind = 'messaging' | 'login'

export function CredentialsDialog({ account, kind, onClose, onSaved }: {
  account: LineAccount | null
  kind: CredentialKind
  onClose: () => void
  onSaved: () => void
}) {
  const [secret, setSecret] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [stepUp, setStepUp] = useState<StepUpRequest | null>(null)
  const secretId = useId()
  const tokenId = useId()

  const close = () => {
    if (busy) return
    setSecret('')
    setToken('')
    setError('')
    onClose()
  }

  const save = async (stepUpToken?: string) => {
    if (!account) return
    const payload: Parameters<typeof api.lineAccounts.update>[1] = {}
    if (kind === 'messaging') {
      if (secret.trim()) payload.channelSecret = secret.trim()
      if (token.trim()) payload.channelAccessToken = token.trim()
    } else if (secret.trim()) {
      payload.loginChannelSecret = secret.trim()
    }
    if (Object.keys(payload).length === 0) {
      setError('差し替える値を入れてください。空の欄は今の値のままにします。')
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = await api.lineAccounts.update(account.id, payload, stepUpToken)
      if (!res.success) throw new Error(res.error)
      setSecret('')
      setToken('')
      onSaved()
      onClose()
    } catch (caught) {
      // 接続情報の書き換えは大事な操作。本人確認を求められたら窓を立てる（V-1）。
      if (!stepUpToken && isStepUpRequired(caught)) {
        setStepUp({ purpose: 'line_account.credentials', action: '接続情報を変更する', retry: save })
        return
      }
      setError('保存に失敗しました。通信を確かめて、もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Frame
        open={account !== null}
        node="Msb1j"
        width={560}
        top={200}
        title="資格情報を差し替える"
        busy={busy}
        onCancel={close}
        actions={<>
          <Button type="button" onClick={close} disabled={busy}>キャンセル</Button>
          <Button type="button" variant="primary" onClick={() => void save()} disabled={busy} busy={busy} busyLabel="保存中…">
            <ShieldCheck size={14} aria-hidden="true" />本人確認して保存
          </Button>
        </>}
      >
        <p className={styles.sub}>{kind === 'messaging' ? 'Messaging API' : 'LINE Login'}</p>
        <Field label={kind === 'messaging' ? 'Channel Secret' : 'Login Channel Secret'} htmlFor={secretId}>
          <TextField id={secretId} type="password" autoComplete="off" placeholder="••••••••••••（新しい値を貼る）" value={secret} onChange={(event) => setSecret(event.target.value)} disabled={busy} />
        </Field>
        {kind === 'messaging' ? (
          <Field label="Channel Access Token" htmlFor={tokenId}>
            <TextField id={tokenId} type="password" autoComplete="off" placeholder="••••••••••••（新しい値を貼る）" value={token} onChange={(event) => setToken(event.target.value)} disabled={busy} />
          </Field>
        ) : null}
        <p className={styles.infoBand}>保存のときに本人確認が出ます。差し替えたあと、接続を確かめます。</p>
        <ErrorLine message={error} />
      </Frame>
      {stepUp && <StepUpPrompt request={stepUp} onDone={() => setStepUp(null)} onClose={() => setStepUp(null)} />}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* 登録の内容を編集する（n9Z2P）。変えた欄だけ送る。 */

export function EditDialog({ account, canEditTimezone, onClose, onSaved }: {
  account: AccountDetailView | null
  /** タイムゾーンはオーナーだけが変えられる。 */
  canEditTimezone: boolean
  onClose: () => void
  onSaved: () => void
}) {
  if (!account) return null
  return <EditDialogBody key={account.id} account={account} canEditTimezone={canEditTimezone} onClose={onClose} onSaved={onSaved} />
}

function EditDialogBody({ account, canEditTimezone, onClose, onSaved }: {
  account: AccountDetailView
  canEditTimezone: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const initialTimezone = account.timezone ?? 'Asia/Tokyo'
  const [name, setName] = useState(account.name)
  const [timezone, setTimezone] = useState(initialTimezone)
  const [loginChannelId, setLoginChannelId] = useState(account.loginChannelId ?? '')
  const [liffId, setLiffId] = useState(account.liffId ?? '')
  const [ogSiteName, setOgSiteName] = useState(account.ogSiteName ?? '')
  const [ogDescription, setOgDescription] = useState(account.ogDefaultDescription ?? '')
  const [ogImageUrl, setOgImageUrl] = useState(account.ogDefaultImageUrl ?? '')
  const [showOgMore, setShowOgMore] = useState(false)
  const [capacity, setCapacity] = useState(account.friendCapacity == null ? '' : formatNumber(account.friendCapacity))
  const [warnAt, setWarnAt] = useState(account.capacityWarnAt == null ? '' : formatNumber(account.capacityWarnAt))
  const [iconUrl, setIconUrl] = useState(account.iconUrl ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [stepUp, setStepUp] = useState<StepUpRequest | null>(null)
  const ids = { name: useId(), tz: useId(), login: useId(), liff: useId(), og: useId(), ogDesc: useId(), ogImage: useId(), cap: useId(), warn: useId(), icon: useId() }

  const close = () => {
    if (!busy) onClose()
  }

  const save = async (stepUpToken?: string) => {
    if (!name.trim()) {
      setError('アカウント名を入れてください。')
      return
    }
    const capacityNext = parseCount(capacity)
    const warnNext = parseCount(warnAt)
    if (Number.isNaN(capacityNext) || Number.isNaN(warnNext)) {
      setError('友だちの上限と警告を出す人数は、数字で入れてください。')
      return
    }
    if (capacityNext !== null && warnNext !== null && warnNext > capacityNext) {
      setError('警告を出す人数は上限以下にしてください。上限を超える値は鳴りません。')
      return
    }
    const payload: Parameters<typeof api.lineAccounts.update>[1] = {}
    if (name.trim() !== account.name) payload.name = name.trim()
    if (canEditTimezone && timezone.trim() !== initialTimezone) payload.timezone = timezone.trim()
    const loginNext = loginChannelId.trim() || null
    if (loginNext !== (account.loginChannelId ?? null)) {
      payload.loginChannelId = loginNext
      // Login の ID を消したら、組になる秘密も一緒に消す（片方だけ残すとサーバが断る）。
      if (loginNext === null && account.loginChannelId) payload.loginChannelSecret = null
    }
    if ((liffId.trim() || null) !== (account.liffId ?? null)) payload.liffId = liffId.trim() || null
    if ((ogSiteName.trim() || null) !== (account.ogSiteName ?? null)) payload.ogSiteName = ogSiteName.trim() || null
    if ((ogDescription.trim() || null) !== (account.ogDefaultDescription ?? null)) payload.ogDefaultDescription = ogDescription.trim() || null
    if ((ogImageUrl.trim() || null) !== (account.ogDefaultImageUrl ?? null)) payload.ogDefaultImageUrl = ogImageUrl.trim() || null
    if (capacityNext !== (account.friendCapacity ?? null)) payload.friendCapacity = capacityNext
    if (warnNext !== (account.capacityWarnAt ?? null)) payload.capacityWarnAt = warnNext
    if ((iconUrl.trim() || null) !== (account.iconUrl ?? null)) payload.iconUrl = iconUrl.trim() || null
    if (Object.keys(payload).length === 0) {
      onClose()
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = await api.lineAccounts.update(account.id, payload, stepUpToken)
      if (!res.success) throw new Error(res.error)
      onSaved()
      onClose()
    } catch (caught) {
      if (!stepUpToken && isStepUpRequired(caught)) {
        setStepUp({ purpose: 'line_account.credentials', action: '接続情報を変更する', retry: save })
        return
      }
      setError('保存に失敗しました。通信を確かめて、もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Frame
        open
        node="n9Z2P"
        width={580}
        top={120}
        title="登録の内容を編集する"
        busy={busy}
        onCancel={close}
        actions={<>
          <Button type="button" onClick={close} disabled={busy}>キャンセル</Button>
          <Button type="button" variant="primary" onClick={() => void save()} disabled={busy} busy={busy} busyLabel="保存中…">
            <Check size={14} aria-hidden="true" />保存する
          </Button>
        </>}
      >
        <div className={styles.pair}>
          <Field label="アカウント名" htmlFor={ids.name}>
            <TextField id={ids.name} required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} disabled={busy} />
          </Field>
          {canEditTimezone ? (
            <div className={styles.narrow}>
              <Field label="タイムゾーン" htmlFor={ids.tz}>
                <TextField id={ids.tz} value={timezone} onChange={(event) => setTimezone(event.target.value)} disabled={busy} />
              </Field>
            </div>
          ) : null}
        </div>
        <div className={styles.pair}>
          <Field label="LINE Login（任意）" htmlFor={ids.login}>
            <TextField id={ids.login} placeholder="チャネル ID" value={loginChannelId} onChange={(event) => setLoginChannelId(event.target.value)} disabled={busy} />
          </Field>
          <Field label="LIFF（任意）" htmlFor={ids.liff}>
            <TextField id={ids.liff} placeholder="LIFF ID" value={liffId} onChange={(event) => setLiffId(event.target.value)} disabled={busy} />
          </Field>
        </div>
        <div className={styles.field}>
          <div className={styles.labelRow}>
            <label className={styles.label} htmlFor={ids.og}>ブランド設定（OGP）</label>
            <button type="button" className={styles.more} aria-expanded={showOgMore} onClick={() => setShowOgMore((value) => !value)}>
              {showOgMore ? '説明と画像を閉じる' : '説明と画像も変える'}
            </button>
          </div>
          <TextField id={ids.og} placeholder="共有したときに出る名前" value={ogSiteName} onChange={(event) => setOgSiteName(event.target.value)} disabled={busy} />
        </div>
        {showOgMore ? (
          <>
            <Field label="共有したときの説明" htmlFor={ids.ogDesc}>
              <TextField id={ids.ogDesc} value={ogDescription} onChange={(event) => setOgDescription(event.target.value)} disabled={busy} />
            </Field>
            <Field label="共有したときの画像のURL" htmlFor={ids.ogImage}>
              <TextField id={ids.ogImage} type="url" value={ogImageUrl} onChange={(event) => setOgImageUrl(event.target.value)} disabled={busy} />
            </Field>
          </>
        ) : null}
        <div className={styles.pair}>
          <Field label="友だちの上限" htmlFor={ids.cap}>
            <TextField id={ids.cap} inputMode="numeric" placeholder="管理しない" value={capacity} onChange={(event) => setCapacity(event.target.value)} disabled={busy} />
          </Field>
          <Field label="警告を出す人数" htmlFor={ids.warn}>
            <TextField id={ids.warn} inputMode="numeric" placeholder="警告しない" value={warnAt} onChange={(event) => setWarnAt(event.target.value)} disabled={busy} />
          </Field>
        </div>
        <Field label="アイコンのURL" htmlFor={ids.icon}>
          <TextField id={ids.icon} type="url" placeholder="https://example.com/icon.png" value={iconUrl} onChange={(event) => setIconUrl(event.target.value)} disabled={busy} />
        </Field>
        <ErrorLine message={error} />
      </Frame>
      {stepUp && <StepUpPrompt request={stepUp} onDone={() => setStepUp(null)} onClose={() => setStepUp(null)} />}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* テスト送信先を変える。中身は今の部品（検索・追加・外す）をそのまま使う。 */

export function TestRecipientsDialog({ accountId, open, onClose }: { accountId: string; open: boolean; onClose: () => void }) {
  return (
    <Frame
      open={open}
      width={560}
      top={160}
      title="テスト送信先"
      onCancel={onClose}
    >
      <p className={styles.infoBand}>リマインダや配信のテスト送信が届く先です。変更はこのアカウントだけに効きます。</p>
      <div className={styles.fill}><TestRecipientsSetting accountId={accountId} /></div>
    </Frame>
  )
}
