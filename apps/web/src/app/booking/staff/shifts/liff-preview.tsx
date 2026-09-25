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

export type LiffPreviewStatus = 'loading' | 'ready' | 'error'

/**
 * 予約設定の右パネルに出す、お客様のLINE画面のプレビュー。
 *
 * 構造・文言は `apps/liff/src/components/DateTimePicker.tsx` にそろえる:
 * 「日時を選んでください」の見出しの下に、空きのある日が縦に並び、
 * 各日の下に時刻ボタンが4列で並ぶ。カレンダー・○×休・凡例・内訳は
 * 実際の画面に無いので出さない。
 * 読み込み中・失敗の見せ方も実LIFFの共通部品（`LoadingView`・
 * `LoadErrorView`・`apps/liff/src/lib/user-message.ts` の文言）と同じにする。
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
  // LIFF と同じく、返ってきた枠を日付ごとにまとめて空きのある日だけ出す。
  const byDate = new Map<string, string[]>()
  for (const slot of slots) {
    const times = byDate.get(slot.date) ?? []
    times.push(slot.start)
    byDate.set(slot.date, times)
  }
  const dates = [...byDate.keys()].sort()

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
              <p className="text-ink-secondary text-sm leading-6">読み込めませんでした。時間をおいて、もう一度お試しください。</p>
              {/* 実LIFFの LoadErrorView と同じ「もう一度読み込む」ボタンの見え方。
                  「← 戻る」と同じく、押せない見本なのでボタン要素ではなく
                  見た目だけ再現する（直書きボタンの負債も増やさない）。 */}
              <p className="border-hairline text-ink mt-4 w-full rounded-lg py-3 text-center text-sm font-semibold">
                もう一度読み込む
              </p>
            </div>
          ) : dates.length === 0 ? (
            <p className="text-ink-faint mt-4 text-sm">この期間に空きはありません。</p>
          ) : (
            <div className="space-y-4">
              {dates.map((date) => (
                <section key={date}>
                  <h4 className="text-ink mb-2 text-sm font-semibold">{formatLiffDate(date)}</h4>
                  <div className="grid grid-cols-4 gap-2">
                    {(byDate.get(date) ?? []).map((time) => (
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
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
