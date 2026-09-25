'use client'

import { useCallback, useEffect, useState } from 'react'
import { EC_EVENT_LABELS, type EcEventType } from '@line-crm/shared'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import SummaryCard from '@/components/shared/summary-card'
import { ApiError, api, type EcConnector, type EcConnectorOverview } from '@/lib/api'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { formatEcDateTimeWithYear as dateTime } from './ec-datetime'
import styles from './ec-commerce-v6.module.css'

const CONNECTOR_EVENT_TYPES = [
  'ec.order.confirmed',
  'ec.order.payment_received',
  'ec.order.shipped',
  'ec.order.cancelled',
  'ec.order.refunded',
  'ec.customer.profile_updated',
] as const satisfies readonly EcEventType[]
const IDENTITY_RULES = [
  ['verified_email', 'メールアドレスが同じ', 'いちばん確かな照らし合わせです'],
  ['verified_phone', '電話番号が同じ', 'ハイフンや国番号の違いを整えて比べます'],
  ['manual_name_postal', '名前と郵便番号が同じ', '候補へ並べ、人が確認してから結びつけます'],
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

export default function ConnectorPanel({ accountId }: { accountId: string | null }) {
  const [data, setData] = useState<EcConnectorOverview | null>(null)
  const [form, setForm] = useState<Form>(EMPTY_FORM)
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error' | 'forbidden'>('loading')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  // #517 軽7: 全部外し自体は止めない(止めたい場面がある)。保存の直前で
  // 確認を1枚だけ挟み、押した人が自覚できる形にする。
  const [emptyConfirm, setEmptyConfirm] = useState<{ events: boolean; rules: boolean } | null>(null)

  const load = useCallback(async () => {
    if (!accountId) {
      setData(null)
      setForm(EMPTY_FORM)
      setState('empty')
      return
    }
    setState('loading')
    try {
      const response = await api.ecCommerce.connector(accountId)
      if (!response.success || !response.data?.health) throw new Error('invalid_connector_response')
      setData(response.data)
      setForm(toForm(response.data.connector))
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

  const requestSave = () => {
    if (!accountId || saving) return
    const events = form.eventTypes.length === 0
    const rules = form.identityRules.length === 0
    if (events || rules) {
      setEmptyConfirm({ events, rules })
      return
    }
    void save()
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

  const connector = data?.connector
  /*
   * #948 N-322: 「取り込みを止める」は押した時点ではフォームの状態を変える
   * だけで、保存するまで止まらない。押したあと離れると「止めたつもり」に
   * なるため、未保存の差分がある間は警告を出し、画面を離れる操作も止める。
   */
  const pendingStatusChange = Boolean(connector) && form.status !== connector?.status
  const dirty = state === 'ready' && (() => {
    const { expectedVersion: _ev, inboundSecret: _sec, ...current } = form
    const { expectedVersion: _ev2, inboundSecret: _sec2, ...baseline } = toForm(connector ?? null)
    return form.inboundSecret.length > 0
      || JSON.stringify(current) !== JSON.stringify(baseline)
  })()
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: saving })
  /*
   * #948 N-326: 保存ボタンが disabled のとき、なぜ押せないかをボタンの隣に
   * 書く。disabled の条件と同じ順で最初に当たった理由だけを出す。
   */
  const saveBlockReason = saving ? null
    : !form.shopDomain ? 'ショップのアドレスを入れると保存できます。'
    : !connector?.secretConfigured && form.inboundSecret.length < 32
      ? 'はじめてつなぐときは、32文字以上の鍵を入れてください。'
      : null

  if (state !== 'ready') {
    return (
      <ListState
        kind={state}
        title={state === 'empty' ? accountId ? 'つなぎ先はまだありません' : 'LINEアカウントを選択してください' : undefined}
        description={state === 'empty' ? accountId ? 'ネットショップの種類・アドレス・鍵を登録すると、注文を取り込めます。' : '左のメニュー上部で、設定するLINEアカウントを選びます。' : undefined}
        action={state === 'empty' && accountId ? <Button type="button" variant="primary" onClick={() => setState('ready')}>つなぎ先を設定</Button> : undefined}
        onRetry={state === 'error' ? () => void load() : undefined}
      />
    )
  }

  return (
    <>
      <NoteBar tone={connector?.status === 'paused' ? 'warn' : 'info'}>
        {connector?.status === 'paused' ? '取り込みを止めています。保存済みの設定は残っています。' : connector ? `つながっています。最後にデータが届いたのは ${dateTime(data?.health.lastReceivedAt ?? null)} です。` : 'まだつながっていません。下の情報を入れて保存してください。'}
      </NoteBar>
      {pendingStatusChange ? (
        <NoteBar tone="warn">
          {form.status === 'paused'
            ? '「取り込みを止める」を押しましたが、まだ止まっていません。「設定を保存」を押すと止まります。'
            : '「取り込みを再開する」を押しましたが、まだ再開していません。「設定を保存」を押すと再開します。'}
        </NoteBar>
      ) : null}
      {notice ? <div className={notice.tone === 'success' ? styles.noticeSuccess : styles.noticeError} role="status">{notice.text}</div> : null}
      <div className={styles.connectorGrid}>
        <div className={styles.stack}>
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>つなぎ先の情報</h2>
            <p className={styles.cardNote}>鍵は保存後に読み戻せません。画面には最後の4文字だけを出します。</p>
            <div className={styles.fields}>
              <label className={styles.field}>ネットショップの種類<select className={styles.select} value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value as Form['provider'] })}><option value="shopify">Shopify</option><option value="ec_cube">EC-CUBE</option></select></label>
              <label className={styles.field}>ショップのアドレス<input className={styles.input} value={form.shopDomain} onChange={(event) => setForm({ ...form, shopDomain: event.target.value })} placeholder="nen-store.myshopify.com" /></label>
              <label className={styles.field}>つなぐための鍵<input className={styles.input} type="password" autoComplete="new-password" value={form.inboundSecret} onChange={(event) => setForm({ ...form, inboundSecret: event.target.value })} placeholder={connector?.secretConfigured ? `設定済み（末尾 ${connector.secretLastFour ?? '----'}）` : '32文字以上'} /><span className={styles.cardNote}>{connector?.secretUpdatedAt ? `${dateTime(connector.secretUpdatedAt)} に更新。鍵そのものは表示しません` : '鍵そのものは表示しません'}</span></label>
            </div>
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>どこの出来事を取り込むか</h2>
            <p className={styles.cardNote}>チェックを外すと、その出来事を起点にした配信や集計も止まります。</p>
            <div className={styles.checks}>{CONNECTOR_EVENT_TYPES.map((value) => <label className={styles.check} key={value}><input type="checkbox" checked={form.eventTypes.includes(value)} onChange={() => toggle('eventTypes', value)} /><span>{EC_EVENT_LABELS[value]}</span></label>)}</div>
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>どうやって人を見分けるか</h2>
            <p className={styles.cardNote}>上から照らし合わせます。名前だけで自動では結びつけません。</p>
            <div className={styles.ruleList}>{IDENTITY_RULES.map(([value, label, note], index) => <label className={styles.rule} key={value}><input type="checkbox" checked={form.identityRules.includes(value)} onChange={() => toggle('identityRules', value)} /><span className={styles.ruleNumber}>{index + 1}</span><span><strong>{label}</strong><small>{note}</small></span></label>)}</div>
            <div className={styles.actions}>
              {connector ? <Button type="button" onClick={() => setForm({ ...form, status: form.status === 'paused' ? 'connected' : 'paused' })}>{form.status === 'paused' ? '取り込みを再開する' : '取り込みを止める'}</Button> : null}
              <Button type="button" variant="primary" disabled={saving || !form.shopDomain || (!connector?.secretConfigured && form.inboundSecret.length < 32)} onClick={requestSave}>{saving ? '保存しています…' : '設定を保存'}</Button>
            </div>
            {saveBlockReason ? <p className="mt-1 text-caption leading-relaxed text-ink-faint" role="note">{saveBlockReason}</p> : null}
          </section>
        </div>

        <aside className={styles.stack}>
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>取り込みのようす</h2>
            <div className={styles.compactKpis}>
              <SummaryCard variant="v6" title="今日" value={data?.health.today ?? null} unit="件" detail="" help="今日届いた出来事の件数です" />
              <SummaryCard variant="v6" title="この30日" value={data?.health.last30Days ?? null} unit="件" detail="" help="直近30日に届いた出来事の件数です" />
              <SummaryCard variant="v6" title="失敗" value={data?.health.failed ?? null} unit="件" detail="確認が必要" />
              <SummaryCard variant="v6" title="最後に成功" value={null} unit="" detail={dateTime(data?.health.lastSucceededAt ?? null)} badge="日時" badgeTone="neutral" />
            </div>
          </section>
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>つながる先</h2>
            {/*
             * #948 N-320: 「止めると影響する数」を明示する。上の3つはECの出来事を
             * 起点にする設定の数(止めると止まるもの)、下の2つはアカウント全体の
             * 記録数で、止めても過去の記録は残る。混ぜて出すと、止めても変わらない
             * ものまで影響に見えてしまう。
             */}
            <p className={styles.cardNote}>
              {Object.values(data?.impact ?? {}).every((value) => typeof value === 'number')
                ? '「ECの出来事がきっかけ」とあるものは、このつなぎ先を止めると止まります。コンバージョンと分析はアカウント全体の記録数です。'
                : '取得できない影響件数は「未取得」と表示します。0件とは限りません。'}
            </p>
            {[
              ['NEN配信', data?.impact.nenCampaigns, 'ECの出来事がきっかけ'],
              ['マイル', data?.impact.mileageRules, 'ECの出来事がきっかけ'],
              ['友だち属性', data?.impact.friendFields, 'ECの出来事がきっかけ'],
              ['コンバージョン', data?.impact.conversions, 'アカウント全体'],
              ['分析', data?.impact.analytics, 'アカウント全体'],
            ].map(([label, value, scope]) => <div className={styles.impactRow} key={String(label)}><span>{label}<small className="mt-0.5 block text-caption font-normal text-ink-faint">{scope}</small></span><strong>{typeof value === 'number' ? `${value}件` : '— 未取得'}</strong></div>)}
            {/*
             * #948 N-320: やり直し規定を常時表示する。つなぎ先単位の自動やり直しは
             * 無い(retryPolicy は常に null、#517)ため、実行単位の手動やり直しへの
             * 行き先を固定の文で出す。
             */}
            <p className="mt-1 text-caption leading-relaxed text-ink-faint">
              止めたあとも、保存済みの設定と届いたデータは残ります。失敗した処理のやり直しは「取り込みの記録」タブで一件ずつ「もう一度やる」から行います。
            </p>
          </section>
        </aside>
      </div>
      <ConfirmDialog
        open={emptyConfirm !== null}
        title={emptyConfirm?.events && emptyConfirm?.rules
          ? '取り込みと照合をすべて止めますか？'
          : emptyConfirm?.events
            ? 'すべての出来事の取り込みを止めますか？'
            : '自動の照合をすべて止めますか？'}
        description={[
          emptyConfirm?.events ? '取り込む出来事が1つも選ばれていません。保存すると、すべての出来事の取り込みが止まります。' : null,
          emptyConfirm?.rules ? '人を照らし合わせる決めごとが1つも選ばれていません。保存すると、自動の照合がすべて止まります。' : null,
        ].filter(Boolean).join('')}
        confirmLabel="止めて保存する"
        destructive
        busy={saving}
        onConfirm={() => {
          setEmptyConfirm(null)
          void save()
        }}
        onCancel={() => {
          if (saving) return
          setEmptyConfirm(null)
        }}
      />
      {/* #948 N-322: 止める変更を保存せずに離れるときの確認。 */}
      <ConfirmDialog
        open={leaveTarget !== null}
        title="保存していない変更があります"
        description={pendingStatusChange
          ? (form.status === 'paused'
            ? '「取り込みを止める」はまだ保存されていません。このまま移動すると、取り込みは止まりません。移動しますか？'
            : '「取り込みを再開する」はまだ保存されていません。このまま移動すると、取り込みは再開しません。移動しますか？')
          : 'このまま移動すると、入力した内容は保存されません。移動しますか？'}
        confirmLabel="保存せずに移動"
        cancelLabel="設定に戻る"
        onConfirm={confirmLeave}
        onCancel={cancelLeave}
      />
    </>
  )
}
