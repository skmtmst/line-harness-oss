'use client'

import SelectField from '@/components/shared/select-field'
import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import type { ConversionPoint } from '@line-crm/shared'
import CreatePage, {
  AsideCard,
  ChoiceCard,
  Field,
  FormSection,
  inputClass,
} from '@/components/shared/create-page'
import { useAccount } from '@/contexts/account-context'

/**
 * 成果地点（CV）を作る（設計 V2 6-1-1）。
 *
 * 設計は「何を成果として数えるか → どうやって数えるか → 金額の扱い」の順に
 * 聞く。数え方を決めないと、作っただけで1件も増えないので、そこを2番目に
 * 置いて飛ばせないようにしている。
 */

/**
 * 種別。設計は3つにまとめている。
 *
 * eventType は自由な文字列なので、過去に作られた値（signup / reserve / other）も
 * そのまま残る。一覧側のラベル表にも同じ3つを載せてある。
 */
const EVENT_TYPES = [
  { value: 'purchase', label: '購入', note: '金額を伴う成果' },
  { value: 'form_submit', label: '申込・登録', note: 'フォームや予約の完了' },
  { value: 'visit', label: '来店・参加', note: 'イベントや店舗での成果' },
]

const MEASURE_METHODS = [
  {
    value: 'url_reach' as const,
    label: '指定ページへの到達で数える',
    note: 'サンクスページのURLを指定します',
  },
  {
    value: 'webhook' as const,
    label: 'EC・外部システムからの通知で数える',
    note: 'Webhookで受け取ったできごとを使います',
  },
  {
    value: 'manual' as const,
    label: '管理画面から手動で登録する',
    note: 'スタッフが手で記録します',
  },
]

interface ReportRow {
  conversionPointId: string
  eventType: string
  totalCount: number
  totalValue: number
}

export default function NewConversionPointPage() {
  const { accounts } = useAccount()
  const [name, setName] = useState('')
  const [eventType, setEventType] = useState('purchase')
  const [value, setValue] = useState('')
  const [measureMethod, setMeasureMethod] = useState<'manual' | 'url_reach' | 'webhook'>('url_reach')
  const [targetUrl, setTargetUrl] = useState('')
  const [countRepeat, setCountRepeat] = useState(true)
  const [attributionDays, setAttributionDays] = useState('')
  const [lineAccountId, setLineAccountId] = useState('')
  const [points, setPoints] = useState<ConversionPoint[]>([])
  const [report, setReport] = useState<ReportRow[]>([])

  // 右の「同種の成果地点」に要る。作る前に、似たものが既にあるか分かるように。
  useEffect(() => {
    let cancelled = false
    void Promise.allSettled([api.conversions.points(), api.conversions.report()]).then(
      ([p, r]) => {
        if (cancelled) return
        if (p.status === 'fulfilled' && p.value.success) setPoints(p.value.data)
        if (r.status === 'fulfilled' && r.value.success) setReport(r.value.data)
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  const sameKind = useMemo(() => {
    const ids = new Set(points.filter((p) => p.eventType === eventType).map((p) => p.id))
    const rows = report.filter((r) => ids.has(r.conversionPointId))
    return {
      points: ids.size,
      count: rows.reduce((s, r) => s + r.totalCount, 0),
      yen: rows.reduce((s, r) => s + r.totalValue, 0),
    }
  }, [points, report, eventType])

  const yen = value ? Number(value) : null

  return (
    <CreatePage
      title="成果地点（CV）を作る"
      description="「申込」「購入」など、成果として数えたい行動を登録します。"
      parent={['成果とアフィリエイト', '/conversions']}
      saveLabel="成果地点を作成"
      validate={() => {
        if (!name.trim()) return '成果地点（CV）名を入力してください'
        if (measureMethod === 'url_reach' && !targetUrl.trim()) {
          return '指定ページへの到達で数えるときは、対象のURLが要ります'
        }
        return null
      }}
      onReset={() => {
        setName('')
        setValue('')
        setTargetUrl('')
      }}
      onSave={async () => {
        const res = await api.conversions.createPoint({
          name: name.trim(),
          eventType,
          value: yen,
          measureMethod,
          targetUrl: measureMethod === 'url_reach' ? targetUrl.trim() : null,
          countRepeat,
          attributionDays: attributionDays ? Number(attributionDays) : null,
          lineAccountId: lineAccountId || null,
        })
        if (!res.success) throw new Error(res.error)
        return res.data.id
      }}
      aside={
        <>
          <AsideCard title="この設定だとこう数えます" note="いまの入力">
            <ol className="text-ink-secondary space-y-2 text-xs leading-relaxed">
              <li>1. 友だちが配信のリンクを開く → クリックを記録</li>
              <li>
                2.{' '}
                {measureMethod === 'url_reach'
                  ? `${targetUrl.trim() || '（URL未入力）'} に到達`
                  : measureMethod === 'webhook'
                    ? '外部システムから通知が届く'
                    : 'スタッフが管理画面から記録'}{' '}
                → 成果1件
                {yen != null && yen > 0 ? `・${yen.toLocaleString()}円として記録` : 'として記録'}
              </li>
              <li>3. 流入経路とアフィリエイターにひも付け</li>
            </ol>
          </AsideCard>

          <AsideCard title="同種の成果地点">
            <dl className="space-y-1.5 text-xs">
              <div className="flex justify-between gap-2">
                <dt className="text-ink-faint">いまある数</dt>
                <dd className="text-ink tabular-nums">{sameKind.points} 件が計測中</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-faint">今月のCV（同種）</dt>
                <dd className="text-ink tabular-nums">
                  {sameKind.count} 件 ・ ¥{sameKind.yen.toLocaleString()}
                </dd>
              </div>
            </dl>
          </AsideCard>

          <AsideCard title="数え方の目安">
            <ul className="text-ink-faint space-y-1.5 text-xs leading-relaxed">
              <li>・同じ人が同じ日に2回到達しても、1回として数えます</li>
              <li>・広告やリファラルリンク経由の成果は、経路ごとに集計されます</li>
              <li>・金額を入れると、一覧に合計金額が表示されます</li>
            </ul>
          </AsideCard>
        </>
      }
    >
      <FormSection step={1} label="何を成果として数えるか">
        <Field label="成果地点（CV）名" htmlFor="cv-name" required>
          <input
            id="cv-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例：定期便の申込"
            className={inputClass}
          />
        </Field>

        <Field label="種別">
          <div className="grid gap-2 sm:grid-cols-3">
            {EVENT_TYPES.map((t) => (
              <ChoiceCard
                key={t.value}
                selected={eventType === t.value}
                title={t.label}
                note={t.note}
                onClick={() => setEventType(t.value)}
              />
            ))}
          </div>
        </Field>
      </FormSection>

      <FormSection
        step={2}
        label="どうやって数えるか"
        note="ここを決めないと、作っただけで1件も増えません。"
      >
        <div className="grid gap-2">
          {MEASURE_METHODS.map((m) => (
            <ChoiceCard
              key={m.value}
              selected={measureMethod === m.value}
              title={m.label}
              note={m.note}
              onClick={() => setMeasureMethod(m.value)}
            />
          ))}
        </div>

        {measureMethod === 'url_reach' && (
          <Field
            label="対象URL"
            htmlFor="cv-url"
            required
            note="前方一致で判定します。パラメータは無視されます。計測リンク（/t/…）を踏んだ人だけが対象です。"
          >
            <input
              id="cv-url"
              type="url"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://stg.nen-petfood.com/thanks"
              className={inputClass}
            />
          </Field>
        )}
      </FormSection>

      <FormSection step={3} label="金額の扱い">
        {/* 設計は「毎回同じ金額」以外の決め方（率など）も見据えた作りだが、
            持っているのは1件あたりの固定額だけ。選べる形にすると、
            選べないものが選べるように見える。 */}
        <Field label="金額の決め方" note="率での指定は準備中です。">
          <p className="bg-canvas-sunken text-ink-faint rounded-control px-3 py-2 text-sm">
            毎回同じ金額
          </p>
        </Field>

        {/* 一覧の列名は「成果単価」だが、作る画面では「1件あたりの金額」。
            設計がそう書き分けている。ここでは1件いくらかを入れる欄なので。 */}
        <Field label="1件あたりの金額" htmlFor="cv-value" note="空欄なら金額を集計しません。">
          <input
            id="cv-value"
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="0"
            className={`${inputClass} tabular-nums`}
          />
        </Field>

        <div className="grid gap-2 sm:grid-cols-2">
          <ChoiceCard
            selected={countRepeat}
            title="毎回カウントする"
            note="定期購入などに向いています"
            onClick={() => setCountRepeat(true)}
          />
          <ChoiceCard
            selected={!countRepeat}
            title="1人1回だけ数える"
            note="初回獲得だけを見たいとき"
            onClick={() => setCountRepeat(false)}
          />
        </div>
      </FormSection>

      <FormSection step={4} label="友だち追加からの計測期間">
        <Field
          label="計測期間"
          htmlFor="cv-days"
          note="この期間を過ぎた成果は、流入経路と結びつけません。空欄なら既定の90日。"
        >
          <div className="flex items-center gap-1.5">
            <input
              id="cv-days"
              type="number"
              min={1}
              max={365}
              value={attributionDays}
              onChange={(e) => setAttributionDays(e.target.value)}
              placeholder="90"
              className={`${inputClass} w-24 tabular-nums`}
            />
            <span className="text-ink-faint text-xs">日</span>
          </div>
        </Field>
      </FormSection>

      <FormSection step={5} label="集計対象アカウント">
        <Field
          label="対象"
          htmlFor="cv-account"
          note="1つに絞ると、そのアカウントで起きた成果だけを数えます。"
        >
          <SelectField
            id="cv-account"
            value={lineAccountId}
            onChange={(e) => setLineAccountId(e.target.value)}
            options={[{ value: '', label: 'すべてのアカウント' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
          />
        </Field>
      </FormSection>
    </CreatePage>
  )
}
