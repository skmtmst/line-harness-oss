'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Check, LogIn, Plug, Send, X } from 'lucide-react'
import { PageFrame, PageHeading } from '@/components/templates/page-frame'
import { PageFooter } from '@/components/templates/page-footer'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import Dialog from '@/components/shared/dialog'
import Notice from '@/components/shared/notice'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import { usePageTitle, usePageCrumbs, useHideSettingsNav } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { restaurantDeliveryApi, type UberConnectionData, type UberConnectionStatus } from '@/lib/restaurant-delivery-api'
import { formatDate } from '@/lib/format'
import styles from './delivery.module.css'

/**
 * ★V8-B 設定 › デリバリー連携
 * （`dF4Ov` 未接続 ／ `OIY4Z` 接続後の状態 ／ `kJLks` 解除の確認 ／ `X5d8UF` つなぐお店を選ぶ、2026-10-12 利用者承認）。
 * 承認案：`新規デザイン/2026-10-12_デリバリー管理_デリバリー連携/デリバリー連携_v03.pen`
 *
 * 画面の作りは設定 › SNS 連携（`v8/settings/sns/sns.tsx`）に合わせ、1列のカードを縦に並べる。
 * お店での入力欄は作らない。つなぐ操作は各社のログイン、または musubo への申し込みだけ。
 *
 * 承認された範囲は「ボタンは押せない状態で用意し、回答が来た会社から中身をつなぐ」。
 * Uber Eats は受け口がつながったので `ready` を true にし、ログインの経路を実際に動かす。
 * 出前館・ロケットナウは返事待ちのため false のまま（押せないボタン＋待ちの案内）。
 *
 * Uber Eats の流れ：
 *  1. ［Uber Eats にログインしてつなぐ］→ `POST …/ubereats/connect/start` →返った認可URLへ移動。
 *  2. Uber で「許可」→ サーバの戻り口が受け取り、この画面へ `?ubereats=pending_store` で戻る。
 *  3. この画面は開くたびに `GET …/ubereats/connection` で本当の状態を読み直す。
 *
 * `pending_store`（ログイン済み・つなぐお店は未選択）は、まだ注文が入らないので
 * 札は「未接続」のまま、承認案 `OIY4Z` の帯（Notice）で続きを伝える。新しい状態札は増やさない。
 *
 * つなぐお店を選ぶ段（`X5d8UF`）：
 *  4. Uber から戻った直後（`?ubereats=pending_store`）は `GET …/ubereats/stores` で候補を取り、窓を開く。
 *  5. ［このお店につなぐ］→ `POST …/ubereats/stores/select` → Uber 側の連携が有効になり「接続中」。
 * 候補を取るときだけ Uber へ問い合わせる（画面を開くたびには問い合わせない）。
 * 窓を閉じたあとは、同じボタンから選び直せる（ログインのやり直しは要らない）。
 * 確定は結果が分からないまま送り直すと連携が重なるため、自動では再送しない。
 *
 * 承認案と作りが食い違うところ（`docs/v8-design-rules.md` §1 正本の順位で決めた。詳しくは同じ場所の `BEHAVIOR.md`）：
 *  - 社名のうしろの半角の空き … 絵のとおり直した（`withParticle`）。
 *  - 窓の左のボタン … 絵は「やめる」だが、オーナーの決まり B-146（入力をやめる＝「キャンセル」、
 *    「やめる」は使わない）が絵より上なので「キャンセル」のまま。
 *  - 右上の×と窓の高さ … ×は共通部品が必ず出す（UI-25、`dialog-close-ui25.test.tsx` の見張り）。
 *    絵には×がないが「見張りに反する絵は、今の作りに合わせて絵を直す」ため、×は消さない。
 *    高さ 396 と 451 の差は、絵の余白（12/20）と間隔（12）が共通部品の値（24・16）と違うせい。
 *    「作る画面の細かい違いは共通部品の値にそろえる」ので、ここでは数字を合わせ込まない。
 *  → 絵の側を直すのは `デリバリー連携_v04.pen` の仕事（未承認。承認済み v03 は残す）。
 *
 * 出前館・ロケットナウの状態と日付は、各社の受け口が決まったあとサーバから受け取る。
 * それまでの間も画面の経路を確かめられるよう、入口の値は `services` の引数で
 * 差し替えられるようにしてある（既定は下の `SERVICES`）。
 */

type DeliveryStatus = 'disconnected' | 'connected' | 'error' | 'applying'

const STATUS: Record<DeliveryStatus, { label: string; tone: StatusBadgeTone }> = {
  disconnected: { label: '未接続', tone: 'neutral' },
  connected: { label: '接続中', tone: 'success' },
  error: { label: '接続エラー', tone: 'danger' },
  applying: { label: '申し込み受付中', tone: 'warning' },
}

/** つなぐお店の候補。各社のログインから戻ったあと、サーバ経由で受け取る並び。 */
export type DeliveryStore = { id: string; name: string; address: string }

export type DeliveryService = {
  id: 'uber' | 'demaecan' | 'rocketnow'
  name: string
  /** 段の説明（題のすぐ下） */
  sub: string
  /** つなぎ方。login＝各社のログインで繋ぐ／apply＝musubo が申し込みを代行する */
  connect: 'login' | 'apply'
  /** つなぐ手順の案内（真珠色の囲み） */
  guide: string
  /** 返事が来てつなげるようになった会社だけ true。false の間はボタンを押せない。 */
  ready: boolean
  status: DeliveryStatus
  /** つないだお店の名前（接続中・接続エラーのとき） */
  storeName?: string
  connectedAt?: string
  checkedAt?: string
  appliedAt?: string
  /** 状態の下へ出す帯（`OIY4Z` の Notice）。接続エラー・申し込み受付中・ログイン直後に使う。 */
  stateNote?: string
  /** 帯の色。既定は状態まかせ（接続エラーだけ赤）。ログインから戻った知らせはここで指定する。 */
  stateNoteTone?: 'warn' | 'danger'
  /** 各社のログインで許可されたお店の一覧（`X5d8UF` の選び口に出す） */
  stores?: DeliveryStore[]
}

/**
 * 会社の名前のうしろに「で」「に」などを足す。
 * 英数字で終わる名前（Uber Eats）のあとだけ半角の空きを入れ、日本語の名前（出前館）はそのまま続ける。
 * 承認案の文（「Uber Eats での許可を…」「Uber Eats の連携を…」）と、
 * 数字の単位の決まり（`docs/v8-design-rules.md`「単位は数字の後ろに半角の空き」）に合わせる。
 */
function withParticle(name: string, particle: string): string {
  return /[0-9A-Za-z]$/.test(name) ? `${name} ${particle}` : `${name}${particle}`
}

/** つなぐボタンの名札。解除の窓の案内文でも同じ言い方を使う。 */
function connectLabel(service: DeliveryService): string {
  return service.connect === 'login' ? `${withParticle(service.name, 'に')}ログインしてつなぐ` : '連携を申し込む'
}

/**
 * 3社の並びと文章。承認案 `dF4Ov` のとおり Uber Eats ／ 出前館 ／ ロケットナウ の順。
 * 状態と日付は、各社の返事が来てつなぎ込んだときにサーバから受け取る。
 */
export const SERVICES: DeliveryService[] = [
  {
    id: 'uber',
    name: 'Uber Eats',
    sub: 'Uber Eats に入った注文を、この画面へ取り込みます',
    connect: 'login',
    guide:
      'ボタンを押すと Uber Eats のログイン画面が開きます。ふだんお使いの Uber Eats のIDでログインし、「許可」を押してください。そのあと、つなぐお店を選ぶ画面に戻ります。',
    // Uber Eats だけ受け口がつながっている。この環境に接続の設定が無い場合は
    // サーバの返事（oauthConfigured）で false に戻し、押させない。
    ready: true,
    status: 'disconnected',
  },
  {
    id: 'demaecan',
    name: '出前館',
    sub: '出前館に入った注文を、この画面へ取り込みます',
    connect: 'apply',
    guide:
      '出前館はログインでつなぐ仕組みがありません。ボタンを押すと musubo が出前館へ連携の申し込みを行い、受け取った接続情報を musubo 側で設定します。お店で鍵を調べたり入力したりする必要はありません。',
    ready: false,
    status: 'disconnected',
  },
  {
    id: 'rocketnow',
    name: 'ロケットナウ',
    sub: 'ロケットナウに入った注文を、この画面へ取り込みます',
    connect: 'apply',
    guide:
      'ロケットナウはつなぎ方の公開資料がないため、musubo が問い合わせ中です。決まり次第この画面からお申し込みいただけるようにします。こちらも入力は不要の形にします。',
    ready: false,
    status: 'disconnected',
  },
]

/** 返事を待っている間、押せないボタンに添える説明。 */
const WAITING = 'いま musubo が各デリバリーサービスへ連携のお手続きを進めています。できるようになり次第、この画面からつなげます。'

/** 状態の下へ出す帯の中身。 */
type StateNote = { text: string; tone: 'warn' | 'danger' }

/**
 * サーバが持つ Uber の状態を、承認済みの4つの札（未接続・接続中・接続エラー・申し込み受付中）へ移す。
 * `pending_store` はまだ注文が入らないので「未接続」。札は増やさず、下の帯で続きを伝える。
 */
const UBER_DESIGN_STATUS: Record<UberConnectionStatus, DeliveryStatus> = {
  disconnected: 'disconnected',
  pending_store: 'disconnected',
  connected: 'connected',
  expired: 'error',
  no_permission: 'error',
}

/** サーバの状態そのものを説明する帯。 */
const UBER_STATE_NOTE: Partial<Record<UberConnectionStatus, StateNote>> = {
  pending_store: {
    // 承認案 `X5d8UF` の選び口がつながったので、続きはお店自身で選べる。
    text: 'Uber Eats へのログインは受け取りました。続けて、下のボタンから「つなぐお店」を選んでください。選び終わると、この段が「接続中」に変わります。',
    tone: 'warn',
  },
  expired: {
    text: 'Uber Eats とのつなぎの期限が切れました。「Uber Eats にログインしてつなぐ」からもう一度ログインしてください。',
    tone: 'danger',
  },
  no_permission: {
    text: 'Uber Eats 側の許可が外れているため、注文を取り込めません。musubo が Uber Eats へ確認します。',
    tone: 'danger',
  },
}

/**
 * Uber から戻ったときの `?ubereats=` の符号。サーバは分類済みの符号だけを載せる
 * （自由文・鍵・トークンは載らない）。ここでお店向けの言い方へ直す。
 */
const UBER_RETURN_NOTE: Record<string, StateNote> = {
  pending_store: UBER_STATE_NOTE.pending_store as StateNote,
  'error:denied': { text: 'Uber Eats の画面で「許可」が押されなかったため、つなげませんでした。もう一度お試しください。', tone: 'danger' },
  'error:invalid_state': { text: 'ログインの受け付けから時間が経ちすぎたため、やり直しが必要です。もう一度ボタンを押してください。', tone: 'danger' },
  'error:store_missing': { text: 'このLINEアカウントにお店が紐付いていないため、つなげませんでした。musubo へお知らせください。', tone: 'danger' },
  'error:oauth_not_configured': { text: 'musubo 側の接続の設定が足りないため、つなげませんでした。musubo が設定を確認します。', tone: 'danger' },
  'error:encryption_key_missing': { text: 'musubo 側の設定が足りないため、つなげませんでした。musubo が設定を確認します。', tone: 'danger' },
  'error:token_exchange_failed': { text: 'Uber Eats との通信に失敗したため、つなげませんでした。少し待ってからもう一度お試しください。', tone: 'danger' },
}

/** 表に無い符号（Uber 側の分類）も、言い方を決めて出す。符号そのものは画面に出さない。 */
function uberReturnNote(flash: string): StateNote | undefined {
  if (flash === '') return undefined
  const known = UBER_RETURN_NOTE[flash]
  if (known) return known
  if (flash.startsWith('error:')) {
    return { text: 'Uber Eats とのつなぎを完了できませんでした。もう一度お試しください。続くときは musubo へお知らせください。', tone: 'danger' }
  }
  return undefined
}

/** サーバから読んだ接続の状態を、画面の1段ぶんの書き換えへ直す。 */
function uberPatch(data: UberConnectionData, flash: string): Partial<DeliveryService> {
  const { connection } = data
  const note = uberReturnNote(flash) ?? UBER_STATE_NOTE[connection.status]
  return {
    // この環境に接続の設定が無ければ押させない。
    ready: data.oauthConfigured,
    status: UBER_DESIGN_STATUS[connection.status],
    storeName: connection.storeName ?? undefined,
    connectedAt: connection.connectedAt ?? undefined,
    checkedAt: connection.checkedAt ?? undefined,
    stateNote: note?.text,
    stateNoteTone: note?.tone,
  }
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowSpacer} />
      <span className={styles.rowValue}>{value}</span>
    </div>
  )
}

export default function DeliverySettingsPage({ services: initialServices = SERVICES }: { services?: DeliveryService[] } = {}) {
  usePageTitle('デリバリー連携')
  usePageCrumbs([{ label: '設定', href: '/settings' }])
  useHideSettingsNav()
  const role = useStaffRole()
  const canManage = canManageRole(role)
  const { selectedAccountId } = useAccount()
  const searchParams = useSearchParams()
  /** Uber から戻ったときに付く符号（`?ubereats=pending_store` など）。 */
  const uberReturn = searchParams.get('ubereats') ?? ''

  const [services, setServices] = useState<DeliveryService[]>(initialServices)
  /** ログインの経路を用意している間、ボタンを押しっぱなしにしないための印。 */
  const [busy, setBusy] = useState<DeliveryService['id'] | null>(null)
  /** 解除を確かめる窓（`kJLks`）で外そうとしている会社 */
  const [disconnecting, setDisconnecting] = useState<DeliveryService | null>(null)
  /** つなぐお店を選ぶ窓（`X5d8UF`）。各社のログインから戻ったときに開く。 */
  const [picking, setPicking] = useState<{ service: DeliveryService; stores: DeliveryStore[] } | null>(null)
  const [pickedStoreId, setPickedStoreId] = useState('')
  /**
   * Uber のログインは済んでいて、つなぐお店だけ未選択（サーバの `pending_store`）。
   * 承認済みの札は4つのままなので、この続きがあることは画面の状態では持たず別に覚える。
   */
  const [uberPendingStore, setUberPendingStore] = useState(false)

  const anyConnected = services.some((service) => service.status !== 'disconnected')

  /** 1社だけ書き換える。 */
  const patch = useCallback((id: DeliveryService['id'], next: Partial<DeliveryService>) => {
    setServices((prev) => prev.map((service) => (service.id === id ? { ...service, ...next } : service)))
  }, [])

  /**
   * いまの接続の状態をサーバから読み直す。画面を開くたびと、Uber から戻った直後に通る。
   * 読むのはサーバの受け口（D1だけ）で、ここから Uber へは問い合わせない。
   */
  const load = useCallback(async () => {
    if (!selectedAccountId) return
    try {
      const data = await restaurantDeliveryApi.ubereatsConnection(selectedAccountId)
      setUberPendingStore(data.connection.status === 'pending_store')
      patch('uber', uberPatch(data, uberReturn))
    } catch {
      // 読めなかっただけなので、出ている状態はそのまま残し、つなぐ操作も止めない。
      patch('uber', {
        stateNote: 'いまの接続の状態を読み取れませんでした。少し待ってから画面を開き直してください。',
        stateNoteTone: 'warn',
      })
    }
  }, [patch, selectedAccountId, uberReturn])

  useEffect(() => { void load() }, [load])

  /**
   * つなぐお店の候補を取り、選ぶ窓（`X5d8UF`）を開く。
   *
   * ここだけが Uber へ問い合わせる。画面を開くたびには呼ばず、
   * ログインから戻った直後と、お店がボタンを押したときだけ通る。
   */
  const openStorePicker = useCallback(async (service: DeliveryService) => {
    if (!selectedAccountId) return
    setBusy(service.id)
    try {
      const { stores } = await restaurantDeliveryApi.ubereatsStores(selectedAccountId)
      if (stores.length === 0) {
        patch(service.id, {
          stateNote: `${withParticle(service.name, 'で')}お店が見つかりませんでした。${withParticle(service.name, 'で')}お店の管理権限があるアカウントでログインし直してください。`,
          stateNoteTone: 'warn',
        })
        return
      }
      patch(service.id, { stores })
      setPickedStoreId('')
      setPicking({ service, stores })
    } catch {
      // 失敗の符号はサーバに残る。画面には符号を出さず、次にできることだけ伝える。
      patch(service.id, {
        stateNote: `${withParticle(service.name, 'から')}お店の一覧を取れませんでした。少し待ってからもう一度お試しください。`,
        stateNoteTone: 'danger',
      })
    } finally {
      setBusy(null)
    }
  }, [patch, selectedAccountId])

  /**
   * ログインから戻った直後（`?ubereats=pending_store`）だけ、続きの選び口を自動で開く。
   * 一度きりにして、窓を閉じたあとに開き直らないようにする（Uber への問い合わせも増やさない）。
   */
  const autoPickedRef = useRef(false)
  useEffect(() => {
    if (autoPickedRef.current) return
    if (uberReturn !== 'pending_store' || !uberPendingStore) return
    const uber = services.find((service) => service.id === 'uber')
    if (!uber?.ready) return
    autoPickedRef.current = true
    void openStorePicker(uber)
  }, [openStorePicker, services, uberPendingStore, uberReturn])

  /**
   * つなぐボタン。
   * login の会社は各社のログイン画面へ送り出す。ログインが済んでいて
   * つなぐお店だけ決まっていない場合は、ログインをやり直さず選ぶ窓（`X5d8UF`）を開く。
   * apply の会社は musubo が申し込みを代行するため、受付中の状態にする。
   */
  const connect = useCallback(async (service: DeliveryService) => {
    if (service.connect === 'login') {
      if (service.id === 'uber' && uberPendingStore) {
        await openStorePicker(service)
        return
      }
      if (!selectedAccountId) return
      setBusy(service.id)
      try {
        const res = await restaurantDeliveryApi.ubereatsConnectStart(selectedAccountId)
        // 認可URLはサーバが組み立てる。鍵も合言葉も画面には来ない。
        window.location.href = res.authorizeUrl
      } catch {
        setBusy(null)
        patch(service.id, {
          stateNote: `${withParticle(service.name, 'の')}ログイン画面を開けませんでした。少し待ってからもう一度お試しください。`,
          stateNoteTone: 'danger',
        })
      }
      return
    }
    patch(service.id, {
      status: 'applying',
      appliedAt: new Date().toISOString(),
      stateNote: `musubo が${withParticle(service.name, 'へ')}連携の申し込みを行いました。手続きが終わるまでお待ちください。`,
      stateNoteTone: undefined,
    })
  }, [openStorePicker, patch, selectedAccountId, uberPendingStore])

  /**
   * 選んだお店でつなぐ（`X5d8UF` の確定）。ここで Uber 側の連携が有効になる。
   * 結果が分からないまま送り直すと連携が重なるため、自動では送り直さない。
   * 押し直しは、窓をもう一度開いてもらう人の操作として扱う。
   */
  const pickStore = useCallback(async () => {
    if (!picking || !pickedStoreId || !selectedAccountId) return
    const service = picking.service
    setBusy(service.id)
    try {
      const { connection } = await restaurantDeliveryApi.ubereatsSelectStore(selectedAccountId, pickedStoreId)
      const note = UBER_STATE_NOTE[connection.status]
      patch(service.id, {
        status: UBER_DESIGN_STATUS[connection.status],
        storeName: connection.storeName ?? undefined,
        connectedAt: connection.connectedAt ?? undefined,
        checkedAt: connection.checkedAt ?? undefined,
        stores: undefined,
        stateNote: note?.text,
        stateNoteTone: note?.tone,
      })
      setUberPendingStore(connection.status === 'pending_store')
    } catch {
      patch(service.id, {
        stateNote: `${withParticle(service.name, 'で')}お店をつなげませんでした。少し待ってから、もう一度お店を選んでください。`,
        stateNoteTone: 'danger',
      })
    } finally {
      setBusy(null)
      setPicking(null)
      setPickedStoreId('')
    }
  }, [patch, picking, pickedStoreId, selectedAccountId])

  /** 連携を解除する（`kJLks` の確定）。 */
  const disconnect = useCallback(() => {
    if (!disconnecting) return
    patch(disconnecting.id, {
      status: 'disconnected',
      storeName: undefined,
      connectedAt: undefined,
      checkedAt: undefined,
      appliedAt: undefined,
      stateNote: undefined,
      stateNoteTone: undefined,
    })
    setDisconnecting(null)
  }, [disconnecting, patch])

  return (
    <>
      <PageFrame kind="settings" boardId="dF4Ov" hasFooter={canManage}>
        {/* 板の頭は型の PageHeading だけ。頭の下に説明の行を置かず、説明は題の横の「？」へ入れる
            （docs/v8-design-rules.md:66・§6.12-2／B-158・B-172 page-head）。承認案 v03 の説明文は
            つながっている会社があるかどうかで書き分け、そのまま「？」の中身にする。 */}
        <PageHeading
          headingSize="compact"
          title="デリバリー連携"
          help={`Uber Eats・出前館・ロケットナウに入った注文を、musubo の「デリバリー受注」画面にまとめて取り込みます。${
            anyConnected
              ? 'つながっているサービスの状態をここに出します。お店での入力はありません。うまくいっていない時は musubo が原因を確認し、必要な手続きを行います。'
              : 'お店での入力はありません。Uber Eats は「ログインしてつなぐ」を押して Uber Eats の画面で許可するだけ、出前館とロケットナウは「連携を申し込む」を押すだけです。鍵・接続先アドレス・通知の設定は、すべて musubo 側で行います。'
          }`}
        />
        <div className={styles.body}>
          {services.map((service) => {
            const state = STATUS[service.status]
            const usable = service.ready && canManage
            return (
              /* 角丸・線・影は共通の Card に任せる（B-168）。中の間と余白だけ承認案 v03 の寸法で足す。 */
              <Card key={service.id} appearance="outlined" layout="vertical" className={styles.card} aria-labelledby={`delivery-${service.id}-title`}>
                <div className={styles.cardHead}>
                  <h2 id={`delivery-${service.id}-title`} className={styles.cardTitle}>{service.name}</h2>
                  <p className={styles.cardSub}>{service.sub}</p>
                </div>

                <div className={`${styles.row} ${styles.rowCenter}`}>
                  <span className={styles.rowLabel}>いまの状態</span>
                  <span className={styles.rowSpacer} />
                  <StatusBadge tone={state.tone} size="compact">{state.label}</StatusBadge>
                </div>

                {/* 状態の注記は自作の色分け（`.note[data-tone]`）をやめ、共通の帯（Notice）に任せる
                    （B-172 status-badge）。つなぐ手順の案内は色の意味を持たないので真珠色の囲みのまま。 */}
                {/* 帯を先に見るのは、ログイン済み・お店は未選択（`pending_store`）が
                    札の上では「未接続」のままで、続きを伝えるのがこの帯だけだから。 */}
                {service.stateNote ? (
                  <Notice tone={service.stateNoteTone ?? (service.status === 'error' ? 'danger' : 'warn')} appearance="soft">{service.stateNote}</Notice>
                ) : service.status === 'disconnected' ? (
                  <p className={styles.note}>{service.guide}</p>
                ) : null}

                {service.status === 'applying' ? (
                  <Row label="申し込んだ日" value={formatDate(service.appliedAt, { style: 'detail', fallback: '—' })} />
                ) : service.status === 'disconnected' ? null : (
                  <>
                    {service.storeName ? <Row label="つないだお店" value={service.storeName} /> : null}
                    <Row label="つないだ日" value={formatDate(service.connectedAt, { style: 'detail', fallback: '—' })} />
                    <Row label="最後に確かめた時刻" value={formatDate(service.checkedAt, { style: 'detail', fallback: '—' })} />
                  </>
                )}

                {canManage ? (
                  <div className={styles.actions}>
                    {service.status === 'disconnected' ? (
                      <Button
                        variant="primary"
                        disabled={!usable}
                        title={usable ? undefined : WAITING}
                        busy={busy === service.id}
                        busyLabel="開いています…"
                        onClick={() => void connect(service)}
                      >
                        {service.connect === 'login' ? <LogIn size={15} aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}
                        {connectLabel(service)}
                      </Button>
                    ) : service.status === 'applying' ? (
                      <>
                        <span className={styles.rowSpacer} />
                        <Button
                          variant="secondary"
                          disabled={!usable}
                          title={usable ? undefined : WAITING}
                          onClick={() => patch(service.id, { status: 'disconnected', appliedAt: undefined, stateNote: undefined })}
                        >
                          <X size={15} aria-hidden="true" />
                          申し込みを取り消す
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          variant="secondary"
                          disabled={!usable}
                          title={usable ? undefined : WAITING}
                          onClick={() => patch(service.id, { checkedAt: new Date().toISOString() })}
                        >
                          <Plug size={15} aria-hidden="true" />
                          接続を確かめる
                        </Button>
                        <span className={styles.rowSpacer} />
                        <Button variant="danger" disabled={!usable} title={usable ? undefined : WAITING} onClick={() => setDisconnecting(service)}>
                          連携を解除する
                        </Button>
                      </>
                    )}
                  </div>
                ) : null}
              </Card>
            )
          })}
        </div>

        {canManage ? (
          <PageFooter
            actions={(
              <>
                <Button disabled>キャンセル</Button>
                <Button variant="primary" disabled title="この画面はボタンを押すとすぐ反映されます。保存する内容はまだありません。">
                  <Check size={15} aria-hidden="true" />
                  保存する
                </Button>
              </>
            )}
          />
        ) : null}
      </PageFrame>

      {/* 解除を確かめる窓（`kJLks`）。幅480は共通の small。 */}
      <Dialog
        open={disconnecting !== null}
        size="small"
        confirmation
        footerDivider
        tone="destructive"
        title={`${withParticle(disconnecting?.name ?? '', 'の')}連携を解除しますか`}
        description={`${withParticle(disconnecting?.name ?? '', 'との')}つなぎを外します。これから入る注文は「デリバリー受注」に届かなくなります。すでに届いている注文はそのまま残ります。`}
        confirmLabel="解除する"
        onConfirm={disconnect}
        onCancel={() => setDisconnecting(null)}
      >
        <p className={styles.note}>
          もう一度つなぐときは、この画面の「{disconnecting ? connectLabel(disconnecting) : ''}」からやり直してください。鍵を調べたり入力したりする必要はありません。
        </p>
      </Dialog>

      {/* つなぐお店を選ぶ窓（`X5d8UF`）。各社のログインから戻り、許可されたお店を受け取れたときに開く。 */}
      <Dialog
        open={picking !== null}
        size="small"
        confirmation
        footerDivider
        title="つなぐお店を選んでください"
        description={`${withParticle(picking?.service.name ?? '', 'での')}許可をいただきました。${withParticle(picking?.service.name ?? '', 'に')}登録されているお店が${picking?.stores.length ?? 0}件見つかりました。musubo につなぐお店を選んでください。`}
        confirmLabel="このお店につなぐ"
        confirmIcon={<Check size={15} aria-hidden="true" />}
        confirmDisabled={pickedStoreId === '' || busy !== null}
        onConfirm={pickStore}
        onCancel={() => { setPicking(null); setPickedStoreId('') }}
      >
        {/* 1つだけ選ぶ群は共通の RadioCardGroup／RadioCard に任せる（§6.12-14・B-172 toggle）。
            群の役割も選んだときの色も共通の部品が持ち、この画面では自作しない。
            窓の中の小さい箱なので variant="form"。 */}
        <RadioCardGroup legend="つなぐお店" className={styles.stores}>
          {picking?.stores.map((store) => (
            <RadioCard
              key={store.id}
              variant="form"
              name="delivery-store"
              value={store.id}
              checked={pickedStoreId === store.id}
              onChange={setPickedStoreId}
              title={store.name}
              note={store.address}
            />
          ))}
        </RadioCardGroup>
        <p className={styles.note}>
          選んだお店の注文が「デリバリー受注」に届きます。あとから変えるときは、この画面で一度解除してからもう一度ログインしてください。
        </p>
      </Dialog>
    </>
  )
}
