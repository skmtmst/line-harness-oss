import { Hono } from 'hono';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import {
  cancelMeetConsultation,
  registerMeetConsultation,
  type RegisterMeetConsultationInput,
} from '../services/meet-consultation-reminders.js';
import { canAccessAllLineAccounts, getVisibleLineAccountScope } from '../services/account-access.js';

const meetConsultations = new Hono<Env>();

meetConsultations.get('/api/meet-consultations', requireRole('owner', 'admin', 'staff'), async (c) => {
  const status = c.req.query('status') ?? 'confirmed';
  if (!['confirmed', 'cancelled', 'completed', 'all'].includes(status)) {
    return c.json({ success: false, error: 'invalid status' }, 400);
  }
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  const accountWhere = scope.allowedAccountIds.length
    ? `AND (f.line_account_id IN (${scope.allowedAccountIds.map(() => '?').join(',')})${scope.canSeeUnassigned ? ' OR f.line_account_id IS NULL' : ''})`
    : scope.canSeeUnassigned
      ? 'AND f.line_account_id IS NULL'
      : 'AND 1 = 0';
  const result = await c.env.DB
    .prepare(
      `SELECT c.id, c.external_event_id, c.friend_id, c.title, c.starts_at, c.ends_at,
              c.meet_url, c.status, c.created_at, c.updated_at,
              f.display_name,
              SUM(CASE WHEN r.status='pending' THEN 1 ELSE 0 END) AS pending_reminders,
              SUM(CASE WHEN r.status='sent' THEN 1 ELSE 0 END) AS sent_reminders,
              SUM(CASE WHEN r.status='failed' THEN 1 ELSE 0 END) AS failed_reminders
         FROM meet_consultations c
         INNER JOIN friends f ON f.id = c.friend_id
         LEFT JOIN meet_consultation_reminders r ON r.consultation_id = c.id
        WHERE (? = 'all' OR c.status = ?)
          ${accountWhere}
        GROUP BY c.id
        ORDER BY c.starts_at ASC`,
    )
    .bind(status, status, ...scope.allowedAccountIds)
    .all();
  return c.json({ success: true, data: result.results ?? [] });
});

meetConsultations.post('/api/meet-consultations', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const body = await c.req.json<RegisterMeetConsultationInput>();
    if (typeof body.friendId !== 'string' || !body.friendId.trim()) {
      return c.json({ success: false, error: 'friendId is required' }, 400);
    }
    const [friend, existing] = await Promise.all([
      c.env.DB.prepare('SELECT line_account_id FROM friends WHERE id = ?')
        .bind(body.friendId).first<{ line_account_id: string | null }>(),
      c.env.DB.prepare(
        `SELECT f.line_account_id
           FROM meet_consultations c
           JOIN friends f ON f.id = c.friend_id
          WHERE c.external_event_id = ?`,
      ).bind(body.externalEventId).first<{ line_account_id: string | null }>(),
    ]);
    if (!friend || !await canAccessAllLineAccounts(
      c.env.DB, c.get('staff'), [friend.line_account_id, existing?.line_account_id],
    )) {
      return c.json({ success: false, error: 'friend not found or not following' }, 404);
    }
    const registered = await registerMeetConsultation(c.env.DB, body);
    return c.json({ success: true, data: registered }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === 'friend not found or not following' ? 404 : 400;
    return c.json({ success: false, error: message }, status);
  }
});

meetConsultations.delete('/api/meet-consultations/:externalEventId', requireRole('owner', 'admin', 'staff'), async (c) => {
  const externalEventId = c.req.param('externalEventId');
  const consultation = await c.env.DB.prepare(
    `SELECT f.line_account_id
       FROM meet_consultations c
       JOIN friends f ON f.id = c.friend_id
      WHERE c.external_event_id = ?`,
  ).bind(externalEventId).first<{ line_account_id: string | null }>();
  if (!consultation || !await canAccessAllLineAccounts(
    c.env.DB, c.get('staff'), [consultation.line_account_id],
  )) {
    return c.json({ success: false, error: 'consultation not found' }, 404);
  }
  try {
    const cancelled = await cancelMeetConsultation(c.env.DB, externalEventId, new Date(), {
      failOnSendInFlight: true,
    });
    if (!cancelled) return c.json({ success: false, error: 'consultation not found' }, 404);
  } catch (error) {
    // 送信権の貸出中は確定させず 409 で再試行させる (取消確定後の送信を起こさない)。
    if (error instanceof Error && error.message === 'REMINDER_SEND_IN_FLIGHT') {
      return c.json({ success: false, error: 'send_in_flight_retry' }, 409);
    }
    throw error;
  }
  return c.json({ success: true, data: null });
});

export { meetConsultations };
