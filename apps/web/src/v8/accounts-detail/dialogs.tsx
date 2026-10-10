'use client'

/*
 * ★V8 LINEアカウントの詳細から開く窓（送受信を止める CFAyf・資格情報を差し替える Msb1j・
 * アーカイブ WOfBN・登録の内容を編集する n9Z2P）。
 *
 * 窓の枠は共通の Dialog。絵の幅・上からの位置は designWidth・designTop で渡す。
 * 中身（帯・入力欄・下の操作）はここで並べる。保存の口・本人確認の流れは今の画面
 * （app/accounts/detail・components/accounts/account-edit-modal）と同じ。
 */
import ImageUploader from '@/components/shared/image-uploader'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Check, ShieldCheck } from 'lucide-react'
import type { LineAccount } from '@line-crm/shared'
import { api, ApiError, describeSaveFailure } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { readSessionSnapshot } from '@/lib/session-snapshot'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import Notice from '@/components/shared/notice'
import OtpInput from '@/components/shared/otp-input'
import { TextField } from '@/components/shared/text-field'
import { Field } from '@/components/shared/form-controls'
import { useFormErrors } from '@/lib/use-form-errors'
import StepUpPrompt, { isStepUpRequired, stepUpFailureMessage, type StepUpRequest } from '@/components/step-up-prompt'
import TestRecipientsSetting from '@/components/accounts/test-recipients-setting'
import { ARCHIVE_BLOCKER_MESSAGES, parseCount, type AccountDetailView } from './view'
import styles from './dialogs.module.css'
import { withPermissionFailure } from '@/components/shared/api-error-message'
import NumberInput from '@/components/shared/number-field'

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
      layout="account-inset"
      footer={actions}
    >
      <div className={styles.body}>{children}</div>
    </Dialog>
  )
}

/** 欄の誤りが描画されたら、先頭へ移動する。通信失敗は上の案内へ残す。 */
function useInvalidFocus(errors: Record<string, string>, ids: Record<string, string>) {
  const idsRef = useRef(ids)
  idsRef.current = ids
  useEffect(() => {
    const key = Object.keys(errors)[0]
    if (!key) return
    // 窓を開いた直後のフォーカス移動より後に、誤りの欄を標的にする。
    const frame = requestAnimationFrame(() => {
      const input = document.getElementById(idsRef.current[key])
      input?.focus()
      input?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(frame)
  }, [errors])
}

function ErrorLine({ message }: { message: string }) {
  return message ? <Notice tone="danger" >{message}</Notice> : null
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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [stepUp, setStepUp] = useState<StepUpRequest | null>(null)
  const inputId = useId()
  useInvalidFocus(fieldErrors, { reason: inputId })
  const stopping = account?.isActive ?? true

  const close = () => {
    if (busy) return
    setReason('')
    setFieldErrors({})
    setError('')
    onClose()
  }

  const run = async (stepUpToken?: string) => {
    if (!account) return
    const trimmed = reason.trim()
    if (!trimmed) {
      setFieldErrors({ reason: '理由を入れてください。あとから「なぜ止めたか」を追えるようにします。' })
      setError('')
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
      setError(withPermissionFailure(caught, describeSaveFailure(caught), 'store'))
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
        <Notice tone="warn" presentation="account-note" icon={null}>
          {stopping
            ? '止めているあいだ、配信も受信もしません。予約した配信は送られません。'
            : '再開の前にLINEとの接続を確かめます。止めているあいだに予約していた配信は、自動で送り直しません。'}
        </Notice>
        <Field label={stopping ? '止める理由（必須）' : '再開する理由（必須）'} htmlFor={inputId} error={fieldErrors.reason}>
          <TextField
            id={inputId}
            maxLength={500}
            placeholder={stopping ? '例：乗り換えの準備のため' : '例：接続を直したので再開する'}
            value={reason}
            onChange={(event) => { setReason(event.target.value); setFieldErrors({}) }}
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
  return withPermissionFailure(caught, describeSaveFailure(caught), 'store')
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

  /* 6桁目が入った瞬間にも送る（entered）。送っている間は二重に送らない。 */
  const run = async (entered?: string) => {
    const value = entered ?? secret
    const valueReady = method === 'none' || (method === 'totp' ? /^\d{6}$/.test(value) : value.length > 0)
    if (!account || !valueReady || busy) return
    setBusy(true)
    setError('')
    let token: string | undefined
    if (method !== 'none') {
      try {
        const res = await api.auth.stepUp({ method, value, purpose: 'line_account.archive' })
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
      <Notice tone="info" presentation="account-note" icon={null}>一覧から外します。送受信は止まり、友だちと履歴は残ります。</Notice>
      <Field label="アーカイブの理由（任意）" htmlFor={reasonId}>
        <TextField
          id={reasonId}
          maxLength={500}
          placeholder="例：使わなくなったため"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={busy}
        />
      </Field>
      {method === 'totp' ? (
        <div className={styles.verify}>
          <p className={styles.sub} id={secretId}>本人確認（認証アプリの6桁）</p>
          <OtpInput value={secret} onChange={setSecret} onComplete={(entered) => void run(entered)} visualLabel="認証コード（6桁）" labelledBy={secretId} invalid={Boolean(error)} busy={busy} />
        </div>
      ) : method === 'password' ? (
        <Field label="本人確認（パスワード）" htmlFor={secretId}>
          <TextField id={secretId} type="password" autoComplete="current-password" value={secret} onChange={(event) => setSecret(event.target.value)} disabled={busy} />
        </Field>
      ) : (
        <Notice tone="info" presentation="account-note" icon={null}>本人確認の方法（2段階認証・パスワード）が登録されていません。そのままアーカイブします。</Notice>
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
      setError(withPermissionFailure(caught, describeSaveFailure(caught), 'store'))
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
        <Notice tone="info" presentation="account-note" icon={null}>一覧へ戻します。戻った直後は「止まっている」状態です。送受信を始めるには、接続を確かめてから「送受信を再開する」を使います。</Notice>
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
  /*
   * 対象のアカウント・種類ごとに中身を作り直す（WEB132）。A で入れかけた値を B へ持ち越して保存しない。
   * 登録の編集（EditDialog）と同じ形。
   */
  if (!account) return null
  return <CredentialsDialogBody key={`${account.id}:${kind}`} account={account} kind={kind} onClose={onClose} onSaved={onSaved} />
}

function CredentialsDialogBody({ account, kind, onClose, onSaved }: {
  account: LineAccount
  kind: CredentialKind
  onClose: () => void
  onSaved: () => void
}) {
  // 保存中に対象が変わって中身が消えたら、A の結果で B の窓を閉じたり読み直したりしない。
  // 付くたびに true へ戻す。開発時の StrictMode は付ける→外す→付けるを1回ずつ多く回すので、
  // 外すときだけ false にすると、付いているのに false が残って保存の結果と「保存中」の解除を捨てる。
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  const [secret, setSecret] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [stepUp, setStepUp] = useState<StepUpRequest | null>(null)
  const secretId = useId()
  const tokenId = useId()
  useInvalidFocus(fieldErrors, { secret: secretId })

  const close = () => {
    if (busy) return
    setSecret('')
    setToken('')
    setError('')
    onClose()
  }

  const save = async (stepUpToken?: string) => {
    const payload: Parameters<typeof api.lineAccounts.update>[1] = {}
    if (kind === 'messaging') {
      if (secret.trim()) payload.channelSecret = secret.trim()
      if (token.trim()) payload.channelAccessToken = token.trim()
    } else if (secret.trim()) {
      payload.loginChannelSecret = secret.trim()
    }
    if (Object.keys(payload).length === 0) {
      setFieldErrors({ secret: '差し替える値を入れてください。空の欄は今の値のままにします。' })
      setError('')
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = await api.lineAccounts.update(account.id, payload, stepUpToken)
      if (!alive.current) return
      if (!res.success) throw new Error(res.error)
      setSecret('')
      setToken('')
      onSaved()
      onClose()
    } catch (caught) {
      if (!alive.current) return
      // 接続情報の書き換えは大事な操作。本人確認を求められたら窓を立てる（V-1）。
      if (!stepUpToken && isStepUpRequired(caught)) {
        setStepUp({ purpose: 'line_account.credentials', action: '接続情報を変更する', retry: save })
        return
      }
      setError('保存に失敗しました。通信を確かめて、もう一度お試しください。')
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  return (
    <>
      <Frame
        open
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
        <Field label={kind === 'messaging' ? 'Channel Secret' : 'Login Channel Secret'} htmlFor={secretId} error={fieldErrors.secret}>
          <TextField id={secretId} type="password" autoComplete="off" placeholder="••••••••••••（新しい値を貼る）" value={secret} onChange={(event) => { setSecret(event.target.value); setFieldErrors({}) }} disabled={busy} />
        </Field>
        {kind === 'messaging' ? (
          <Field label="Channel Access Token" htmlFor={tokenId}>
            <TextField id={tokenId} type="password" autoComplete="off" placeholder="••••••••••••（新しい値を貼る）" value={token} onChange={(event) => { setToken(event.target.value); setFieldErrors({}) }} disabled={busy} />
          </Field>
        ) : null}
        <Notice tone="info" presentation="account-note" icon={null}>保存のときに本人確認が出ます。差し替えたあと、接続を確かめます。</Notice>
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
  const ids = { name: useId(), tz: useId(), login: useId(), liff: useId(), og: useId(), ogDesc: useId(), cap: useId(), warn: useId() }


  const close = () => {
    if (!busy) onClose()
  }

  /* 保存で落ちた欄は、その欄の真下に理由を出して移る（B-139）。 */
  const fields = useFormErrors()
  fields.define('name', 'アカウント名', () => (name.trim() ? null : 'アカウント名を入れてください。'))
  fields.define('cap', '友だちの上限', () => (Number.isNaN(parseCount(capacity)) ? '数字で入れてください。' : null))
  fields.define('warn', '警告を出す人数', () => {
    const capacityNext = parseCount(capacity)
    const warnNext = parseCount(warnAt)
    if (Number.isNaN(warnNext)) return '数字で入れてください。'
    return capacityNext !== null && !Number.isNaN(capacityNext) && warnNext !== null && warnNext > capacityNext ? '警告を出す人数は上限以下にしてください。上限を超える値は鳴りません。' : null
  })
  const fieldProps = (key: string) => ({ ...fields.bind(key), invalid: fields.invalid(key) })

  const save = async (stepUpToken?: string) => {
    if (fields.submit().length > 0) {
      setError('')
      return
    }
    const capacityNext = parseCount(capacity)
    const warnNext = parseCount(warnAt)
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
          <Field label="アカウント名" htmlFor={ids.name} error={fields.error('name')}>
            <TextField {...fieldProps('name')} id={ids.name} required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} disabled={busy} />
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

            <Button type="button" variant="text" presentation="account-inline" aria-expanded={showOgMore} onClick={() => setShowOgMore((value) => !value)}>
              {showOgMore ? '説明と画像を閉じる' : '説明と画像も変える'}
            </Button>
          </div>
          <Field label="ブランド設定（OGP）" htmlFor={ids.og}><TextField id={ids.og} placeholder="共有したときに出る名前" value={ogSiteName} onChange={(event) => setOgSiteName(event.target.value)} disabled={busy} /></Field>
        </div>
        {showOgMore ? (
          <>
            <Field label="共有したときの説明" htmlFor={ids.ogDesc}>
              <TextField id={ids.ogDesc} value={ogDescription} onChange={(event) => setOgDescription(event.target.value)} disabled={busy} />
            </Field>
            <ImageUploader
              mode="url"
              size="compact"
              label="共有したときの画像"
              title="共有したときの画像を追加"
              disabled={busy}
              value={ogImageUrl ? { mode: 'url', url: ogImageUrl } : null}
              onChange={(next) => setOgImageUrl(next?.mode === 'url' ? next.url : '')}
            />
          </>
        ) : null}
        <div className={styles.pair}>
          <Field label="友だちの上限" htmlFor={ids.cap} error={fields.error('cap')}>
            <NumberInput numericText {...fieldProps('cap')} id={ids.cap} inputMode="numeric" placeholder="管理しない" value={capacity} onChange={(event) => setCapacity(event.target.value)} disabled={busy} />
          </Field>
          <Field label="警告を出す人数" htmlFor={ids.warn} error={fields.error('warn')}>
            <NumberInput numericText {...fieldProps('warn')} id={ids.warn} inputMode="numeric" placeholder="警告しない" value={warnAt} onChange={(event) => setWarnAt(event.target.value)} disabled={busy} />
          </Field>
        </div>
        <ImageUploader
          mode="url"
          size="compact"
          label="アイコン"
          title="アイコンを追加"
          disabled={busy}
          value={iconUrl ? { mode: 'url', url: iconUrl } : null}
          onChange={(next) => setIconUrl(next?.mode === 'url' ? next.url : '')}
        />
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
      <Notice tone="info" presentation="account-note" icon={null}>リマインダや配信のテスト送信が届く先です。変更はこのアカウントだけに効きます。</Notice>
      <div className={styles.fill}><TestRecipientsSetting accountId={accountId} /></div>
    </Frame>
  )
}
