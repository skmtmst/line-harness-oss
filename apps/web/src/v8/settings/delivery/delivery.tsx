'use client'

import { useCallback, useState } from 'react'
import { Check, LogIn, Plug, Send, X } from 'lucide-react'
import { PageFrame, PageHeading, PageFooter } from '@/components/templates/page-frame'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import Dialog from '@/components/shared/dialog'
import Notice from '@/components/shared/notice'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import { usePageTitle, usePageCrumbs, useHideSettingsNav } from '@/components/shell/page-chrome'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
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
 * いまは3社への問い合わせの返事を待っている段のため、承認された範囲
 * （「ボタンは押せない状態で用意し、回答が来た会社から中身をつなぐ」）どおり、
 * 各社の `ready` を false にして置く。返事が来た会社はここを true にすれば、
 * 下の「つなぐ → お店を選ぶ → 解除する」の流れがそのまま動く。
 *
 * 状態（接続中・接続エラー・申し込み受付中）と日付・お店の一覧は、各社の受け口が決まったあと
 * サーバから受け取る。それまでの間も画面の経路を確かめられるよう、入口の値は
 * `services` の引数で差し替えられるようにしてある（既定は下の `SERVICES`）。
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
  /** 接続エラー・申し込み受付中のときに状態の下へ出す囲み */
  stateNote?: string
  /** 各社のログインで許可されたお店の一覧（`X5d8UF` の選び口に出す） */
  stores?: DeliveryStore[]
}

/** つなぐボタンの名札。解除の窓の案内文でも同じ言い方を使う。 */
function connectLabel(service: DeliveryService): string {
  return service.connect === 'login' ? `${service.name} にログインしてつなぐ` : '連携を申し込む'
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
    ready: false,
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

  const [services, setServices] = useState<DeliveryService[]>(initialServices)
  /** 解除を確かめる窓（`kJLks`）で外そうとしている会社 */
  const [disconnecting, setDisconnecting] = useState<DeliveryService | null>(null)
  /** つなぐお店を選ぶ窓（`X5d8UF`）。各社のログインから戻ったときに開く。 */
  const [picking, setPicking] = useState<{ service: DeliveryService; stores: DeliveryStore[] } | null>(null)
  const [pickedStoreId, setPickedStoreId] = useState('')

  const anyConnected = services.some((service) => service.status !== 'disconnected')

  /** 1社だけ書き換える。 */
  const patch = useCallback((id: DeliveryService['id'], next: Partial<DeliveryService>) => {
    setServices((prev) => prev.map((service) => (service.id === id ? { ...service, ...next } : service)))
  }, [])

  /**
   * つなぐボタン。
   * login の会社は各社のログインから戻ったあと、許可されたお店を選ぶ窓（`X5d8UF`）を開く。
   * apply の会社は musubo が申し込みを代行するため、受付中の状態にする。
   */
  const connect = useCallback((service: DeliveryService) => {
    if (service.connect === 'login') {
      setPickedStoreId('')
      setPicking({ service, stores: service.stores ?? [] })
      return
    }
    patch(service.id, {
      status: 'applying',
      appliedAt: new Date().toISOString(),
      stateNote: `musubo が${service.name}へ連携の申し込みを行いました。手続きが終わるまでお待ちください。`,
    })
  }, [patch])

  /** 選んだお店でつなぐ（`X5d8UF` の確定）。 */
  const pickStore = useCallback(() => {
    if (!picking) return
    const store = picking.stores.find((candidate) => candidate.id === pickedStoreId)
    const now = new Date().toISOString()
    patch(picking.service.id, {
      status: 'connected',
      storeName: store?.name,
      connectedAt: now,
      checkedAt: now,
      stateNote: undefined,
    })
    setPicking(null)
    setPickedStoreId('')
  }, [patch, picking, pickedStoreId])

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
                {service.status === 'disconnected' ? (
                  <p className={styles.note}>{service.guide}</p>
                ) : service.stateNote ? (
                  <Notice tone={service.status === 'error' ? 'danger' : 'warn'} appearance="soft">{service.stateNote}</Notice>
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
                      <Button variant="primary" disabled={!usable} title={usable ? undefined : WAITING} onClick={() => connect(service)}>
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
        title={`${disconnecting?.name ?? ''}の連携を解除しますか`}
        description={`${disconnecting?.name ?? ''}とのつなぎを外します。これから入る注文は「デリバリー受注」に届かなくなります。すでに届いている注文はそのまま残ります。`}
        confirmLabel="解除する"
        onConfirm={disconnect}
        onCancel={() => setDisconnecting(null)}
      >
        <p className={styles.note}>
          もう一度つなぐときは、この画面の「{disconnecting ? connectLabel(disconnecting) : ''}」からやり直してください。鍵を調べたり入力したりする必要はありません。
        </p>
      </Dialog>

      {/* つなぐお店を選ぶ窓（`X5d8UF`）。各社のログインから戻り、許可されたお店が2件以上あるときに開く。 */}
      <Dialog
        open={picking !== null}
        size="small"
        confirmation
        footerDivider
        title="つなぐお店を選んでください"
        description={`${picking?.service.name ?? ''}での許可をいただきました。${picking?.service.name ?? ''}に登録されているお店が${picking?.stores.length ?? 0}件見つかりました。musubo につなぐお店を選んでください。`}
        confirmLabel="このお店につなぐ"
        confirmIcon={<Check size={15} aria-hidden="true" />}
        confirmDisabled={pickedStoreId === ''}
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
