import type { BookingAvailabilitySlot } from '@/lib/api'

const WEEKDAY_JP = '日月火水木金土'

/**
 * `apps/liff/src/lib/datetime.ts` の formatJp と同じ形（`M/D(曜)`）。
 * プレビューの日付見出しをお客様の画面と同じ表記にそろえる。
 */
export function formatLiffDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEKDAY_JP[d.getUTCDay()]})`
}

/**
 * `apps/liff/src/lib/datetime.ts` の formatMd と同じ形（`M/D`）。
 * 日付の札の中の下段に使う。
 */
function formatLiffMonthDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
}

/**
 * `apps/liff/src/lib/datetime.ts` の formatWeekday と同じ形（`曜`1文字）。
 * 日付の札の中の上段に使う。
 */
function formatLiffWeekday(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  return WEEKDAY_JP[d.getUTCDay()]
}

/** `YYYY-MM-DD` に n 日足す（実LIFFの addDays と同じ計算）。 */
function addDaysStr(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export type LiffPreviewStatus = 'loading' | 'ready' | 'error'

/**
 * 予約設定の右パネルに出す、お客様のLINE画面のプレビュー。
 *
 * 構造・文言は `apps/liff/src/components/DateTimePicker.tsx`（★V7）にそろえる:
 * 「日時を選んでください」の見出しの下に、日付の札が横に並び
 * （枠の無い日は「満席」で押せない）、選んだ日の時刻ボタンが3列で並ぶ。
 * カレンダー・○×休・凡例・内訳は実際の画面に無いので出さない。
 * 読み込み中・失敗の見せ方も実LIFFの共通部品（`LoadingView`・
 * `LoadErrorView`・`apps/liff/src/lib/user-message.ts` の文言）と同じにする。
 * 失敗は題「読み込めませんでした」＋本文 LOAD_FAILED_MESSAGE
 * （「電波の良いところで、もう一度お試しください。」）＋「もう一度読み込む」。
 *
 * お客様はメニュー→担当→日時の順に進むため、ここでは先頭の有効メニューの
 * `by_staff[0]`（担当一覧の先頭と同じ並び）の空き枠をそのまま表示し、
 * どのメニュー・担当の画面かを枠の上に注記する。
 */
export default function LiffDateTimePreview({
  status,
  slots,
  menuName,
  staffName,
}: {
  status: LiffPreviewStatus
  slots: BookingAvailabilitySlot[]
  menuName: string | null
  staffName: string | null
}) {
  // LIFF と同じく、返ってきた枠を日付ごとにまとめる。
  const byDate = new Map<string, string[]>()
  for (const slot of slots) {
    const times = byDate.get(slot.date) ?? []
    times.push(slot.start)
    byDate.set(slot.date, times)
  }
  const available = [...byDate.keys()].sort()
  // 実LIFFは今日から14日ぶんの札を横に並べ、枠の無い日は「満席」で押せない。
  // プレビューは渡された枠の最初〜最後の日で札を作り、枠の無い日は同じく
  // 「満席」にする（置いている期間の取り方は違うが、札の並び方は同じ）。
  const days: string[] = []
  if (available.length > 0) {
    for (let d = available[0]; d <= available[available.length - 1]; d = addDaysStr(d, 1)) {
      days.push(d)
    }
  }
  // 実LIFFと同じく、空きのある先頭の日を選んだ状態で出す。
  const selectedDay = available[0] ?? null
  const selectedTimes = selectedDay ? (byDate.get(selectedDay) ?? []) : []

  const caption = !menuName
    ? '受付中のメニューが無いため、お客様の画面にも空き枠は出ません。'
    : staffName
      ? `「${menuName}」で担当「${staffName}」を選んだときの日時選択画面です。`
      : `「${menuName}」を担当できるスタッフがいないため、空き枠は出ません。`

  return (
    <>
      <h2 className="text-ink-secondary text-sm font-semibold">お客様のLINEではこう見えます</h2>
      <p className="text-ink-faint mt-1 text-xs">{caption}</p>
      <div className="bg-info mt-3 rounded-card p-3">
        <div className="bg-canvas rounded-control space-y-3 p-4">
          <p className="text-ink-faint text-xs">← 戻る</p>
          <h3 className="text-ink text-lg font-bold">日時を選んでください</h3>
          <p className="text-ink-faint text-xs">確認画面で要望を入力してください</p>
          {status === 'loading' ? (
            <p className="text-ink-faint text-sm" role="status">読み込み中...</p>
          ) : status === 'error' ? (
            <div className="mx-auto max-w-md p-8 text-center">
              {/* 実LIFFの LoadErrorView と同じ題＋本文。題と重ねないため
                  本文は LOAD_FAILED_MESSAGE（`apps/liff/src/lib/user-message.ts`）
                  の「電波の良いところで、もう一度お試しください。」だけにする。 */}
              <p className="text-ink text-base font-bold">読み込めませんでした</p>
              <p className="text-ink-secondary mt-2 text-sm leading-6">電波の良いところで、もう一度お試しください。</p>
              {/* 実LIFFの LoadErrorView と同じ「もう一度読み込む」ボタンの見え方。
                  「← 戻る」と同じく、押せない見本なのでボタン要素ではなく
                  見た目だけ再現する（直書きボタンの負債も増やさない）。 */}
              <p className="border-hairline text-ink mt-4 w-full rounded-lg py-3 text-center text-sm font-semibold">
                もう一度読み込む
              </p>
            </div>
          ) : available.length === 0 ? (
            <p className="text-ink-faint mt-4 text-sm">この期間に空きはありません。</p>
          ) : (
            <div className="space-y-4">
              {/* 実LIFFと同じ日付の札の横並び。枠の無い日は「満席」で押せない。 */}
              <div className="-mx-4 overflow-x-auto px-4" role="group" aria-label="日付">
                <div className="flex gap-2 pb-1">
                  {days.map((date) => {
                    const open = (byDate.get(date)?.length ?? 0) > 0
                    const active = date === selectedDay
                    return (
                      <button
                        key={date}
                        type="button"
                        disabled={!open}
                        aria-pressed={active}
                        className={`flex min-h-16 w-15 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border px-1 py-2 ${
                          active
                            ? 'border-accent-deep bg-accent-deep text-white'
                            : open
                              ? 'border-hairline bg-canvas text-ink'
                              : 'border-hairline bg-canvas text-ink-faint'
                        }`}
                      >
                        <span className="text-xs">{formatLiffWeekday(date)}</span>
                        <span className="text-sm font-bold whitespace-nowrap">{formatLiffMonthDay(date)}</span>
                        {!open && <span className="text-[11px]">満席</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
              {selectedDay && (
                <section aria-label={`${formatLiffDate(selectedDay)}の空き`}>
                  <h3 className="text-ink mb-2 text-sm font-bold">{formatLiffDate(selectedDay)} の空き</h3>
                  <div className="grid grid-cols-3 gap-2">
                    {selectedTimes.map((time) => (
                      // 管理画面の操作ボタンではなく、お客様のLINE画面に出る
                      // 時刻ボタンの再現なので、共通Buttonではなく直書きにする
                      // （実LIFF: border rounded py-2 text-sm）。
                      <button
                        key={time}
                        type="button"
                        className="border-hairline rounded py-2 text-sm"
                      >
                        {time}
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
