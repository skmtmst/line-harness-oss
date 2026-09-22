import type { EventDetail } from '@/lib/api'

/**
 * イベントの作成（EventWizard）と編集（EventForm）で共有する契約（#740）。
 *
 * 2画面は別体験のまま置く（タブ／段階・初回枠・OG・全面payloadの統合は対象外）。
 * ここへ寄せるのは、ずれると作成と編集で挙動が食い違うものだけ。
 * 新しい上限・検証・既定値を足すときは、両画面のどちらか片方に書かず、
 * 必ずここへ足して両方から使うこと。
 */

/** イベント名の字数上限。サーバ（EVENT_NAME_MAX=255）と同じ値。 */
export const EVENT_NAME_MAX_LENGTH = 255

/** イベント詳細の字数上限。サーバ（EVENT_DESCRIPTION_MAX=20000）と同じ値。 */
export const EVENT_DESCRIPTION_MAX_LENGTH = 20000

/**
 * 作成・編集で同じ下書きの初期値を使う（#740）。
 * 片方だけ変えると、同じ項目の初期表示が画面で食い違う。
 */
export const EVENT_DEFAULT_DRAFT: EventDetail = {
  id: '',
  name: '',
  venue_name: null,
  venue_url: null,
  image_url: null,
  description: null,
  description_centered: 0,
  max_bookings_per_friend: null,
  requires_approval: 0,
  approval_deadline_hours: 24,
  cancel_deadline_hours_before: null,
  reminder_day_before_enabled: 1,
  reminder_hours_before: null,
  is_published: 0,
  sort_order: 0,
  confirmation_message_extra: null,
  reminder_message_extra: null,
  og_title: null,
  og_description: null,
  og_image_url: null,
  visible_tag_id: null,
  waitlist_enabled: 0,
  entry_cutoff_hours_before: null,
  version: 1,
}

/**
 * 複数アカウント横断の保存対象をそろえる（#740）。
 * 現在選んでいるアカウントを必ず含め、重複を除く。単一のときは null。
 * サーバは multi に非空配列を要求する（422 invalid_account_ids）ため、
 * 空のまま送らない。編集画面の保存時と同じ振る舞い。
 */
export function resolveEventMultiAccountIds(
  draft: Pick<EventDetail, 'target_type' | 'account_ids'>,
  accountId: string,
): string[] | null {
  if ((draft.target_type ?? 'single') !== 'multi-account-dedup') return null
  const raw = draft.account_ids
  const parsed: string[] = Array.isArray(raw)
    ? raw.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : typeof raw === 'string'
      ? (() => {
        try {
          const json: unknown = JSON.parse(raw)
          return Array.isArray(json)
            ? json.filter((id): id is string => typeof id === 'string' && id.length > 0)
            : []
        } catch {
          return []
        }
      })()
      : []
  // 順番を保って重複を除き、現アカウントが無ければ先頭へ足す。
  const ids = [...new Set(parsed)]
  return ids.includes(accountId) ? ids : [accountId, ...ids]
}

/**
 * 締切・取消期限の選択肢（追加47件 EVENT-03 / EVENT-04）。
 *
 * 保存値の意味は Worker（events.ts の cancel / entry_cutoff 判定）と同じ:
 *   null = 期限を設けない（申込締切は「開始まで受ける」、取消は「不可」）
 *   0    = 開始直前まで
 *   正数 = 開始 N 時間前まで
 * 作成（ウィザード）と編集（タブ）で同じ値を同じ説明で出さないと、
 * 作成時「いつでも取消できる」と読んだ設定が編集では「不可」に見える
 * ような逆転が起きる。選択肢は必ずここから両画面へ配る。
 *
 * `value` は <select> が扱える文字列。'none' が null を表す。
 */

/** null（期限なし）を表す select の値。 */
export const EVENT_DEADLINE_NONE = 'none'

export type EventDeadlineOption = { value: string; label: string }

/** 申込の締め切り（entry_cutoff_hours_before）。null = 開始まで受け付ける。 */
export const EVENT_ENTRY_CUTOFF_OPTIONS: ReadonlyArray<EventDeadlineOption> = [
  { value: EVENT_DEADLINE_NONE, label: '開始まで受け付ける' },
  { value: '1', label: '開始の1時間前まで' },
  { value: '2', label: '開始の2時間前まで' },
  { value: '3', label: '開始の3時間前まで' },
  { value: '24', label: '開始の24時間前まで（前日）' },
  { value: '48', label: '開始の48時間前まで（2日前）' },
  { value: '168', label: '開始の168時間前まで（1週間前）' },
]

/**
 * 取消の期限（cancel_deadline_hours_before）。
 * null = 不可（Worker は 403 cancel_not_allowed）、0 = 開始直前まで可。
 */
export const EVENT_CANCEL_DEADLINE_OPTIONS: ReadonlyArray<EventDeadlineOption> = [
  { value: EVENT_DEADLINE_NONE, label: '不可（運営に LINE 連絡）' },
  { value: '0', label: '開始直前までキャンセルできる' },
  { value: '2', label: '開始の2時間前まで' },
  { value: '6', label: '開始の6時間前まで' },
  { value: '12', label: '開始の12時間前まで' },
  { value: '24', label: '開始の24時間前まで' },
  { value: '48', label: '開始の48時間前まで' },
]

/** 保存値（時間）→ select の value。null / 未設定は 'none'。 */
export function deadlineSelectValue(hours: number | null | undefined): string {
  return hours == null ? EVENT_DEADLINE_NONE : String(hours)
}

/** select の value → 保存値（時間）。'none' は null。 */
export function parseDeadlineSelect(value: string): number | null {
  return value === EVENT_DEADLINE_NONE ? null : Number(value)
}

/**
 * 選択肢に無い保存値をそのまま見せるための一覧（EVENT-04）。
 *
 * 保存値が選択肢に無いまま select の value に渡すと、ブラウザは先頭の
 * 項目を選んだように見せてしまい、「開始の2時間前まで」を保存した枠が
 * 編集では「開始まで受け付ける」に見える事故になった。保存済みの値は
 * 「保存済み：開始のN時間前まで」として数値昇順の位置へ差し込み、
 * 別の値に読み替えない（無断で変換もしない）。
 */
export function deadlineOptionsWithSaved(
  options: ReadonlyArray<EventDeadlineOption>,
  savedHours: number | null | undefined,
): EventDeadlineOption[] {
  if (savedHours == null || options.some((o) => o.value === String(savedHours))) {
    return [...options]
  }
  const saved: EventDeadlineOption = {
    value: String(savedHours),
    label: `保存済み：開始の${savedHours}時間前まで`,
  }
  const next = [...options]
  const idx = next.findIndex(
    (o) => o.value !== EVENT_DEADLINE_NONE && Number(o.value) > savedHours,
  )
  next.splice(idx === -1 ? next.length : idx, 0, saved)
  return next
}
