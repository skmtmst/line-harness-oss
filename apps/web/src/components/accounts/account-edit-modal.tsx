'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import {
  AccountFormSections,
  emptyAccountFormState,
  type AccountFormState,
} from './account-form-fields'
import AccountSetupUrls from './account-setup-urls'

interface Props {
  accountId: string
  initialName: string
  initialChannelId: string
  initialLoginChannelId: string | null
  initialLiffId: string | null
  initialOgSiteName?: string | null
  initialOgDefaultDescription?: string | null
  initialOgDefaultImageUrl?: string | null
  initialFriendCapacity?: number | null
  initialCapacityWarnAt?: number | null
  initialIconUrl?: string | null
  onClose: () => void
  onSaved: () => void
}

// Edit modal never reads persisted credential values. The API only returns
// configured/not-configured flags, and replacement values start empty.
// On save, only fields the user actually modified are sent. Empty messaging
// credentials are NOT sent (leave server value as-is) — this lets users edit
// just the Login/LIFF fields without re-entering Messaging credentials.
export default function AccountEditModal({
  accountId,
  initialName,
  initialChannelId,
  initialLoginChannelId,
  initialLiffId,
  initialOgSiteName = null,
  initialOgDefaultDescription = null,
  initialOgDefaultImageUrl = null,
  initialFriendCapacity = null,
  initialCapacityWarnAt = null,
  initialIconUrl = null,
  onClose,
  onSaved,
}: Props) {
  const [state, setState] = useState<AccountFormState>({
    ...emptyAccountFormState,
    name: initialName,
    channelId: initialChannelId,
    loginChannelId: initialLoginChannelId ?? '',
    liffId: initialLiffId ?? '',
    ogSiteName: initialOgSiteName,
    ogDefaultDescription: initialOgDefaultDescription,
    ogDefaultImageUrl: initialOgDefaultImageUrl,
  })
  // 上限とアイコンは AccountFormState には持たせない。新規作成では使わず、
  // 作成フォームと編集フォームで共有している型を広げると、作成側に
  // 使わない欄が入り込む。
  const [friendCapacity, setFriendCapacity] = useState(
    initialFriendCapacity == null ? '' : String(initialFriendCapacity),
  )
  const [capacityWarnAt, setCapacityWarnAt] = useState(
    initialCapacityWarnAt == null ? '' : String(initialCapacityWarnAt),
  )
  const [iconUrl, setIconUrl] = useState(initialIconUrl ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Lock background scroll while modal open. Restore on unmount so navigation
  // away mid-edit doesn't leave the page in a non-scrollable state.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  const update = (partial: Partial<AccountFormState>) =>
    setState((s) => ({ ...s, ...partial }))

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')

    // Only send fields the user actually changed. Empty string for password-
    // like fields means "no change", not "clear it" — there's no UI affordance
    // to clear credentials, and accidentally clearing them would break prod.
    const payload: Parameters<typeof api.lineAccounts.update>[1] = {}
    if (state.name !== initialName) payload.name = state.name
    if (state.channelAccessToken.trim() !== '') {
      payload.channelAccessToken = state.channelAccessToken.trim()
    }
    if (state.channelSecret.trim() !== '') {
      payload.channelSecret = state.channelSecret.trim()
    }
    // Login/LIFF: empty string means "clear" (set null) — these are
    // configured per-account and clearing is a legitimate operation
    // (e.g. removing a deprecated LIFF). Send the current value as-is.
    const loginIdNext = state.loginChannelId.trim() || null
    const loginIdChanged = loginIdNext !== (initialLoginChannelId ?? null)
    if (loginIdChanged) payload.loginChannelId = loginIdNext

    if (state.loginChannelSecret.trim() !== '') {
      payload.loginChannelSecret = state.loginChannelSecret.trim()
    } else if (loginIdNext === null && initialLoginChannelId !== null) {
      // User cleared the Login Channel ID. Pair with secret-clear so the
      // server's pair-validator doesn't reject the request (it would see
      // id=null + kept-old-secret as inconsistent). Pair-clear is the
      // intended "disable LINE Login on this account" action.
      payload.loginChannelSecret = null
    }

    if ((state.liffId.trim() || null) !== (initialLiffId ?? null)) {
      payload.liffId = state.liffId.trim() || null
    }

    // OGP brand settings: always send when they differ from initial values
    if (state.ogSiteName !== initialOgSiteName) {
      payload.ogSiteName = state.ogSiteName
    }
    if (state.ogDefaultDescription !== initialOgDefaultDescription) {
      payload.ogDefaultDescription = state.ogDefaultDescription
    }
    if (state.ogDefaultImageUrl !== initialOgDefaultImageUrl) {
      payload.ogDefaultImageUrl = state.ogDefaultImageUrl
    }

    // 上限・警告値・アイコン。空欄は「管理しない／未設定」の意味で送る。
    const capacityNext = friendCapacity.trim() === '' ? null : Number(friendCapacity)
    if (capacityNext !== (initialFriendCapacity ?? null)) {
      payload.friendCapacity = capacityNext
    }
    const warnNext = capacityWarnAt.trim() === '' ? null : Number(capacityWarnAt)
    if (warnNext !== (initialCapacityWarnAt ?? null)) {
      payload.capacityWarnAt = warnNext
    }
    const iconNext = iconUrl.trim() || null
    if (iconNext !== (initialIconUrl ?? null)) {
      payload.iconUrl = iconNext
    }

    if (Object.keys(payload).length === 0) {
      onClose()
      return
    }

    try {
      const res = await api.lineAccounts.update(accountId, payload)
      if (res.success) {
        onSaved()
        onClose()
      } else {
        setError(res.error || '保存に失敗しました')
      }
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        className="my-2 w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-xl sm:my-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-4 sm:px-6">
          <h2 className="text-base font-bold text-gray-900">アカウント編集</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            aria-label="閉じる"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-4 p-4 sm:p-6">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">アカウント名</label>
            <input
              value={state.name}
              onChange={(e) => update({ name: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              required
            />
          </div>

          <AccountFormSections
            state={state}
            update={update}
            showMessagingRequired={false}
            channelIdEditable={false}
            defaultOpen={{
              messaging: false,
              // Open Login/LIFF by default in edit mode if they're empty,
              // since "I want to fill these in" is the most common edit
              // intent now that they were previously SQL-only.
              login: !initialLoginChannelId,
              liff: !initialLiffId,
            }}
          />

          {/* 上限とアイコン。鍵ではないので、この画面に置いても閲覧権限で困らない。 */}
          <div className="border-hairline space-y-3 rounded-lg border p-3">
            <p className="text-ink-secondary text-sm font-semibold">友だち数とアイコン</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="acc-capacity" className="text-ink-faint mb-1 block text-xs font-medium">
                  上限
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    id="acc-capacity"
                    type="number"
                    min={1}
                    value={friendCapacity}
                    onChange={(e) => setFriendCapacity(e.target.value)}
                    placeholder="管理しない"
                    className="border-hairline rounded-control w-full border px-3 py-2 text-sm tabular-nums"
                  />
                  <span className="text-ink-faint whitespace-nowrap text-xs">人</span>
                </div>
              </div>
              <div>
                <label htmlFor="acc-warn" className="text-ink-faint mb-1 block text-xs font-medium">
                  警告を出す人数
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    id="acc-warn"
                    type="number"
                    min={1}
                    value={capacityWarnAt}
                    onChange={(e) => setCapacityWarnAt(e.target.value)}
                    placeholder="警告しない"
                    className="border-hairline rounded-control w-full border px-3 py-2 text-sm tabular-nums"
                  />
                  <span className="text-ink-faint whitespace-nowrap text-xs">人</span>
                </div>
              </div>
            </div>
            <p className="text-ink-faint text-xs">
              警告を出す人数は上限以下にしてください。上限を超える値は永久に鳴りません。
            </p>
            <div>
              <label htmlFor="acc-icon" className="text-ink-faint mb-1 block text-xs font-medium">
                アイコンのURL
              </label>
              <input
                id="acc-icon"
                type="url"
                value={iconUrl}
                onChange={(e) => setIconUrl(e.target.value)}
                placeholder="https://example.com/icon.png"
                className="border-hairline rounded-control w-full border px-3 py-2 text-sm"
              />
              <p className="text-ink-faint mt-1 text-xs">
                管理画面の一覧で使います。共有時に出る画像（OGP）とは別の欄です。
              </p>
            </div>
          </div>

          <AccountSetupUrls
            liffId={state.liffId.trim() || initialLiffId || null}
            heading="このアカで使う URL（LINE Developers Console に貼る）"
          />

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-xs">
              {error}
            </div>
          )}

          <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t border-gray-100 bg-white px-4 pb-1 pt-3 sm:-mx-6 sm:px-6">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 hover:bg-gray-50"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
