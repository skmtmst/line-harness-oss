import type { Webinar } from './webinars/types/index.js';
import { activeTenantLineAccountSql } from './line-accounts.js';

export async function getWebinarBySlug(db: D1Database, slug: string, options: { activeAccountOnly?: boolean } = {}): Promise<Webinar | null> {
  if (options.activeAccountOnly) {
    return db.prepare(`SELECT w.* FROM webinars w LEFT JOIN line_accounts la ON la.id=w.account_id
      WHERE w.slug=? AND (w.account_id IS NULL OR (la.is_active=1 AND la.archived_at IS NULL
        AND ${activeTenantLineAccountSql('la.id')}))`).bind(slug).first<Webinar>();
  }
  return db.prepare('SELECT * FROM webinars WHERE slug = ?').bind(slug).first<Webinar>();
}
