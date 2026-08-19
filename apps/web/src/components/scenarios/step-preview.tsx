'use client'

/*
 * 1通目のプレビュー。
 *
 * 出すのは2つ。
 *   1. **いつ届くか**を具体的な日時で（「1日後の10:00」だけでは、いつなのか
 *      すぐに分からない。購読開始を今とみなして実際の日時に直す）
 *   2. **何が届くか**をトーク画面に近い形で
 *
 * 「1日後 10:00」のような書き方は、設定としては正しいが、読む側は毎回
 * 頭の中で今日の日付に足し算することになる。ここで足しておく。
 */

import type { DeliveryMode } from '@line-crm/shared'
import type { ScenarioQuestion } from './question-editor'
import type { StepMessageKind } from './message-type-tabs'

export interface StepPreviewProps {
  deliveryMode: DeliveryMode
  offsetDays: number
  /** absolute_time のときの配信時刻 "HH:MM"。 */
  deliveryTime: string
  /** elapsed / relative のときの「〜時間後」。 */
  offsetHours: number
  kind: StepMessageKind
  /** テンプレートを選んでいるときは、その名前。 */
  templateName?: string | null
  body: string
  imageUrl?: string | null
  question: ScenarioQuestion | null
  /** 誰に送るか。札に出す。 */
  audienceLabel: string
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

/** 日本時間で見た「いま」。端末が海外時刻でも、配信はJSTで動く。 */
function nowJst(): Date {
  const now = new Date()
  return new Date(now.getTime() + (now.getTimezoneOffset() + 9 * 60) * 60_000)
}

function formatJst(date: Date): string {
  const m = date.getMonth() + 1
  const d = date.getDate()
  const w = WEEKDAYS[date.getDay()]
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${m}月${d}日(${w}) ${hh}:${mm}`
}

/**
 * 届く日時を出す。配信方式ごとに数え方が違う。
 *
 *   時刻で指定 … 購読開始の日から N日後の、決めた時刻
 *   経過時間   … 購読開始から N日と M時間後
 *
 * 時刻で指定は、**その日の配信時刻をもう過ぎていれば翌日**になる
 * （worker の computeNextDeliveryAt と同じ扱い）。0日後を選んだのに
 * 過去の時刻を出すと、実際の配信とずれて見える。
 */
export function computeDeliveryAt(
  start: Date,
  mode: DeliveryMode,
  offsetDays: number,
  deliveryTime: string,
  offsetHours: number,
): Date {
  const at = new Date(start.getTime())
  if (mode === 'absolute_time') {
    const [h, m] = deliveryTime.split(':').map((n) => Number(n) || 0)
    at.setDate(at.getDate() + offsetDays)
    at.setHours(h, m, 0, 0)
    if (at.getTime() < start.getTime()) at.setDate(at.getDate() + 1)
    return at
  }
  at.setDate(at.getDate() + offsetDays)
  at.setHours(at.getHours() + offsetHours)
  return at
}

function scheduleWords(
  mode: DeliveryMode,
  offsetDays: number,
  deliveryTime: string,
  offsetHours: number,
): string {
  if (mode === 'absolute_time') {
    return offsetDays === 0 ? `当日の ${deliveryTime}` : `${offsetDays}日後の ${deliveryTime}`
  }
  const parts: string[] = []
  if (offsetDays > 0) parts.push(`${offsetDays}日`)
  if (offsetHours > 0) parts.push(`${offsetHours}時間`)
  return parts.length === 0 ? 'すぐに' : `${parts.join('と')}後`
}

/**
 * その日の配信時刻を過ぎていて、翌日送りになったか。
 *
 * 「当日の10:00」と書いてあるのに日付が翌日になると、設定を間違えたのかと
 * 疑うことになる。理由をその場に出す。
 */
function rolledToNextDay(
  start: Date,
  at: Date,
  mode: DeliveryMode,
  offsetDays: number,
): boolean {
  if (mode !== 'absolute_time') return false
  const expected = new Date(start.getTime())
  expected.setDate(expected.getDate() + offsetDays)
  return at.getDate() !== expected.getDate() || at.getMonth() !== expected.getMonth()
}

export default function StepPreview({
  deliveryMode,
  offsetDays,
  deliveryTime,
  offsetHours,
  kind,
  templateName,
  body,
  imageUrl,
  question,
  audienceLabel,
}: StepPreviewProps) {
  const start = nowJst()
  const at = computeDeliveryAt(start, deliveryMode, offsetDays, deliveryTime, offsetHours)
  const words = scheduleWords(deliveryMode, offsetDays, deliveryTime, offsetHours)
  const rolled = rolledToNextDay(start, at, deliveryMode, offsetDays)

  return (
    <aside className="space-y-3" aria-label="プレビュー">
      <div className="bg-canvas rounded-card border-hairline border p-4">
        <h3 className="text-ink text-sm font-bold">いつ届くか</h3>
        <p className="text-ink-faint mt-0.5 text-xs leading-relaxed">
          いま購読が始まったとして計算しています。実際は、その人が購読を始めた時刻が起点です。
        </p>

        {/* 購読開始 → 1通目 の並び。時刻を縦に並べると、間隔が目で分かる。 */}
        <ol className="mt-3 space-y-0">
          <li className="flex gap-3">
            <span className="flex flex-col items-center">
              <span className="border-hairline mt-1.5 h-2.5 w-2.5 shrink-0 rounded-pill border-2" />
              <span className="border-hairline min-h-8 w-px flex-1 border-l" />
            </span>
            <span className="min-w-0 pb-3">
              <span className="text-ink-secondary block text-xs">購読開始</span>
              <span className="text-ink-faint block text-xs">{formatJst(start)}</span>
            </span>
          </li>
          <li className="flex gap-3">
            <span className="bg-accent mt-1.5 h-2.5 w-2.5 shrink-0 rounded-pill" />
            <span className="min-w-0">
              <span className="text-ink-secondary block text-xs">1通目（{words}）</span>
              <span className="text-ink block text-sm font-bold">{formatJst(at)}</span>
              {rolled && (
                <span className="text-warning bg-warning-bg rounded-control mt-1.5 block px-2 py-1 text-xs leading-relaxed">
                  いまはもう {deliveryTime} を過ぎているため、翌日になります。
                  購読開始が {deliveryTime} より前なら、その日のうちに届きます。
                </span>
              )}
            </span>
          </li>
        </ol>

        <p className="text-ink-faint border-hairline mt-3 border-t pt-3 text-xs leading-relaxed">
          2通目からは、このあとの編集画面で足せます。足すと、ここと同じ形で届く日時が並びます。
        </p>
      </div>

      <div className="bg-canvas rounded-card border-hairline border p-4">
        <h3 className="text-ink text-sm font-bold">何が届くか</h3>
        <p className="text-ink-faint mt-0.5 text-xs">送る相手：{audienceLabel}</p>

        {/* トーク画面に近い形。実物と同じ見た目にはしない（別物と分かるように）。 */}
        <div className="bg-canvas-sunken rounded-card mt-3 space-y-2 p-3">
          {templateName ? (
            <Bubble>
              <span className="text-ink-faint text-xs">テンプレート</span>
              <span className="text-ink mt-0.5 block text-sm font-bold">{templateName}</span>
            </Bubble>
          ) : kind === 'image' ? (
            imageUrl ? (
              // 中身が何かを見せるだけなので、次の最適化には載せない。
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl}
                alt="送る画像"
                className="rounded-card max-h-48 w-auto max-w-full object-contain"
              />
            ) : (
              <Placeholder>画像を選ぶと、ここに出ます</Placeholder>
            )
          ) : kind === 'question' && question ? (
            <>
              {question.intro?.trim() ? <Bubble>{question.intro}</Bubble> : null}
              <Bubble>
                <span className="text-ink block text-sm font-bold">
                  {question.text.trim() || '（質問文がまだ空です）'}
                </span>
                <span className="mt-2 block space-y-1.5">
                  {question.choices.map((choice, i) => (
                    <span
                      key={i}
                      className={`rounded-control block px-3 py-2 text-center text-sm font-bold ${
                        i === 0
                          ? 'bg-accent text-on-accent'
                          : 'border-hairline text-ink-secondary border'
                      }`}
                    >
                      {choice.label.trim() || `選択肢${i + 1}`}
                    </span>
                  ))}
                </span>
              </Bubble>
            </>
          ) : body.trim() ? (
            <Bubble>{body}</Bubble>
          ) : (
            <Placeholder>本文を書くと、ここに出ます</Placeholder>
          )}
        </div>

        {/* 差し込みは、この画面では実際の値に置き換えられない。誤解を避ける。 */}
        {/\{\{[a-z_.]+\}\}/.test(body) && (
          <p className="text-ink-faint mt-2 text-xs leading-relaxed">
            {'{{name}}'} などの差し込みは、送るときに一人ひとりの値に置き換わります。ここでは書いたまま出しています。
          </p>
        )}
      </div>
    </aside>
  )
}

function Bubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-canvas rounded-card border-hairline max-w-full border px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap text-ink">
      {children}
    </div>
  )
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-hairline rounded-card text-ink-faint border border-dashed px-3 py-6 text-center text-xs">
      {children}
    </p>
  )
}
