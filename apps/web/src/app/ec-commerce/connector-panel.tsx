'use client'

import { useCallback, useEffect, useState } from 'react'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import SummaryCard from '@/components/shared/summary-card'
import { ApiError, api, type EcConnector, type EcConnectorOverview } from '@/lib/api'
import { formatEcDateTimeWithYear as dateTime } from './ec-datetime'
import styles from './ec-commerce-v6.module.css'

const EVENT_TYPES = [
  ['ec.order.confirmed', '注文が確定した'],
  ['ec.order.payment_received', '入金を確認した'],
  ['ec.order.shipped', '発送した'],
  ['ec.order.cancelled', '注文を取り消した'],
  ['ec.order.refunded', '返品・返金した'],
  ['ec.customer.profile_updated', '会員情報が変わった'],
] as const
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
  eventTypes: EVENT_TYPES.map(([value]) => value),
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

  const connector = data?.connector
  return (
    <>
      <NoteBar tone={connector?.status === 'paused' ? 'warn' : 'info'}>
        {connector?.status === 'paused' ? '取り込みを止めています。保存済みの設定は残っています。' : connector ? `つながっています。最後にデータが届いたのは ${dateTime(data?.health.lastReceivedAt ?? null)} です。` : 'まだつながっていません。下の情報を入れて保存してください。'}
      </NoteBar>
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
            <div className={styles.checks}>{EVENT_TYPES.map(([value, label]) => <label className={styles.check} key={value}><input type="checkbox" checked={form.eventTypes.includes(value)} onChange={() => toggle('eventTypes', value)} /><span>{label}</span></label>)}</div>
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>どうやって人を見分けるか</h2>
            <p className={styles.cardNote}>上から照らし合わせます。名前だけで自動では結びつけません。</p>
            <div className={styles.ruleList}>{IDENTITY_RULES.map(([value, label, note], index) => <label className={styles.rule} key={value}><input type="checkbox" checked={form.identityRules.includes(value)} onChange={() => toggle('identityRules', value)} /><span className={styles.ruleNumber}>{index + 1}</span><span><strong>{label}</strong><small>{note}</small></span></label>)}</div>
            <div className={styles.actions}>
              {connector ? <Button type="button" onClick={() => setForm({ ...form, status: form.status === 'paused' ? 'connected' : 'paused' })}>{form.status === 'paused' ? '取り込みを再開する' : '取り込みを止める'}</Button> : null}
              <Button type="button" variant="primary" disabled={saving || !form.shopDomain || (!connector?.secretConfigured && form.inboundSecret.length < 32)} onClick={() => void save()}>{saving ? '保存しています…' : '設定を保存'}</Button>
            </div>
          </section>
        </div>

        <aside className={styles.stack}>
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>取り込みのようす</h2>
            <div className={styles.compactKpis}>
              <SummaryCard variant="v6" title="今日" value={data?.health.today ?? null} unit="件" detail="届いた出来事" />
              <SummaryCard variant="v6" title="この30日" value={data?.health.last30Days ?? null} unit="件" detail="届いた出来事" />
              <SummaryCard variant="v6" title="失敗" value={data?.health.failed ?? null} unit="件" detail="確認が必要" />
              <SummaryCard variant="v6" title="最後に成功" value={null} unit="" detail={dateTime(data?.health.lastSucceededAt ?? null)} badge="日時" badgeTone="neutral" />
            </div>
          </section>
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>つながる先</h2>
            <p className={styles.cardNote}>
              {Object.values(data?.impact ?? {}).every((value) => typeof value === 'number')
                ? 'このつなぎ先を止めると影響する設定・集計です。NEN配信・マイル・友だち属性は全体の件数です。'
                : '取得できない影響件数は「未取得」と表示します。0件とは限りません。'}
              {data?.retryPolicy ? <><br />やり直しの決めごと：{data.retryPolicy}</> : null}
            </p>
            {[['NEN配信', data?.impact.nenCampaigns], ['コンバージョン', data?.impact.conversions], ['マイル', data?.impact.mileageRules], ['友だち属性', data?.impact.friendFields], ['分析', data?.impact.analytics]].map(([label, value]) => <div className={styles.impactRow} key={String(label)}><span>{label}</span><strong>{typeof value === 'number' ? `${value}件` : '— 未取得'}</strong></div>)}
          </section>
        </aside>
      </div>
    </>
  )
}
