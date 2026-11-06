'use client'

import { startRegistration } from '@simplewebauthn/browser'
import { useCallback, useEffect, useState } from 'react'
import type { ApiResponse } from '@line-crm/shared'
import { fetchApi, describeSaveFailure } from '@/lib/api'
import { useStepUpGate } from '@/components/step-up-prompt'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import styles from './staff.module.css'

type Passkey = { id: string; createdAt: string; lastUsedAt: string | null }
type Options = Parameters<typeof startRegistration>[0]['optionsJSON']
const registeredDate = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' })

export default function SelfPasskeys({ enabled }: { enabled: boolean | null }) {
  const [keys, setKeys] = useState<Passkey[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [keyToRemove, setKeyToRemove] = useState<Passkey | null>(null)
  const stepUp = useStepUpGate()
  const load = useCallback(async () => {
    try {
      const res = await fetchApi<ApiResponse<Passkey[]>>('/api/auth/passkeys/self', { cache: 'no-store' })
      if (!res.success || !Array.isArray(res.data)) throw new Error(res.success ? 'パスキー一覧を読み込めませんでした' : res.error)
      setKeys(res.data)
    } catch (caught) { setError(describeSaveFailure(caught)) }
    finally { setLoaded(true) }
  }, [])
  useEffect(() => { void load() }, [load])

  const register = async () => {
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      if (typeof PublicKeyCredential === 'undefined') throw new Error('このブラウザはパスキーに対応していません')
      const grant = await stepUp.gate('auth.passkey.register', 'パスキーを登録する')
      if (!grant) return
      const begin = await fetchApi<ApiResponse<{ options: Options; challengeToken: string }>>('/api/auth/passkeys/register/options', { method: 'POST', body: '{}' })
      if (!begin.success) throw new Error(begin.error)
      const response = await startRegistration({ optionsJSON: begin.data.options })
      const finish = await fetchApi<ApiResponse<{ id: string }>>('/api/auth/passkeys/register/verify', {
        method: 'POST', headers: { 'X-Step-Up-Token': grant }, body: JSON.stringify({ challengeToken: begin.data.challengeToken, response }),
      })
      if (!finish.success) throw new Error(finish.error)
      setMessage('パスキーを登録しました。')
      await load()
    } catch (caught) {
      if (caught instanceof Error && caught.name === 'NotAllowedError') return
      setError(describeSaveFailure(caught))
    } finally { setBusy(false) }
  }

  const remove = async () => {
    const key = keyToRemove
    if (!key) return
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      const grant = await stepUp.gate('auth.passkey.remove', 'パスキーを削除する')
      if (!grant) return
      const res = await fetchApi<ApiResponse<unknown>>('/api/auth/passkeys/self', {
        method: 'DELETE', headers: { 'X-Step-Up-Token': grant }, body: JSON.stringify({ id: key.id }),
      })
      if (!res.success) throw new Error(res.error)
      setMessage('パスキーを削除しました。')
      setKeyToRemove(null)
      await load()
    } catch (caught) { setError(describeSaveFailure(caught)) }
    finally { setBusy(false) }
  }

  return <>
    <section className={styles.passkeyBlock} aria-label="パスキー">
      {error ? <Notice tone="danger" message={error} /> : null}
      {message ? <Notice tone="info" message={message} /> : null}
      <p className={styles.securityState}>パスキー　{loaded ? keys.length ? `登録済み ${keys.length}件` : '未登録' : '確認中'}</p>
      {loaded && keys.length ? <div className={styles.passkeyList}>{keys.map((key, index) => <div key={key.id} className={styles.passkeyItem}>
        <div><strong>パスキー {index + 1}</strong><span>{registeredDate.format(new Date(key.createdAt))} 登録</span></div>
        <Button variant="text" textTone="danger" size="compact" disabled={busy} onClick={() => setKeyToRemove(key)}>削除</Button>
      </div>)}</div> : null}
      <Button variant="primary" fullWidth disabled={busy || !enabled || !loaded || keys.length >= 10} onClick={() => void register()} busy={busy} busyLabel="確認しています…">パスキーを追加</Button>
      {enabled === false ? <p className={styles.securityHint}>追加するには認証アプリの登録が必要です。</p> : null}
    </section>
    <ConfirmDialog open={keyToRemove !== null} title="パスキーを削除しますか？" deleteName={keyToRemove ? 'パスキー' : undefined} description="この端末のパスキーは次回から使えなくなります。認証アプリは引き続き使えます。" destructive busy={busy} error={error} onConfirm={() => void remove()} onCancel={() => setKeyToRemove(null)} />
    {stepUp.prompt}
  </>
}
