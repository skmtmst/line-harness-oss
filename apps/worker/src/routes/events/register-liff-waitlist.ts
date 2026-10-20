import { logger } from '@line-crm/shared/server';
import type { Env } from '../../worker-env.js';
import type { Hono } from 'hono';
import { bad } from '../../services/event-input-error.js';
import { inputJsonBoundary } from '../../lib/input-errors.js';
import { enrollByTrigger } from '../../services/reminder-trigger.js';
import { verifyCallerLineUserId } from '../../services/liff-auth.js';
import { computeRemindersForBooking, insertRemindersForBooking } from '../../services/event-booking-reminders.js';
import { sendEventBookingNotification } from '../../services/event-booking-notifier.js';
import { awardActivityMileage } from '../../services/activity-mileage.js';
import { dispatchAutomationEventWithLogging } from '../../features/automations/automation-triggers/index.js';
import { applyActionScoreEvent } from '../../services/action-score-events.js';
import { resolveLineCredential } from '@line-crm/db';
import { acceptEventWaitlistOffer, getEventWaitlistOffer, getEventWaitlistOfferAccountId } from '../../services/event-waitlist.js';
import { optionalExecutionCtx } from './input.js';
import { startsAtJst } from './time-input.js';

export function registerLiffWaitlist(events: Hono<Env>): void {
events.get('/api/liff/events/waitlist/:token', async (c) => {
  const callerLineUserId = await verifyCallerLineUserId(c.req.header('Authorization'), c.env);
  if (!callerLineUserId) return bad(c, 'unauthorized', 401);
  const offerAccountId = await getEventWaitlistOfferAccountId(c.env.DB, c.req.param('token'));
  if (!offerAccountId) return bad(c, 'waitlist_offer_not_found', 404);
  if (!await verifyCallerLineUserId(c.req.header('Authorization'), c.env, offerAccountId)) return bad(c, 'unauthorized', 401);
  const data = await getEventWaitlistOffer(c.env.DB, { token: c.req.param('token'), callerLineUserId });
  if (!data) return bad(c, 'waitlist_offer_not_found', 404);
  return c.json({ success: true, data });
});

events.post('/api/liff/events/waitlist/:token/accept', inputJsonBoundary(), async (c) => {
  const callerLineUserId = await verifyCallerLineUserId(c.req.header('Authorization'), c.env);
  if (!callerLineUserId) return bad(c, 'unauthorized', 401);
  const offerAccountId = await getEventWaitlistOfferAccountId(c.env.DB, c.req.param('token'));
  if (!offerAccountId) return bad(c, 'waitlist_offer_not_found', 404);
  if (!await verifyCallerLineUserId(c.req.header('Authorization'), c.env, offerAccountId)) return bad(c, 'unauthorized', 401);
  const result = await acceptEventWaitlistOffer(c.env.DB, {
    token: c.req.param('token'),
    callerLineUserId,
  });
  if (result.kind === 'not_found') return bad(c, 'waitlist_offer_not_found', 404);
  if (result.kind === 'expired') return bad(c, 'waitlist_offer_expired', 410);
  if (result.kind === 'unavailable') return bad(c, 'waitlist_offer_unavailable', 409);

  // DB上の予約確定が先。以降の派生処理が失敗しても、承諾そのものを失敗へ戻さない。
  const reminders = computeRemindersForBooking({
    starts_at_utc: result.startsAt,
    reminder_day_before_enabled: result.reminderDayBeforeEnabled,
    reminder_hours_before: result.reminderHoursBefore,
  });
  await insertRemindersForBooking(c.env.DB, result.bookingId, reminders)
    .catch((error) => logger.error("routes_events_failed"));
  await enrollByTrigger(c.env.DB, {
    triggerType: 'event',
    friendId: result.friendId,
    startsAtIso: result.startsAt,
    sourceId: result.bookingId,
    sourceEventId: result.bookingId,
    eventId: result.eventId,
    lineAccountId: result.lineAccountId,
  }).catch((error) => logger.error("routes_events_failed"));
  await awardActivityMileage(c.env.DB, {
    eventType: 'booking_created',
    source: 'event_booking',
    sourceEventId: result.bookingId,
    friendId: result.friendId,
    metadata: {
      bookingType: 'event', bookingId: result.bookingId,
      eventId: result.eventId, slotId: result.occurrenceId,
    },
    occurredAt: new Date().toISOString(),
  }).catch((error) => logger.error("routes_events_failed"));
  await applyActionScoreEvent(c.env.DB, {
    lineAccountId: result.lineAccountId,
    friendId: result.friendId,
    eventType: 'booking_created',
    source: 'event_booking',
    sourceEventId: result.bookingId,
    subjectKey: result.eventId,
    occurredAt: new Date().toISOString(),
  }).catch((error) => logger.error("routes_events_failed"));

  if (result.newlyConverted) {
    const automation = dispatchAutomationEventWithLogging(c.env.DB, {
      lineAccountId: result.lineAccountId,
      eventType: 'calendar_booked',
      sourceEventId: result.bookingId,
      friendId: result.friendId,
      eventData: {
        bookingType: 'event', bookingId: result.bookingId,
        eventId: result.eventId, slotId: result.occurrenceId,
      },
    }).catch((error) => logger.error("routes_events_failed"));
    const executionCtx = optionalExecutionCtx(c);
    if (executionCtx) executionCtx.waitUntil(automation);
    else await automation;

    try {
      const account = await c.env.DB.prepare(
        `SELECT channel_access_token, channel_access_token_encrypted
           FROM line_accounts WHERE id = ?`,
      ).bind(result.lineAccountId).first<{
        channel_access_token: string;
        channel_access_token_encrypted: string | null;
      }>();
      if (account && (account.channel_access_token || account.channel_access_token_encrypted)) {
        const accessToken = await resolveLineCredential(
          account.channel_access_token_encrypted,
          account.channel_access_token,
          { lineAccountId: result.lineAccountId, field: 'channel_access_token' },
        );
        await sendEventBookingNotification({
          delivery: { db: c.env.DB, accountId: result.lineAccountId, operationId: `event-waitlist-accept:${result.bookingId}`,subject:{bookingId:result.bookingId,slotId:result.occurrenceId,status:'confirmed',startsAt:result.startsAt} },
          channelAccessToken: accessToken,
          toLineUserId: result.lineUserId,
          kind: 'received_confirmed',
          ctx: {
            eventName: result.eventName,
            startsAtJst: startsAtJst(result.startsAt),
            venueName: result.venueName,
            venueUrl: result.venueUrl,
            confirmationExtra: result.confirmationExtra,
          },
        });
      }
    } catch (error) {
      logger.error("routes_events_failed");
    }
  }

  return c.json({
    success: true,
    data: {
      bookingId: result.bookingId,
      status: 'confirmed',
      alreadyConfirmed: !result.newlyConverted,
    },
  });
});
}
