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
  booking_requested: `【予約リクエスト受付のお知らせ】
※まだご予約は確定しておりません。

[name]様

この度は、ご予約のリクエストをいただき誠にありがとうございます😊
現在、ご予約内容の確認と承認の手続きを行っております。

ご予約承認後に改めて確定もしくはメッセージを送信いたします。
予約の承認には通常24時間以内に完了しますが、
繁忙期などでは若干時間がかかる場合がございますのでご了承くださいませ🙇‍♀️

以下の内容でリクエストを受け付けました：

お名前: [context.reserve.create_request.full_name]
予約日時: [context.reserve.create_request.date_time_range_for_display]
コース名: [context.reserve.create_request.course.name]
料金: [context.reserve.create_request.price_for_display]

万が一、リクエストに誤りがある場合やご相談等ございましたら
こちらLINEの左下のメッセージより直接ご返信ください☺️
サロン住所はご予約確定時にご連絡を差し上げます。
それでは承認まで少々お待ちくださいませ。`,
  booking_approved: `【予約確定のお知らせ】

[name]様

この度は、ご予約ありがとうございます😊
[name]様のご予約を以下の通り確定いたしました。

予約詳細：

お名前: [context.reserve.create_approve.full_name]
予約日時: [context.reserve.create_approve.date_time_range_for_display]
コース名: [context.reserve.create_approve.course.name]
料金: [context.reserve.create_approve.price_for_display]

[context.reserve.create_approve.location_block]

【ご来店に際しての注意事項】
○15分以上遅刻された場合は施術をお断りする場合がございます。
○キャンセル料「有」
ご変更・キャンセルは【前日の12:00まで】にご連絡をお願いしております。
当日キャンセルや無断キャンセルの場合キャンセル料は100%を申し受けます。
他のお客様のご予約枠も限られておりますため、ご理解とご協力をお願いいたします。
○体調不良や感染症が疑われ得る場合は無理をせずご連絡ください。
○ノーメイクでのご来店をお勧めしております（メイク落とし有）
○ハイフは施術後1〜3週間は鈍痛が伴う施術です。
○妊娠中の方は矯正のみご案内可能。安定期に入っていること、その旨を必ずお伝えください。
○美容整形のご経験がある方は施術箇所を必ずお伝えください。
○飲酒後、飲酒予定の方はお断りさせていただく場合がございます。

【決済方法】
現金・クレジットカード・交通系電子マネー・QRコード決済　可能

何かご不明な点がございましたらこちらのLINEまでお気軽にお問い合わせくださいませ。
素敵な時間をお過ごしいただけますよう準備を進めてまいります☺️
どうぞよろしくお願い申し上げます。`,
  booking_rejected: `【ご予約のご相談】

[name]様
この度はmeautyへのご予約ありがとうございます🌼
大変申し訳ございません。
時間差予約によりご希望の日時が埋まってしまっております。
大変お手数をお掛けしますが、
この後に空き状況を送らせていただきますため
[name]様のご予定をご確認いただきまして
こちらのLINEの左下メッセージよりお返事をお願い申し上げます🙇

その他ご相談等ございましたらお気軽にお申し付けください。
それではこの後に空き状況をお送りいたします。少々お待ちくださいませ☺️`,
  change_requested: `【ご予約変更リクエスト受付のお知らせ】
※まだご予約の変更は確定しておりません。

[name]様

ご予約変更のリクエストを受け付けました😊
現在、変更後の日時・コースを確認しております。

現在のご予約：
予約日時: [context.reserve.edit_request.current.date_time_range_for_display]
コース名: [context.reserve.edit_request.current.course.name]
料金: [context.reserve.edit_request.current.price_for_display]

変更希望：
予約日時: [context.reserve.edit_request.latest.date_time_range_for_display]
コース名: [context.reserve.edit_request.latest.course.name]
料金: [context.reserve.edit_request.latest.price_for_display]

承認またはご相談のメッセージを通常24時間以内にお送りします。
承認されるまでは、現在のご予約内容が有効です。

万が一、変更内容に誤りがある場合やご相談等ございましたら、
こちらのLINEの左下メッセージより直接ご返信ください☺️
それでは確認まで少々お待ちくださいませ。`,
  change_approved: `【ご予約後変更受付】

[name]様
以下の通りご予約の変更を承りましたのでご確認くださいませ。
また、LINE上の「予約の確認」からも詳細をご確認いただけます。

[context.reserve.edit_approve.latest.date_time_range_for_display]
[context.reserve.edit_approve.latest.course.name]
[context.reserve.edit_approve.latest.price_for_display]
[context.reserve.edit_approve.confirm_url]

その他ご不明点ございましたら、
LINEの左下メッセージよりお気軽にお問い合わせください。
それでは[name]様のご来店を心よりお待ち申し上げます☺️`,
  change_rejected: `【ご予約変更のご相談】

[name]様

ご予約変更のリクエストを確認いたしましたが、
大変申し訳ございません。ご希望の変更内容ではご案内が難しい状況です。
現在のご予約は変更されず、そのまま有効となっております。

現在のご予約：
予約日時: [context.reserve.edit_reject.current.date_time_range_for_display]
コース名: [context.reserve.edit_reject.current.course.name]
料金: [context.reserve.edit_reject.current.price_for_display]

変更希望：
予約日時: [context.reserve.edit_reject.latest.date_time_range_for_display]
コース名: [context.reserve.edit_reject.latest.course.name]
料金: [context.reserve.edit_reject.latest.price_for_display]

[context.reserve.edit_reject.confirm_url]

別の日時をご希望の場合は、空き状況をご案内いたします。
お手数ですが、こちらのLINEの左下メッセージよりお気軽にご相談くださいませ🙇‍♀️`,
  cancel_requested: `【キャンセルリクエスト受付のお知らせ】
※まだキャンセルは確定しておりません。

[name]様

以下のご予約について、キャンセルリクエストを受け付けました。

予約日時: [context.reserve.cancel_request.date_time_range_for_display]
コース名: [context.reserve.cancel_request.course.name]
料金: [context.reserve.cancel_request.price_for_display]

現在、キャンセル内容の確認を行っております。
承認またはご相談のメッセージを通常24時間以内にお送りします。
承認されるまでは、ご予約は有効です。

万が一、リクエストに誤りがある場合やご相談等ございましたら、
こちらのLINEの左下メッセージより直接ご返信ください。
それでは確認まで少々お待ちくださいませ。`,
  cancel_approved: `【キャンセルのご確認】

[name]様

この度はmeautyをご予約いただきありがとうございます😊
通知に基づき以下の予約をキャンセルとさせていただきます。

キャンセルされた予約詳細：

[context.reserve.cancel_approve.date_time_range_for_display]
[context.reserve.cancel_approve.course.name]
[context.reserve.cancel_approve.price_for_display]

meautyではお客様に最高の体験を提供できるよう努めております。
この度はご予約いただき誠にありがとうございました。
[name]様とまたの機会にお会いできることを楽しみにしております☺️`,
  cancel_rejected: `【キャンセルのご相談】

[name]様

キャンセルリクエストを確認いたしましたが、
大変申し訳ございません。今回のキャンセルは承認できませんでした。
以下のご予約はキャンセルされず、そのまま有効となっております。

予約日時: [context.reserve.cancel_reject.date_time_range_for_display]
コース名: [context.reserve.cancel_reject.course.name]
料金: [context.reserve.cancel_reject.price_for_display]

[context.reserve.cancel_reject.confirm_url]

キャンセル期限やご予約内容についてご相談がございましたら、
こちらのLINEの左下メッセージより直接ご返信ください。
内容を確認のうえ、スタッフよりご案内いたします。`,
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
