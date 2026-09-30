'use client'

import { useId, useRef, useState } from 'react'
import { api } from '@/lib/api'
import StepUpPrompt, { isStepUpRequired, type StepUpRequest } from '@/components/step-up-prompt'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
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
  /**
   * R73。詳細画面の「編集する」は `basic`（名前などの登録内容）、
   * 「差し替える」は `credentials`（Messaging の鍵・トークンの入力欄を
   * 開いた状態）で開く。どちらも同じ保存口（PATCH/PUT 振り分け）を使う。
   */
  initialSection?: 'basic' | 'credentials'
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
  initialSection = 'basic',
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
  const modalTitleId = useId()
  const [error, setError] = useState('')
  const [stepUp, setStepUp] = useState<StepUpRequest | null>(null)

  /*
   * 本人確認（StepUpPrompt）の窓が重なっている間は、Escape を
   * 最上位の窓だけへ効かせるため外側の閉じる処理を止める。
   * hook の依存にすると効果の掛け直しでフォーカスが飛ぶので ref 越しに見る。
   * 背面のスクロール停止もこの hook が担う。
   */
  const stepUpOpenRef = useRef(false)
  stepUpOpenRef.current = stepUp != null
  const panelRef = useOverlayFocus(true, () => {
    if (!stepUpOpenRef.current) onClose()
  }, saving)

  const update = (partial: Partial<AccountFormState>) =>
    setState((s) => ({ ...s, ...partial }))

  const handleSave = async (e: React.FormEvent, stepUpToken?: string) => {
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
      const res = await api.lineAccounts.update(accountId, payload, stepUpToken)
      if (res.success) {
        onSaved()
        onClose()
      } else {
        setError(res.error || '保存に失敗しました。通信を確かめて、もう一度お試しください。')
      }
    } catch (caught) {
      // 接続情報の書き換えは大事な操作。本人確認を求められたら窓を立てる（V-1）。
      if (!stepUpToken && isStepUpRequired(caught)) {
        setStepUp({ purpose: 'line_account.credentials', action: '接続情報を変更する', retry: (token) => handleSave(e, token) })
        return
      }
      setError('保存に失敗しました。通信を確かめて、もう一度お試しください。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-scrim p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={modalTitleId}
        className="my-2 w-full max-w-2xl overflow-hidden rounded-control bg-canvas shadow-float sm:my-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-hairline bg-canvas px-4 py-4 sm:px-6">
          <h2 id={modalTitleId} className="text-base font-bold text-ink">{initialSection === 'credentials' ? '資格情報を差し替える' : '登録の内容を編集する'}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-faint hover:text-ink-secondary text-xl leading-none"
            aria-label="閉じる"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-4 p-4 sm:p-6">
          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1">アカウント名</label>
            <input
              value={state.name}
              onChange={(e) => update({ name: e.target.value })}
              className="w-full border border-hairline rounded-control px-3 py-2 text-sm"
              required
            />
          </div>

          <AccountFormSections
            state={state}
            update={update}
            showMessagingRequired={false}
            channelIdEditable={false}
            defaultOpen={{
              messaging: initialSection === 'credentials',
              // Open Login/LIFF by default in edit mode if they're empty,
              // since "I want to fill these in" is the most common edit
              // intent now that they were previously SQL-only.
              login: !initialLoginChannelId,
              liff: !initialLiffId,
            }}
          />

          {/* 上限とアイコン。鍵ではないので、この画面に置いても閲覧権限で困らない。 */}
          <div className="border-hairline space-y-3 rounded-control border p-3">
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
            heading="このアカウントで使う URL（LINE Developers Console に貼る）"
          />

          {error && (
            <div className="p-3 bg-danger-bg border border-status-danger-border rounded-mini text-danger text-xs">
              {error}
            </div>
          )}

          <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t border-divider-soft bg-canvas px-4 pb-1 pt-3 sm:-mx-6 sm:px-6">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-control text-sm font-medium border border-hairline hover:bg-surface-pearl"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-control text-on-accent text-sm font-medium disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              {saving ? '保存中...' : '保存する'}
            </button>
          </div>
        </form>
      </div>
      {stepUp && <StepUpPrompt request={stepUp} onDone={() => setStepUp(null)} onClose={() => setStepUp(null)} />}
    </div>
  )
}
