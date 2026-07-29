export type BookingCalendarView = 'week' | 'month';

export interface BookingManagementSettings {
  is_public: number;
  allow_new_booking: number;
  allow_change_request: number;
  allow_cancel_request: number;
  reception_start_mode: 'always' | 'relative' | 'fixed';
  reception_start_days_before: number | null;
  reception_start_at: string | null;
  reception_end_mode: 'until_start' | 'relative' | 'fixed';
  reception_end_minutes_before: number;
  reception_end_at: string | null;
  change_deadline_minutes_before: number;
  cancel_deadline_minutes_before: number;
  slot_interval_minutes: number;
  calendar_view: BookingCalendarView;
  calendar_connection_id: string | null;
  google_sync_enabled: number;
}

export interface BookingFormField {
  id: string;
  field_key: string;
  label: string;
  field_type: 'text' | 'tel' | 'date' | 'textarea';
  placeholder: string | null;
  is_required: number;
  is_active: number;
  sort_order: number;
  is_system: number;
}

export const DEFAULT_BOOKING_SETTINGS: BookingManagementSettings = {
  is_public: 1,
  allow_new_booking: 1,
  allow_change_request: 1,
  allow_cancel_request: 1,
  reception_start_mode: 'always',
  reception_start_days_before: null,
  reception_start_at: null,
  reception_end_mode: 'until_start',
  reception_end_minutes_before: 0,
  reception_end_at: null,
  change_deadline_minutes_before: 1440,
  cancel_deadline_minutes_before: 2880,
  slot_interval_minutes: 30,
  calendar_view: 'week',
  calendar_connection_id: null,
  google_sync_enabled: 0,
};

export const DEFAULT_BOOKING_FORM_FIELDS: Omit<BookingFormField, 'id'>[] = [
  {
    field_key: 'customer_name',
    label: 'お名前',
    field_type: 'text',
    placeholder: '例：坂本 真人',
    is_required: 1,
    is_active: 1,
    sort_order: 10,
    is_system: 1,
  },
  {
    field_key: 'customer_kana',
    label: 'フリガナ',
    field_type: 'text',
    placeholder: '例：サカモト マサト',
    is_required: 1,
    is_active: 1,
    sort_order: 20,
    is_system: 1,
  },
  {
    field_key: 'customer_phone',
    label: '電話番号',
    field_type: 'tel',
    placeholder: '例：09012345678',
    is_required: 1,
    is_active: 1,
    sort_order: 30,
    is_system: 1,
  },
  {
    field_key: 'customer_birthdate',
    label: '生年月日',
    field_type: 'date',
    placeholder: null,
    is_required: 1,
    is_active: 1,
    sort_order: 40,
    is_system: 1,
  },
];

export const DEFAULT_BOOKING_MESSAGES: Record<string, string> = {
  booking_requested:
    '予約リクエストを受け付けました。\\n\\nメニュー: {{menu_name}}\\n担当: {{staff_name}}\\n日時: {{starts_at}}\\n\\nお店からの返信をお待ちください。',
  booking_approved:
    '予約が確定しました。\\n\\nメニュー: {{menu_name}}\\n担当: {{staff_name}}\\n日時: {{starts_at}}',
  booking_rejected:
    '申し訳ありません、ご希望の枠でお取りできませんでした。\\n別の日時で再度お試しください。',
  change_requested:
    '予約変更リクエストを受け付けました。\\n\\n変更後: {{requested_starts_at}}\\n\\nお店からの返信をお待ちください。',
  change_approved:
    '予約変更が承認されました。\\n\\n変更後: {{starts_at}}',
  change_rejected:
    '予約変更リクエストは承認されませんでした。現在の予約内容に変更はありません。',
  cancel_requested:
    'キャンセルリクエストを受け付けました。\\n\\n日時: {{starts_at}}\\n\\n承認までは予約が有効です。',
  cancel_approved:
    '予約のキャンセルが承認されました。\\n\\n日時: {{starts_at}}',
  cancel_rejected:
    'キャンセルリクエストは承認されませんでした。現在の予約内容に変更はありません。',
};

export async function getBookingSettings(
  db: D1Database,
  accountId: string,
): Promise<BookingManagementSettings> {
  const row = await db
    .prepare(
      `SELECT is_public, allow_new_booking, allow_change_request, allow_cancel_request,
              reception_start_mode, reception_start_days_before, reception_start_at,
              reception_end_mode, reception_end_minutes_before, reception_end_at,
              change_deadline_minutes_before, cancel_deadline_minutes_before,
              slot_interval_minutes, calendar_view, calendar_connection_id,
              google_sync_enabled
         FROM booking_management_settings
        WHERE line_account_id = ?`,
    )
    .bind(accountId)
    .first<BookingManagementSettings>();
  return row ?? { ...DEFAULT_BOOKING_SETTINGS };
}

export async function getBookingFormFields(
  db: D1Database,
  accountId: string,
  includeInactive = false,
): Promise<BookingFormField[]> {
  const rows = await db
    .prepare(
      `SELECT id, field_key, label, field_type, placeholder,
              is_required, is_active, sort_order, is_system
         FROM booking_form_fields
        WHERE line_account_id = ? ${includeInactive ? '' : 'AND is_active = 1'}
        ORDER BY sort_order ASC, id ASC`,
    )
    .bind(accountId)
    .all<BookingFormField>();
  if (rows.results.length > 0) return rows.results;
  return DEFAULT_BOOKING_FORM_FIELDS.map((field) => ({
    ...field,
    id: `default:${field.field_key}`,
  }));
}

export async function getBookingMessage(
  db: D1Database,
  accountId: string,
  eventKey: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT message_text, is_enabled
         FROM booking_message_settings
        WHERE line_account_id = ? AND event_key = ?`,
    )
    .bind(accountId, eventKey)
    .first<{ message_text: string; is_enabled: number }>();
  if (row) return row.is_enabled === 1 ? row.message_text : null;
  return DEFAULT_BOOKING_MESSAGES[eventKey] ?? null;
}

export function isWithinReceptionWindow(
  settings: BookingManagementSettings,
  startsAt: Date,
  now = new Date(),
): boolean {
  if (settings.reception_start_mode === 'fixed' && settings.reception_start_at) {
    if (now < new Date(settings.reception_start_at)) return false;
  }
  if (
    settings.reception_start_mode === 'relative' &&
    settings.reception_start_days_before !== null
  ) {
    const opensAt = new Date(
      startsAt.getTime() - settings.reception_start_days_before * 86_400_000,
    );
    if (now < opensAt) return false;
  }
  if (settings.reception_end_mode === 'fixed' && settings.reception_end_at) {
    if (now > new Date(settings.reception_end_at)) return false;
  }
  const closesAt = new Date(
    startsAt.getTime() - Math.max(0, settings.reception_end_minutes_before) * 60_000,
  );
  return now <= closesAt;
}
