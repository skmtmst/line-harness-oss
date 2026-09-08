'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { api, type OutgoingWebhookOverview } from '@/lib/api'
import type { IncomingWebhook, WebhookInteractionSummary } from '@line-crm/shared'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import SelectField from '@/components/shared/select-field'
import WebhookInteractions from './webhook-interactions'
import { IncomingOverview, OutgoingOverview } from './webhook-overviews'
import { usePageTitle } from '@/components/shell/page-chrome'
import { MIN_SECRET_LENGTH, generateSecret } from './secret'

type Tab = 'incoming' | 'outgoing'
type LoadStatus = 'loading' | 'ready' | 'error'

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

/*
  `notify` というキーは旧URL（/notifications → /webhooks?tab=notify）のために残す。
  中身は通知機能ではなく、下の見本（WebhookSamples）を開く。
  「見本 14」という表示は設計（V6 26-1 ノード k3WxrO）の指定なので変えない。
*/
const MERGED_TABS = [
  { key: 'outgoing', label: 'こちらから送る 6' },
  { key: 'incoming', label: 'こちらで受け取る 3' },
  { key: 'interactions', label: 'やり取りの記録' },
  { key: 'notify', label: '見本 14' },
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

/*
  送る側の見本（いつ送るか・何を送るか）。一覧の表示文言とそろえている。
  送り先の作成は /webhooks/new で行うので、ここでは行き先の案内だけ持つ。
*/
const OUTGOING_SAMPLES = [
  { event: 'friend.added', when: '友だちが追加されたとき', payload: '名前・追加日・流入元' },
  { event: 'form.submitted', when: 'フォームが送られたとき', payload: '回答のすべて' },
  { event: 'booking.created', when: '予約が入ったとき', payload: '予約日時・メニュー・担当' },
  { event: 'conversion.confirmed', when: '注文が確定したとき', payload: '注文番号・金額・お客様名' },
] as const

/*
  見本タブの中身（N-381）。以前は別機能の通知画面を埋め込んでいたが、
  外部連携の見本として、受け取る側の種類と送る側のきっかけを並べ、
  それぞれ作成の入口へつなげる。通知機能への導線は置かない。
*/
function WebhookSamples() {
  return (
    <div>
      <p className="bg-accent-soft text-ink-secondary rounded-card mb-4 px-4 py-3 text-sm leading-6">
        よくあるつなぎ方の見本です。使いたい見本を選ぶと、作成画面がその内容で開きます。
      </p>
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
        <section className="bg-canvas border-hairline rounded-card border p-5" aria-label="受け取る見本">
          <h2 className="text-ink mb-1 text-lg font-bold">受け取る見本</h2>
          <p className="text-ink-secondary mb-4 text-sm">相手のサービスで起きたことをうちに取り込みます。</p>
          <ul className="space-y-3">
            {SOURCE_PRESETS.map((preset) => (
              <li key={preset.value} className="bg-canvas-sunken rounded-control flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <strong className="text-ink block text-sm">{preset.label}</strong>
                  <span className="text-ink-secondary mt-1 block text-xs">{preset.hint}</span>
                </div>
                <Button variant="secondary" href={`/webhooks?tab=incoming&source=${preset.value}`}>
                  この見本で作る
                </Button>
              </li>
            ))}
          </ul>
        </section>
        <section className="bg-canvas border-hairline rounded-card border p-5" aria-label="送る見本">
          <h2 className="text-ink mb-1 text-lg font-bold">送る見本</h2>
          <p className="text-ink-secondary mb-4 text-sm">うちで起きたことを相手のサービスに知らせます。</p>
          <ul className="space-y-3">
            {OUTGOING_SAMPLES.map((sample) => (
              <li key={sample.event} className="bg-canvas-sunken rounded-control flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <strong className="text-ink block text-sm">{sample.when}</strong>
                  <span className="text-ink-secondary mt-1 block text-xs">送るもの：{sample.payload}</span>
                </div>
                <Button variant="secondary" href="/webhooks/new">
                  送り先を作る
                </Button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}

function WebhooksPageInner({ tab }: { tab: Tab }) {
  const { selectedAccountId } = useAccount()
  const selectedAccountIdRef = useRef(selectedAccountId)
  selectedAccountIdRef.current = selectedAccountId
  const loadGenerationRef = useRef(0)
  /*
    開始/停止の送信中の行ID（N-382）。二重押しの2回目は受け付けない。
    stateではなくrefで持つ。stateは次の描画まで古い値が見えるため、
    素早い二重押しを2回とも通してしまう。行ごとに持つので、他の行の操作は止めない。
  */
  const togglingIdsRef = useRef<Set<string>>(new Set())
  const [incoming, setIncoming] = useState<IncomingWebhook[]>([])
  const [outgoing, setOutgoing] = useState<OutgoingWebhookOverview[]>([])
  const [incomingStatus, setIncomingStatus] = useState<LoadStatus>('loading')
  const [outgoingStatus, setOutgoingStatus] = useState<LoadStatus>('loading')
  const [interactionSummary, setInteractionSummary] = useState<WebhookInteractionSummary | null>(null)
  const [summaryStatus, setSummaryStatus] = useState<LoadStatus>('loading')
  const [loadedAccountId, setLoadedAccountId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const searchParams = useSearchParams()
  // 見本タブから `?source=` 付きで来たときだけ、受け取る設定の種類を先に選んでおく。
  // 知らない値は無視して空のままにする。
  const requestedSource = searchParams.get('source') ?? ''
  const initialSource = SOURCE_PRESETS.some((preset) => preset.value === requestedSource)
    ? requestedSource
    : ''
  const [showCreate, setShowCreate] = useState(initialSource !== '')

  const [inForm, setInForm] = useState({ name: '', sourceType: initialSource, secret: '' })
  // 見本に無いものを選んだときだけ、自由入力に切り替える。
  const [sourceIsOther, setSourceIsOther] = useState(false)
  const selectedPreset = sourceIsOther
    ? null
    : SOURCE_PRESETS.find((preset) => preset.value === inForm.sourceType) ?? null

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
    setInteractionSummary(null)
    setLoadedAccountId(null)
    setError('')
    if (!requestAccountId) {
      setIncomingStatus('ready')
      setOutgoingStatus('ready')
      setSummaryStatus('ready')
      return
    }
    setIncomingStatus('loading')
    setOutgoingStatus('loading')
    setSummaryStatus('loading')
    setError('')
    const [incomingResult, outgoingResult, interactionsResult] = await Promise.allSettled([
      api.webhooks.incoming.list(requestAccountId),
      api.webhooks.outgoing.list(requestAccountId),
      api.webhooks.interactions.list(requestAccountId, { periodDays: 30, page: 1, limit: 1 }),
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

    if (
      interactionsResult.status === 'fulfilled'
      && interactionsResult.value.success
      && interactionsResult.value.data?.summary
    ) {
      setInteractionSummary(interactionsResult.value.data.summary)
      setSummaryStatus('ready')
    } else {
      setInteractionSummary(null)
      setSummaryStatus('error')
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
    void load()
  }, [load, selectedAccountId])

  const handleToggleIncoming = async (id: string, currentActive: boolean) => {
    const requestAccountId = selectedAccountId
    if (!requestAccountId || loadedAccountId !== requestAccountId) {
      return setError('LINEアカウントの一覧を読み直してください')
    }
    // 送信中の行の再押下は受け付けない。二重押しで止める→動かすと逆になる。
    if (togglingIdsRef.current.has(id)) return
    togglingIdsRef.current.add(id)
    try {
      const res = await api.webhooks.incoming.update(id, requestAccountId, { isActive: !currentActive })
      if (selectedAccountIdRef.current !== requestAccountId) return
      // 失敗時は一覧を変えず、次に何をすればよいか出す。成功時だけ読み直してサーバ状態へ寄せる。
      if (!res.success) return setError(`切り替えできませんでした（${res.error}）。状態は変わっていません。確かめてから、もう一度お試しください。`)
      if (selectedAccountIdRef.current === requestAccountId) await load()
    } catch {
      if (selectedAccountIdRef.current !== requestAccountId) return
      setError('切り替えに失敗しました。状態は変わっていません。時間をおいて、もう一度お試しください。')
    } finally {
      togglingIdsRef.current.delete(id)
    }
  }

  const handleToggleOutgoing = async (id: string, currentActive: boolean) => {
    const requestAccountId = selectedAccountId
    if (!requestAccountId || loadedAccountId !== requestAccountId) {
      return setError('LINEアカウントの一覧を読み直してください')
    }
    // 送信中の行の再押下は受け付けない。二重押しで止める→動かすと逆になる。
    if (togglingIdsRef.current.has(id)) return
    togglingIdsRef.current.add(id)
    try {
      const res = await api.webhooks.outgoing.update(id, requestAccountId, { isActive: !currentActive })
      if (selectedAccountIdRef.current !== requestAccountId) return
      // 失敗時は一覧を変えず、次に何をすればよいか出す。成功時だけ読み直してサーバ状態へ寄せる。
      if (!res.success) return setError(`切り替えできませんでした（${res.error}）。状態は変わっていません。確かめてから、もう一度お試しください。`)
      if (selectedAccountIdRef.current === requestAccountId) await load()
    } catch {
      if (selectedAccountIdRef.current !== requestAccountId) return
      setError('切り替えに失敗しました。状態は変わっていません。時間をおいて、もう一度お試しください。')
    } finally {
      togglingIdsRef.current.delete(id)
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
      await load()
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

  return (
    <div>
      <div data-design="Crumb" className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav className="text-ink-faint text-xs" aria-label="パンくず">
          <span className="text-action font-semibold">自動化</span>
          <span className="mx-2">›</span>
          <span>外部連携</span>
        </nav>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" href="/webhooks?tab=notify">見本から作る</Button>
          {tab === 'incoming' ? (
            <Button variant="primary" onClick={() => setShowCreate(!showCreate)}>
              {showCreate ? 'キャンセル' : '受け取り口を追加'}
            </Button>
          ) : (
            <Button variant="primary" href="/webhooks/new">送り先を追加</Button>
          )}
        </div>
      </div>
      <MergedTabs basePath="/webhooks" paramName="tab" tabs={MERGED_TABS} active={tab} />

      {/* Rotate-secret modal — used to recover legacy webhooks or rotate. */}
      {rotateTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <form onSubmit={handleRotateSubmit} className="bg-canvas rounded-lg shadow-xl max-w-lg w-full p-6">
            <h2 className="text-lg font-semibold text-ink mb-2">
              「{rotateTarget.name}」のシークレットを{rotateTarget.activate ? '設定して有効化' : '更新'}
            </h2>
            <p className="text-sm text-ink-secondary mb-4">
              新しいシークレットを設定します。
              <strong className="text-danger">設定後は今回限り画面に表示されません。</strong>
              控えておいてから「保存」を押してください。
            </p>
            <div className="flex gap-2 mb-4">
              <input
                value={rotateSecretValue}
                onChange={(e) => setRotateSecretValue(e.target.value)}
                className="flex-1 border border-hairline rounded-lg px-3 py-2 text-sm font-mono"
                placeholder="ランダムな英数字32文字以上"
                required
                minLength={MIN_SECRET_LENGTH}
                autoFocus
              />
              <Button
                type="button"
                onClick={() => setRotateSecretValue(generateSecret())}
              >
                自動生成
              </Button>
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                type="button"
                onClick={() => {
                  setRotateTarget(null)
                  setRotateSecretValue('')
                }}
              >
                キャンセル
              </Button>
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
          <div className="bg-canvas rounded-lg shadow-xl max-w-lg w-full p-6">
            <h2 className="text-lg font-semibold text-ink mb-2">
              シークレットを保存してください
            </h2>
            <p className="text-sm text-ink-secondary mb-4">
              「{createdSecret.name}」を作成しました。
              <strong className="text-danger">このシークレットは今後二度と表示されません。</strong>
              閉じる前に必ず安全な場所に保存してください。
            </p>
            <div className="bg-canvas-sunken border border-hairline rounded p-3 mb-4">
              <code className="text-sm break-all">{createdSecret.secret}</code>
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                onClick={() => copySecret(createdSecret.secret)}
              >
                {secretCopied ? 'コピー済み' : 'クリップボードにコピー'}
              </Button>
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
        <div className="mb-4 p-4 bg-danger-bg border border-danger-bg rounded-lg text-danger text-sm">
          {error}
        </div>
      )}

      {/* Create forms */}
      {showCreate && tab === 'incoming' && (
        <form onSubmit={handleCreateIncoming} className="bg-canvas rounded-lg border border-hairline p-6 mb-6">
          <h3 className="text-sm font-semibold text-ink mb-4">受け取る設定を追加</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-1">名前</label>
              <input
                value={inForm.name}
                onChange={(e) => setInForm({ ...inForm, name: e.target.value })}
                className="w-full border border-hairline rounded-lg px-3 py-2 text-sm"
                placeholder="LINE公式アカウント"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-1">どこから来るか</label>
              <SelectField
                value={sourceIsOther ? SOURCE_OTHER : inForm.sourceType}
                onChange={(e) => {
                  const next = e.target.value
                  if (next === SOURCE_OTHER) { setSourceIsOther(true); setInForm({ ...inForm, sourceType: '' }); return }
                  setSourceIsOther(false)
                  setInForm({ ...inForm, sourceType: next })
                }}
                aria-label="受信元の種類"
                className="w-full border border-hairline rounded-lg px-3 py-2 text-sm"
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
              <label className="block text-sm font-medium text-ink-secondary mb-1">
                シークレット (最低{MIN_SECRET_LENGTH}文字)
              </label>
              <div className="flex gap-2">
                <input
                  value={inForm.secret}
                  onChange={(e) => setInForm({ ...inForm, secret: e.target.value })}
                  className="flex-1 border border-hairline rounded-lg px-3 py-2 text-sm font-mono"
                  placeholder="ランダムな英数字32文字以上"
                  required
                  minLength={MIN_SECRET_LENGTH}
                />
                <Button
                  type="button"
                  onClick={() => setInForm({ ...inForm, secret: generateSecret() })}
                >
                  自動生成
                </Button>
              </div>
              <p className="text-xs text-ink-faint mt-1">
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

      {tab === 'incoming' ? (
        <IncomingOverview
          items={incoming}
          status={activeStatus}
          showCreate={showCreate}
          lineAccountId={selectedAccountId}
          endpointUrl={endpointUrl}
          onReload={() => void load()}
          onToggle={handleToggleIncoming}
          onRotate={(wh) => {
            setRotateTarget({ kind: 'incoming', id: wh.id, name: wh.name, activate: !wh.hasSecret })
            setRotateSecretValue('')
          }}
          onDelete={(wh) => askDelete('incoming', wh.id, wh.name)}
        />
      ) : (
        <OutgoingOverview
          items={outgoing}
          status={activeStatus}
          showCreate={showCreate}
          summary={interactionSummary}
          summaryStatus={summaryStatus}
          incomingCount={incoming.length}
          lineAccountId={selectedAccountId}
          onReload={() => void load()}
          onToggle={handleToggleOutgoing}
          onRotate={(wh) => {
            setRotateTarget({
              kind: 'outgoing',
              id: wh.id,
              name: wh.name,
              activate: isHttpsUrl(wh.url) && !wh.hasSecret,
            })
            setRotateSecretValue('')
          }}
          onDelete={(wh) => askDelete('outgoing', wh.id, wh.name)}
        />
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
  usePageTitle('外部連携')
  if (tab === 'incoming' || tab === 'outgoing') return <WebhooksPageInner key={tab} tab={tab} />
  return (
    <div>
      <MergedTabs basePath="/webhooks" paramName="tab" tabs={MERGED_TABS} active={tab} />
      {tab === 'interactions' && <WebhookInteractions />}
      {tab === 'notify' && <WebhookSamples />}
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
