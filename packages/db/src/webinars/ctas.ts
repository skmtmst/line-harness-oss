import { jstNow } from '../utils.js';
import { type WebinarCta } from './types.js';
import { getWebinarById } from './definitions.js';


export async function getWebinarCtas(
  db: D1Database,
  webinarId: string,
): Promise<WebinarCta[]> {
  const { results } = await db
    .prepare('SELECT * FROM webinar_ctas WHERE webinar_id = ? ORDER BY at_seconds ASC')
    .bind(webinarId)
    .all<WebinarCta>();
  return results ?? [];
}

export async function replaceWebinarCtas(
  db: D1Database,
  webinarId: string,
  ctas: Array<{
    atSeconds: number;
    kind: 'form' | 'url';
    title: string;
    body: string | null;
    buttonLabel: string;
    autoOpen: boolean;
    formId: string | null;
    url: string | null;
  }>,
  lock?: { expectedVersion: number; updatedBy: string },
): Promise<number | null> {
  const now = jstNow();
  const expectedVersion = lock?.expectedVersion ?? (await getWebinarById(db, webinarId))?.cta_version ?? 0;
  const token = crypto.randomUUID();
  const stmts = [
    db.prepare(`UPDATE webinars SET cta_version = cta_version + 1, cta_updated_by = ?, cta_updated_at = ?, cta_write_token = ?, updated_at = ?
      WHERE id = ? AND cta_version = ?`).bind(lock?.updatedBy ?? null, now, token, now, webinarId, expectedVersion),
    db.prepare('DELETE FROM webinar_ctas WHERE webinar_id = ? AND EXISTS (SELECT 1 FROM webinars WHERE id = ? AND cta_write_token = ?)').bind(webinarId, webinarId, token),
    ...ctas.map((cta) =>
      db
        .prepare(
          `INSERT INTO webinar_ctas
             (id, webinar_id, at_seconds, kind, title, body, button_label, auto_open,
              form_id, url, created_at, updated_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM webinars WHERE id = ? AND cta_write_token = ?)`,
        )
        .bind(
          crypto.randomUUID(), webinarId, cta.atSeconds, cta.kind, cta.title, cta.body,
          cta.buttonLabel, cta.autoOpen ? 1 : 0, cta.formId, cta.url, now, now, webinarId, token,
        ),
    ),
  ];
  const result = await db.batch(stmts);
  return result[0].meta?.changes ? ctas.length : null;
}
