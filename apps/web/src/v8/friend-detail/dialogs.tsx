'use client'

/*
 * 個別操作から開く2つの窓：対応状況を編集（N-035）・シナリオに登録する（NEXT-09）。
 * 今の画面では左の欄・下の操作の中に開いていた入力を、V8 では窓にした（中身・送る口は同じ）。
 */
import { useCallback, useRef, useState } from 'react'
import type { Chat, Scenario } from '@line-crm/shared'
import Dialog from '@/components/shared/dialog'
import Select from '@/components/shared/select'
import { api, ApiError, describeSaveFailure } from '@/lib/api'
import { loadOperators } from '@/lib/operators-cache'
import type { PanelStatus } from './use-friend-detail'
import styles from './detail.module.css'

export function useSupportEditor(friendId: string, onSaved: (notice: string) => void, onConflict: (message: string) => void) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<Chat['status']>('resolved')
  const [operatorId, setOperatorId] = useState('')
  const [revision, setRevision] = useState(0)
  const [operators, setOperators] = useState<Array<{ id: string; name: string }>>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  /* 開くたびに今の担当・対応状況を取り直す。GET /api/chats/:id は友だちIDでも引ける。 */
  const openEditor = useCallback(async () => {
    setOpen(true)
    setError('')
    setBusy(true)
    try {
      const [chatRes, operatorRes] = await Promise.all([api.chats.get(friendId), loadOperators()])
      if (chatRes.success) {
        setStatus(chatRes.data.status)
        setOperatorId(chatRes.data.operatorId ?? '')
        setRevision(chatRes.data.revision)
      }
      if (operatorRes.success) setOperators(operatorRes.data)
      else setError('担当者の選択肢を読み込めませんでした')
    } catch {
      setError('対応の状況を読み込めませんでした')
    } finally {
      setBusy(false)
    }
  }, [friendId])

  const save = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      // 読んだ改訂値を付けて、ほかの人の変更を黙って上書きしない。
      const res = await api.chats.update(friendId, { status, operatorId: operatorId || null, revision })
      if (!res.success) {
        setError(res.error)
        return
      }
      setOpen(false)
      onSaved('担当・対応状況を更新しました')
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setOpen(false)
        onConflict('ほかの担当者が先に更新しました。最新の内容を読み直しました')
      } else {
        setError(describeSaveFailure(err))
      }
    } finally {
      setBusy(false)
    }
  }

  const dialog = (
    <Dialog
      open={open}
      title="対応状況を編集"
      designWidth={440}
      busy={busy}
      error={error}
      confirmLabel="保存する"
      onConfirm={() => void save()}
      onCancel={() => setOpen(false)}
    >
      <div className={styles.dialogBody} data-support-editor>
        <label className={styles.dialogLabel}>
          対応状況
          <Select
            size="full"
            value={status}
            disabled={busy}
            onChange={(value) => setStatus(value as Chat['status'])}
            aria-label="対応状況を変える"
            options={[
              { value: 'unread', label: '未対応' },
              { value: 'in_progress', label: '対応中' },
              { value: 'on_hold', label: '保留' },
              { value: 'resolved', label: '対応済み' },
            ]}
          />
        </label>
        <label className={styles.dialogLabel}>
          担当者
          <Select
            size="full"
            value={operatorId}
            disabled={busy}
            onChange={(value) => setOperatorId(value)}
            aria-label="担当者を変える"
            options={[{ value: '', label: '未割り当て' }, ...operators.map((o) => ({ value: o.id, label: o.name }))]}
          />
        </label>
      </div>
    </Dialog>
  )

  return { openEditor, dialog }
}

export function useScenarioPicker(
  friendId: string,
  friendName: string,
  accountId: string | null,
  onEnrolled: (notice: string) => void,
) {
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<Scenario[]>([])
  const [listStatus, setListStatus] = useState<PanelStatus>('idle')
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const reqRef = useRef(0)

  /* 選べるのは表示中アカウントのシナリオだけ。選ぶ→確認→登録までここで完結（NEXT-09）。 */
  const openPicker = useCallback(async () => {
    setOpen(true)
    setError('')
    setPick('')
    const req = ++reqRef.current
    setListStatus('loading')
    try {
      const res = await api.scenarios.list({ accountId: accountId || undefined })
      if (req !== reqRef.current) return
      if (res.success) {
        setOptions(res.data)
        setListStatus('ready')
      } else {
        setListStatus('error')
      }
    } catch {
      if (req !== reqRef.current) return
      setListStatus('error')
    }
  }, [accountId])

  const enroll = async () => {
    if (busy || listStatus !== 'ready') return
    const scenario = options.find((s) => s.id === pick)
    if (!scenario) {
      setError('登録するシナリオを選んでください')
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = await api.scenarios.enroll(scenario.id, friendId)
      if (res.success) {
        setOpen(false)
        onEnrolled(`「${scenario.name}」に登録しました`)
      } else {
        setError(res.error)
      }
    } catch (err) {
      setError(describeSaveFailure(err))
    } finally {
      setBusy(false)
    }
  }

  const active = options.filter((s) => s.isActive)
  const picked = options.find((s) => s.id === pick)
  const dialog = (
    <Dialog
      open={open}
      title="シナリオに登録する"
      designWidth={480}
      busy={busy}
      error={error}
      confirmLabel="このシナリオに登録する"
      onConfirm={() => void enroll()}
      onCancel={() => setOpen(false)}
    >
      <div className={styles.dialogBody} data-scenario-picker>
        {listStatus === 'loading' || listStatus === 'idle' ? (
          <p className={styles.secNote}>シナリオを読み込んでいます…</p>
        ) : listStatus === 'error' ? (
          <p className={styles.secNote}>
            シナリオの選択肢を読み込めませんでした
            <button type="button" className={styles.retry} onClick={() => void openPicker()}>もう一度試す</button>
          </p>
        ) : active.length === 0 ? (
          <p className={styles.secNote}>登録できるシナリオがありません。</p>
        ) : (
          <>
            <Select
              size="full"
              value={pick}
              disabled={busy}
              onChange={(value) => setPick(value)}
              aria-label="登録するシナリオを選ぶ"
              options={[{ value: '', label: '— シナリオを選ぶ —' }, ...active.map((s) => ({ value: s.id, label: s.name }))]}
            />
            {picked ? <p className={styles.memo}>「{picked.name}」に{friendName || 'この友だち'}を登録します。</p> : null}
          </>
        )}
      </div>
    </Dialog>
  )

  return { openPicker, dialog }
}
