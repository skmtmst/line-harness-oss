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
