'use client'

/*
 * 1通目の下見（設計 `V6 5 kk8dz 1通目設定` の右側）。
 *
 * 設計は1枚。トーク画面と同じ並びで、**いつ届くか**を帯で出し、その下に
 * **何が届くか**を吹き出しで出す。2枚に割ると、時刻と中身を別々に見ることになり、
 * 「この文面がこの時刻に届く」という1つの絵にならない。
 *
 * 「1日後 10:00」のような書き方は、設定としては正しいが、読む側は毎回
 * 頭の中で今日の日付に足し算することになる。ここで足しておく。
 */

import { Clock } from 'lucide-react'
import styles from './step-preview.module.css'
import type { DeliveryMode } from '@line-crm/shared'
import type { ScenarioQuestion } from './question-editor'
import type { StepMessageKind } from './message-type-tabs'
import type { MessageKindState } from './message-kind-fields'

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
  /** 位置情報・動画・音声・スタンプの入力。 */
  kindState?: MessageKindState
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
  kindState,
  audienceLabel,
}: StepPreviewProps) {
  const start = nowJst()
  const at = computeDeliveryAt(start, deliveryMode, offsetDays, deliveryTime, offsetHours)
  const words = scheduleWords(deliveryMode, offsetDays, deliveryTime, offsetHours)
  const rolled = rolledToNextDay(start, at, deliveryMode, offsetDays)

  return (
    <aside
      aria-label="1通目の下見"
      className={`${styles.preview} border-hairline bg-canvas border p-4`}
    >
      <h3 className="text-ink text-sm font-bold">配信の流れ</h3>
      <p className="text-ink-faint mt-0.5 text-micro leading-relaxed">
        いま購読が始まったとして計算しています（購読開始 {formatJst(start)}）。
        実際は、その人が購読を始めた時刻が起点です。
      </p>
      <p className="text-ink-secondary mt-1.5 text-micro leading-relaxed">
        送る相手：{audienceLabel}
      </p>

      {/* トーク画面に近い形。実物と同じ見た目にはしない（別物と分かるように）。 */}
      <div className="bg-canvas-sunken rounded-card mt-3 space-y-2 p-3">
        {/* 届く日時の帯（設計 h=26 r=full 11/600 アイコン13）。 */}
        <p className="flex justify-center">
          <span className={`${styles.band} bg-accent-soft text-accent rounded-pill flex items-center gap-1 px-2.5 text-micro font-semibold`}>
            <Clock aria-hidden size={13} strokeWidth={1.75} />
            {words}・{formatJst(at)}
          </span>
        </p>

        {templateName ? (
          <Bubble>
            <span className="text-ink-faint text-micro">テンプレート</span>
            <span className="text-ink mt-0.5 block text-label font-bold">{templateName}</span>
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
              <span className="text-ink block text-label font-bold">
                {question.text.trim() || '（質問文がまだ空です）'}
              </span>
              <span className="mt-2 block space-y-1.5">
                {question.choices.map((choice, i) => (
                  <span
                    key={i}
                    className={`rounded-control block px-3 py-2 text-center text-label font-bold ${
                      i === 0
                        ? 'bg-accent-deep text-on-accent'
                        : 'border-hairline text-ink-secondary border'
                    }`}
                  >
                    {choice.label.trim() || `選択肢${i + 1}`}
                  </span>
                ))}
              </span>
            </Bubble>
          </>
        ) : kind === 'carousel' ? (
          templateName ? (
            <Bubble>
              <span className="text-ink-faint text-micro">カルーセル</span>
              <span className="text-ink mt-0.5 block text-label font-bold">{templateName}</span>
              <span className="text-ink-faint mt-1 block text-micro">
                実際の見た目は、カルーセルの編集画面で確かめられます。
              </span>
            </Bubble>
          ) : (
            <Placeholder>カルーセルを選ぶと、ここに出ます</Placeholder>
          )
        ) : kind === 'location' ? (
          kindState?.location.latitude && kindState.location.longitude ? (
            <Bubble>
              <span className="text-ink block text-label font-bold">
                {kindState.location.title.trim() || '場所'}
              </span>
              {kindState.location.address.trim() && (
                <span className="text-ink-secondary mt-0.5 block text-micro">
                  {kindState.location.address}
                </span>
              )}
              {/* 地図そのものは出さない。ここで別の地図を出すと、
                  実際にLINEで開く地図と違うものを見せることになる。 */}
              <span className="bg-canvas-sunken text-ink-faint rounded-control mt-2 block px-3 py-4 text-center text-micro">
                地図（{kindState.location.latitude}, {kindState.location.longitude}）
              </span>
            </Bubble>
          ) : (
            <Placeholder>緯度と経度を入れると、ここに出ます</Placeholder>
          )
        ) : kind === 'sticker' ? (
          kindState?.sticker.stickerId ? (
            <Bubble>
              {/* 目印なので次の最適化には載せない。 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`https://stickershop.line-scdn.net/stickershop/v1/sticker/${kindState.sticker.stickerId}/android/sticker.png`}
                alt="スタンプ"
                className="h-20 w-20"
              />
            </Bubble>
          ) : (
            <Placeholder>スタンプを選ぶと、ここに出ます</Placeholder>
          )
        ) : kind === 'video' ? (
          kindState?.video.previewImageUrl ? (
            <Bubble>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={kindState.video.previewImageUrl}
                alt="動画のサムネイル"
                className="rounded-card max-h-40 w-auto max-w-full object-contain"
              />
              <span className="text-ink-faint mt-1 block text-micro">動画</span>
            </Bubble>
          ) : (
            <Placeholder>動画とサムネイルのURLを入れると、ここに出ます</Placeholder>
          )
        ) : kind === 'audio' ? (
          kindState?.audio.originalContentUrl ? (
            <Bubble>
              <span className="text-ink block text-label">音声</span>
              <span className="text-ink-faint mt-0.5 block text-micro">
                {kindState.audio.duration ? `${kindState.audio.duration} 秒` : '長さが未設定'}
              </span>
            </Bubble>
          ) : (
            <Placeholder>音声のURLを入れると、ここに出ます</Placeholder>
          )
        ) : body.trim() ? (
          <Bubble>{body}</Bubble>
        ) : (
          <Placeholder>本文を書くと、ここに出ます</Placeholder>
        )}
      </div>

      {/*
        「当日の10:00」と書いてあるのに日付が翌日になると、設定を間違えたのかと
        疑うことになる。理由をその場に出す。
      */}
      {rolled && (
        <p className="text-warning bg-warning-bg rounded-control mt-2 px-2 py-1.5 text-micro leading-relaxed">
          いまはもう {deliveryTime} を過ぎているため、翌日になります。
          購読開始が {deliveryTime} より前なら、その日のうちに届きます。
        </p>
      )}

      {/*
        差し込みの注意書き。
        日付は届く日時が決まっているのでここで実物にできるが、名前や
        友だち情報は相手ごとに変わるので置き換えられない。混ぜて出すと
        「置き換わるもの／置き換わらないもの」が分からなくなるため、
        どちらも書いたまま出して、そのことを書く。
      */}
      {/\{\{[a-z_.+:0-9-]+\}\}/.test(body) && (
        <p className="text-ink-faint mt-2 text-micro leading-relaxed">
          差し込み（{'{{name}}'} や {'{{date}}'} など）は、送るときに実際の値へ置き換わります。
          ここでは書いたまま出しています。
        </p>
      )}

      <p className="text-ink-faint border-hairline mt-3 border-t pt-3 text-micro leading-relaxed">
        2通目からは、このあとの編集画面で足せます。足すと、ここと同じ形で届く日時が並びます。
      </p>
    </aside>
  )
}

/** 吹き出し。設計は左下だけ角を落とす（r=14,14,14,4）。 */
function Bubble({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${styles.bubble} bg-canvas border-hairline text-ink max-w-full border px-3 py-2 text-label leading-relaxed font-medium whitespace-pre-wrap`}>
      {children}
    </div>
  )
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-hairline rounded-card text-ink-faint border border-dashed px-3 py-6 text-center text-micro">
      {children}
    </p>
  )
}
