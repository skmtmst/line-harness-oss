'use client'

import { useEffect, useState } from 'react'
import Button from '@/components/shared/button'
import Select from '@/components/shared/select'
import { notifyToast } from '@/components/shared/toast'
import { bookingApi, type BookingMenu, type BookingPaymentAdminConfig } from '@/lib/api'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'

type PayMode = 'none' | 'onsite' | 'online'
type PayProvider = 'none' | 'onsite' | 'stripe'

const MODE_OPTIONS = [
  { value: 'none', label: 'お支払いなし' },
  { value: 'onsite', label: '店頭で払う' },
  { value: 'online', label: 'オンラインで払う' },
]
const PROVIDER_OPTIONS = [
  { value: 'none', label: 'なし' },
  { value: 'onsite', label: '店頭' },
  { value: 'stripe', label: 'Stripe（テスト）' },
]

/**
 * 決済の準備 (★V8・i7Zkz)。店の既定・メニューごとの上書き・鍵の有無・テストモードの印。
 * 鍵の値は出さず、有無だけ出す。
 */
export default function PaymentTabV8({ accountId, menus, canEdit }: {
  accountId: string
  menus: BookingMenu[]
  canEdit: boolean
}) {
  const [config, setConfig] = useState<BookingPaymentAdminConfig | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [draft, setDraft] = useState({ mode: 'none' as PayMode, provider: 'none' as PayProvider, holdMinutes: 30 })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menuOverrides, setMenuOverrides] = useState<Record<string, PayMode>>({})
  const [menuSaving, setMenuSaving] = useState<string | null>(null)

  // 店の既定の下書きが残っている間だけ、離れる前に確かめる。
  const dirty = config !== null && (
    draft.mode !== config.mode ||
    draft.provider !== (config.provider === 'stripe' ? 'stripe' : config.provider === 'onsite' ? 'onsite' : 'none') ||
    draft.holdMinutes !== config.holdMinutes
  )
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: saving })

  useEffect(() => {
    let alive = true
    setStatus('loading')
    bookingApi.getPaymentConfig(accountId).then(
      (response) => {
        if (!alive) return
        setConfig(response.data)
        setDraft({
          mode: response.data.mode,
          provider: (response.data.provider === 'stripe' ? 'stripe' : response.data.provider === 'onsite' ? 'onsite' : 'none') as PayProvider,
          holdMinutes: response.data.holdMinutes,
        })
        setStatus('ready')
      },
      () => {
        if (!alive) return
        setStatus('error')
      },
    )
    return () => {
      alive = false
    }
  }, [accountId])

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      const response = await bookingApi.savePaymentConfig(accountId, draft)
      setConfig(response.data)
      notifyToast('お支払いの設定を保存しました。')
    } catch {
      setError('保存できませんでした。入力を確かめて、もう一度お試しください。')
    } finally {
      setSaving(false)
    }
  }

  async function clearMenuOverride(menuId: string) {
    setMenuSaving(menuId)
    try {
      await bookingApi.clearMenuPayment(accountId, menuId)
      setMenuOverrides((current) => {
        const next = { ...current }
        delete next[menuId]
        return next
      })
      notifyToast('店の既定に戻しました。')
    } catch {
      setError('店の既定に戻せませんでした。もう一度お試しください。')
    } finally {
      setMenuSaving(null)
    }
  }

  async function saveMenuOverride(menuId: string, mode: PayMode) {
    setMenuSaving(menuId)
    try {
      await bookingApi.saveMenuPayment(accountId, menuId, {
        mode,
        provider: mode === 'online' ? 'stripe' : mode === 'onsite' ? 'onsite' : 'none',
      })
      setMenuOverrides((current) => ({ ...current, [menuId]: mode }))
      notifyToast('メニューのお支払いを保存しました。')
    } catch {
      setError('メニューの保存ができませんでした。もう一度お試しください。')
    } finally {
      setMenuSaving(null)
    }
  }

  if (status === 'loading') return <p>読み込んでいます…</p>
  if (status === 'error' || !config) {
    return (
      <div>
        <p>お支払いの設定を読み込めませんでした。</p>
        <Button onClick={() => window.location.reload()}>読み直す</Button>
      </div>
    )
  }

  return (
    <div data-design-node="i7Zkz">
      <h2>お支払い</h2>
      <p>予約のお支払い方法を決めます。お支払いなしのままなら、今の予約の流れは変わりません。</p>

      <section aria-label="店の既定">
        <h3>店の既定</h3>
        <Select
          aria-label="お支払い方法"
          label="お支払い方法"
          options={MODE_OPTIONS}
          value={draft.mode}
          onChange={(value) => setDraft((current) => ({ ...current, mode: value as PayMode }))}
          disabled={!canEdit}
        />
        {draft.mode === 'online' && (
          <Select
            aria-label="決済サービス"
            label="決済サービス"
            options={PROVIDER_OPTIONS.filter((option) => option.value !== 'none')}
            value={draft.provider === 'none' ? 'stripe' : draft.provider}
            onChange={(value) => setDraft((current) => ({ ...current, provider: value as PayProvider }))}
            disabled={!canEdit}
          />
        )}
        {draft.mode === 'online' && (
          <label>
            仮押さえの期限（分）
            <input
              type="number"
              min={5}
              max={1440}
              value={draft.holdMinutes}
              onChange={(event) => setDraft((current) => ({ ...current, holdMinutes: Number(event.target.value) }))}
              disabled={!canEdit}
            />
          </label>
        )}
        <div>
          <span>{config.keyConfigured ? '鍵：入っている' : '鍵：入っていない'}</span>
          {config.testMode && <span>テストモード</span>}
        </div>
        {error && <p role="alert">{error}</p>}
        <Button variant="primary" onClick={() => void submit()} disabled={!canEdit || saving}>
          {saving ? '保存中…' : '保存する'}
        </Button>
        <UnsavedLeaveDialog
          open={leaveTarget !== null}
          subject="お支払いの設定の変更"
          onConfirm={confirmLeave}
          onCancel={cancelLeave}
        />
      </section>

      <section aria-label="メニューごとの上書き">
        <h3>メニューごとの上書き</h3>
        <p>変えたメニューだけ店の既定と違う扱いにできます。変えていないメニューは店の既定どおりです。</p>
        <ul>
          {menus.map((menu) => (
            <li key={menu.id}>
              <span>{menu.name}</span>
              <Select
                aria-label={`${menu.name}のお支払い方法`}
                label={`${menu.name}のお支払い方法`}
                options={[{ value: 'store', label: '店の既定を使う' }, ...MODE_OPTIONS]}
                value={menuOverrides[menu.id] ?? 'store'}
                onChange={(value) => {
                  if (value === 'store') {
                    void clearMenuOverride(menu.id)
                    return
                  }
                  void saveMenuOverride(menu.id, value as PayMode)
                }}
                disabled={!canEdit || menuSaving === menu.id}
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
