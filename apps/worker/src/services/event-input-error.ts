import type { Context } from 'hono';
import type { Env } from '../worker-env.js';
import { inputError } from '../lib/input-errors.js';

export function bad(c: Context<Env>, code: string, status = 422, fieldKeys: readonly string[] = []): Response {
  const simpleFields = new Set(['name', 'description', 'venue_name', 'venue_address', 'venue_url', 'image_url', 'og_image_url',
    'confirmation_message_extra', 'reminder_message_extra', 'cancel_deadline_hours_before', 'reminder_hours_before',
    'max_bookings_per_friend', 'entry_cutoff_hours_before', 'sort_order', 'approval_deadline_hours', 'target_type',
    'account_ids', 'dedup_priority', 'questions', 'starts_at', 'ends_at', 'capacity', 'is_active', 'client_key']);
  const field = code.replace(/^invalid_/, '').replace(/_required$/, '');
  const special: Record<string, string[]> = { waitlist_reason_required: ['reason'], expected_version_required: ['expectedVersion'], account_id_required: ['account_id'] };
  const exact = special[code] ?? (simpleFields.has(field) ? [field] : code === 'invalid_slot_range' ? ['starts_at', 'ends_at'] : fieldKeys);
  return inputError(c, { error: code }, status as 400 | 401 | 403 | 404 | 409 | 410 | 422 | 429, exact);
}
