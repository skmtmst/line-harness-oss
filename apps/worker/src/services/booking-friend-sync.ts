import { jstNow } from '@line-crm/db';

const STORE_TAGS = [
  { keyword: '甲府', name: '甲府店', color: '#F59E0B' },
  { keyword: '渋谷', name: '渋谷店', color: '#6366F1' },
] as const;

export type BookingCustomerProfile = {
  name: string;
  kana: string;
  phone: string;
  birthdate: string | null;
};

export function bookingStoreTag(locationName: string): { name: string; color: string } {
  const matched = STORE_TAGS.find((tag) => locationName.includes(tag.keyword));
  return matched
    ? { name: matched.name, color: matched.color }
    : { name: locationName.trim(), color: '#06C755' };
}

export async function syncBookingFriendProfile(
  db: D1Database,
  input: {
    accountId: string;
    friendId: string;
    locationId: string;
    customer: BookingCustomerProfile;
  },
): Promise<{ tagId: string; tagName: string; tagAdded: boolean }> {
  const location = await db
    .prepare(
      `SELECT name
         FROM booking_locations
        WHERE id = ? AND line_account_id = ? AND deleted_at IS NULL`,
    )
    .bind(input.locationId, input.accountId)
    .first<{ name: string }>();
  if (!location) throw new Error('booking location not found while syncing friend profile');

  const storeTag = bookingStoreTag(location.name);
  let tag = await db
    .prepare(`SELECT id FROM tags WHERE name = ?`)
    .bind(storeTag.name)
    .first<{ id: string }>();

  if (!tag) {
    const candidateId = crypto.randomUUID();
    await db
      .prepare(
        `INSERT OR IGNORE INTO tags (id, name, color, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(candidateId, storeTag.name, storeTag.color, jstNow())
      .run();
    tag = await db
      .prepare(`SELECT id FROM tags WHERE name = ?`)
      .bind(storeTag.name)
      .first<{ id: string }>();
  }
  if (!tag) throw new Error('booking store tag could not be created');

  const now = jstNow();
  const results = await db.batch([
    db
      .prepare(
        `UPDATE friends
            SET customer_name = ?,
                customer_kana = ?,
                customer_phone = ?,
                customer_birthdate = ?,
                customer_details_updated_at = ?,
                metadata = json_set(
                  COALESCE(NULLIF(metadata, ''), '{}'),
                  '$.customer_name', ?,
                  '$.customer_kana', ?,
                  '$.customer_phone', ?,
                  '$.customer_birthdate', json(?)
                ),
                updated_at = ?
          WHERE id = ? AND line_account_id = ?`,
      )
      .bind(
        input.customer.name,
        input.customer.kana,
        input.customer.phone,
        input.customer.birthdate,
        now,
        input.customer.name,
        input.customer.kana,
        input.customer.phone,
        JSON.stringify(input.customer.birthdate),
        now,
        input.friendId,
        input.accountId,
      ),
    db
      .prepare(
        `INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
         VALUES (?, ?, ?)`,
      )
      .bind(input.friendId, tag.id, now),
  ]);

  if ((results[0]?.meta?.changes ?? 0) === 0) {
    throw new Error('friend not found while syncing booking customer details');
  }

  return {
    tagId: tag.id,
    tagName: storeTag.name,
    tagAdded: (results[1]?.meta?.changes ?? 0) > 0,
  };
}
