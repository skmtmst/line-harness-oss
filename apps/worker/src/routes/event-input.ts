import { EVENT_NAME_MAX, EVENT_DESCRIPTION_MAX, EVENT_APPROVAL_DEADLINE_HOURS } from '../services/event-booking-types.js';

// ----------------------------------------------------------------
// 申込時のカスタム質問 (#841)
// events.questions_json に定義、event_bookings.answer_snapshot_json に
// {質問id: 回答} として保存する。id が変わると過去の回答と紐付かなくなるので、
// 画面が送ってきた id はそのまま採用し、無い分だけ連番で補う。
// ----------------------------------------------------------------

export const EVENT_QUESTION_TYPES = new Set(['text', 'textarea', 'radio', 'checkbox']);

export const EVENT_QUESTIONS_MAX = 10;

export const EVENT_QUESTION_LABEL_MAX = 100;

export const EVENT_QUESTION_OPTIONS_MAX = 20;

export const EVENT_QUESTION_OPTION_MAX = 100;

export interface EventQuestion {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'radio' | 'checkbox';
  required: boolean;
  options: string[] | null;
}

export function normalizeEventQuestions(
  value: unknown,
): { ok: true; questions: EventQuestion[] } | { ok: false; code: string } {
  if (value == null) return { ok: true, questions: [] };
  if (!Array.isArray(value) || value.length > EVENT_QUESTIONS_MAX) {
    return { ok: false, code: 'invalid_questions' };
  }
  const used = new Set<string>();
  const out: EventQuestion[] = [];
  for (const [i, raw] of value.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, code: 'invalid_questions' };
    }
    const q = raw as Record<string, unknown>;
    const label = typeof q.label === 'string' ? q.label.trim() : '';
    if (!label || label.length > EVENT_QUESTION_LABEL_MAX) {
      return { ok: false, code: 'invalid_questions' };
    }
    const type = String(q.type ?? '');
    if (!EVENT_QUESTION_TYPES.has(type)) {
      return { ok: false, code: 'invalid_questions' };
    }
    let options: string[] | null = null;
    if (type === 'radio' || type === 'checkbox') {
      if (!Array.isArray(q.options) || q.options.length === 0
          || q.options.length > EVENT_QUESTION_OPTIONS_MAX
          || !q.options.every((o) => typeof o === 'string' && o.trim().length > 0 && o.length <= EVENT_QUESTION_OPTION_MAX)) {
        return { ok: false, code: 'invalid_questions' };
      }
      options = (q.options as string[]).map((o) => o.trim());
    }
    const id = typeof q.id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(q.id)
      ? q.id
      : `q${i + 1}`;
    if (used.has(id)) return { ok: false, code: 'invalid_questions' };
    used.add(id);
    out.push({ id, label, type: type as EventQuestion['type'], required: q.required === true, options });
  }
  return { ok: true, questions: out };
}

export function validateEventInput(
  body: Record<string, unknown>,
  isCreate: boolean,
): { ok: true } | { ok: false; code: string } {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  if (isCreate || has('name')) {
    const name = body.name;
    // 空白だけの名前は通さない(点検#520軽14)。画面はtrim検査済みだがAPIは未検査だった。
    if (typeof name !== 'string' || name.trim().length === 0 || name.length > EVENT_NAME_MAX) {
      return { ok: false, code: 'invalid_name' };
    }
  }
  if (has('description') && body.description != null) {
    const d = body.description;
    if (typeof d !== 'string' || d.length > EVENT_DESCRIPTION_MAX) {
      return { ok: false, code: 'invalid_description' };
    }
  }
  if (has('venue_name') && body.venue_name != null && (typeof body.venue_name !== 'string' || body.venue_name.length > 255)) return { ok: false, code: 'invalid_venue_name' };
  if (has('venue_address') && body.venue_address != null && (typeof body.venue_address !== 'string' || body.venue_address.length > 1000)) return { ok: false, code: 'invalid_venue_address' };
  // LIFF側はURLをそのまま出している。空は許すが、中身があるときは
  // http(s)だけにする。javascript: などが保存されると友だち側で
  // 想定外の動きになる。LIFF側の表示がわりは別票の範囲。
  for (const key of ['venue_url', 'image_url', 'og_image_url'] as const) {
    if (has(key) && body[key] != null && body[key] !== '') {
      const v = body[key];
      if (typeof v !== 'string' || !/^https?:\/\//i.test(v)) {
        return { ok: false, code: `invalid_${key}` };
      }
    }
  }
  for (const key of ['confirmation_message_extra', 'reminder_message_extra'] as const) {
    if (has(key) && body[key] != null) {
      const v = body[key];
      if (typeof v !== 'string' || v.length > 2000) {
        return { ok: false, code: `invalid_${key}` };
      }
    }
  }
  for (const key of [
    'cancel_deadline_hours_before',
    'reminder_hours_before',
    'max_bookings_per_friend',
    'entry_cutoff_hours_before',
  ] as const) {
    if (has(key) && body[key] != null) {
      const v = body[key];
      if (!Number.isInteger(v) || (v as number) < 0) {
        return { ok: false, code: `invalid_${key}` };
      }
    }
  }
  // waitlist_enabled は画面が `=== 1` で読むので2等を保存させない(点検#520軽14)。
  for (const key of ['description_centered', 'requires_approval', 'reminder_day_before_enabled', 'is_published', 'waitlist_enabled'] as const) {
    if (has(key) && body[key] != null) {
      const v = body[key];
      if (v !== 0 && v !== 1) return { ok: false, code: `invalid_${key}` };
    }
  }
  if (has('sort_order') && body.sort_order != null) {
    if (!Number.isInteger(body.sort_order) || (body.sort_order as number) < 0) {
      return { ok: false, code: 'invalid_sort_order' };
    }
  }
  if (has('approval_deadline_hours')) {
    const hours = body.approval_deadline_hours;
    if (!EVENT_APPROVAL_DEADLINE_HOURS.includes(hours as 2 | 24 | 72)) {
      return { ok: false, code: 'invalid_approval_deadline_hours' };
    }
  }
  if (has('target_type') && body.target_type != null) {
    if (body.target_type !== 'single' && body.target_type !== 'multi-account-dedup') {
      return { ok: false, code: 'invalid_target_type' };
    }
  }
  if (body.target_type === 'multi-account-dedup') {
    const ids = body.account_ids;
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((x) => typeof x === 'string' && x.length > 0)) {
      return { ok: false, code: 'invalid_account_ids' };
    }
    if (body.dedup_priority != null) {
      if (!Array.isArray(body.dedup_priority) || !body.dedup_priority.every((x) => typeof x === 'string')) {
        return { ok: false, code: 'invalid_dedup_priority' };
      }
      const idSet = new Set(ids as string[]);
      if (!(body.dedup_priority as string[]).every((x) => idSet.has(x))) {
        return { ok: false, code: 'dedup_priority_not_subset' };
      }
    }
  }
  if (has('questions') && body.questions != null) {
    const q = normalizeEventQuestions(body.questions);
    if (!q.ok) return { ok: false, code: q.code };
  }
  return { ok: true };
}
