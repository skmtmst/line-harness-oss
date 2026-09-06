'use client'

import SelectField from '@/components/shared/select-field'
import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import type { ConversionPoint } from '@line-crm/shared'
import {
  CalendarCheck,
  ClipboardCheck,
  Eye,
  ShoppingBag,
  Tag,
  Video,
  type LucideIcon,
} from 'lucide-react'
import CreatePage, {
  AsideCard,
  ChoiceCard,
  Field,
  FormSection,
  inputClass,
} from '@/components/shared/create-page'
import { useAccount } from '@/contexts/account-context'

/**
 * 成果地点を作る（設計 V6 19-1-B）。
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
type TriggerKind = 'order' | 'form' | 'booking' | 'page' | 'video' | 'tag'

interface TriggerChoice {
  value: TriggerKind
  label: string
  note: string
  eventType: string
  measureMethod: 'url_reach' | 'webhook'
  icon: LucideIcon
  connected: boolean
}

const TRIGGER_CHOICES: TriggerChoice[] = [
  { value: 'order', label: '注文が確定した', note: 'EC連携', eventType: 'ec_order_confirmed', measureMethod: 'webhook', icon: ShoppingBag, connected: true },
  { value: 'form', label: 'フォームが送信された', note: '回答フォーム', eventType: 'form_submitted', measureMethod: 'webhook', icon: ClipboardCheck, connected: true },
  { value: 'booking', label: '予約が確定した', note: '予約管理', eventType: 'reservation_confirmed', measureMethod: 'webhook', icon: CalendarCheck, connected: true },
  { value: 'page', label: 'ページを見た', note: 'サイトスクリプト', eventType: 'url_reach', measureMethod: 'url_reach', icon: Eye, connected: true },
  { value: 'video', label: '動画を見終えた', note: '保存契約は未接続', eventType: 'webinar_completed', measureMethod: 'webhook', icon: Video, connected: false },
  { value: 'tag', label: 'タグが付いた', note: '保存契約は未接続', eventType: 'tag_added', measureMethod: 'webhook', icon: Tag, connected: false },
]

interface ReportRow {
  conversionPointId: string
  eventType: string
  totalCount: number
  totalValue: number
}

/**
 * 既存の連携が保存した細かな出来事を、作成画面の3分類へ読み替える。
 * 文字列が完全一致するものだけ数えると、実績があるのに「0件」と見えてしまう。
 */
function eventTypeGroup(eventType: string): string {
  if (eventType === 'ec_order_confirmed') return 'purchase'
  if (eventType === 'form_submitted') return 'form_submit'
  if (eventType === 'reservation_confirmed' || eventType === 'webinar_completed') return 'visit'
  return eventType
}

function past30DaysRange(): { startDate: string; endDate: string } {
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const start = new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000)
  start.setHours(0, 0, 0, 0)
  return { startDate: start.toISOString(), endDate: end.toISOString() }
}

export default function NewConversionPointPage() {
  const { accounts } = useAccount()
  const [name, setName] = useState('')
  const [triggerKind, setTriggerKind] = useState<TriggerKind>('order')
  const [eventType, setEventType] = useState('ec_order_confirmed')
  const [value, setValue] = useState('')
  const [valueMode, setValueMode] = useState<'fixed' | 'none'>('fixed')
  const [measureMethod, setMeasureMethod] = useState<'url_reach' | 'webhook'>('webhook')
  const [targetUrl, setTargetUrl] = useState('')
  const [countRepeat, setCountRepeat] = useState(true)
  const [attributionDays, setAttributionDays] = useState('')
  const [lineAccountId, setLineAccountId] = useState('')
  const [points, setPoints] = useState<ConversionPoint[]>([])
  const [report, setReport] = useState<ReportRow[]>([])

  // 右の「同種の成果地点」に要る。作る前に、似たものが既にあるか分かるように。
  useEffect(() => {
    let cancelled = false
    void Promise.allSettled([api.conversions.points(), api.conversions.report(past30DaysRange())]).then(
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
    const selectedGroup = eventTypeGroup(eventType)
    const ids = new Set(
      points.filter((p) => eventTypeGroup(p.eventType) === selectedGroup).map((p) => p.id),
    )
    const rows = report.filter((r) => ids.has(r.conversionPointId))
    return {
      points: ids.size,
      count: rows.reduce((s, r) => s + r.totalCount, 0),
      yen: rows.reduce((s, r) => s + r.totalValue, 0),
    }
  }, [points, report, eventType])

  const duplicateName = useMemo(() => {
    const normalized = name.trim().normalize('NFKC').toLocaleLowerCase('ja')
    if (!normalized) return null
    return points.find(
      (point) => point.name.trim().normalize('NFKC').toLocaleLowerCase('ja') === normalized,
    ) ?? null
  }, [name, points])

  const yen = value ? Number(value) : null
  const trialDaily = (sameKind.count / 30).toLocaleString('ja-JP', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
  const trialAverage = sameKind.count > 0 ? Math.round(sameKind.yen / sameKind.count) : 0

  const selectTrigger = (choice: TriggerChoice) => {
    if (!choice.connected) return
    setTriggerKind(choice.value)
    setEventType(choice.eventType)
    setMeasureMethod(choice.measureMethod)
    if (choice.measureMethod !== 'url_reach') setTargetUrl('')
  }

  return (
    <CreatePage
      title="成果地点をつくる"
      description="「申込」「購入」など、成果として数えたい行動を登録します。"
      parent={['コンバージョン', '/conversions?tab=points']}
      successHref={(id) => `/conversions?tab=points${id ? `&highlight=${encodeURIComponent(id)}` : ''}`}
      saveLabel="つくって数えはじめる"
      designNode="GtylA"
      variant="v6"
      validate={() => {
        if (!name.trim()) return '成果地点の名前を入力してください'
        if (duplicateName) return `「${duplicateName.name}」と同じ名前の成果地点がすでにあります`
        if (measureMethod === 'url_reach' && !targetUrl.trim()) {
          return '指定ページへの到達で数えるときは、対象のURLが要ります'
        }
        return null
      }}
      onReset={() => {
        setName('')
        setValue('')
        setValueMode('fixed')
        setTargetUrl('')
      }}
      onSave={async () => {
        const res = await api.conversions.createPoint({
          name: name.trim(),
          eventType,
          value: valueMode === 'fixed' ? yen : null,
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
          <section className="border-info bg-info-bg rounded-card border p-4">
            <h2 className="text-info text-sm font-bold">この決めごとをこの30日にあてはめると</h2>
            <div className="mt-3 flex items-end justify-between gap-4">
              <div>
                <p className="text-info text-2xl font-bold tabular-nums">{sameKind.count.toLocaleString()}件</p>
                <p className="text-info mt-1 text-xs tabular-nums">1日あたり {trialDaily}件</p>
              </div>
              <div className="text-right">
                <p className="text-info text-xl font-bold tabular-nums">¥{sameKind.yen.toLocaleString()}</p>
                <p className="text-info mt-1 text-xs tabular-nums">1件あたり ¥{trialAverage.toLocaleString()}</p>
              </div>
            </div>
            <p className="text-ink-secondary mt-3 text-xs leading-relaxed">
              現在は同種の成果地点 {sameKind.points}件の実績です。重複除外・取消を含む保存前試算APIの接続後に、この入力だけの試算へ切り替えます。
            </p>
          </section>

          <AsideCard title="つながる先">
            <ul className="text-ink-secondary divide-hairline divide-y text-xs">
              <li className="flex justify-between gap-3 py-2"><span>成果とアフィリエイト</span><span className="text-ink-faint">案件から使う</span></li>
              <li className="flex justify-between gap-3 py-2"><span>分析</span><span className="text-ink-faint">成果のグラフ</span></li>
              <li className="flex justify-between gap-3 py-2"><span>自動応答</span><span className="text-ink-faint">成果後の通知</span></li>
              <li className="flex justify-between gap-3 py-2"><span>流入と計測</span><span className="text-ink-faint">どの経路から起きたか</span></li>
              <li className="flex justify-between gap-3 py-2"><span>マイル</span><span className="text-ink-faint">成果でマイルを付与</span></li>
            </ul>
            <p className="text-ink-faint mt-3 text-xs">利用先を保存するAPIは未接続です。</p>
          </AsideCard>

          <section className="border-warning bg-warning-bg rounded-card border p-4">
            <h2 className="text-warning text-sm font-bold">気をつけること</h2>
            <ul className="text-ink-secondary mt-3 space-y-2 text-xs leading-relaxed">
              <li>同じ意味の成果地点を2つ作ると、分析の数字が二重になります。</li>
              <li>似たものがないか、上の同種実績を確認してください。</li>
              <li>過去にさかのぼっては数えません。作った後の成果から記録します。</li>
            </ul>
          </section>
        </>
      }
    >
      <FormSection step={1} label="何が起きたら数えますか">
        <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
          {TRIGGER_CHOICES.map((choice) => {
            const Icon = choice.icon
            const selected = triggerKind === choice.value
            return (
              <label
                key={choice.value}
                className={`rounded-card min-w-0 border p-3 text-left transition-colors ${
                  selected ? 'border-accent bg-accent-soft' : 'border-hairline hover:bg-canvas-sunken'
                } ${choice.connected ? 'cursor-pointer' : 'cursor-not-allowed opacity-55'}`}
              >
                <input
                  type="radio"
                  name="conversion-trigger"
                  value={choice.value}
                  checked={selected}
                  disabled={!choice.connected}
                  onChange={() => selectTrigger(choice)}
                  className="sr-only"
                />
                <Icon className={selected ? 'text-accent' : 'text-ink-faint'} size={18} aria-hidden />
                <span className="text-ink mt-2 block text-xs font-bold">{choice.label}</span>
                <span className="text-ink-faint text-micro mt-0.5 block">{choice.note}</span>
              </label>
            )
          })}
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <Field
            label="成果地点の名前"
            htmlFor="cv-name"
            required
            note="一覧・案件・分析にこの名前で並びます。"
          >
            <input
              id="cv-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：商品を買った"
              className={inputClass}
            />
            {duplicateName && (
              <p className="text-danger mt-1 text-xs" role="alert">
                同じ名前の「{duplicateName.name}」があります。同じ意味の成果地点を2つ作らないでください。
              </p>
            )}
          </Field>

          {measureMethod === 'url_reach' ? (
            <Field
              label="数えてよいページ"
              htmlFor="cv-url"
              required
              note="前方一致で判定し、パラメータは無視します。"
            >
              <input
                id="cv-url"
                type="url"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                placeholder="https://example.com/thanks"
                className={inputClass}
              />
            </Field>
          ) : (
            <Field label="どの注文を数えるか" note="対象を絞る保存契約は未接続です。">
              <SelectField value="all" disabled options={[{ value: 'all', label: 'すべての注文' }]} className="w-full" />
            </Field>
          )}

          <Field label="数えてよい商品（任意）" note="商品を絞る保存契約は未接続です。">
            <input disabled value="" placeholder="商品を選べるようになると、ここに出ます" className={`${inputClass} bg-canvas-sunken`} readOnly />
          </Field>
        </div>
      </FormSection>

      <FormSection
        step={2}
        label="同じ人を何回まで数えるか"
        note="ここを間違えると、売上を重ねて数えることがあります。"
      >
        <div className="grid gap-2 sm:grid-cols-3">
          <ChoiceCard selected={countRepeat} title="何回でも数える" note="買うたびに計測します" onClick={() => setCountRepeat(true)} />
          <ChoiceCard selected={!countRepeat} title="1人1回だけ" note="はじめての人だけを数えます" onClick={() => setCountRepeat(false)} />
          <div aria-disabled="true" className="border-hairline rounded-card cursor-not-allowed border p-3 text-left opacity-55">
            <span className="text-ink block text-sm font-semibold">30日に1回まで</span>
            <span className="text-ink-faint block text-xs">期間内1回の保存契約は未接続です</span>
          </div>
        </div>
      </FormSection>

      <FormSection step={3} label="金額をどう出すか">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="金額の出し方" htmlFor="cv-value-mode">
            <SelectField
              id="cv-value-mode"
              value={valueMode}
              onChange={(event) => setValueMode(event.target.value as 'fixed' | 'none')}
              options={[
                { value: 'fixed', label: '毎回同じ金額' },
                { value: 'none', label: '金額を集計しない' },
              ]}
              className="w-full"
            />
          </Field>
          <Field label="決まった金額（円）" htmlFor="cv-value" note="1件ごとの金額です。">
            <input
              id="cv-value"
              type="number"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="0"
              disabled={valueMode === 'none'}
              className={`${inputClass} tabular-nums disabled:bg-canvas-sunken`}
            />
          </Field>
          <Field label="取り消しの扱い" note="取消方針の保存契約は未接続です。">
            <SelectField value="reversal" disabled options={[{ value: 'reversal', label: '返品されたら取り消す' }]} className="w-full" />
          </Field>
        </div>
      </FormSection>

      <FormSection step={4} label="この成果地点を使う場所">
        <p className="text-ink-faint text-xs">つなぐ場所は保存後に設定します。利用先APIの接続後は、この画面で選べます。</p>
        <div className="flex flex-wrap gap-2">
          {['分析「この成果地点を分析のグラフに出す」', 'NEN配信「購入後に案内する」', '使う場所を足す（案件・自動応答・オートメーション）'].map((label) => (
            <span key={label} className="border-hairline text-ink-secondary rounded-pill border px-3 py-1.5 text-xs">{label}</span>
          ))}
        </div>
        <details className="border-hairline rounded-control border px-3 py-2">
          <summary className="text-ink-secondary cursor-pointer text-xs font-semibold">詳細設定（帰属期間・集計対象）</summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Field label="友だち追加からの計測期間" htmlFor="cv-days" note="空欄なら既定の90日です。">
              <div className="flex items-center gap-1.5">
                <input id="cv-days" type="number" min={1} max={365} value={attributionDays} onChange={(e) => setAttributionDays(e.target.value)} placeholder="90" className={`${inputClass} w-24 tabular-nums`} />
                <span className="text-ink-faint text-xs">日</span>
              </div>
            </Field>
            <Field label="集計対象アカウント" htmlFor="cv-account">
              <SelectField
                id="cv-account"
                value={lineAccountId}
                onChange={(e) => setLineAccountId(e.target.value)}
                options={[{ value: '', label: 'すべてのアカウント' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
                className="w-full"
              />
            </Field>
          </div>
        </details>
      </FormSection>
    </CreatePage>
  )
}
