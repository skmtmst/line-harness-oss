import { activeTenantLineAccountSql } from '@line-crm/db';

/** Resolve only the owner needed for LINE verification; never return offer data
 * before the route has verified the token against this account's login channel.
 */
export async function getEventWaitlistOfferAccountId(db: D1Database, token: string): Promise<string | null> {
  if (token.length < 32 || token.length > 256) return null;
  const row = await db.prepare(`SELECT w.line_account_id FROM event_waitlist w
    JOIN line_accounts la ON la.id=w.line_account_id
    WHERE w.offer_token_hash=? AND la.is_active=1 AND la.archived_at IS NULL
      AND ${activeTenantLineAccountSql('la.id')} LIMIT 1`)
    .bind(await sha256(token)).first<{ line_account_id: string }>();
  return row?.line_account_id ?? null;
}

export async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
