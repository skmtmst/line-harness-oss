import type { Context, Hono } from 'hono';
import { BOOKING_MENUS_KEY, BOOKING_SETTINGS_KEY } from '@line-crm/shared';
import type { Env } from '../../worker-env.js';
import { requirePermission } from '../../middleware/role-guard.js';
import { inputError, inputJsonBoundary } from '../../lib/input-errors.js';
import { logger } from '@line-crm/shared/server';
import { BookingPhotoError, bookingPhoto, getBookingPhotos, readPhotoId, readStorePhotos, saveBookingPhoto, saveBookingStorePhotos, storePhotoVisibility } from '../../features/booking/booking-photos/index.js';
import { resolveAccountIdAdmin, resolveAccountIdFromLiff } from './identity.js';

function origin(c: Context<Env>): string {
  return (c.env.WORKER_URL || new URL(c.req.url).origin).replace(/\/$/, '');
}

async function photoAction(c: Context<Env>, save: (body: Record<string, unknown>, accountId: string) => Promise<number>) {
  if (c.get('staff')?.readOnly) return c.json({ error: 'read_only' }, 403);
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return inputError(c, { error: 'missing_account_id' }, 400, ['account_id']);
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || Array.isArray(body) || !Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 0) {
    return inputError(c, { error: 'invalid_photo_version' }, 400, ['expectedVersion']);
  }
  try {
    return c.json({ success: true, data: { version: await save(body, accountId) } });
  } catch (error) {
    if (error instanceof BookingPhotoError) return c.json({ success: false, error: error.code, data: { currentVersion: error.currentVersion } }, error.status);
    if (String(error).includes('booking_photo_media_unavailable')) return c.json({ error: 'booking_photo_media_unavailable' }, 400);
    logger.error('booking_photos_save_failed');
    return c.json({ error: 'booking_photos_save_failed' }, 503);
  }
}

export function registerPhotos(booking: Hono<Env>): void {
  booking.get('/api/booking/admin/menus/photos', async c => {
    const accountId = await resolveAccountIdAdmin(c);
    if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
    try {
      return c.json({ success: true, data: await getBookingPhotos(c.env.DB, accountId, origin(c)) });
    } catch {
      logger.error('booking_photos_read_failed');
      return c.json({ error: 'booking_photos_unavailable' }, 503);
    }
  });
  booking.put('/api/booking/admin/menus/:id/photo', requirePermission(BOOKING_MENUS_KEY), inputJsonBoundary(), c => photoAction(c, async (body, accountId) => {
    if (Number(body.expectedVersion) < 1) throw new BookingPhotoError('invalid_photo_version');
    const version = await saveBookingPhoto(c.env.DB, accountId, 'menu', c.req.param('id'), Number(body.expectedVersion), readPhotoId(body.mediaId), c.get('staff')?.id ?? null);
    return version;
  }));
  booking.put('/api/booking/admin/staff/:id/photo', requirePermission(BOOKING_SETTINGS_KEY), inputJsonBoundary(), c => photoAction(c, async (body, accountId) => {
    if (Number(body.expectedVersion) < 1) throw new BookingPhotoError('invalid_photo_version');
    return saveBookingPhoto(c.env.DB, accountId, 'staff', c.req.param('id'), Number(body.expectedVersion), readPhotoId(body.mediaId));
  }));
  booking.put('/api/booking/admin/store-photos', requirePermission(BOOKING_SETTINGS_KEY), inputJsonBoundary(), c => photoAction(c, (body, accountId) =>
    saveBookingStorePhotos(c.env.DB, accountId, readStorePhotos(body))));
  booking.get('/api/liff/booking/store-photos', async c => {
    const accountId = await resolveAccountIdFromLiff(c);
    if (!accountId) return c.json({ error: 'unknown_liff' }, 404);
    try {
    const row = await c.env.DB.prepare(`SELECT bs.store_photo_media_id,bs.store_photo_interior_media_id,bs.store_photo_waiting_media_id,bs.store_photo_order_json,flags.value AS visibility_json
      FROM booking_settings bs LEFT JOIN account_settings flags ON flags.line_account_id=bs.line_account_id AND flags.key='booking.store_photo_visibility' WHERE bs.line_account_id=?`).bind(accountId)
      .first<{ store_photo_media_id: string | null; store_photo_interior_media_id: string | null; store_photo_waiting_media_id: string | null; store_photo_order_json: string; visibility_json: string | null }>();
    const values = { exterior: row?.store_photo_media_id, interior: row?.store_photo_interior_media_id, waiting: row?.store_photo_waiting_media_id };
    const order = row ? JSON.parse(row.store_photo_order_json) as Array<keyof typeof values> : [];
    const visibility = storePhotoVisibility(row?.visibility_json);
    return c.json({ success: true, data: order.flatMap(slot => {
      if (!visibility[slot]) return [];
      const photo = bookingPhoto(origin(c), values[slot]);
      return photo ? [{ slot, url: photo.url }] : [];
    }) });
    } catch {
      logger.error('booking_store_photos_read_failed');
      return c.json({ error: 'booking_photos_unavailable' }, 503);
    }
  });
}
