


/** 日時を変える窓で、今日から何日先までの空きを出すか（空きの口は28日までまとめて読める）。 */
export const CHANGE_RANGE_DAYS = 14;

/** 窓に並べる空きの数の上限（多すぎると選べない）。 */
export const CHANGE_SLOT_LIMIT = 24;


export type ChangeSlot = { date: string; start: string; startUtc?: string };


/** 取消の失敗を、お客さまが次に何をすればよいかの1文にする。 */
export function cancelFailureMessage(code: string | undefined): string {
  switch (code) {
    case 'cancellation_fee_confirmation_required': return 'キャンセル料の確認が必要です。トークで担当者へご連絡ください。';
    case 'self_deadline_passed': return 'キャンセルの期限を過ぎています。トークでご連絡ください。';
    case 'version_conflict':
    case 'not_editable':
    case 'booking_not_found': return '予約の内容が変わっていました。一覧を読み直しました。';
    case 'send_in_flight_retry': return 'お知らせを送っている途中でした。少し待ってから、もう一度お試しください。';
    default: return 'キャンセルできませんでした。電波のよいところで、もう一度お試しください。';
  }
}


/** 日時変更の失敗の1文。 */
export function changeFailureMessage(code: string | undefined): string {
  switch (code) {
    case 'slot_not_available':
    case 'slot_conflict': return '選んだ日時は埋まりました。別の日時を選んでください。';
    case 'self_deadline_passed': return '変更の期限を過ぎています。トークでご連絡ください。';
    case 'past_cutoff':
    case 'past_datetime':
    case 'invalid_starts_at': return '選んだ日時は受付を終えています。別の日時を選んでください。';
    case 'version_conflict':
    case 'not_editable':
    case 'booking_not_found': return '予約の内容が変わっていました。一覧を読み直してから、もう一度お試しください。';
    case 'send_in_flight_retry': return 'お知らせを送っている途中でした。少し待ってから、もう一度お試しください。';
    default: return '日時を変えられませんでした。電波のよいところで、もう一度お試しください。';
  }
}


export function errorCode(err: unknown): string | undefined {
  const body = (err as { body?: { error?: unknown } } | null)?.body;
  return typeof body?.error === 'string' ? body.error : undefined;
}
