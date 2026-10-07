'use client'

/*
 * ★V8 EC連携 つなぎ先（板 iLJmw）。
 *
 * 並び（絵）：上の段に「つなぎ先の情報」（種類・アドレス・鍵）と右の「取り込みのようす」（今日・この30日・失敗・最後に成功）。
 * その下に板の幅で「取り込みの状態」（止める・再開・止めたとき）→「どこの出来事を取り込むか」（1行に並べる）→
 * 「どうやって人を見分けるか」（番号つき）→ いちばん下の行に「つながる先」と「設定を保存する」。
 * 口・保存の決まり（全部外すときの確認・止めるのは保存してから効く・離れるときの確認・競合の読み直し）は
 * 今の部品（app/ec-commerce/connector-panel.tsx）と同じ。
 */
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { EC_EVENT_LABELS, type EcEventType } from '@line-crm/shared'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import Select from '@/components/shared/select'
import { TextField } from '@/components/shared/text-field'
import { ApiError, api, type EcConnector, type EcConnectorOverview } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import styles from './connector.module.css'

/* 絵の並び（注文完了・発送完了・入金確認完了・返金完了・注文キャンセル・ペット情報更新）。 */
const CONNECTOR_EVENT_TYPES = [
  'ec.order.confirmed',
  'ec.order.shipped',
  'ec.order.payment_received',
  'ec.order.refunded',
  'ec.order.cancelled',
  'ec.customer.profile_updated',
] as const satisfies readonly EcEventType[]

const IDENTITY_RULES = [
  ['verified_email', 'メールアドレスが同じ', 'いちばん確かな照らし合わせです'],
  ['verified_phone', '電話番号が同じ', 'ハイフンや国番号の違いを整えて比べます'],
  ['manual_name_postal', '名前と郵便番号が同じ → 会員のつき合わせで人が決める', '候補へ並べ、人が確認してから結びつけます'],
] as const

type Form = {
  provider: EcConnector['provider']
  shopDomain: string
  status: EcConnector['status']
  inboundSecret: string
  eventTypes: string[]
  identityRules: EcConnector['identityRules']
  expectedVersion: number
}

const EMPTY_FORM: Form = {
  provider: 'shopify', shopDomain: '', status: 'connected', inboundSecret: '',
  eventTypes: [...CONNECTOR_EVENT_TYPES],
  identityRules: ['verified_email', 'verified_phone', 'manual_name_postal'], expectedVersion: 0,
}

function toForm(connector: EcConnector | null): Form {
  if (!connector) return EMPTY_FORM
  return {
    provider: connector.provider,
    shopDomain: connector.shopDomain,
    status: connector.status,
    inboundSecret: '',
    eventTypes: connector.eventTypes,
    identityRules: connector.identityRules,
    expectedVersion: connector.version,
  }
}

function when(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? '—' : formatDateTime(date)
}

const READONLY_REASON = '見るだけの権限では設定を変えられません。変えるにはオーナーか管理者に頼んでください。'

export default function EcConnector({ accountId, canEdit = true }: { accountId: string | null; canEdit?: boolean }) {
  const [data, setData] = useState<EcConnectorOverview | null>(null)
  const [form, setForm] = useState<Form>(EMPTY_FORM)
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error' | 'forbidden'>('loading')
  const [saving, setSaving] = useState(false)
  const [replacingSecret, setReplacingSecret] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  /* 全部外すこと自体は止めない。保存の直前に確認を1枚だけ挟む。 */
  const [emptyConfirm, setEmptyConfirm] = useState<{ events: boolean; rules: boolean } | null>(null)

  const load = useCallback(async () => {
    if (!accountId) { setData(null); setForm(EMPTY_FORM); setState('empty'); return }
    setState('loading')
    try {
      const response = await api.ecCommerce.connector(accountId)
      if (!response.success || !response.data?.health) throw new Error('invalid_connector_response')
      setData(response.data)
      setForm(toForm(response.data.connector))
      setReplacingSecret(false)
      setState(response.data.configured ? 'ready' : 'empty')
    } catch (error) {
      setState(error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error')
    }
  }, [accountId])

  useEffect(() => { void load() }, [load])

  const toggle = (field: 'eventTypes' | 'identityRules', value: string) => {
    setForm((current) => {
      const values = current[field] as string[]
      const next = values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
      return { ...current, [field]: next }
    })
  }

  const save = async () => {
    if (!accountId) return
    setSaving(true)
    setNotice(null)
    try {
      const response = await api.ecCommerce.updateConnector(accountId, form)
      if (!response.success) throw new Error('save_failed')
      setForm((current) => ({ ...current, inboundSecret: '', expectedVersion: response.data.version }))
      setNotice({ tone: 'success', text: 'つなぎ先の設定を保存しました。' })
      await load()
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) await load()
      setNotice({ tone: 'error', text: error instanceof ApiError && error.status === 409 ? 'ほかの担当者が先に変更しました。最新の内容を読み直しました。' : '設定を保存できませんでした。入力内容を確認してください。' })
    } finally {
      setSaving(false)
    }
  }

  const requestSave = () => {
    if (!accountId || saving) return
    const events = form.eventTypes.length === 0
    const rules = form.identityRules.length === 0
    if (events || rules) { setEmptyConfirm({ events, rules }); return }
    void save()
  }

  const connector = data?.connector
  /* 「取り込みを止める」は保存するまで効かない。未保存の差分がある間は知らせ、離れる操作も止める。 */
  const pendingStatusChange = Boolean(connector) && form.status !== connector?.status
  const dirty = state === 'ready' && (() => {
    const { expectedVersion: _ev, inboundSecret: _sec, ...current } = form
    const { expectedVersion: _ev2, inboundSecret: _sec2, ...baseline } = toForm(connector ?? null)
    return form.inboundSecret.length > 0 || JSON.stringify(current) !== JSON.stringify(baseline)
  })()
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: saving })
  /* 保存できない理由は、押せない条件と同じ順で最初の1つだけ。 */
  const saveBlockReason = saving ? null
    : !form.shopDomain ? 'ショップのアドレスを入れると保存できます。'
      : !connector?.secretConfigured && form.inboundSecret.length < 32 ? 'はじめてつなぐときは、32文字以上の鍵を入れてください。'
        : null

  if (state !== 'ready') {
    return (
      <ListState
        kind={state}
        title={state === 'empty' ? accountId ? 'つなぎ先はまだありません' : 'LINEアカウントを選択してください' : undefined}
        description={state === 'empty' ? accountId ? 'ネットショップの種類・アドレス・鍵を登録すると、注文を取り込めます。' : 'LINEアカウントを選ぶ欄で、設定するアカウントを選びます。' : undefined}
        action={state === 'empty' && accountId && canEdit ? <Button type="button" variant="primary" onClick={() => setState('ready')}>つなぎ先を設定</Button> : undefined}
        onRetry={state === 'error' ? () => void load() : undefined}
      />
    )
  }

  const paused = form.status === 'paused'
  const showSecretInput = canEdit && (!connector?.secretConfigured || replacingSecret)
  const impact = data?.impact
  const impactWords = (value: number | null | undefined) => (typeof value === 'number' ? `${value}件` : '未取得')

  return (
    <div className={styles.board} data-design-node="iLJmw">
      {!canEdit ? <NoteBar tone="info">{READONLY_REASON}いまの設定はこのまま見られます。</NoteBar> : null}
      {notice ? <p className={notice.tone === 'success' ? styles.noticeGood : styles.noticeBad} role={notice.tone === 'success' ? 'status' : 'alert'}>{notice.text}</p> : null}

      <div className={styles.top}>
        <section className={styles.card} aria-labelledby="ec-connector-info">
          <h2 id="ec-connector-info" className={styles.cardTitle}>つなぎ先の情報</h2>
          <div className={styles.field}>
            <span className={styles.label} id="ec-connector-provider">ネットショップの種類</span>
            {canEdit ? (
              <Select aria-label="ネットショップの種類" value={form.provider} onChange={(value) => setForm({ ...form, provider: value as Form['provider'] })} options={[{ value: 'shopify', label: 'Shopify' }, { value: 'ec_cube', label: 'EC-CUBE' }]} size="full" />
            ) : <TextField aria-label="ネットショップの種類" value={form.provider === 'ec_cube' ? 'EC-CUBE' : 'Shopify'} readOnly aria-readonly="true" />}
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="ec-connector-domain">ショップのアドレス</label>
            <TextField id="ec-connector-domain" value={form.shopDomain} onChange={(event) => setForm({ ...form, shopDomain: event.target.value })} placeholder="nen-store.myshopify.com" readOnly={!canEdit} />
          </div>
          <div className={`${styles.field} ${styles.keyField}`}>
            <label className={styles.label} htmlFor="ec-connector-secret">つなぐための鍵</label>
            {showSecretInput ? (
              <TextField id="ec-connector-secret" type="password" autoComplete="new-password" value={form.inboundSecret} onChange={(event) => setForm({ ...form, inboundSecret: event.target.value })} placeholder="32文字以上" />
            ) : (
              <div className={styles.keyRow}>
                <span className={styles.keyMask} id="ec-connector-secret" title={connector?.secretUpdatedAt ? `${when(connector.secretUpdatedAt)} に更新` : undefined}>{connector?.secretConfigured ? `●●●●●●●●●●●●  ${connector.secretLastFour ?? '----'}` : '未設定'}</span>
                {canEdit ? <Button type="button" onClick={() => setReplacingSecret(true)}>差し替える</Button> : null}
              </div>
            )}
            <p className={styles.note}>鍵は保存後に読み戻せません。画面には最後の4文字だけを出します。</p>
          </div>
        </section>

        <section className={styles.card} aria-labelledby="ec-connector-health">
          <h2 id="ec-connector-health" className={styles.cardTitle}>取り込みのようす</h2>
          <div className={styles.minis}>
            {([['今日', data?.health.today, '今日届いた出来事の件数です'], ['この30日', data?.health.last30Days, 'この30日に届いた出来事の件数です'], ['失敗', data?.health.failed, '確認が必要な失敗の件数です']] as const).map(([label, value, help]) => (
              <div key={label} className={styles.mini} title={help}>
                <span className={styles.miniLabel}>{label}</span>
                <span className={`${styles.miniValue} ${label === '失敗' && typeof value === 'number' && value > 0 ? styles.miniWarn : ''}`}>{typeof value === 'number' ? `${value.toLocaleString()} 件` : '—'}</span>
              </div>
            ))}
          </div>
          <p className={styles.note}>{`最後に成功 ${when(data?.health.lastSucceededAt ?? null)}`}</p>
        </section>
      </div>

      <section className={`${styles.card} ${styles.cardWide}`} aria-labelledby="ec-connector-status">
        <h2 id="ec-connector-status" className={styles.cardTitle}>取り込みの状態</h2>
        <p className={styles.desc}>止めると、ネットショップからの出来事を受け取らなくなります。「設定を保存する」で効きます。</p>
        <div className={styles.statusRow}>
          <span className={styles.status} data-tone={connector?.status === 'paused' ? 'muted' : 'good'}><span className={styles.dot} aria-hidden="true" />{connector?.status === 'paused' ? '止めている' : '取り込み中'}</span>
          <span className={styles.statusText}>{`最後に受け取った ${when(data?.health.lastReceivedAt ?? null)}`}</span>
          {connector && canEdit ? (
            <Button type="button" onClick={() => setForm({ ...form, status: paused ? 'connected' : 'paused' })}>{paused ? '取り込みを再開する' : '取り込みを止める'}</Button>
          ) : null}
        </div>
        <div className={`${styles.band} ${pendingStatusChange ? styles.bandWarn : ''}`} role={pendingStatusChange ? 'status' : undefined}>
          <strong className={styles.bandTitle}>{paused ? '再開したとき：' : '止めたとき：'}</strong>
          <span className={styles.bandText}>
            {pendingStatusChange
              ? (paused ? '「取り込みを止める」を押しましたが、まだ止まっていません。「設定を保存する」を押すと止まります。' : '「取り込みを再開する」を押しましたが、まだ再開していません。「設定を保存する」を押すと再開します。')
              : (paused ? '取り込みを再開します。保存すると再開します。保存済みの設定は残っています。' : '取り込みを止めます。保存すると止まります。保存せずに離れると確認が出ます。')}
          </span>
        </div>
      </section>

      <section className={`${styles.card} ${styles.cardWide}`} aria-labelledby="ec-connector-events">
        <h2 id="ec-connector-events" className={styles.cardTitle}>どこの出来事を取り込むか</h2>
        <div className={styles.checks}>
          {/* 閲覧のみは押せるチェックを置かず、いまの選び方を文字で見せる。 */}
          {CONNECTOR_EVENT_TYPES.map((value) => canEdit
            ? <Checkbox key={value} checked={form.eventTypes.includes(value)} onCheckedChange={() => toggle('eventTypes', value)}>{EC_EVENT_LABELS[value]}</Checkbox>
            : <span key={value} className={styles.readValue}>{`${EC_EVENT_LABELS[value]}：${form.eventTypes.includes(value) ? '取り込む' : '取り込まない'}`}</span>)}
        </div>
        <p className={styles.note}>チェックを外すと、その出来事を起点にした配信や集計も止まります。</p>
      </section>

      <section className={`${styles.card} ${styles.cardWide}`} aria-labelledby="ec-connector-identity">
        <h2 id="ec-connector-identity" className={styles.cardTitle}>どうやって人を見分けるか</h2>
        <p className={styles.note}>上から照らし合わせます。名前だけで自動では結びつけません。</p>
        <div className={styles.rules}>
          {IDENTITY_RULES.map(([value, label, help], index) => (
            <span key={value} className={styles.rule} title={help}>
              {canEdit
                ? <Checkbox checked={form.identityRules.includes(value)} onCheckedChange={() => toggle('identityRules', value)}>{`${index + 1}. ${label}`}</Checkbox>
                : <span className={styles.readValue}>{`${index + 1}. ${label}：${form.identityRules.includes(value) ? '使う' : '使わない'}`}</span>}
            </span>
          ))}
        </div>
      </section>

      <div className={styles.foot}>
        {/* つながる先：止めると止まるもの（ECの出来事がきっかけ）の数は title で見せる。 */}
        <p className={styles.links}>
          つながる先：
          <Link href="/nen-campaigns" title={`ECの出来事がきっかけ ${impactWords(impact?.nenCampaigns)}`}>→ NEN配信</Link>
          <Link href="/mileage" title={`ECの出来事がきっかけ ${impactWords(impact?.mileageRules)}`}>→ マイル</Link>
          <Link href="/conversions" title={`アカウント全体 ${impactWords(impact?.conversions)}`}>→ コンバージョン</Link>
          <Link href="/ec-commerce/identity-candidates" title="会員のつき合わせ">→ 会員</Link>
        </p>
        {canEdit ? (
          <div className={styles.saveBox}>
            {saveBlockReason ? <p className={styles.note} role="note">{saveBlockReason}</p> : null}
            <Button type="button" variant="primary" disabled={saving || !form.shopDomain || (!connector?.secretConfigured && form.inboundSecret.length < 32)} onClick={requestSave} busy={saving} busyLabel="保存しています…">設定を保存する</Button>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={emptyConfirm !== null}
        title={emptyConfirm?.events && emptyConfirm?.rules ? '取り込みと照合をすべて止めますか？' : emptyConfirm?.events ? 'すべての出来事の取り込みを止めますか？' : '自動の照合をすべて止めますか？'}
        description={[
          emptyConfirm?.events ? '取り込む出来事が1つも選ばれていません。保存すると、すべての出来事の取り込みが止まります。' : null,
          emptyConfirm?.rules ? '人を照らし合わせる決めごとが1つも選ばれていません。保存すると、自動の照合がすべて止まります。' : null,
        ].filter(Boolean).join('')}
        confirmLabel="止めて保存する"
        destructive
        busy={saving}
        onConfirm={() => { setEmptyConfirm(null); void save() }}
        onCancel={() => { if (!saving) setEmptyConfirm(null) }}
      />
      <UnsavedLeaveDialog
        open={leaveTarget !== null}
        description={pendingStatusChange
          ? (paused ? '「取り込みを止める」はまだ保存されていません。このまま移ると、取り込みは止まりません。移りますか？' : '「取り込みを再開する」はまだ保存されていません。このまま移ると、取り込みは再開しません。移りますか？')
          : 'このまま移ると、入力した内容は保存されません。移りますか？'}
        cancelLabel="設定に戻る"
        onConfirm={confirmLeave}
        onCancel={cancelLeave}
      />
    </div>
  )
}
