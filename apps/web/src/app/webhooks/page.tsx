'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Header from '@/components/layout/header'
import { api } from '@/lib/api'
import type { IncomingWebhook, OutgoingWebhook } from '@line-crm/shared'
import { Suspense } from 'react'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import NotificationsPage from '@/app/notifications/page'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import SelectField from '@/components/shared/select-field'
import WebhookInteractions from './webhook-interactions'

type Tab = 'incoming' | 'outgoing'
type LoadStatus = 'loading' | 'ready' | 'error'

const MIN_SECRET_LENGTH = 32

// Generate a 32-char URL-safe random secret in the browser. 24 random bytes
// produce exactly 32 base64 characters; remap +/ to -/_ instead of stripping
// so we always end up with 32 chars (stripping would drop the count).
function generateSecret(): string {
  const buf = new Uint8Array(24)
  crypto.getRandomValues(buf)
  let s = ''
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

const MERGED_TABS = [
  { key: 'webhooks', label: 'Webhook' },
  { key: 'interactions', label: 'やり取りの記録' },
  { key: 'notify', label: '未対応の通知' },
]

/*
  受け取る設定の「どこから来るか」を、**見本から選べるようにする**。

  設計 `M0Gb7` は「予約サービス」「アンケートツール」のような見本を選んで作る道を
  持っているが、実装は `sourceType` の自由入力だけだった。**何を書けばよいか
  分からない欄**になっていて、`line` という置き文字だけが手がかりになっていた。

  値（`value`）は今までどおりの文字列なので、口も保存の形も変えない。
  見本に無いものは「その他」を選べば自由に書ける。
*/
const SOURCE_PRESETS = [
  { value: 'line', label: 'LINE公式アカウント', hint: '友だち追加やメッセージの通知を受け取ります' },
  { value: 'booking', label: '予約サービス', hint: '予約の確定・変更・取り消しを受け取ります' },
  { value: 'form', label: 'アンケートツール', hint: '回答が届いたことを受け取ります' },
  { value: 'ec', label: 'ECサイト', hint: '注文や発送の知らせを受け取ります' },
  { value: 'payment', label: '決済サービス', hint: '支払いの成否を受け取ります' },
] as const

/** 見本に無い「その他」を選んだときだけ、自由入力に切り替える印。 */
const SOURCE_OTHER = '__other__'

/**
 * 保存してある値を、画面の言葉に戻す。
 *
 * 未設定を `-`（半角ハイフン）で書いていた。V6の決めごとは `—`。
 * 半角は数や記号に見えて、「無い」と読み取れない。
 */
function sourceLabel(value: string | null | undefined): string {
  if (!value) return '—'
  return SOURCE_PRESETS.find((preset) => preset.value === value)?.label ?? value
}

function WebhooksPageInner() {
  const { selectedAccountId } = useAccount()
  const selectedAccountIdRef = useRef(selectedAccountId)
  selectedAccountIdRef.current = selectedAccountId
  const loadGenerationRef = useRef(0)
  const [tab, setTab] = useState<Tab>('incoming')
  const [incoming, setIncoming] = useState<IncomingWebhook[]>([])
  const [outgoing, setOutgoing] = useState<OutgoingWebhook[]>([])
  const [incomingStatus, setIncomingStatus] = useState<LoadStatus>('loading')
  const [outgoingStatus, setOutgoingStatus] = useState<LoadStatus>('loading')
  const [loadedAccountId, setLoadedAccountId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  const [inForm, setInForm] = useState({ name: '', sourceType: '', secret: '' })
  // 見本に無いものを選んだときだけ、自由入力に切り替える。
  const [sourceIsOther, setSourceIsOther] = useState(false)
  const selectedPreset = sourceIsOther
    ? null
    : SOURCE_PRESETS.find((preset) => preset.value === inForm.sourceType) ?? null

  const [outForm, setOutForm] = useState({ name: '', url: '', eventTypes: '', secret: '', maxRetries: '0' })

  // After a successful create the API returns the secret exactly once.
  // Show it to the operator with a copy affordance, then forget it.
  const [createdSecret, setCreatedSecret] = useState<{ name: string; secret: string } | null>(null)
  const [secretCopied, setSecretCopied] = useState(false)

  // Rotate-secret modal state. Used to recover legacy webhooks deactivated
  // by migration 034, or to rotate a leaked secret in place.
  const [rotateTarget, setRotateTarget] = useState<
    | { kind: 'incoming' | 'outgoing'; id: string; name: string; activate: boolean }
    | null
  >(null)
  const [rotateSecretValue, setRotateSecretValue] = useState('')

  /**
   * 削除の確認。ブラウザの `confirm()` は「この受信Webhookを削除しますか？」
   * としか言えず、URLが無効になることも、届いた記録が残ることも読めない。
   * 画像比較にも写らないので、共通の `ConfirmDialog` へ移した（設計 `H2S1T4`）。
   *
   * 押した時点のLINEアカウントを一緒に持つ。窓を開けたまま切り替えられると、
   * 別アカウントのWebhookを消してしまう。
   */
  const [deleteTarget, setDeleteTarget] = useState<
    { kind: 'incoming' | 'outgoing'; id: string; name: string; accountId: string } | null
  >(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const load = useCallback(async () => {
    const requestGeneration = ++loadGenerationRef.current
    const requestAccountId = selectedAccountId
    setIncoming([])
    setOutgoing([])
    setLoadedAccountId(null)
    setError('')
    if (!requestAccountId) {
      setIncomingStatus('ready')
      setOutgoingStatus('ready')
      return
    }
    setIncomingStatus('loading')
    setOutgoingStatus('loading')
    setError('')
    const [incomingResult, outgoingResult] = await Promise.allSettled([
      api.webhooks.incoming.list(requestAccountId),
      api.webhooks.outgoing.list(requestAccountId),
    ])
    // アカウント切替後に、前のアカウントの遅い応答で一覧を上書きしない。
    if (
      loadGenerationRef.current !== requestGeneration
      || selectedAccountIdRef.current !== requestAccountId
    ) return

    if (incomingResult.status === 'fulfilled' && incomingResult.value.success) {
      setIncoming(incomingResult.value.data)
      setIncomingStatus('ready')
    } else {
      // 前回の一覧を残すと、取得に失敗したあとも古い設定を現在値に見せてしまう。
      setIncoming([])
      setIncomingStatus('error')
    }

    if (outgoingResult.status === 'fulfilled' && outgoingResult.value.success) {
      setOutgoing(outgoingResult.value.data)
      setOutgoingStatus('ready')
    } else {
      setOutgoing([])
      setOutgoingStatus('error')
    }
    setLoadedAccountId(requestAccountId)
  }, [selectedAccountId])

  useEffect(() => {
    loadGenerationRef.current += 1
    setCreatedSecret(null)
    setSecretCopied(false)
    setRotateTarget(null)
    setRotateSecretValue('')
    setShowCreate(false)
    setInForm({ name: '', sourceType: '', secret: '' })
    setSourceIsOther(false)
    setOutForm({ name: '', url: '', eventTypes: '', secret: '', maxRetries: '0' })
    void load()
  }, [load, selectedAccountId])

  const handleToggleIncoming = async (id: string, currentActive: boolean) => {
    const requestAccountId = selectedAccountId
    if (!requestAccountId || loadedAccountId !== requestAccountId) {
      return setError('LINEアカウントの一覧を読み直してください')
    }
    try {
      const res = await api.webhooks.incoming.update(id, requestAccountId, { isActive: !currentActive })
      if (selectedAccountIdRef.current !== requestAccountId) return
      if (!res.success) return setError(res.error)
      if (selectedAccountIdRef.current === requestAccountId) await load()
    } catch {
      if (selectedAccountIdRef.current !== requestAccountId) return
      setError('更新に失敗しました')
    }
  }

  const handleToggleOutgoing = async (id: string, currentActive: boolean) => {
    const requestAccountId = selectedAccountId
    if (!requestAccountId || loadedAccountId !== requestAccountId) {
      return setError('LINEアカウントの一覧を読み直してください')
    }
    try {
      const res = await api.webhooks.outgoing.update(id, requestAccountId, { isActive: !currentActive })
      if (selectedAccountIdRef.current !== requestAccountId) return
      if (!res.success) return setError(res.error)
      if (selectedAccountIdRef.current === requestAccountId) await load()
    } catch {
      if (selectedAccountIdRef.current !== requestAccountId) return
      setError('更新に失敗しました')
    }
  }

  /** 削除の窓を開ける。押した時点のLINEアカウントをここで固定する。 */
  const askDelete = (kind: 'incoming' | 'outgoing', id: string, name: string) => {
    const requestAccountId = selectedAccountId
    if (!requestAccountId || loadedAccountId !== requestAccountId) {
      return setError('LINEアカウントの一覧を読み直してください')
    }
    setDeleteError('')
    setDeleteTarget({ kind, id, name, accountId: requestAccountId })
  }

  const handleConfirmDelete = async () => {
    // 押している間は受け付けない。二度押しの2回目は404になり、
    // 消えているのに「削除できませんでした」と出る。
    if (!deleteTarget || deleting) return
    const requestAccountId = deleteTarget.accountId
    const kind = deleteTarget.kind
    const label = kind === 'incoming' ? '受信Webhook' : '送信Webhook'
    // 窓を開けたまま切り替えられていたら、消さずに選び直させる。
    if (requestAccountId !== selectedAccountId || loadedAccountId !== requestAccountId) {
      setDeleteError('LINEアカウントが切り替わりました。削除するWebhookを選び直してください。')
      return
    }
    setDeleting(true)
    setDeleteError('')
    try {
      const res =
        kind === 'incoming'
          ? await api.webhooks.incoming.delete(deleteTarget.id, requestAccountId)
          : await api.webhooks.outgoing.delete(deleteTarget.id, requestAccountId)
      if (!res.success) throw new Error(res.error)
      if (selectedAccountIdRef.current !== requestAccountId) return
      setDeleteTarget(null)
      await load()
    } catch {
      if (selectedAccountIdRef.current !== requestAccountId) return
      // 生のAPIエラーは運用者に読めないので、窓の中に運用の言葉で出す。
      setDeleteError(`この${label}を削除できませんでした。状態を読み直してから、もう一度お試しください。`)
    } finally {
      setDeleting(false)
    }
  }

  const handleCreateIncoming = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const requestAccountId = selectedAccountId
    if (!requestAccountId) return setError('LINEアカウントを選択してください')
    if (!inForm.name) return
    if (inForm.secret.length < MIN_SECRET_LENGTH) {
      setError(`シークレットは最低${MIN_SECRET_LENGTH}文字必要です`)
      return
    }
    try {
      const res = await api.webhooks.incoming.create({
        lineAccountId: requestAccountId,
        name: inForm.name,
        sourceType: inForm.sourceType || undefined,
        secret: inForm.secret,
      })
      if (!res.success) {
        if (selectedAccountIdRef.current !== requestAccountId) return
        setError(res.error)
        return
      }
      if (selectedAccountIdRef.current !== requestAccountId) return
      setCreatedSecret({ name: res.data.name, secret: res.data.secret })
      setSecretCopied(false)
      setInForm({ name: '', sourceType: '', secret: '' })
      setSourceIsOther(false)
      setShowCreate(false)
      load()
    } catch {
      if (selectedAccountIdRef.current !== requestAccountId) return
      setError('作成に失敗しました')
    }
  }

  const handleCreateOutgoing = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const requestAccountId = selectedAccountId
    if (!requestAccountId) return setError('LINEアカウントを選択してください')
    if (!outForm.name || !outForm.url) return
    if (!isHttpsUrl(outForm.url)) {
      setError('URLは https:// から始まる必要があります')
      return
    }
    if (outForm.secret.length < MIN_SECRET_LENGTH) {
      setError(`シークレットは最低${MIN_SECRET_LENGTH}文字必要です`)
      return
    }
    try {
      const eventTypes = outForm.eventTypes
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      const res = await api.webhooks.outgoing.create({
        lineAccountId: requestAccountId,
        name: outForm.name,
        url: outForm.url,
        eventTypes,
        secret: outForm.secret,
        maxRetries: Number(outForm.maxRetries) || 0,
      })
      if (!res.success) {
        if (selectedAccountIdRef.current !== requestAccountId) return
        setError(res.error)
        return
      }
      if (selectedAccountIdRef.current !== requestAccountId) return
      setCreatedSecret({ name: res.data.name, secret: res.data.secret })
      setSecretCopied(false)
      setOutForm({ name: '', url: '', eventTypes: '', secret: '', maxRetries: '0' })
      setShowCreate(false)
      load()
    } catch {
      if (selectedAccountIdRef.current !== requestAccountId) return
      setError('作成に失敗しました')
    }
  }

  const copySecret = async (secret: string) => {
    try {
      await navigator.clipboard.writeText(secret)
      setSecretCopied(true)
    } catch {
      // ignore — operator can still copy manually
    }
  }

  const handleRotateSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const requestAccountId = selectedAccountId
    if (!requestAccountId || loadedAccountId !== requestAccountId) {
      return setError('LINEアカウントの一覧を読み直してください')
    }
    if (!rotateTarget) return
    if (rotateSecretValue.length < MIN_SECRET_LENGTH) {
      setError(`シークレットは最低${MIN_SECRET_LENGTH}文字必要です`)
      return
    }
    try {
      const payload = { secret: rotateSecretValue, isActive: rotateTarget.activate || undefined }
      const res =
        rotateTarget.kind === 'incoming'
          ? await api.webhooks.incoming.update(rotateTarget.id, requestAccountId, payload)
          : await api.webhooks.outgoing.update(rotateTarget.id, requestAccountId, payload)
      if (selectedAccountIdRef.current !== requestAccountId) return
      if (!res.success) {
        setError(res.error)
        return
      }
      setRotateTarget(null)
      setRotateSecretValue('')
      load()
    } catch {
      if (selectedAccountIdRef.current !== requestAccountId) return
      setError('シークレットの更新に失敗しました')
    }
  }

  const endpointUrl = (id: string) =>
    `${typeof window !== 'undefined' ? window.location.origin : ''}/api/webhooks/incoming/${id}/receive`
  const activeStatus = tab === 'incoming' ? incomingStatus : outgoingStatus
  const activeLabel = tab === 'incoming' ? 'こちらで受け取る設定' : 'こちらから送る設定'

  return (
    <div>
      <div data-design="Head">
        <Header
          title="外部連携"
          description="外部サービスから受け取る情報と、外部サービスへ送る通知を設定します。"
          action={
            <Button variant="primary" onClick={() => setShowCreate(!showCreate)}>
              {showCreate ? 'キャンセル' : 'Webhookを追加'}
            </Button>
          }
        />
      </div>

      {/* Rotate-secret modal — used to recover legacy webhooks or rotate. */}
      {rotateTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <form onSubmit={handleRotateSubmit} className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              「{rotateTarget.name}」のシークレットを{rotateTarget.activate ? '設定して有効化' : '更新'}
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              新しいシークレットを設定します。
              <strong className="text-red-600">設定後は今回限り画面に表示されません。</strong>
              控えておいてから「保存」を押してください。
            </p>
            <div className="flex gap-2 mb-4">
              <input
                value={rotateSecretValue}
                onChange={(e) => setRotateSecretValue(e.target.value)}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
                placeholder="ランダムな英数字32文字以上"
                required
                minLength={MIN_SECRET_LENGTH}
                autoFocus
              />
              <button
                type="button"
                onClick={() => setRotateSecretValue(generateSecret())}
                className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 whitespace-nowrap"
              >
                自動生成
              </button>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => {
                  setRotateTarget(null)
                  setRotateSecretValue('')
                }}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm rounded-lg text-white font-medium"
                style={{ backgroundColor: 'var(--color-accent)' }}
              >
                保存
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Created-secret modal — shown ONCE after a successful create. */}
      {createdSecret && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              シークレットを保存してください
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              「{createdSecret.name}」を作成しました。
              <strong className="text-red-600">このシークレットは今後二度と表示されません。</strong>
              閉じる前に必ず安全な場所に保存してください。
            </p>
            <div className="bg-gray-50 border border-gray-200 rounded p-3 mb-4">
              <code className="text-sm break-all">{createdSecret.secret}</code>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => copySecret(createdSecret.secret)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                {secretCopied ? 'コピー済み' : 'クリップボードにコピー'}
              </button>
              <button
                onClick={() => {
                  setCreatedSecret(null)
                  setSecretCopied(false)
                }}
                className="px-4 py-2 text-sm rounded-lg text-white font-medium"
                style={{ backgroundColor: 'var(--color-accent)' }}
              >
                保存しました
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => { setTab('incoming'); setShowCreate(false) }}
          className={`px-4 py-2 min-h-[44px] text-sm font-medium rounded-md transition-colors ${
            tab === 'incoming'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          こちらで受け取る
        </button>
        <button
          onClick={() => { setTab('outgoing'); setShowCreate(false) }}
          className={`px-4 py-2 min-h-[44px] text-sm font-medium rounded-md transition-colors ${
            tab === 'outgoing'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          こちらから送る
        </button>
      </div>

      {/* Create forms */}
      {showCreate && tab === 'incoming' && (
        <form onSubmit={handleCreateIncoming} className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">受け取る設定を追加</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">名前</label>
              <input
                value={inForm.name}
                onChange={(e) => setInForm({ ...inForm, name: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="LINE公式アカウント"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">どこから来るか</label>
              <SelectField
                value={sourceIsOther ? SOURCE_OTHER : inForm.sourceType}
                onChange={(e) => {
                  const next = e.target.value
                  if (next === SOURCE_OTHER) { setSourceIsOther(true); setInForm({ ...inForm, sourceType: '' }); return }
                  setSourceIsOther(false)
                  setInForm({ ...inForm, sourceType: next })
                }}
                aria-label="受信元の種類"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                options={[
                  { value: '', label: '選んでください' },
                  ...SOURCE_PRESETS.map((preset) => ({ value: preset.value, label: preset.label })),
                  { value: SOURCE_OTHER, label: 'その他（自分で書く）' },
                ]}
              />
              {/* 選んだものが何を受け取るのかを、選んだ直後に出す。 */}
              {selectedPreset ? (
                <p className="text-ink-faint mt-1 text-xs">{selectedPreset.hint}</p>
              ) : null}
              {sourceIsOther ? (
                <input
                  value={inForm.sourceType}
                  onChange={(e) => setInForm({ ...inForm, sourceType: e.target.value })}
                  className="border-hairline rounded-control mt-2 w-full border px-3 py-2 text-sm"
                  placeholder="送ってくるサービスの名前"
                  aria-label="どこから来るか（自分で書く）"
                />
              ) : null}
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                シークレット (最低{MIN_SECRET_LENGTH}文字)
              </label>
              <div className="flex gap-2">
                <input
                  value={inForm.secret}
                  onChange={(e) => setInForm({ ...inForm, secret: e.target.value })}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
                  placeholder="ランダムな英数字32文字以上"
                  required
                  minLength={MIN_SECRET_LENGTH}
                />
                <button
                  type="button"
                  onClick={() => setInForm({ ...inForm, secret: generateSecret() })}
                  className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 whitespace-nowrap"
                >
                  自動生成
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                外部システムが Webhook 受信時に X-Webhook-Signature ヘッダで HMAC-SHA256 署名する際に使用します。
              </p>
            </div>
          </div>
          <button
            type="submit"
            className="mt-4 px-4 py-2 rounded-lg text-white text-sm font-medium"
            style={{ backgroundColor: 'var(--color-accent)' }}
          >
            作成
          </button>
        </form>
      )}

      {showCreate && tab === 'outgoing' && (
        <form onSubmit={handleCreateOutgoing} className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">送る設定を追加</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">名前</label>
              <input
                value={outForm.name}
                onChange={(e) => setOutForm({ ...outForm, name: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="外部CRM連携"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">URL (https:// 必須)</label>
              <input
                type="url"
                value={outForm.url}
                onChange={(e) => setOutForm({ ...outForm, url: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="https://example.com/webhook"
                pattern="https://.*"
                required
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">イベントタイプ (カンマ区切り、* で全イベント)</label>
              <input
                value={outForm.eventTypes}
                onChange={(e) => setOutForm({ ...outForm, eventTypes: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="friend.added, message.received"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                シークレット (最低{MIN_SECRET_LENGTH}文字)
              </label>
              <div className="flex gap-2">
                <input
                  value={outForm.secret}
                  onChange={(e) => setOutForm({ ...outForm, secret: e.target.value })}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
                  placeholder="ランダムな英数字32文字以上"
                  required
                  minLength={MIN_SECRET_LENGTH}
                />
                <button
                  type="button"
                  onClick={() => setOutForm({ ...outForm, secret: generateSecret() })}
                  className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 whitespace-nowrap"
                >
                  自動生成
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                送信時に X-Webhook-Signature ヘッダで HMAC-SHA256 署名するために使われます。受信側で同じシークレットで検証してください。
              </p>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="wh-retries" className="mb-1 block text-sm font-medium text-gray-700">
                失敗したときの送り直し
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  id="wh-retries"
                  type="number"
                  min={0}
                  max={5}
                  value={outForm.maxRetries}
                  onChange={(e) => setOutForm({ ...outForm, maxRetries: e.target.value })}
                  className="border-hairline rounded-control w-24 border px-3 py-2 text-sm tabular-nums"
                />
                <span className="text-ink-faint text-xs">回まで</span>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                相手が 5xx を返したときや、つながらなかったときに送り直します。
                0.5秒・1秒・2秒…と間隔を空け、上限は5回です。
                相手が 4xx を返した場合は、同じものを送っても結果が変わらないので送り直しません。
              </p>
            </div>
          </div>
          <button
            type="submit"
            className="mt-4 px-4 py-2 rounded-lg text-white text-sm font-medium"
            style={{ backgroundColor: 'var(--color-accent)' }}
          >
            作成
          </button>
        </form>
      )}

      {activeStatus === 'loading' ? (
        <ListState kind="loading" title={`${activeLabel}を読み込んでいます`} />
      ) : activeStatus === 'error' ? (
        <ListState
          kind="error"
          title={`${activeLabel}を表示できませんでした`}
          description="登録内容は消えていません。再読み込みしても直らない場合はエラー報告へ。"
          action={<Button variant="secondary" onClick={() => void load()}>{activeLabel}を再読み込み</Button>}
        />
      ) : tab === 'incoming' ? (
        /* Incoming table */
        incoming.length === 0 && !showCreate ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
            <p className="text-gray-500">こちらで受け取る設定はまだありません。「Webhookを追加」から作成してください。</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">名前</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">どこから来るか</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">エンドポイントURL</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">シークレット</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">ステータス</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">作成日</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {incoming.map((wh) => (
                  <tr key={wh.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{wh.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{sourceLabel(wh.sourceType)}</td>
                    <td className="px-4 py-3">
                      <code className="text-xs bg-gray-100 px-2 py-1 rounded text-gray-700 break-all">
                        {endpointUrl(wh.id)}
                      </code>
                    </td>
                    <td className="px-4 py-3">
                      {wh.hasSecret ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                          設定済
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                          未設定
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggleIncoming(wh.id, wh.isActive)}
                        disabled={!wh.hasSecret && !wh.isActive}
                        className={`text-xs px-2 py-0.5 rounded-full disabled:opacity-50 disabled:cursor-not-allowed ${
                          wh.isActive
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                        title={!wh.hasSecret && !wh.isActive ? 'シークレット未設定のため有効化できません' : ''}
                      >
                        {wh.isActive ? '有効' : '無効'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {new Date(wh.createdAt).toLocaleDateString('ja-JP')}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => {
                          setRotateTarget({
                            kind: 'incoming',
                            id: wh.id,
                            name: wh.name,
                            activate: !wh.hasSecret,
                          })
                          setRotateSecretValue('')
                        }}
                        className="text-xs text-gray-600 hover:text-gray-900 mr-3"
                      >
                        {wh.hasSecret ? 'シークレット更新' : 'シークレット設定'}
                      </button>
                      <button
                        onClick={() => askDelete('incoming', wh.id, wh.name)}
                        className="text-red-500 hover:text-red-700 text-sm"
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )
      ) : (
        /* Outgoing table */
        outgoing.length === 0 && !showCreate ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
            <p className="text-gray-500">こちらから送る設定はまだありません。「Webhookを追加」から作成してください。</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[880px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">名前</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">URL</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">イベントタイプ</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">シークレット</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">ステータス</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">送信状況</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">作成日</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {outgoing.map((wh) => {
                  const hasValidUrl = isHttpsUrl(wh.url)
                  const canActivate = wh.hasSecret && hasValidUrl
                  const blockedReason = !canActivate
                    ? !wh.hasSecret && !hasValidUrl
                      ? 'シークレット未設定 + URL が https:// ではないため有効化できません'
                      : !wh.hasSecret
                        ? 'シークレット未設定のため有効化できません'
                        : 'URL が https:// ではないため有効化できません'
                    : ''
                  return (
                  <tr key={wh.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{wh.name}</td>
                    <td className="px-4 py-3">
                      <code className="text-xs bg-gray-100 px-2 py-1 rounded text-gray-700 break-all">
                        {wh.url}
                      </code>
                      {!hasValidUrl && (
                        <p className="text-xs text-amber-700 mt-1">
                          ※ https:// で始まる完全な URL に作り直してください
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {wh.eventTypes.map((et) => (
                          <span
                            key={et}
                            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700"
                          >
                            {et}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {wh.hasSecret ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                          設定済
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                          未設定
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggleOutgoing(wh.id, wh.isActive)}
                        disabled={!canActivate && !wh.isActive}
                        className={`text-xs px-2 py-0.5 rounded-full disabled:opacity-50 disabled:cursor-not-allowed ${
                          wh.isActive
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                        title={blockedReason}
                      >
                        {wh.isActive ? '有効' : '無効'}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      {/* 連続失敗があるときだけ出す。自動では止めないので、
                          ここで気づけないと送られていないことに気づけない。 */}
                      {(wh.consecutiveFailures ?? 0) > 0 ? (
                        <div>
                          <span className="bg-danger-bg text-danger rounded-pill px-2 py-0.5 text-xs font-medium">
                            {wh.consecutiveFailures}回連続で失敗
                          </span>
                          {wh.lastFailedAt && (
                            <p className="text-ink-faint mt-1 text-[11px]">
                              最終 {new Date(wh.lastFailedAt).toLocaleString('ja-JP')}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-ink-faint text-xs">—</span>
                      )}
                      <p className="text-ink-faint mt-1 text-[11px] tabular-nums">
                        送り直し {wh.maxRetries ?? 0} 回
                      </p>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {new Date(wh.createdAt).toLocaleDateString('ja-JP')}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => {
                          setRotateTarget({
                            kind: 'outgoing',
                            id: wh.id,
                            name: wh.name,
                            activate: hasValidUrl && !wh.hasSecret,
                          })
                          setRotateSecretValue('')
                        }}
                        className="text-xs text-gray-600 hover:text-gray-900 mr-3"
                      >
                        {wh.hasSecret ? 'シークレット更新' : 'シークレット設定'}
                      </button>
                      <button
                        onClick={() => askDelete('outgoing', wh.id, wh.name)}
                        className="text-red-500 hover:text-red-700 text-sm"
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
          </div>
        )
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`${deleteTarget?.kind === 'outgoing' ? '送信' : '受信'}Webhook「${deleteTarget?.name ?? ''}」を削除しますか？`}
        description={
          deleteTarget?.kind === 'outgoing'
            ? 'この宛先への送信が止まり、これから起きる出来事は通知されなくなります。すでに送った記録は残ります。この操作は取り消せません。'
            : 'この受け口のURLは使えなくなり、これから届く通知は受け取れなくなります。すでに受け取った記録は残ります。この操作は取り消せません。'
        }
        confirmLabel="削除する"
        destructive
        busy={deleting}
        error={deleteError}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => {
          if (deleting) return
          setDeleteTarget(null)
          setDeleteError('')
        }}
      />
    </div>
  )
}

function WebhooksPageHost() {
  const tab = useMergedTab(MERGED_TABS)
  return (
    <div>
      <MergedTabs basePath="/webhooks" paramName="tab" tabs={MERGED_TABS} active={tab} />
      {tab === 'webhooks' && <WebhooksPageInner />}
      {tab === 'interactions' && <WebhookInteractions />}
      {tab === 'notify' && <NotificationsPage />}
    </div>
  )
}

export default function WebhooksPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <WebhooksPageHost />
    </Suspense>
  )
}
