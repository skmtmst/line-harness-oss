import { BOOKING_STORE_PHOTO_SLOTS, type BookingPhoto, type BookingPhotoCatalog, type BookingPhotoOwner, type BookingStorePhotoSlot, type BookingStorePhotosWrite } from '@line-crm/shared';
import { recordMenuVersion } from '@line-crm/db';

export class BookingPhotoError extends Error {
  constructor(public code: string, public status: 400 | 404 | 409 = 400, public currentVersion?: number) {
    super(code);
  }
}

export function bookingPhoto(origin: string, mediaId: unknown): BookingPhoto | null {
  return typeof mediaId === 'string' && mediaId
    ? { mediaId, url: `${origin.replace(/\/$/, '')}/media/${encodeURIComponent(mediaId)}/content` } : null;
}

export function readPhotoId(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new BookingPhotoError('invalid_photo_media_id');
  return value.trim();
}

export function readStorePhotos(value: Record<string, unknown>): BookingStorePhotosWrite {
  const photos = value.photos;
  const order = value.order;
  if (!photos || typeof photos !== 'object' || Array.isArray(photos)
    || Object.keys(photos).length !== BOOKING_STORE_PHOTO_SLOTS.length
    || !Array.isArray(order) || order.length !== BOOKING_STORE_PHOTO_SLOTS.length
    || new Set(order).size !== BOOKING_STORE_PHOTO_SLOTS.length
    || !order.every(slot => BOOKING_STORE_PHOTO_SLOTS.includes(slot))) throw new BookingPhotoError('invalid_store_photos');
  const input = photos as Record<string, unknown>;
  return {
    expectedVersion: Number(value.expectedVersion),
    photos: { exterior: readPhotoId(input.exterior), interior: readPhotoId(input.interior), waiting: readPhotoId(input.waiting) },
    order: order as BookingStorePhotoSlot[],
  };
}

export async function getBookingPhotos(db: D1Database, accountId: string, origin: string): Promise<BookingPhotoCatalog> {
  const [menus, staff, store] = await Promise.all([
    db.prepare(`SELECT id,name,version,photo_media_id FROM menus WHERE line_account_id=? AND deleted_at IS NULL ORDER BY sort_order,id`)
      .bind(accountId).all<{ id: string; name: string; version: number; photo_media_id: string | null }>(),
    db.prepare(`SELECT id,display_name AS name,photo_version AS version,photo_media_id FROM staff WHERE line_account_id=? AND deleted_at IS NULL ORDER BY sort_order,id`)
      .bind(accountId).all<{ id: string; name: string; version: number; photo_media_id: string | null }>(),
    db.prepare(`SELECT id,version,store_photo_media_id,store_photo_interior_media_id,store_photo_waiting_media_id,store_photo_order_json FROM booking_settings WHERE line_account_id=?`)
      .bind(accountId).first<{ id: string; version: number; store_photo_media_id: string | null; store_photo_interior_media_id: string | null; store_photo_waiting_media_id: string | null; store_photo_order_json: string }>(),
  ]);
  return {
    menus: menus.results.map(row => ({ id: row.id, name: row.name, version: row.version, photo: bookingPhoto(origin, row.photo_media_id) })),
    staff: staff.results.map(row => ({ id: row.id, name: row.name, version: row.version, photo: bookingPhoto(origin, row.photo_media_id) })),
    store: {
      id: store?.id ?? '', version: store?.version ?? 0,
      photos: { exterior: bookingPhoto(origin, store?.store_photo_media_id), interior: bookingPhoto(origin, store?.store_photo_interior_media_id), waiting: bookingPhoto(origin, store?.store_photo_waiting_media_id) },
      order: store ? JSON.parse(store.store_photo_order_json) as BookingStorePhotoSlot[] : [...BOOKING_STORE_PHOTO_SLOTS],
    },
  };
}

async function checkMedia(db: D1Database, accountId: string, mediaId: string | null): Promise<void> {
  if (mediaId === null) return;
  if (!await db.prepare(`SELECT id FROM media WHERE id=? AND line_account_id=? AND kind='image' AND archived_at IS NULL`)
    .bind(mediaId, accountId).first()) throw new BookingPhotoError('booking_photo_media_unavailable');
}

/** The 735 triggers update the usage ledger in the same statement as the photo CAS. */
export async function saveBookingPhoto(db: D1Database, accountId: string, owner: Exclude<BookingPhotoOwner, 'store'>, id: string, expectedVersion: number, mediaId: string | null, staffId: string | null = null): Promise<number> {
  const table = owner === 'menu' ? 'menus' : 'staff';
  const versionColumn = owner === 'menu' ? 'version' : 'photo_version';
  const current = await db.prepare(`SELECT ${versionColumn} AS version FROM ${table} WHERE id=? AND line_account_id=? AND deleted_at IS NULL`)
    .bind(id, accountId).first<{ version: number }>();
  if (!current) throw new BookingPhotoError('not_found', 404);
  if (current.version !== expectedVersion) throw new BookingPhotoError('version_conflict', 409, current.version);
  await checkMedia(db, accountId, mediaId);
  const result = await db.prepare(`UPDATE ${table} SET photo_media_id=?,${versionColumn}=${versionColumn}+1,
    updated_at=strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')
    WHERE id=? AND line_account_id=? AND deleted_at IS NULL AND ${versionColumn}=?`)
    .bind(mediaId, id, accountId, expectedVersion).run();
  if (!result.meta.changes) throw new BookingPhotoError('version_conflict', 409);
  if (owner === 'menu') await recordMenuVersion(db, { menuId: id, staffId });
  return expectedVersion + 1;
}

export async function saveBookingStorePhotos(db: D1Database, accountId: string, input: BookingStorePhotosWrite): Promise<number> {
  for (const id of new Set(Object.values(input.photos))) await checkMedia(db, accountId, id);
  if (input.expectedVersion === 0) {
    // Match the existing virtual booking-settings defaults; do not enable automatic approval.
    const created = await db.prepare(`INSERT INTO booking_settings(id,line_account_id,approval_mode,
      store_photo_media_id,store_photo_interior_media_id,store_photo_waiting_media_id,store_photo_order_json)
      VALUES(?,?,'manual',?,?,?,?) ON CONFLICT(line_account_id) DO NOTHING`)
      .bind(crypto.randomUUID(), accountId, input.photos.exterior, input.photos.interior, input.photos.waiting, JSON.stringify(input.order)).run();
    if (created.meta.changes) return 1;
  } else {
    const saved = await db.prepare(`UPDATE booking_settings SET store_photo_media_id=?,store_photo_interior_media_id=?,
      store_photo_waiting_media_id=?,store_photo_order_json=?,version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')
      WHERE line_account_id=? AND version=?`)
      .bind(input.photos.exterior, input.photos.interior, input.photos.waiting, JSON.stringify(input.order), accountId, input.expectedVersion).run();
    if (saved.meta.changes) return input.expectedVersion + 1;
  }
  const current = await db.prepare('SELECT version FROM booking_settings WHERE line_account_id=?').bind(accountId).first<{ version: number }>();
  throw new BookingPhotoError('version_conflict', 409, current?.version);
}
