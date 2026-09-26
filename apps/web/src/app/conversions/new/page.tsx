'use client'

import Disclosure from '@/components/shared/disclosure'
import SelectField from '@/components/shared/select-field'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  api,
  ApiError,
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
import Button from '@/components/shared/button'
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

/**
 * 「使う場所」の種類(N-258)。
 *
 * 以前は `conversion-overview` などの**実在しない仮ID**をそのまま保存して
 * いた。いまは各種類の本物のオブジェクト(ファネル・NEN配信の設定・
 * オートメーション)をアカウントごとに読み、そのIDだけを保存する。
 */
type UsageGroupKind = 'analytics' | 'nen_campaign' | 'automation'

const USAGE_GROUPS: Array<{ kind: UsageGroupKind; label: string; note: string }> = [
  { kind: 'analytics', label: '分析', note: 'この成果地点を段に使うファネル' },
  { kind: 'nen_campaign', label: 'NEN配信', note: 'この成果をきっかけにする配信' },
  { kind: 'automation', label: '自動化', note: 'この成果をきっかけに動く処理' },
]

/** 選択できる利用先の1件。refId は必ず実在するオブジェクトのID。 */
interface UsageTarget {
  kind: ConversionDefinitionUsageKind
  refId: string
  refVersionId?: string | null
  label: string
}

function usageKey(target: Pick<UsageTarget, 'kind' | 'refId'>): string {
  return `${target.kind}:${target.refId}`
}

/**
 * 「使う場所」1種類ぶんの候補の取得状態(DETAIL-16)。
 *
 * - idle: 集計対象が未選択で、まだ読んでいない
 * - loading / ok: 読込中と取得成功(0件もここ。「まだありません」と出せる)
 * - error: 500や通信失敗など。再試行できる
 * - forbidden: 403。再試行しても変わらないので再読み込みは出さない
 */
type UsageKindState = 'idle' | 'loading' | 'ok' | 'error' | 'forbidden'

interface UsageKindResult {
  state: UsageKindState
  targets: UsageTarget[]
}

const EMPTY_USAGE_KINDS: Record<UsageGroupKind, UsageKindResult> = {
  analytics: { state: 'idle', targets: [] },
  nen_campaign: { state: 'idle', targets: [] },
  automation: { state: 'idle', targets: [] },
}

/**
 * 種類ごとに候補を読む。1種類の失敗を他の種類へ伝えないため、
 * 全部まとめて待つのではなく種類ごとの結果を返す。
 * 応答が success:false のときも失敗として投げ、呼び出し側で
 * 403(権限不足)とそれ以外を分けられるようにする。
 */
async function fetchUsageTargets(kind: UsageGroupKind, accountId: string): Promise<UsageTarget[]> {
  if (kind === 'analytics') {
    const res = await api.analytics.v6Funnels.list(accountId)
    if (!res.success) throw new Error(res.error)
    return res.data.map((funnel) => ({
      kind, refId: funnel.id, refVersionId: funnel.currentVersion?.id ?? null, label: funnel.name,
    }))
  }
  if (kind === 'nen_campaign') {
    const res = await api.nenCampaigns.settings(accountId)
    if (!res.success) throw new Error(res.error)
    return res.data.map((campaign) => ({ kind, refId: campaign.campaignKey, label: campaign.label }))
  }
  const res = await api.automations.list({ accountId })
  if (!res.success) throw new Error(res.error)
  return res.data.map((automation) => ({
    kind, refId: automation.id, refVersionId: automation.versionId ?? null, label: automation.name,
  }))
}

export default function NewConversionPointPage() {
  const { selectedAccountId, selectedAccount } = useAccount()
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
  /** N-268: チェックすると下書きで保存し、公開するまで計測しない。 */
  const [saveAsDraft, setSaveAsDraft] = useState(false)
  const [points, setPoints] = useState<ConversionPoint[]>([])
  const [usageKinds, setUsageKinds] = useState<Record<UsageGroupKind, UsageKindResult>>(EMPTY_USAGE_KINDS)
  const [selectedUsageKeys, setSelectedUsageKeys] = useState<Set<string>>(new Set())
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

  /*
   * 集計対象アカウントは画面上部の選択に固定する(DETAIL-17)。
   *
   * 以前は詳細設定に別の選択欄があり、そこでB店や「すべて」を選んでも
   * lineAccountId の変更を監視する effect が毎回ヘッダー選択へ戻していた。
   * 案件作成(#686)と同じ決めごとにそろえ、作成先はヘッダーのアカウントに
   * 固定して詳細欄では選ばせない。保存側はアカウント必須で、権限外の
   * アカウントを送ってもサーバーが404で拒否する(conversions.ts)。
   */
  const lineAccountId = selectedAccountId ?? ''

  /*
   * 「使う場所」の候補を実オブジェクトから読む(N-258 / DETAIL-16)。
   *
   * ファネル・NEN配信の設定・オートメーションのそれぞれが持つ本物のIDを
   * 使う。種類ごとに読み、失敗した種類だけを「読み込めません＋再読み込み」
   * にする。読めた種類は使えるままにし、空の成功と取得失敗を区別する。
   * 選べない偽物は置かない。
   */
  const usageRequestIds = useRef<Record<UsageGroupKind, number>>({ analytics: 0, nen_campaign: 0, automation: 0 })
  const requestUsageKind = useCallback((kind: UsageGroupKind, accountId: string) => {
    const requestId = ++usageRequestIds.current[kind]
    setUsageKinds((current) => ({ ...current, [kind]: { ...current[kind], state: 'loading' } }))
    void fetchUsageTargets(kind, accountId).then((targets) => {
      if (usageRequestIds.current[kind] !== requestId) return
      setUsageKinds((current) => ({ ...current, [kind]: { state: 'ok', targets } }))
      // 読み直せた種類の中でだけ、実在しない選択を外す。失敗した種類の
      // 選択は残し、再試行で候補が戻ったときチェックも戻る(DETAIL-16)。
      setSelectedUsageKeys((current) =>
        new Set([...current].filter((key) =>
          !key.startsWith(`${kind}:`) || targets.some((target) => usageKey(target) === key))))
    }).catch((error: unknown) => {
      if (usageRequestIds.current[kind] !== requestId) return
      setUsageKinds((current) => ({
        ...current,
        [kind]: {
          state: error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error',
          // 読めなかった種類の古い候補は保存に送らない。選択自体は残す。
          targets: [],
        },
      }))
    })
  }, [])

  useEffect(() => {
    if (!lineAccountId) {
      setUsageKinds(EMPTY_USAGE_KINDS)
      return
    }
    for (const group of USAGE_GROUPS) requestUsageKind(group.kind, lineAccountId)
  }, [lineAccountId, requestUsageKind])

  const usageTargets = useMemo(
    () => USAGE_GROUPS.flatMap((group) => usageKinds[group.kind].targets),
    [usageKinds],
  )

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
        reversalPolicy,
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
  }, [deduplicationMode, eventType, excludedCondition, lineAccountId, measureMethod, reversalPolicy, targetUrl, triggerKind, valueMode, yen])

  const toggleUsage = (target: UsageTarget) => {
    setSelectedUsageKeys((current) => {
      const next = new Set(current)
      const key = usageKey(target)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
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
      showHeader={false}
      parent={['コンバージョン', '/conversions?tab=points']}
      successHref={(id) => `/conversions?tab=points${id ? `&highlight=${encodeURIComponent(id)}` : ''}`}
      saveLabel={saveAsDraft ? '下書きとして保存する' : 'つくって数えはじめる'}
      designNode="GtylA"
      variant="v6"
      validate={() => {
        if (!name.trim()) return '成果地点の名前を入力してください'
        if (duplicateName) return `「${duplicateName.name}」と同じ名前の成果地点がすでにあります`
        if (measureMethod === 'url_reach' && !targetUrl.trim()) {
          return '指定ページへの到達で数えるときは、対象のURLが要ります'
        }
        if (!lineAccountId) return '集計対象のLINEアカウントを選んでください（画面上部で選べます）'
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
        setSelectedUsageKeys(new Set())
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
          usages: usageTargets
            .filter((target) => selectedUsageKeys.has(usageKey(target)))
            .map(({ kind, refId, refVersionId }) => ({ refKind: kind, refId, refVersionId })),
          // N-268: 下書きで保存すると、一覧の「計測をはじめる」で公開するまで数えない。
          draft: saveAsDraft,
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
        {/* #975 U062: 390pxで6枚の大カードを積まない。短い選択群にし、説明は選択中の1種類だけ下へ出す。 */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="数えるきっかけ">
          {TRIGGER_CHOICES.map((choice) => {
            const Icon = choice.icon
            const selected = triggerKind === choice.value
            return (
              <label
                key={choice.value}
                className={`rounded-control flex min-h-11 min-w-0 items-center gap-2 border px-3 py-2 text-left transition-colors ${
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
                <Icon className={`shrink-0 ${selected ? 'text-accent-deep' : 'text-ink-faint'}`} size={16} aria-hidden />
                <span className="text-ink truncate text-xs font-bold" title={choice.label}>{choice.label}</span>
              </label>
            )
          })}
        </div>
        {(() => {
          const current = TRIGGER_CHOICES.find((choice) => choice.value === triggerKind)
          return current ? (
            <p className="mt-2 text-xs text-ink-secondary" role="status">
              「{current.label}」… {current.note}の出来事が起きた人を数えます。
            </p>
          ) : null
        })()}

        <div className="grid gap-3 md:grid-cols-3">
          <Field
            label="成果地点の名前"
            htmlFor="cv-name"
            required
            help="一覧・案件・分析にこの名前で並びます。"
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
              help="前方一致で判定し、パラメータは無視します。"
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
            <Field label="どの注文を数えるか" htmlFor="cv-order-scope" help="すべての注文を対象に保存します。">
              <SelectField id="cv-order-scope" value="all" disabled options={[{ value: 'all', label: 'すべての注文' }]} className="w-full" />
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
          <Field label="決まった金額（円）" htmlFor="cv-value" help="1件ごとの金額です。">
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
          <Field label="取り消しの扱い" htmlFor="cv-reversal-policy" help="元の成果は消さず、取消記録を追加します。">
            <SelectField
              id="cv-reversal-policy"
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
          {USAGE_GROUPS.map((group) => {
            const kindResult = usageKinds[group.kind]
            const targets = kindResult.targets
            return (
              <div key={group.kind} className="border-hairline rounded-control border p-3">
                <p className="text-ink text-sm font-semibold">{group.label}</p>
                <p className="text-ink-faint text-xs">{group.note}</p>
                {kindResult.state === 'idle' ? (
                  <p className="text-ink-faint mt-2 text-xs">集計対象のアカウントを選ぶと候補が出ます</p>
                ) : kindResult.state === 'loading' ? (
                  <p className="text-ink-faint mt-2 text-xs">候補を読み込んでいます</p>
                ) : kindResult.state === 'forbidden' ? (
                  // 403は再読み込みしても変わらないので、再試行は出さない。
                  <p className="text-warning mt-2 text-xs" role="status">
                    このアカウントの{group.label}を見る権限がありません
                  </p>
                ) : kindResult.state === 'error' ? (
                  <div className="mt-2">
                    <p className="text-danger text-xs" role="alert">
                      使える{group.label}を読み込めませんでした
                    </p>
                    <Button
                      variant="secondary"
                      size="field"
                      className="mt-1.5"
                      disabled={!lineAccountId}
                      onClick={() => requestUsageKind(group.kind, lineAccountId)}
                    >
                      {group.label}を再読み込み
                    </Button>
                  </div>
                ) : targets.length === 0 ? (
                  <p className="text-ink-faint mt-2 text-xs">使える{group.label}がまだありません</p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {targets.map((target) => (
                      <li key={usageKey(target)}>
                        {/* 13px の箱だけだと的が小さい。箱自体を 24px にして行全体を押せるようにする。 */}
                        <label className="flex min-h-6 cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selectedUsageKeys.has(usageKey(target))}
                            onChange={() => toggleUsage(target)}
                            className="h-6 w-6 shrink-0 accent-accent-deep"
                          />
                          <span className="text-ink text-xs">{target.label}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
        <label className="border-hairline rounded-control mt-3 flex min-h-6 cursor-pointer items-start gap-3 border p-3">
          <input
            type="checkbox"
            checked={saveAsDraft}
            onChange={(event) => setSaveAsDraft(event.target.checked)}
            className="h-6 w-6 shrink-0 accent-accent-deep"
          />
          <span>
            <span className="text-ink block text-sm font-semibold">まだ計測せず、下書きとして保存する</span>
            <span className="text-ink-faint mt-0.5 block text-xs">
              一覧の「下書き」に入ります。数えはじめるには一覧から公開します。
            </span>
          </span>
        </label>
        <Disclosure size="compact" title="詳細設定" hint="帰属期間・集計対象">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="友だち追加からの計測期間" htmlFor="cv-days" note="空欄なら既定の90日です。">
              <div className="flex items-center gap-1.5">
                <input id="cv-days" type="number" min={1} max={365} value={attributionDays} onChange={(e) => setAttributionDays(e.target.value)} placeholder="90" className={`${inputClass} w-24 tabular-nums`} />
                <span className="text-ink-faint text-xs">日</span>
              </div>
            </Field>
            <Field
              label="集計対象アカウント"
              htmlFor="cv-account"
              note="画面上部で選んでいるLINEアカウントに固定されます。他のアカウントに作りたいときは、先に上部で切り替えてください。"
            >
              <p id="cv-account" className="bg-canvas-sunken text-ink rounded-control px-3 py-2 text-sm">
                {selectedAccount ? selectedAccount.name : '未選択（画面上部で選んでください）'}
              </p>
            </Field>
          </div>
        </Disclosure>
      </FormSection>
    </CreatePage>
  )
}
