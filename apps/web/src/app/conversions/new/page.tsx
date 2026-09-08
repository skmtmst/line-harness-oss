'use client'

import SelectField from '@/components/shared/select-field'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  api,
  type ConversionDeduplicationMode,
  type ConversionDefinitionPreview,
  type ConversionDefinitionUsageKind,
  type ConversionReversalPolicy,
  type ConversionValueMode,
} from '@/lib/api'
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
import { createLatestPreviewRequestGate, type LatestPreviewRequest } from './latest-preview-request'

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
  { value: 'video', label: '動画を見終えた', note: 'ウェビナー', eventType: 'webinar_completed', measureMethod: 'webhook', icon: Video, connected: true },
  { value: 'tag', label: 'タグが付いた', note: '友だち属性', eventType: 'tag_added', measureMethod: 'webhook', icon: Tag, connected: true },
]

const USAGE_CHOICES: Array<{ kind: ConversionDefinitionUsageKind; refId: string; label: string; note: string }> = [
  { kind: 'analytics', refId: 'conversion-overview', label: '分析', note: 'この成果地点を分析のグラフに出す' },
  { kind: 'nen_campaign', refId: 'purchase-followup', label: 'NEN配信', note: '購入後のご案内のきっかけにする' },
  { kind: 'automation', refId: 'conversion-followup', label: '自動化', note: '成果後の処理を動かす' },
]

export default function NewConversionPointPage() {
  const { accounts, selectedAccountId } = useAccount()
  const [name, setName] = useState('')
  const [triggerKind, setTriggerKind] = useState<TriggerKind>('order')
  const [eventType, setEventType] = useState('ec_order_confirmed')
  const [value, setValue] = useState('')
  const [valueMode, setValueMode] = useState<ConversionValueMode>('source')
  const [measureMethod, setMeasureMethod] = useState<'url_reach' | 'webhook'>('webhook')
  const [targetUrl, setTargetUrl] = useState('')
  const [excludedCondition, setExcludedCondition] = useState('')
  const [deduplicationMode, setDeduplicationMode] = useState<ConversionDeduplicationMode>('once_per_friend')
  const [reversalPolicy, setReversalPolicy] = useState<ConversionReversalPolicy>('source_cancelled')
  const [attributionDays, setAttributionDays] = useState('')
  const [lineAccountId, setLineAccountId] = useState('')
  const [points, setPoints] = useState<ConversionPoint[]>([])
  const [selectedUsages, setSelectedUsages] = useState<ConversionDefinitionUsageKind[]>(['analytics', 'nen_campaign'])
  const [preview, setPreview] = useState<ConversionDefinitionPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewFailed, setPreviewFailed] = useState(false)
  const previewRequests = useRef(createLatestPreviewRequestGate())

  // 右の「同種の成果地点」に要る。作る前に、似たものが既にあるか分かるように。
  useEffect(() => {
    let cancelled = false
    void api.conversions.points().then((response) => {
      if (!cancelled && response.success) setPoints(response.data)
    }).catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (selectedAccountId) setLineAccountId(selectedAccountId)
    else if (!lineAccountId && accounts[0]) setLineAccountId(accounts[0].id)
  }, [accounts, lineAccountId, selectedAccountId])

  /*
   * 同じ名前の警告は、同じ集計対象の中だけで出す(#513 L4)。
   *
   * 以前はアカウントを見ずに探していたので、別のアカウントの同名にまで
   * 反応して作れず、保存時の口(アカウント単位の判定)と食い違っていた。
   * 対象が「すべて」(null)の既存行はどの対象にも当たり得るので残す。
   */
  const duplicateName = useMemo(() => {
    const normalized = name.trim().normalize('NFKC').toLocaleLowerCase('ja')
    if (!normalized) return null
    return points.find(
      (point) => point.name.trim().normalize('NFKC').toLocaleLowerCase('ja') === normalized
        && (point.lineAccountId == null || point.lineAccountId === lineAccountId),
    ) ?? null
  }, [name, points, lineAccountId])

  const yen = value ? Number(value) : null

  useEffect(() => {
    if (!lineAccountId) return
    let request: LatestPreviewRequest | null = null
    const timer = window.setTimeout(() => {
      request = previewRequests.current.start()
      setPreviewLoading(true)
      setPreviewFailed(false)
      void api.conversions.previewDefinition({
        sourceType: eventType,
        sourceConfig: { triggerKind, excludedCondition: excludedCondition.trim() || null },
        targetUrl: measureMethod === 'url_reach' ? targetUrl.trim() : null,
        lineAccountId,
        deduplicationMode,
        deduplicationWindowDays: deduplicationMode === 'window' ? 30 : null,
        valueMode,
        fixedValue: valueMode === 'fixed' && Number.isFinite(yen) ? yen : null,
      }, { signal: request.signal }).then((response) => {
        if (!request?.isCurrent()) return
        if (response.success) setPreview(response.data)
        else setPreviewFailed(true)
      }).catch(() => {
        if (request?.isCurrent()) setPreviewFailed(true)
      }).finally(() => {
        if (request?.isCurrent()) setPreviewLoading(false)
      })
    }, 250)
    return () => {
      window.clearTimeout(timer)
      request?.abort()
    }
  }, [deduplicationMode, eventType, excludedCondition, lineAccountId, measureMethod, targetUrl, triggerKind, valueMode, yen])

  const toggleUsage = (kind: ConversionDefinitionUsageKind) => {
    setSelectedUsages((current) => current.includes(kind)
      ? current.filter((item) => item !== kind)
      : [...current, kind])
  }

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
        if (!lineAccountId) return '集計対象のLINEアカウントを選んでください'
        // 保存側(400)と同じ条件を先に言う。素通りすると汎用失敗文になる(#513 L3)。
        if (valueMode === 'fixed' && (yen === null || !Number.isFinite(yen) || yen < 0)) {
          return '固定で付ける金額は0以上の数値で入力してください'
        }
        if (attributionDays) {
          const days = Number(attributionDays)
          if (!Number.isInteger(days) || days < 1 || days > 365) {
            return '成果を紐づける日数は1〜365日で入力してください'
          }
        }
        return null
      }}
      onReset={() => {
        setName('')
        setValue('')
        setValueMode('source')
        setTargetUrl('')
        setExcludedCondition('')
        setDeduplicationMode('once_per_friend')
        setReversalPolicy('source_cancelled')
      }}
      onSave={async () => {
        const res = await api.conversions.createDefinition({
          name: name.trim(),
          sourceType: eventType,
          sourceConfig: { triggerKind, excludedCondition: excludedCondition.trim() || null },
          targetUrl: measureMethod === 'url_reach' ? targetUrl.trim() : null,
          lineAccountId,
          deduplicationMode,
          deduplicationWindowDays: deduplicationMode === 'window' ? 30 : null,
          valueMode,
          fixedValue: valueMode === 'fixed' ? yen : null,
          reversalPolicy,
          attributionDays: attributionDays ? Number(attributionDays) : null,
          usages: USAGE_CHOICES
            .filter((usage) => selectedUsages.includes(usage.kind))
            .map(({ kind, refId }) => ({ refKind: kind, refId })),
        })
        if (!res.success) throw new Error(res.error)
        return res.data.id
      }}
      aside={
        <>
          <section className="border-info bg-info-bg rounded-card border p-4">
            <h2 className="text-info text-sm font-bold">この決めごとをこの30日にあてはめると</h2>
            <div className="mt-3 flex items-end justify-between gap-4" aria-busy={previewLoading}>
              <div>
                <p className="text-info text-2xl font-bold tabular-nums">{preview ? `${preview.estimatedCount.toLocaleString()}件` : '—'}</p>
                <p className="text-info mt-1 text-xs tabular-nums">1日あたり {preview ? `${preview.dailyAverage.toLocaleString()}件` : '—'}</p>
              </div>
              <div className="text-right">
                <p className="text-info text-xl font-bold tabular-nums">{preview ? `¥${preview.estimatedValue.toLocaleString()}` : '—'}</p>
                <p className="text-info mt-1 text-xs tabular-nums">
                  {preview && preview.estimatedCount > 0
                    ? `1件あたり ¥${Math.round(preview.estimatedValue / preview.estimatedCount).toLocaleString()}`
                    : '1件あたり —'}
                </p>
              </div>
            </div>
            <p className="text-ink-secondary mt-3 text-xs leading-relaxed">
              {previewFailed
                ? '保存前の試算を読み込めませんでした。入力内容は保存されていません。'
                : preview
                  ? `入力中の条件だけで試算しています。重複除外 ${preview.duplicateExcludedCount}件・取消 ${preview.cancellationCount}件。試算では成果を追加しません。`
                  : '入力中の条件を試算しています。'}
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
            <p className="text-ink-faint mt-3 text-xs">選んだ利用先は成果地点の公開版と一緒に保存します。</p>
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
            <Field label="どの注文を数えるか" note="すべての注文を対象に保存します。">
              <SelectField value="all" disabled options={[{ value: 'all', label: 'すべての注文' }]} className="w-full" />
            </Field>
          )}

          <Field label="数えない条件（任意）" htmlFor="cv-excluded-condition" note="空欄なら、除外せずに数えます。">
            <input
              id="cv-excluded-condition"
              value={excludedCondition}
              onChange={(event) => setExcludedCondition(event.target.value)}
              placeholder="例：テスト用アカウントの注文をのぞく"
              className={inputClass}
            />
          </Field>
        </div>
      </FormSection>

      <FormSection
        step={2}
        label="同じ人を何回まで数えるか"
        note="ここを間違えると、売上を重ねて数えることがあります。"
      >
        <div className="grid gap-2 sm:grid-cols-3">
          <ChoiceCard selected={deduplicationMode === 'every'} title="何回でも数える" note="買うたびに1件。売上を追うときに使います" onClick={() => setDeduplicationMode('every')} />
          <ChoiceCard selected={deduplicationMode === 'once_per_friend'} title="1人1回だけ" note="はじめての人だけを数えます" onClick={() => setDeduplicationMode('once_per_friend')} />
          <ChoiceCard selected={deduplicationMode === 'window'} title="30日に1回まで" note="短い間にくり返し起きるものに使います" onClick={() => setDeduplicationMode('window')} />
        </div>
      </FormSection>

      <FormSection step={3} label="金額をどう出すか">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="金額の出し方" htmlFor="cv-value-mode">
            <SelectField
              id="cv-value-mode"
              value={valueMode}
              onChange={(event) => setValueMode(event.target.value as ConversionValueMode)}
              options={[
                { value: 'source', label: '注文の金額をそのまま使う' },
                { value: 'fixed', label: '決まった額を使う' },
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
          <Field label="取り消しの扱い" note="元の成果は消さず、取消記録を追加します。">
            <SelectField
              value={reversalPolicy}
              onChange={(event) => setReversalPolicy(event.target.value as ConversionReversalPolicy)}
              options={[
                { value: 'source_cancelled', label: '返品されたら取り消す' },
                { value: 'manual', label: '担当者が取り消す' },
                { value: 'none', label: '取り消しを数えない' },
              ]}
              className="w-full"
            />
          </Field>
        </div>
      </FormSection>

      <FormSection step={4} label="この成果地点を使う場所">
        <p className="text-ink-faint text-xs">ふつうは呼ぶ側から選びます。ここで選んだ場所は作成と同時につながります。</p>
        <div className="grid gap-2 md:grid-cols-3">
          {USAGE_CHOICES.map((usage) => (
            <label key={usage.kind} className="border-hairline rounded-control flex cursor-pointer items-start gap-2 border p-3">
              <input
                type="checkbox"
                checked={selectedUsages.includes(usage.kind)}
                onChange={() => toggleUsage(usage.kind)}
                className="mt-0.5"
              />
              <span>
                <span className="text-ink block text-sm font-semibold">{usage.label}</span>
                <span className="text-ink-faint block text-xs">{usage.note}</span>
              </span>
            </label>
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
