'use client'

import SelectField from '@/components/shared/select-field'
import { useEffect, useMemo, useState } from 'react'
import type { Tag } from '@line-crm/shared'
import { api } from '@/lib/api'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import CreatePage, {
  AsideCard,
  ChoiceCard,
  Field,
  FormSection,
  inputClass,
} from '@/components/shared/create-page'
import { TextInput } from '@/components/shared/form-controls'
import ConditionBuilder, {
  pruneCondition,
  type SegmentCondition,
} from '@/components/shared/condition-builder'

/**
 * たまる決めごとをつくる（設計 V6 17-1-D / BmoGY）。
 *
 * 設計は「どのルールか → 何マイル付けるか → 付けすぎを防ぐ → 受け取る人」の4節。
 *
 * いちばん大きな直しは、保存先を変えたこと。この画面は `scoring_rules` に
 * 書いていたが、一覧（/mileage）が読んでいるのは `mileage_rules` のほう。
 * つまり **作ったルールが一覧に出ず、マイルも付かなかった**。
 * 一覧と同じ `api.mileage` に載せ替えた。
 *
 * 載せ替えたことで、設計が求めていたものはほぼ全部そろっている。
 * 出どころ・確定待ち・1日の回数・同じ対象は1回だけ・倍率をかけない・
 * 紹介した人に付ける、はすべて `mileage_rules` の列と conditions にある。
 * 開始日・終了日は列と突き合わせだけあって書き込む口が無かったので、
 * db と worker を通した。
 */

/**
 * きっかけ。実際に awardActivityMileage が呼ばれている行動だけを並べる。
 * source を指定すると、その経路から来たものだけが対象になる。
 */
const EVENT_TYPES = [
  {
    value: 'message_received',
    label: 'メッセージを受け取った',
    note: '友だちからトークが届いたとき',
    sources: [['', 'すべて']],
  },
  {
    value: 'link_clicked',
    label: 'リンクがクリックされた',
    note: '計測リンクを開いたとき',
    sources: [
      ['', 'すべて'],
      ['tracked_link', '計測リンク'],
    ],
  },
  {
    value: 'form_submitted',
    label: 'フォームが送信された',
    note: '回答が届いたとき',
    sources: [
      ['', 'すべて'],
      ['form', 'フォーム'],
    ],
  },
  {
    value: 'booking_created',
    label: '予約が入った',
    note: '予約が作られたとき',
    sources: [
      ['', 'すべて'],
      ['booking', '予約'],
      ['event_booking', 'イベント予約'],
    ],
  },
  {
    value: 'friend_registered',
    label: '友だちが増えた',
    note: '友だち追加されたとき。紹介経由なら、受け取る人で紹介した人を選べます',
    sources: [
      ['', 'すべて'],
      ['line_relationship', 'LINEの友だち追加'],
    ],
  },
  {
    value: 'webinar_completed',
    label: 'ウェビナーを見終えた',
    note: '9割まで見たとき',
    sources: [
      ['', 'すべて'],
      ['webinar', 'ウェビナー'],
    ],
  },
  {
    value: 'webinar_cta_clicked',
    label: 'ウェビナーのボタンが押された',
    note: '案内のリンクを開いたとき',
    sources: [
      ['', 'すべて'],
      ['webinar', 'ウェビナー'],
    ],
  },
  {
    value: 'purchase_completed',
    label: '購入した',
    note: '決済が通ったとき',
    sources: [
      ['', 'すべて'],
      ['stripe', 'Stripe'],
    ],
  },
  {
    value: 'instagram_line_returned',
    label: 'Instagramから戻ってきた',
    note: 'Instagram経由でLINEに戻ったとき',
    sources: [
      ['', 'すべて'],
      ['instagram', 'Instagram'],
    ],
  },
] as const

const DAILY_CAPS = [
  ['', '制限なし'],
  ['1', '1回まで'],
  ['2', '2回まで'],
  ['3', '3回まで'],
  ['5', '5回まで'],
  ['10', '10回まで'],
]

export default function NewMileageRulePage() {
  usePageTitle('たまる決めごとをつくる')
  const { selectedAccountId } = useAccount()
  const [name, setName] = useState('予約してくれたら 300 マイル')
  const [eventType, setEventType] = useState<string>('booking_created')
  const [source, setSource] = useState('')
  const [amount, setAmount] = useState('300')
  const [initialStatus, setInitialStatus] = useState<'available' | 'pending'>('available')
  const [ignoreMultiplier, setIgnoreMultiplier] = useState(false)
  const [dailyCap, setDailyCap] = useState('')
  const [uniqueMode, setUniqueMode] = useState<'' | 'subject' | 'subjectPerDay'>('')
  const [beneficiary, setBeneficiary] = useState<'actor' | 'referrer'>('actor')
  const [validFrom, setValidFrom] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [expiresAfterDays, setExpiresAfterDays] = useState('365')
  const [reverseOnCancellation, setReverseOnCancellation] = useState(true)
  const [targetConditions, setTargetConditions] = useState<SegmentCondition | null>(null)
  const [isActive, setIsActive] = useState(true)
  const [notifyFriend, setNotifyFriend] = useState(true)
  const [tags, setTags] = useState<Tag[]>([])

  useEffect(() => {
    let cancelled = false
    void api.tags.list().then((res) => {
      if (!cancelled && res.success) setTags(res.data)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const selected = EVENT_TYPES.find((t) => t.value === eventType) ?? EVENT_TYPES[0]
  const value = Number(amount)
  const validAmount = Number.isInteger(value) && value >= 1
  const expiryDays = expiresAfterDays === '' ? null : Number(expiresAfterDays)
  const cancellationEvent = eventType === 'booking_created'
    ? 'booking_cancelled'
    : eventType === 'purchase_completed' ? 'order_cancelled' : null

  /** 倍率つきのタグ。優先度がいちばん高い1枚だけが効く。 */
  const multiplierTags = useMemo(
    () =>
      tags
        .filter((t) => t.mileageMultiplierBps != null)
        .sort((a, b) => (b.mileageMultiplierPriority ?? 0) - (a.mileageMultiplierPriority ?? 0)),
    [tags],
  )

  const sourceLabel = selected.sources.find(([v]) => v === source)?.[1] ?? 'すべて'

  return (
    <CreatePage
      title="たまる決めごとをつくる"
      description="どの行動に何マイルを付けるかを決めます。付けすぎを防ぐ回数の制限も、ここで設定します。"
      parent={['マイル', '/mileage?tab=earning-rules']}
      saveLabel="たまる決めごとを作る"
      showHeader={false}
      designNode="BmoGY"
      variant="v6"
      statusLabel="まだ動いていません。つくると、この瞬間から選んだ行動にマイルが付きはじめます。"
      validate={() => {
        if (!name.trim()) return 'ルール名を入力してください'
        if (!validAmount) return '付与マイルは1以上の整数で入力してください'
        if (!selectedAccountId) return 'LINEアカウントを選択してください'
        if (expiryDays !== null && (!Number.isInteger(expiryDays) || expiryDays < 1 || expiryDays > 3650)) {
          return '有効期限は1〜3650日で入力してください'
        }
        if (validFrom && validUntil && validFrom > validUntil) {
          return '終了日は開始日より後にしてください'
        }
        return null
      }}
      onSave={async () => {
        const res = await api.mileage.createRule({
          name: name.trim(),
          eventType,
          source: source || null,
          amount: value,
          initialStatus,
          conditions: {
            ...(dailyCap ? { dailyCapActions: Number(dailyCap) } : {}),
            ...(uniqueMode === 'subject' ? { uniquePerSubject: true } : {}),
            ...(uniqueMode === 'subjectPerDay' ? { uniquePerSubjectPerDay: true } : {}),
            ...(ignoreMultiplier ? { ignoreMultiplier: true } : {}),
            ...(beneficiary === 'referrer' ? { beneficiary: 'referrer' as const } : {}),
          },
          validFrom: validFrom || null,
          validUntil: validUntil || null,
        })
        if (!res.success) throw new Error(res.error)
        const draftResponse = await api.mileage.saveEarningRuleDraft(res.data.id, {
          accountId: selectedAccountId!,
          expectedVersion: 0,
          draft: {
            name: name.trim(),
            eventType,
            source: source || null,
            amount: value,
            initialStatus,
            validFrom: validFrom || null,
            validUntil: validUntil || null,
            expiresAfterDays: expiryDays,
            cancellationEventTypes: reverseOnCancellation && cancellationEvent ? [cancellationEvent] : [],
            targetConditions: pruneCondition(targetConditions),
            sortOrder: 0,
            notification: {
              enabled: notifyFriend,
              messageTemplate: 'ありがとうございます。{awardedMiles} マイルが付きました。現在の残高は {balance} マイルです。',
            },
          },
        })
        if (!draftResponse.success) {
          await api.mileage.updateRule(res.data.id, { isActive: false }).catch(() => undefined)
          throw new Error(draftResponse.error)
        }
        // 作成は常に動く状態で入る。止めた状態で作りたいときだけ、続けて止める。
        if (!isActive) {
          await api.mileage.updateRule(res.data.id, { isActive: false })
        }
        return res.data.id
      }}
      aside={
        <>
          <AsideCard title="この設定だとこう貯まります">
            <p className="text-ink-secondary text-xs leading-relaxed">
              {source ? `${sourceLabel}経由で` : ''}
              {selected.label}とき、
              {beneficiary === 'referrer' ? 'この人を紹介した相手に' : '行動した本人に'}{' '}
              <strong className="text-ink">{validAmount ? value : '—'}マイル</strong> を付与します。
              {dailyCap ? `1日${dailyCap}回まで。` : ''}
              {initialStatus === 'pending' ? '確定するまで使えません。' : ''}
            </p>

            {multiplierTags.length > 0 && !ignoreMultiplier && (
              <table className="mt-3 w-full text-xs">
                <thead>
                  <tr className="text-ink-faint text-left">
                    <th className="px-4 py-3 font-normal">タグ</th>
                    <th className="px-4 py-3 text-right font-normal">倍率</th>
                    <th className="px-4 py-3 text-right font-normal">付与</th>
                  </tr>
                </thead>
                <tbody className="text-ink-secondary">
                  <tr>
                    <td className="py-0.5">倍率なしの人</td>
                    <td className="py-0.5 text-right tabular-nums">1.0倍</td>
                    <td className="py-0.5 text-right tabular-nums">
                      {validAmount ? value : '—'} マイル
                    </td>
                  </tr>
                  {multiplierTags.map((t) => {
                    const rate = (t.mileageMultiplierBps ?? 10000) / 10000
                    return (
                      <tr key={t.id}>
                        <td className="py-0.5">{t.name}</td>
                        <td className="py-0.5 text-right tabular-nums">{rate.toFixed(1)}倍</td>
                        <td className="py-0.5 text-right tabular-nums">
                          {validAmount ? Math.round(value * rate) : '—'} マイル
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
            <p className="text-ink-faint mt-2 text-xs leading-relaxed">
              倍率はタグ側の設定で決まります。優先度がいちばん高いタグ1枚だけが効きます。
            </p>
          </AsideCard>

          <AsideCard title="LINEプレビュー">
            <p className="text-ink-faint text-xs">{selected.label}あと、すぐに届く想定です</p>
            <div className="mt-3 rounded-card bg-accent-soft p-3 text-sm leading-6 text-ink">
              ありがとうございます。{validAmount ? value.toLocaleString('ja-JP') : '—'} マイルが付きました。現在の残高は、配信時に自動で入ります。
            </div>
            <label className="mt-3 flex items-start gap-2 text-xs text-ink-secondary">
              <input type="checkbox" checked={notifyFriend} onChange={(event) => setNotifyFriend(event.target.checked)} />
              <span>マイルが付いたら、この内容を自動で知らせる</span>
            </label>
            <p className="mt-2 text-xs text-ink-faint">通知するかどうかと本文を、たまる決めごとの下書きへ一緒に保存します。</p>
          </AsideCard>

          <AsideCard title="詳細設定と気をつけること">
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-action">保存される内容と制限を見る</summary>
              <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-ink-faint">
                <li>・有効期限、取消時の差し引き、利用対象条件も下書きへ保存します。</li>
                <li>・付与マイルは1以上でないと保存できません。</li>
                <li>・確定待ちの確定操作は、まだ画面にありません。</li>
                <li>・複数のルールが当たると、それぞれ加算されます。</li>
                <li>・「タグが付いた」は、まだきっかけに選べません。</li>
              </ul>
            </details>
          </AsideCard>
        </>
      }
    >
      <FormSection step={1} label="どのルールか">
        <div className="grid gap-3 lg:grid-cols-3">
        <Field
          label="ルール名"
          htmlFor="sc-name"
          required
          note="一覧に表示される名前です。お客様には見えません。"
        >
          <input
            id="sc-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例：リンクをクリック"
            className={inputClass}
          />
        </Field>

        <Field label="きっかけ" htmlFor="sc-event" required note={selected.note}>
          <SelectField
            id="sc-event"
            value={eventType}
            onChange={(e) => {
              setEventType(e.target.value)
              setSource('')
            }}
            options={EVENT_TYPES.map((t) => ({ value: t.value, label: t.label }))}
            className={inputClass}
          />
        </Field>

        <Field
          label="出どころ"
          htmlFor="sc-source"
          note="同じ行動でも、経由した場所ごとに分けられます。"
        >
          <SelectField
            id="sc-source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            aria-label="行動の出どころ"
            className={inputClass}
            options={selected.sources.map(([value, label]) => ({ value, label }))}
          />
        </Field>
        </div>
      </FormSection>

      <FormSection step={2} label="何マイル付けるか">
        <div className="grid items-end gap-3 sm:grid-cols-2">
        <Field label="付与マイル" htmlFor="sc-amount" required note="1以上で入力してください。">
          <input
            id="sc-amount"
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={`${inputClass} w-32 tabular-nums`}
          />
        </Field>

        <Field label="付与のされ方">
          <div className="grid gap-2 sm:grid-cols-2">
            <ChoiceCard
              selected={initialStatus === 'available'}
              onClick={() => setInitialStatus('available')}
              title="すぐ使える"
              note="その場で残高に入ります"
            />
            <ChoiceCard
              selected={initialStatus === 'pending'}
              onClick={() => setInitialStatus('pending')}
              title="確定待ち"
              note="確定するまで使えません"
            />
          </div>
        </Field>
        </div>

        <details className="rounded-control border border-hairline px-3 py-2">
          <summary className="cursor-pointer text-xs font-semibold text-action">倍率の詳細設定</summary>
          <label className="mt-3 flex items-start gap-2 text-sm text-ink-secondary">
            <input type="checkbox" className="mt-0.5" checked={ignoreMultiplier} onChange={(e) => setIgnoreMultiplier(e.target.checked)} />
            <span>会員ランクの倍率をかけない<span className="block text-xs text-ink-faint">誰でも同じ額にしたいときに選びます。</span></span>
          </label>
        </details>
      </FormSection>

      <FormSection
        step={3}
        label="付けすぎを防ぐ"
        note="何も指定しないと、行動のたびに毎回付与されます。"
      >
        <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="1日に数える回数"
          htmlFor="sc-cap"
          note="同じ人が1日に何回まで対象になるかです。"
        >
          <SelectField
            id="sc-cap"
            value={dailyCap}
            onChange={(e) => setDailyCap(e.target.value)}
            aria-label="1日に数える回数"
            className={inputClass}
            options={DAILY_CAPS.map(([value, label]) => ({ value, label }))}
          />
        </Field>

        <Field label="同じ対象の数えかた" htmlFor="sc-unique">
          <SelectField id="sc-unique" value={uniqueMode} onChange={(e) => setUniqueMode(e.target.value as typeof uniqueMode)} options={[{ value: "", label: "何度でも数える" }, { value: "subject", label: "同じ対象は1回だけ" }, { value: "subjectPerDay", label: "同じ対象は1日1回だけ" }]} className={inputClass} />
        </Field>
        </div>
      </FormSection>

      <FormSection step={4} label="受け取る人" note="紹介した人に付ける設定もできます。">
        <div className="grid gap-2 sm:grid-cols-2">
          <ChoiceCard
            selected={beneficiary === 'actor'}
            onClick={() => setBeneficiary('actor')}
            title="行動した本人"
            note="そのまま本人の残高に入ります"
          />
          <ChoiceCard
            selected={beneficiary === 'referrer'}
            onClick={() => setBeneficiary('referrer')}
            title="紹介した人"
            note="この人を紹介した相手に入ります"
          />
        </div>

        <details className="rounded-control border border-hairline px-3 py-2">
          <summary className="cursor-pointer text-xs font-semibold text-action">
            {targetConditions ? '設定中の利用対象条件を編集' : '条件を足す（15の軸から組み合わせられます）'}
          </summary>
          <div className="mt-3">
            <Field label="だれに付けるか（条件）" note="条件を付けない場合は全員が対象です。">
              <ConditionBuilder value={targetConditions} onChange={setTargetConditions} label="利用対象の条件" />
            </Field>
          </div>
        </details>

        <details className="rounded-control border border-hairline px-3 py-2">
          <summary className="cursor-pointer text-xs font-semibold text-action">期間・失効・公開の詳細設定</summary>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <Field label="開始日・終了日" note="空欄なら期限なしです。">
              <div className="flex items-center gap-2">
                <input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} className={inputClass} aria-label="開始日" />
                <span className="text-sm text-ink-faint">〜</span>
                <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className={inputClass} aria-label="終了日" />
              </div>
            </Field>
            <Field label="付いたマイルの有効期限" htmlFor="sc-expiry" note="空欄なら期限なしです。">
              <div className="flex items-center gap-2">
                <TextInput id="sc-expiry" type="number" min={1} max={3650} value={expiresAfterDays} onChange={(e) => setExpiresAfterDays(e.target.value)} className="max-w-32 tabular-nums" />
                <span className="whitespace-nowrap text-sm text-ink-secondary">日後</span>
              </div>
            </Field>
          </div>
          {cancellationEvent ? (
            <label className="mt-3 flex items-start gap-2 text-sm text-ink-secondary">
              <input type="checkbox" checked={reverseOnCancellation} onChange={(e) => setReverseOnCancellation(e.target.checked)} className="mt-0.5" />
              <span>取り消されたら、付けたぶんを引く<span className="block text-xs text-ink-faint">{eventType === 'booking_created' ? '予約の取り消し' : '注文の取り消し'}を同じ記録から追跡します。</span></span>
            </label>
          ) : null}
          <label className="mt-3 flex items-start gap-2 text-sm text-ink-secondary">
            <input type="checkbox" className="mt-0.5" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            <span>作成したらすぐ動かす<span className="block text-xs text-ink-faint">オフにすると停止中で保存します。</span></span>
          </label>
        </details>
      </FormSection>
    </CreatePage>
  )
}
