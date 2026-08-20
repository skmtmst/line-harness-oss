import { Hono } from 'hono';
import {
  getReminders,
  getReminderById,
  createReminder,
  updateReminder,
  deleteReminder,
  getReminderSteps,
  createReminderStep,
  deleteReminderStep,
  enrollFriendInReminder,
  getFriendReminders,
  cancelFriendReminder,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';

const reminders = new Hono<Env>();

const TRIGGER_TYPES = ['manual', 'booking', 'event', 'friend_field'] as const;
const DELIVERY_MODES = ['time', 'countdown'] as const;
type TriggerType = (typeof TRIGGER_TYPES)[number];

/**
 * きっかけの設定を検証して取り出す。送られた項目だけを含める。
 *
 * PUT は本文をそのまま updateReminder へ渡す作りだったので、
 * 新しい項目はここで形を確かめてから渡す。
 */
function readTriggerInput(
  body: Record<string, unknown>,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const out: Record<string, unknown> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);

  if (has('triggerType')) {
    if (!TRIGGER_TYPES.includes(body.triggerType as TriggerType)) {
      return { ok: false, error: `triggerType must be one of ${TRIGGER_TYPES.join(', ')}` };
    }
    out.triggerType = body.triggerType;
  }
  if (has('triggerFieldId')) {
    const raw = body.triggerFieldId;
    if (raw === null || raw === '' || raw === undefined) {
      out.triggerFieldId = null;
    } else if (typeof raw !== 'string') {
      return { ok: false, error: 'triggerFieldId must be a string' };
    } else {
      out.triggerFieldId = raw;
    }
  }
  if (has('repeatYearly')) {
    if (typeof body.repeatYearly !== 'boolean') {
      return { ok: false, error: 'repeatYearly must be boolean' };
    }
    out.repeatYearly = body.repeatYearly;
  }
  if (has('deliveryMode')) {
    if (!DELIVERY_MODES.includes(body.deliveryMode as (typeof DELIVERY_MODES)[number])) {
      return { ok: false, error: `deliveryMode must be one of ${DELIVERY_MODES.join(', ')}` };
    }
    out.deliveryMode = body.deliveryMode;
  }
  if (has('triggerOffsetMinutes')) {
    const raw = body.triggerOffsetMinutes;
    if (raw === null || raw === '' || raw === undefined) {
      out.triggerOffsetMinutes = null;
    } else {
      const n = Number(raw);
      // 前にも後ろにもずらせるので負の値を許す。上限は前後30日。
      if (!Number.isInteger(n) || Math.abs(n) > 60 * 24 * 30) {
        return { ok: false, error: 'triggerOffsetMinutes must be an integer within +/- 43200' };
      }
      out.triggerOffsetMinutes = n;
    }
  }
  if (has('sendAtTime')) {
    const raw = body.sendAtTime;
    if (raw === null || raw === '' || raw === undefined) {
      out.sendAtTime = null;
    } else if (typeof raw !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) {
      return { ok: false, error: 'sendAtTime must be HH:MM' };
    } else {
      out.sendAtTime = raw;
    }
  }
  if (has('targetTagId')) {
    const raw = body.targetTagId;
    out.targetTagId = raw === null || raw === '' || raw === undefined ? null : String(raw);
  }
  return { ok: true, value: out };
}


// ========== リマインダCRUD ==========

reminders.get('/api/reminders', async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId');
    let items: Awaited<ReturnType<typeof getReminders>>;
    if (lineAccountId) {
      const result = await c.env.DB
        .prepare(`SELECT * FROM reminders WHERE line_account_id = ? ORDER BY created_at DESC`)
        .bind(lineAccountId)
        .all();
      items = result.results as unknown as Awaited<ReturnType<typeof getReminders>>;
    } else {
      items = await getReminders(c.env.DB);
    }
    return c.json({
      success: true,
      data: items.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        isActive: Boolean(r.is_active),
        triggerType: r.trigger_type ?? 'manual',
        deliveryMode: r.delivery_mode ?? 'countdown',
        triggerFieldId: r.trigger_field_id ?? null,
        repeatYearly: r.repeat_yearly === 1,
        triggerOffsetMinutes: r.trigger_offset_minutes ?? null,
        sendAtTime: r.send_at_time ?? null,
        targetTagId: r.target_tag_id ?? null,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/reminders error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

reminders.get('/api/reminders/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const [reminder, steps] = await Promise.all([
      getReminderById(c.env.DB, id),
      getReminderSteps(c.env.DB, id),
    ]);
    if (!reminder) return c.json({ success: false, error: 'Reminder not found' }, 404);
    return c.json({
      success: true,
      data: {
        id: reminder.id,
        name: reminder.name,
        description: reminder.description,
        isActive: Boolean(reminder.is_active),
        triggerType: reminder.trigger_type ?? 'manual',
        deliveryMode: reminder.delivery_mode ?? 'countdown',
        triggerFieldId: reminder.trigger_field_id ?? null,
        repeatYearly: reminder.repeat_yearly === 1,
        triggerOffsetMinutes: reminder.trigger_offset_minutes ?? null,
        sendAtTime: reminder.send_at_time ?? null,
        targetTagId: reminder.target_tag_id ?? null,
        createdAt: reminder.created_at,
        updatedAt: reminder.updated_at,
        steps: steps.map((s) => ({
          id: s.id,
          reminderId: s.reminder_id,
          offsetMinutes: s.offset_minutes,
          messageType: s.message_type,
          messageContent: s.message_content,
          createdAt: s.created_at,
        })),
      },
    });
  } catch (err) {
    console.error('GET /api/reminders/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

reminders.post('/api/reminders', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      description?: string;
      lineAccountId?: string | null;
    } & Record<string, unknown>>();
    if (!body.name) return c.json({ success: false, error: 'name is required' }, 400);
    const trigger = readTriggerInput(body);
    if (!trigger.ok) return c.json({ success: false, error: trigger.error }, 400);
    const item = await createReminder(c.env.DB, { ...body, ...trigger.value });
    // Save line_account_id if provided
    if (body.lineAccountId) {
      await c.env.DB.prepare(`UPDATE reminders SET line_account_id = ? WHERE id = ?`)
        .bind(body.lineAccountId, item.id).run();
    }
    return c.json({ success: true, data: { id: item.id, name: item.name, createdAt: item.created_at } }, 201);
  } catch (err) {
    console.error('POST /api/reminders error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

reminders.put('/api/reminders/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<Record<string, unknown>>();
    const trigger = readTriggerInput(body);
    if (!trigger.ok) return c.json({ success: false, error: trigger.error }, 400);
    await updateReminder(c.env.DB, id, { ...body, ...trigger.value });
    const updated = await getReminderById(c.env.DB, id);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: { id: updated.id, name: updated.name, isActive: Boolean(updated.is_active) } });
  } catch (err) {
    console.error('PUT /api/reminders/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

reminders.delete('/api/reminders/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    await deleteReminder(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/reminders/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== リマインダステップ ==========

reminders.post('/api/reminders/:id/steps', requireRole('owner', 'admin'), async (c) => {
  try {
    const reminderId = c.req.param('id');
    const body = await c.req.json<{
      offsetMinutes: number;
      messageType: string;
      messageContent: string;
      offsetDays?: number | null;
      sendAtTime?: string | null;
      templateId?: string | null;
    }>();
    if (body.offsetMinutes === undefined || !body.messageType || !body.messageContent) {
      return c.json({ success: false, error: 'offsetMinutes, messageType, messageContent are required' }, 400);
    }
    if (
      body.sendAtTime !== undefined &&
      body.sendAtTime !== null &&
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.sendAtTime)
    ) {
      return c.json({ success: false, error: 'sendAtTime must be HH:MM' }, 400);
    }
    if (
      body.offsetDays !== undefined &&
      body.offsetDays !== null &&
      (!Number.isInteger(body.offsetDays) || Math.abs(body.offsetDays) > 365)
    ) {
      return c.json({ success: false, error: 'offsetDays must be an integer within +/- 365' }, 400);
    }
    const step = await createReminderStep(c.env.DB, { reminderId, ...body });
    return c.json({
      success: true,
      data: { id: step.id, reminderId: step.reminder_id, offsetMinutes: step.offset_minutes, messageType: step.message_type, createdAt: step.created_at },
    }, 201);
  } catch (err) {
    console.error('POST /api/reminders/:id/steps error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

reminders.delete('/api/reminders/:reminderId/steps/:stepId', requireRole('owner', 'admin'), async (c) => {
  try {
    await deleteReminderStep(c.env.DB, c.req.param('stepId'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/reminders/:reminderId/steps/:stepId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 友だちリマインダ登録 ==========

reminders.post('/api/reminders/:id/enroll/:friendId', requireRole('owner', 'admin'), async (c) => {
  try {
    const reminderId = c.req.param('id');
    const friendId = c.req.param('friendId');
    const body = await c.req.json<{ targetDate: string }>();
    if (!body.targetDate) return c.json({ success: false, error: 'targetDate is required' }, 400);
    const enrollment = await enrollFriendInReminder(c.env.DB, { friendId, reminderId, targetDate: body.targetDate });
    return c.json({
      success: true,
      data: { id: enrollment.id, friendId: enrollment.friend_id, reminderId: enrollment.reminder_id, targetDate: enrollment.target_date, status: enrollment.status },
    }, 201);
  } catch (err) {
    console.error('POST /api/reminders/:id/enroll/:friendId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

reminders.get('/api/friends/:friendId/reminders', async (c) => {
  try {
    const friendId = c.req.param('friendId');
    const items = await getFriendReminders(c.env.DB, friendId);
    return c.json({
      success: true,
      data: items.map((fr) => ({
        id: fr.id,
        friendId: fr.friend_id,
        reminderId: fr.reminder_id,
        targetDate: fr.target_date,
        status: fr.status,
        createdAt: fr.created_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/friends/:friendId/reminders error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

reminders.delete('/api/friend-reminders/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    await cancelFriendReminder(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/friend-reminders/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { reminders };
