'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { X } from 'lucide-react'
import { api, ApiError, type OutgoingWebhookOverview } from '@/lib/api'
import { describeApiFailure } from '@/components/shared/api-error-message'
import type { IncomingWebhook, WebhookInteractionSummary } from '@line-crm/shared'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import WebhookInteractions from './webhook-interactions'
import GoogleSheetsPanel from './google-sheets-panel'
import ApiTokensPanel from './api-tokens-panel'
import { IncomingOverview, OutgoingKpis, OutgoingOverview } from './webhook-overviews'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useAdminTheme } from '@/lib/use-admin-theme'
import OutgoingV8Page from './outgoing-v8'
import InteractionsV8Page from './interactions-v8'
import IncomingV8Page from './incoming-v8'
import ApiTokensV8Page from './apitokens-v8'
import { MIN_SECRET_LENGTH, generateSecret } from './secret'
import StepUpPrompt, { isStepUpRequired, type StepUpRequest } from '@/components/step-up-prompt'

type Tab = 'incoming' | 'outgoing'
type LoadStatus = 'loading' | 'ready' | 'error'
type ToggleKind = 'incoming' | 'outgoing'
type ToggleFailure = { kind: ToggleKind; id: string; name: string; message: string }
/* 送信中にもう一度押されたことの記録(#707)。押下を黙って落とさず、待っている旨を返す。 */
type ToggleBusyNotice = { kind: ToggleKind; id: string; name: string }

/*
 * 受け取り口のURLはAPIの側の住所で組み立てる（C33）。
 *
 * 以前は開いている管理画面の住所を使っていたが、
 * 検証環境では管理画面（pages.dev）とAPI（workers.dev）が別住所のため、
 * 写したURLが受け付け口を指さなかった。受け口は Worker の口なので、
 * 画面が叩いているのと同じAPI基底を使う。末尾の `/` は落とす。
 */
const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')

/*
 * 受け取り口の作成の入力ミスを、欄の下に出す言葉へ写す（R32）。
 *
 * 口の検証文は英語（`name is required` など）で、そのまま出すと直し方が
 * 分からない。どの欄かをここで決め、日本語の直し方を返す。
 * 日本語の本文（LINEアカウントの選択など）はそのまま上に載せる。
 */
function mapIncomingCreateFieldError(raw: string): { field: 'name' | 'secret'; text: string } | null {
  if (/secret/i.test(raw)) return { field: 'secret', text: 'シークレットは32文字以上にしてください' }
  if (/name/i.test(raw)) {
    return /120/.test(raw)
      ? { field: 'name', text: '名前は120文字以内にしてください' }
      : { field: 'name', text: '名前を入力してください' }
  }
  return null
}

function toggleKey(kind: ToggleKind, id: string): string {
  return `${kind}:${id}`
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

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
/*
 * R150: event は送信Webhookが実際に購読できる種類ID
 * (packages/db KNOWN_OUTGOING_EVENT_TYPES)。作られない出来事を
 * 見本に書くと「全イベント送信」の設定が意図せず作られる。
 */
const OUTGOING_SAMPLES = [
  { event: 'friend_add', when: '友だちが追加されたとき', payload: '名前・追加日・流入元' },
  { event: 'form_submitted', when: 'フォームが送られたとき', payload: 'フォーム名・回答ID' },
  { event: 'booking_created', when: '予約が入ったとき', payload: '予約ID・メニュー・担当' },
  { event: 'ec.order.confirmed', when: '注文が確定したとき', payload: '注文番号・金額・お客様名' },
] as const

/*
  `notify` というキーは旧URL（/notifications → /webhooks?tab=notify）の名残。
  リダイレクト自体は通知一覧画面の新設（V6 1-1）で外したが、
  `?tab=notify` の直接リンクは画面内に残っているのでキーは残す。
  中身は通知機能ではなく、下の見本（WebhookSamples）を開く。

  **タブの件数は直書きしない（#980）。**
  設計（V6 26-1 ノード k3WxrO）が描いた「6」「3」は作り物の数で、
  一覧が0件のアカウントでもそのまま出ていた。「送る」「受け取る」の
  件数は WebhooksPageInner が、選択中アカウントで絞った一覧の取得結果と
  同じ配列から付ける。取得前・失敗時は数字を出さない。
  「見本」の件数だけは画面に並べる見本データ（受け取る＋送る）から数える。
*/
const MERGED_TABS = [
  { key: 'outgoing', label: 'こちらから送る' },
  { key: 'incoming', label: 'こちらで受け取る' },
  { key: 'interactions', label: 'やり取りの記録' },
  // #838 第2段: Sheets連携のOAuth戻り先もこのタブ（?tab=sheets&sheets=…）。
  { key: 'sheets', label: 'Google Sheets' },
  // R434: 公開APIの鍵の発行・棚卸し・停止。口は前からあり、画面が無かった。
  { key: 'api-tokens', label: 'API接続' },
  { key: 'notify', label: `見本 ${SOURCE_PRESETS.length + OUTGOING_SAMPLES.length}` },
]

/*
  見本タブの中身（N-381）。以前は別機能の通知画面を埋め込んでいたが、
  外部連携の見本として、受け取る側の種類と送る側のきっかけを並べ、
  それぞれ作成の入口へつなげる。通知機能への導線は置かない。
*/
function WebhookSamples() {
  /*
   * 見本からの作成も受け取り口・送り先の作成（R32）。口側が
   * `requireRole('owner')` で守っているので、統括でなければ
   * 作成ボタンは出さず、統括への依頼だけ出す。
   */
  const [staffRole, setStaffRole] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void api.staff.me()
      .then((response) => {
        if (cancelled || !response.success) return
        setStaffRole(response.data.role)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  const canCreateSamples = staffRole === null || staffRole === 'owner'
  return (
    <div>
      <Notice tone="info" className="mb-4">
        よくあるつなぎ方の見本です。使いたい見本を選ぶと、作成画面がその内容で開きます。
      </Notice>
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
        <section className="bg-canvas border-hairline rounded-card border p-5" aria-label="受け取る見本">
          <h2 className="text-ink mb-1 text-lg font-bold">受け取る見本</h2>
          <p className="text-ink-secondary mb-4 text-sm">相手のサービスで起きたことをうちに取り込みます。</p>
          {canCreateSamples ? (
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
          ) : (
            <p className="text-ink-secondary text-sm">受け取り口の作成は統括だけができます。必要なときは統括に頼んでください。</p>
          )}
        </section>
        <section className="bg-canvas border-hairline rounded-card border p-5" aria-label="送る見本">
          <h2 className="text-ink mb-1 text-lg font-bold">送る見本</h2>
          <p className="text-ink-secondary mb-4 text-sm">うちで起きたことを相手のサービスに知らせます。</p>
          {canCreateSamples ? (
            <ul className="space-y-3">
              {OUTGOING_SAMPLES.map((sample) => (
                <li key={sample.event} className="bg-canvas-sunken rounded-control flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <strong className="text-ink block text-sm">{sample.when}</strong>
                    <span className="text-ink-secondary mt-1 block text-xs">送るもの：{sample.payload}</span>
                  </div>
                  <Button variant="secondary" href={`/webhooks/new?event=${sample.event}`}>
                    送り先を作る
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-secondary text-sm">送り先の作成は統括だけができます。必要なときは統括に頼んでください。</p>
          )}
        </section>
      </div>
    </div>
  )
}

function WebhooksPageInner({ tab }: { tab: Tab }) {
  const { selectedAccountId } = useAccount()
  const selectedAccountIdRef = useRef(selectedAccountId)
  selectedAccountIdRef.current = selectedAccountId
  // 初回は AccountProvider が null → 保存済みアカウントの順で復元する。
  // その復元を「利用者が切り替えた」と誤認せず、最後に表示した実アカウントだけを覚える。
  const lastLoadedAccountIdRef = useRef<string | null>(null)
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
  // 一つの失敗を別行の成功で消さないよう、開始・停止の失敗だけは行ごとに持つ。
  const [toggleFailures, setToggleFailures] = useState<Record<string, ToggleFailure>>({})
  /*
    送信中の行を描画に出すための写し(#707)。

    **二重押し防止の正本は上の `togglingIdsRef` のまま。**ここを正本にすると、
    stateは次の描画まで古い値が見えるので、素早い二重押しを2回とも通してしまう。
    この配列は「送信中だと見える」ためだけに持つ。
  */
  const [togglingKeys, setTogglingKeys] = useState<string[]>([])
  /* 送信中の再押下を黙って落とすと、押しても無反応な画面に見える(#707)。 */
  const [toggleBusyNotices, setToggleBusyNotices] = useState<Record<string, ToggleBusyNotice>>({})
  const searchParams = useSearchParams()
  // 見本タブから `?source=` 付きで来たときだけ、受け取る設定の種類を先に選んでおく。
  // 知らない値は無視して空のままにする。
  const requestedSource = searchParams.get('source') ?? ''
  const initialSource = SOURCE_PRESETS.some((preset) => preset.value === requestedSource)
    ? requestedSource
    : ''
  const [showCreate, setShowCreate] = useState(initialSource !== '')
  const [stepUp, setStepUp] = useState<StepUpRequest | null>(null)
  /*
   * 受け取り口・送り先の作成は統括だけ（R32）。口側が `requireRole('owner')`
   * で守っているので、画面も権限に合わせて操作を出す。
   *
   * できるかは入り直した本人の役割（`api.staff.me()`）で決める。手元の保存値
   * （`localStorage`）は書き換え可能なので判定に使わない（#506 軽と同じ考え）。
   * 確認が終わるまでは今までどおり操作を出し、終わって統括でなければ
   * ボタンを出さず「統括に頼んでください」の案内に替える。
   */
  const [staffRole, setStaffRole] = useState<string | null>(null)
  const [createFieldError, setCreateFieldError] = useState<{ name?: string; secret?: string }>({})

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
  /*
   * d23b R420: 押した時点のLINEアカウントを一緒に持つ。
   * 本人確認の窓をまたいで切り替えられると、別アカウントの設定へ
   * 間違った合言葉を書き込んでしまう。
   */
  const [rotateTarget, setRotateTarget] = useState<
    | { kind: 'incoming' | 'outgoing'; id: string; name: string; activate: boolean; accountId: string }
    | null
  >(null)
  const [rotateSecretValue, setRotateSecretValue] = useState('')

  // 2つの窓も共通の約束に揃える: Escapeで閉じる・Tabは窓の中・
  // 閉じたら起点へ戻す・背面はスクロールしない。
  const rotateModalRef = useOverlayFocus(!!rotateTarget, () => {
    setRotateTarget(null)
    setRotateSecretValue('')
  })
  const secretModalRef = useOverlayFocus(!!createdSecret, () => {
    setCreatedSecret(null)
    setSecretCopied(false)
  })

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
    const accountChanged = lastLoadedAccountIdRef.current !== null
      && lastLoadedAccountIdRef.current !== selectedAccountId
    loadGenerationRef.current += 1
    setCreatedSecret(null)
    setSecretCopied(false)
    setRotateTarget(null)
    setRotateSecretValue('')
    // d23b R420: アカウントを切り替えたら、前のアカウントへ紐付いた
    // 本人確認の窓も閉じる。通った許可を別アカウントの操作へ回さない。
    setStepUp(null)
    if (accountChanged) {
      setShowCreate(false)
      setInForm({ name: '', sourceType: '', secret: '' })
      setCreateFieldError({})
      setSourceIsOther(false)
      setToggleFailures({})
      setToggleBusyNotices({})
    }
    if (selectedAccountId !== null) lastLoadedAccountIdRef.current = selectedAccountId
    void load()
  }, [load, selectedAccountId])

  useEffect(() => {
    let cancelled = false
    void api.staff.me()
      .then((response) => {
        if (cancelled || !response.success) return
        setStaffRole(response.data.role)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // 統括でないことが分かったら、開きかけの作成欄を閉じる。
  useEffect(() => {
    if (staffRole !== null && staffRole !== 'owner') setShowCreate(false)
  }, [staffRole])

  /* 見張り(ref)と見え方(state)を、送信の開始と終了で必ず一緒に動かす(#707)。 */
  const beginToggle = (key: string) => {
    togglingIdsRef.current.add(key)
    setTogglingKeys((current) => current.includes(key) ? current : [...current, key])
    setToggleFailures((current) => {
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  const endToggle = (key: string) => {
    togglingIdsRef.current.delete(key)
    setTogglingKeys((current) => current.filter((item) => item !== key))
    setToggleBusyNotices((current) => {
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  /* 応答待ちの行を、種類ごとのIDに戻して一覧へ渡す。 */
  const togglingIdsOf = (kind: ToggleKind): string[] =>
    togglingKeys.flatMap((key) => key.startsWith(`${kind}:`) ? [key.slice(kind.length + 1)] : [])

  const handleToggleIncoming = async (id: string, currentActive: boolean) => {
    const requestAccountId = selectedAccountId
    if (!requestAccountId || loadedAccountId !== requestAccountId) {
      return setError('LINEアカウントの一覧を読み直してください')
    }
    const key = toggleKey('incoming', id)
    /*
      送信中の行の再押下は受け付けない。二重押しで止める→動かすと逆になる。
      **ただし黙って落とさない(#707)。**落としたことを記録して、待っている旨を返す。
    */
    if (togglingIdsRef.current.has(key)) {
      const name = incoming.find((item) => item.id === id)?.name ?? 'この受け取り口'
      setToggleBusyNotices((current) => ({ ...current, [key]: { kind: 'incoming', id, name } }))
      return
    }
    beginToggle(key)
    try {
      const res = await api.webhooks.incoming.update(id, requestAccountId, { isActive: !currentActive })
      if (selectedAccountIdRef.current !== requestAccountId) return
      // 失敗時は一覧を変えず、次に何をすればよいか出す。成功時だけ読み直してサーバ状態へ寄せる。
      if (!res.success) {
        const name = incoming.find((item) => item.id === id)?.name ?? 'この受け取り口'
        setToggleFailures((current) => ({
          ...current,
          [key]: {
            kind: 'incoming', id, name,
            message: '切り替えできませんでした。状態は変わっていません。確かめてから、もう一度お試しください。',
          },
        }))
        return
      }
      if (selectedAccountIdRef.current === requestAccountId) await load()
    } catch (caught) {
      if (selectedAccountIdRef.current !== requestAccountId) return
      const name = incoming.find((item) => item.id === id)?.name ?? 'この受け取り口'
      // 切り替えは統括だけの操作。権限不足は通信の失敗と分けて案内する（R32）。
      const forbidden = caught instanceof ApiError && caught.status === 403
      setToggleFailures((current) => ({
        ...current,
        [key]: {
          kind: 'incoming', id, name,
          message: forbidden
            ? '統括だけが切り替えできます。必要なときは統括に頼んでください。状態は変わっていません。'
            : '切り替えに失敗しました。状態は変わっていません。時間をおいて、もう一度お試しください。',
        },
      }))
    } finally {
      endToggle(key)
    }
  }

  const handleToggleOutgoing = async (id: string, currentActive: boolean) => {
    const requestAccountId = selectedAccountId
    if (!requestAccountId || loadedAccountId !== requestAccountId) {
      return setError('LINEアカウントの一覧を読み直してください')
    }
    const key = toggleKey('outgoing', id)
    /*
      送信中の行の再押下は受け付けない。二重押しで止める→動かすと逆になる。
      **ただし黙って落とさない(#707)。**落としたことを記録して、待っている旨を返す。
    */
    if (togglingIdsRef.current.has(key)) {
      const name = outgoing.find((item) => item.id === id)?.name ?? 'この送り先'
      setToggleBusyNotices((current) => ({ ...current, [key]: { kind: 'outgoing', id, name } }))
      return
    }
    beginToggle(key)
    try {
      const res = await api.webhooks.outgoing.update(id, requestAccountId, { isActive: !currentActive })
      if (selectedAccountIdRef.current !== requestAccountId) return
      // 失敗時は一覧を変えず、次に何をすればよいか出す。成功時だけ読み直してサーバ状態へ寄せる。
      if (!res.success) {
        const name = outgoing.find((item) => item.id === id)?.name ?? 'この送り先'
        setToggleFailures((current) => ({
          ...current,
          [key]: {
            kind: 'outgoing', id, name,
            message: '切り替えできませんでした。状態は変わっていません。確かめてから、もう一度お試しください。',
          },
        }))
        return
      }
      if (selectedAccountIdRef.current === requestAccountId) await load()
    } catch (caught) {
      if (selectedAccountIdRef.current !== requestAccountId) return
      const name = outgoing.find((item) => item.id === id)?.name ?? 'この送り先'
      // 切り替えは統括だけの操作。権限不足は通信の失敗と分けて案内する（R32）。
      const forbidden = caught instanceof ApiError && caught.status === 403
      if (!forbidden) {
        /*
          d23b R418: 応答が消えても、口側では止める処理が通っていることがある。
          「変わっていません」と断言せず、一覧を読み直して実際の状態へ寄せ、
          結果を確かめる案内だけを残す。
        */
        await load().catch(() => {})
      }
      setToggleFailures((current) => ({
        ...current,
        [key]: {
          kind: 'outgoing', id, name,
          message: forbidden
            ? '統括だけが切り替えできます。必要なときは統括に頼んでください。状態は変わっていません。'
            : '切り替えの応答を受け取れませんでした。一覧の表示を確かめてください。変わっている可能性があります。',
        },
      }))
    } finally {
      endToggle(key)
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
    } catch (caught) {
      if (selectedAccountIdRef.current !== requestAccountId) return
      // 生のAPIエラーは運用者に読めないので、窓の中に運用の言葉で出す。
      // 削除は統括だけの操作。権限不足は通信の失敗と分けて案内する（R32）。
      const forbidden = caught instanceof ApiError && caught.status === 403
      setDeleteError(forbidden
        ? `この${label}の削除は統括だけができます。必要なときは統括に頼んでください。`
        : `この${label}を削除できませんでした。状態を読み直してから、もう一度お試しください。`)
    } finally {
      setDeleting(false)
    }
  }

  const handleCreateIncoming = async (e: React.FormEvent, stepUpToken?: string) => {
    e.preventDefault()
    setError('')
    setCreateFieldError({})
    const requestAccountId = selectedAccountId
    if (!requestAccountId) return setError('LINEアカウントを選択してください')
    if (!inForm.name) {
      setCreateFieldError({ name: '名前を入力してください' })
      return
    }
    if (inForm.secret.length < MIN_SECRET_LENGTH) {
      setCreateFieldError({ secret: `シークレットは最低${MIN_SECRET_LENGTH}文字必要です` })
      return
    }
    try {
      const res = await api.webhooks.incoming.create({
        lineAccountId: requestAccountId,
        name: inForm.name,
        sourceType: inForm.sourceType || undefined,
        secret: inForm.secret,
      }, stepUpToken)
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
    } catch (caught) {
      // 秘密の値の登録は大事な操作。本人確認を求められたら窓を立てる（V-1）。
      if (!stepUpToken && isStepUpRequired(caught)) {
        setStepUp({ purpose: 'webhook.secret', action: '受け取り口を登録する', retry: (token) => handleCreateIncoming(e, token) })
        return
      }
      if (selectedAccountIdRef.current !== requestAccountId) return
      /*
       * 失敗は原因どおりに（R32）。権限がない（403）は統括への依頼、
       * 入力の直し（400/422）は欄の下に直し方を出す。通信・サーバーの
       * 失敗だけが「もう一度」になる。
       */
      if (caught instanceof ApiError && (caught.status === 400 || caught.status === 422)) {
        const mapped = mapIncomingCreateFieldError(caught.message)
        if (mapped) setCreateFieldError({ [mapped.field]: mapped.text })
      }
      setError(describeApiFailure(caught, '作成', {
        forbidden: '受け取り口の作成は統括だけができます。必要なときは統括に頼んでください。',
      }))
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

  const handleRotateSubmit = async (e: React.FormEvent, stepUpToken?: string) => {
    e.preventDefault()
    setError('')
    const requestAccountId = selectedAccountId
    if (!requestAccountId || loadedAccountId !== requestAccountId) {
      return setError('LINEアカウントの一覧を読み直してください')
    }
    if (!rotateTarget) return
    /*
      d23b R420: 本人確認の窓をまたいだり開けたままにしているあいだに
      切り替えられたら、開いた時点のアカウントのものではない。書き込みを
      止めて選び直させる（本人確認の許可は開いたときのアカウントに紐付く）。
    */
    if (rotateTarget.accountId !== requestAccountId) {
      setRotateTarget(null)
      setRotateSecretValue('')
      setError('LINEアカウントが切り替わりました。対象を選び直してください。')
      return
    }
    if (rotateSecretValue.length < MIN_SECRET_LENGTH) {
      setError(`シークレットは最低${MIN_SECRET_LENGTH}文字必要です`)
      return
    }
    try {
      const payload = { secret: rotateSecretValue, isActive: rotateTarget.activate || undefined }
      const res =
        rotateTarget.kind === 'incoming'
          ? await api.webhooks.incoming.update(rotateTarget.id, requestAccountId, payload, stepUpToken)
          : await api.webhooks.outgoing.update(rotateTarget.id, requestAccountId, payload, stepUpToken)
      if (selectedAccountIdRef.current !== requestAccountId) return
      if (!res.success) {
        setError(res.error)
        return
      }
      setRotateTarget(null)
      setRotateSecretValue('')
      load()
    } catch (caught) {
      // シークレットの差し替えは大事な操作。本人確認を求められたら窓を立てる（V-1）。
      if (!stepUpToken && isStepUpRequired(caught)) {
        setStepUp({ purpose: 'webhook.secret', action: 'シークレットを更新する', retry: (token) => handleRotateSubmit(e, token) })
        return
      }
      if (selectedAccountIdRef.current !== requestAccountId) return
      setError(describeApiFailure(caught, 'シークレットの更新', {
        forbidden: '合言葉の更新は統括だけができます。必要なときは統括に頼んでください。',
      }))
    }
  }

  const endpointUrl = (id: string) => `${API_BASE}/api/webhooks/incoming/${id}/receive`
  const activeStatus = tab === 'incoming' ? incomingStatus : outgoingStatus
  /*
   * 作成の操作は統括だけに出す（R32）。役割の確認が終わるまでは
   * 今までどおり出し、統括でないと分かったら案内に替える。
   */
  const canCreate = staffRole === null || staffRole === 'owner'
  const createGuidance = tab === 'incoming'
    ? '受け取り口の作成は統括だけができます。必要なときは統括に頼んでください。'
    : '送り先の作成は統括だけができます。必要なときは統括に頼んでください。'

  /*
    #980: タブの件数は、そのタブの一覧と同じ取得から数える。
    `incoming` / `outgoing` はこの画面が選択中アカウントで絞って取った配列で、
    下の一覧（IncomingOverview / OutgoingOverview）とKPI帯（OutgoingKpis、
    タブの下にこの画面が描く）がそのまま描く同じ集合。読み込み中・
    取得失敗・まだ取っていない間は数字を付けない
    （一覧側も「読み込んでいます」「表示できませんでした」と数を分けている）。
  */
  const countedTabs = MERGED_TABS.map((item) => {
    if (item.key === 'outgoing' && outgoingStatus === 'ready') {
      return { ...item, label: `${item.label} ${outgoing.length}` }
    }
    if (item.key === 'incoming' && incomingStatus === 'ready') {
      return { ...item, label: `${item.label} ${incoming.length}` }
    }
    return item
  })

  return (
    <div className="flex flex-col gap-4">
      {/* カード同士の縦の間隔はこの親の gap-4（16px）だけで作る。子ごとの mb/mt は付けない。 */}
      <div data-design="Crumb" className="flex flex-wrap items-center justify-between gap-3">
        <nav className="text-ink-faint text-xs" aria-label="パンくず">
          <span className="text-action font-semibold">自動化</span>
          <span className="mx-2">›</span>
          <span>外部連携</span>
        </nav>
      </div>
      <MergedTabs basePath="/webhooks" paramName="tab" tabs={countedTabs} active={tab} />
      {/*
        作る操作は数字のカードの下・一覧のすぐ上の左にそろえる。
        「見本から作る」も作る操作なので同じ並びの副ボタンへ、
        統括だけに出す（R32）。管理者には統括への依頼だけ出す。
        数字のカード（こちらから送るタブの KPI 帯）の下に置く。
      */}
      {tab === 'outgoing' ? (
        <div className="mt-4">
          <OutgoingKpis
            items={outgoing}
            status={outgoingStatus}
            incomingCount={incoming.length}
            summary={interactionSummary}
            summaryStatus={summaryStatus}
          />
        </div>
      ) : null}
      <div className="mb-4 mt-4 flex flex-wrap items-center gap-2">
        {tab === 'incoming' ? (
          canCreate ? (
            <Button variant="primary" onClick={() => setShowCreate(!showCreate)}>
              {showCreate ? 'キャンセル' : '＋ 受け取り口を作る'}
            </Button>
          ) : (
            <p className="text-ink-secondary text-sm">{createGuidance}</p>
          )
        ) : canCreate ? (
          <Button variant="primary" href="/webhooks/new">＋ 送り先を作る</Button>
        ) : (
          <p className="text-ink-secondary text-sm">{createGuidance}</p>
        )}
        {canCreate ? (
          <Button variant="secondary" href="/webhooks?tab=notify">見本から作る</Button>
        ) : null}
      </div>

      {/* Rotate-secret modal — used to recover legacy webhooks or rotate. */}
      {rotateTarget && (
        <div ref={rotateModalRef} className="fixed inset-0 bg-scrim flex items-center justify-center z-50 p-4">
          <form onSubmit={handleRotateSubmit} role="dialog" aria-modal="true" aria-labelledby="rotate-secret-title" className="bg-canvas rounded-control shadow-float max-w-lg w-full p-6">
            <div className="mb-2 flex items-start justify-between gap-3">
              <h2 id="rotate-secret-title" className="text-lg font-semibold text-ink">
                「{rotateTarget.name}」のシークレットを{rotateTarget.activate ? '設定して有効化' : '更新'}
              </h2>
              <button
                type="button"
                aria-label="閉じる"
                className="rounded-mini p-1 text-ink-secondary hover:bg-canvas-sunken"
                onClick={() => {
                  setRotateTarget(null)
                  setRotateSecretValue('')
                }}
              >
                <X aria-hidden="true" className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-ink-secondary mb-4">
              新しいシークレットを設定します。
              <strong className="text-danger">設定後は今回限り画面に表示されません。</strong>
              控えておいてから「保存」を押してください。
              保存後も前の合言葉は24時間だけ使えるので、相手側の切り替え中も届物は止まりません。
            </p>
            <div className="flex gap-2 mb-4">
              <input
                value={rotateSecretValue}
                onChange={(e) => setRotateSecretValue(e.target.value)}
                className="flex-1 border border-hairline rounded-control px-3 py-2 text-sm font-mono"
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
              <Button
                type="submit"
                variant="primary"
              >
                保存する
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Created-secret modal — shown ONCE after a successful create. */}
      {createdSecret && (
        <div className="fixed inset-0 bg-scrim flex items-center justify-center z-50 p-4">
          <div ref={secretModalRef} role="dialog" aria-modal="true" aria-labelledby="created-secret-title" className="bg-canvas rounded-control shadow-float max-w-lg w-full p-6">
            <div className="mb-2 flex items-start justify-between gap-3">
              <h2 id="created-secret-title" className="text-lg font-semibold text-ink">
                シークレットを保存してください
              </h2>
              <button
                type="button"
                aria-label="閉じる"
                className="rounded-mini p-1 text-ink-secondary hover:bg-canvas-sunken"
                onClick={() => {
                  setCreatedSecret(null)
                  setSecretCopied(false)
                }}
              >
                <X aria-hidden="true" className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-ink-secondary mb-4">
              「{createdSecret.name}」を作成しました。
              <strong className="text-danger">このシークレットは今後二度と表示されません。</strong>
              閉じる前に必ず安全な場所に保存してください。
            </p>
            <div className="bg-canvas-sunken border border-hairline rounded-mini p-3 mb-4">
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
                className="px-4 py-2 text-sm rounded-control text-on-accent font-medium"
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
        <Notice tone="danger" className="mb-4">
          {error}
        </Notice>
      )}
      {Object.entries(toggleFailures).map(([key, failure]) => (
        <Notice
          key={key}
          tone="danger"
          className="mb-4"
          data-webhook-toggle-error={key}
        >
          「{failure.name}」を{failure.kind === 'incoming' ? '受け取る設定' : '送る設定'}：{failure.message}
        </Notice>
      ))}
      {/*
        送信中の再押下に返す案内(#707)。`disabled` で押せなくすると、二重押しが
        そもそも起こせなくなり、二重押し防止(togglingIdsRef)を見張っている
        試験が壊れても緑のままになる。押せる状態は保ったまま、2回目の押下を
        黙って落とさずここへ出す。失敗案内と同じ場所へ置いて、見る所を増やさない。
      */}
      {Object.entries(toggleBusyNotices).map(([key, busy]) => (
        <Notice
          key={key}
          tone="warn"
          className="mb-4"
          data-webhook-toggle-busy={key}
        >
          「{busy.name}」を{busy.kind === 'incoming' ? '受け取る設定' : '送る設定'}：いま切り替えを送っています。返事が来るまでお待ちください。
        </Notice>
      ))}

      {/* Create forms */}
      {showCreate && tab === 'incoming' && (
        <form onSubmit={handleCreateIncoming} className="bg-canvas rounded-control border border-hairline p-6">
          <h3 className="text-sm font-semibold text-ink mb-4">受け取る設定を追加</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-1">名前</label>
              <input
                value={inForm.name}
                onChange={(e) => {
                  setInForm({ ...inForm, name: e.target.value })
                  if (createFieldError.name) setCreateFieldError((current) => ({ ...current, name: undefined }))
                }}
                className="w-full border border-hairline rounded-control px-3 py-2 text-sm"
                placeholder="LINE公式アカウント"
                required
              />
              {createFieldError.name ? (
                <p className="text-danger mt-1 text-xs" role="alert">{createFieldError.name}</p>
              ) : null}
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-1">どこから来るか</label>
              <Select
                value={sourceIsOther ? SOURCE_OTHER : inForm.sourceType}
                onChange={(value) => {
                  const next = value
                  if (next === SOURCE_OTHER) { setSourceIsOther(true); setInForm({ ...inForm, sourceType: '' }); return }
                  setSourceIsOther(false)
                  setInForm({ ...inForm, sourceType: next })
                }}
                aria-label="受信元の種類"
                size="full"
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
                  onChange={(e) => {
                    setInForm({ ...inForm, secret: e.target.value })
                    if (createFieldError.secret) setCreateFieldError((current) => ({ ...current, secret: undefined }))
                  }}
                  className="flex-1 border border-hairline rounded-control px-3 py-2 text-sm font-mono"
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
              {createFieldError.secret ? (
                <p className="text-danger mt-1 text-xs" role="alert">{createFieldError.secret}</p>
              ) : null}
              <p className="text-xs text-ink-faint mt-1">
                外部システムが Webhook 受信時に X-Webhook-Signature ヘッダで HMAC-SHA256 署名する際に使用します。
              </p>
            </div>
          </div>
          <Button
            type="submit"
            variant="primary"
            className="mt-4"
          >
            作る
          </Button>
        </form>
      )}

      {tab === 'incoming' ? (
        <IncomingOverview
          items={incoming}
          status={activeStatus}
          showCreate={showCreate}
          lineAccountId={selectedAccountId}
          endpointUrl={endpointUrl}
          canManage={canCreate}
          canResolveUnmatched={staffRole === null || staffRole === 'owner' || staffRole === 'admin'}
          onReload={() => void load()}
          onToggle={handleToggleIncoming}
          togglingIds={togglingIdsOf('incoming')}
          onRotate={(wh) => {
            // 開いた時点のアカウントを固定する（d23b R420）。
            setRotateTarget({ kind: 'incoming', id: wh.id, name: wh.name, activate: !wh.hasSecret, accountId: selectedAccountId ?? '' })
            setRotateSecretValue('')
          }}
          onDelete={(wh) => askDelete('incoming', wh.id, wh.name)}
        />
      ) : (
        <OutgoingOverview
          items={outgoing}
          status={activeStatus}
          showCreate={showCreate}
          canManage={canCreate}
          summary={interactionSummary}
          summaryStatus={summaryStatus}
          incomingCount={incoming.length}
          lineAccountId={selectedAccountId}
          onReload={() => void load()}
          onToggle={handleToggleOutgoing}
          togglingIds={togglingIdsOf('outgoing')}
          onRotate={(wh) => {
            // 開いた時点のアカウントを固定する（d23b R420）。
            setRotateTarget({
              kind: 'outgoing',
              id: wh.id,
              name: wh.name,
              activate: isHttpsUrl(wh.url) && !wh.hasSecret,
              accountId: selectedAccountId ?? '',
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
      {stepUp && <StepUpPrompt request={stepUp} onDone={() => setStepUp(null)} onClose={() => setStepUp(null)} />}
    </div>
  )
}

function WebhooksPageHost() {
  const tab = useMergedTab(MERGED_TABS)
  const theme = useAdminTheme()
  usePageTitle('外部連携')
  /*
   * ★V8 切替（一覧 `ZSbFY`）。v7 の見た目は data-theme="v8" が付くまで
   * 1画素も変えない。ほかのタブは v7 のまま（1タブずつV8化する）。
   */
  if (theme === 'v8' && tab === 'outgoing') return <OutgoingV8Page />
  if (theme === 'v8' && tab === 'interactions') return <InteractionsV8Page />
  if (theme === 'v8' && tab === 'incoming') return <IncomingV8Page />
  if (theme === 'v8' && tab === 'api-tokens') return <ApiTokensV8Page />
  if (tab === 'incoming' || tab === 'outgoing') return <WebhooksPageInner key={tab} tab={tab} />
  return (
    <div className="flex flex-col gap-4">
      <MergedTabs basePath="/webhooks" paramName="tab" tabs={MERGED_TABS} active={tab} />
      {tab === 'interactions' && <WebhookInteractions />}
      {tab === 'sheets' && <GoogleSheetsPanel />}
      {tab === 'api-tokens' && <ApiTokensPanel />}
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
