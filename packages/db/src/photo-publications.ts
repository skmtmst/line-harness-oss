import { jstNow } from './utils.js';
import type { PhotoPublicationOrderInput } from '@line-crm/shared';

/** 全掲載の集合と版を1つのSQLで照合し、1件でも変化したら全件を書き換えない。 */
export async function savePhotoPublicationOrder(db: D1Database, input: PhotoPublicationOrderInput) {
  const result = await db.prepare(`
    WITH visible AS MATERIALIZED (
      SELECT pub.id, pub.version FROM nen_photo_publications pub
      JOIN nen_photo_submissions ps ON ps.id=pub.photo_id AND ps.line_account_id=pub.line_account_id
      WHERE pub.line_account_id=? AND pub.status='published' AND ps.status='adopted'
        AND ps.publication_consent_at IS NOT NULL AND ps.publication_withdrawn_at IS NULL
    ), requested AS MATERIALIZED (
      SELECT json_extract(value,'$.id') AS id, json_extract(value,'$.expectedVersion') AS version,
             CAST(key AS INTEGER) AS position FROM json_each(?)
    ), valid AS MATERIALIZED (
      SELECT (SELECT COUNT(*) FROM visible)=(SELECT COUNT(*) FROM requested)
        AND NOT EXISTS (SELECT 1 FROM requested r LEFT JOIN visible v ON v.id=r.id
                        WHERE v.id IS NULL OR v.version<>r.version) AS ok
    )
    UPDATE nen_photo_publications
      SET sort_order=(SELECT position FROM requested WHERE requested.id=nen_photo_publications.id),
          version=version+1, updated_at=?
      WHERE line_account_id=? AND id IN (SELECT id FROM visible) AND (SELECT ok FROM valid)
  `).bind(input.accountId, JSON.stringify(input.items), jstNow(), input.accountId).run();
  return Number(result.meta.changes) === input.items.length;
}

export async function publishPhoto(db: D1Database, input: {
  photoId: string; accountId: string; expectedVersion: number; idempotencyKey: string;
}) {
  const key = `publish:${input.idempotencyKey}`;
  const previous = await db.prepare('SELECT id, version, status, last_idempotency_key FROM nen_photo_publications WHERE photo_id=? AND line_account_id=?')
    .bind(input.photoId, input.accountId).first<{id: string; version: number; status: string; last_idempotency_key: string | null}>();
  if (previous?.last_idempotency_key === key && previous.status === 'published') {
    if (previous.version !== input.expectedVersion+1) return { kind: 'conflict' as const };
    return { kind: 'saved' as const, id: previous.id, version: previous.version };
  }
  const photo = await db.prepare('SELECT status, publication_consent_at, publication_withdrawn_at, public_image_url FROM nen_photo_submissions WHERE id=? AND line_account_id=?')
    .bind(input.photoId, input.accountId).first<{status: string; publication_consent_at: string | null; publication_withdrawn_at: string | null; public_image_url: string | null}>();
  if (!photo) return { kind: 'missing' as const };
  if (photo.status !== 'adopted' || !photo.publication_consent_at || photo.publication_withdrawn_at || !photo.public_image_url) {
    return { kind: 'ineligible' as const };
  }
  if ((previous?.version ?? 0) !== input.expectedVersion) return { kind: 'conflict' as const };
  const now = jstNow();
  const id = previous?.id ?? `photo-publication:${input.photoId}`;
  const results = await db.batch([
    db.prepare(`INSERT INTO nen_photo_publications
      (id,photo_id,line_account_id,status,show_owner_name,version,published_at,updated_at,last_idempotency_key)
      SELECT ?,ps.id,ps.line_account_id,'published',0,1,?,?,? FROM nen_photo_submissions ps
      WHERE ps.id=? AND ps.line_account_id=? AND ps.status='adopted'
        AND ps.publication_consent_at IS NOT NULL AND ps.publication_withdrawn_at IS NULL
        AND ps.public_image_url IS NOT NULL
        AND COALESCE((SELECT version FROM nen_photo_publications WHERE photo_id=ps.id),0)=?
      ON CONFLICT(photo_id) DO UPDATE SET status='published',version=nen_photo_publications.version+1,
        withdrawn_at=NULL,withdrawn_by=NULL,updated_at=excluded.updated_at,last_idempotency_key=excluded.last_idempotency_key
      WHERE nen_photo_publications.line_account_id=excluded.line_account_id AND nen_photo_publications.version=?`)
      .bind(id, now, now, key, input.photoId, input.accountId, input.expectedVersion, input.expectedVersion),
    db.prepare(`INSERT INTO nen_photo_publication_placements
      (id,publication_id,line_account_id,placement_type,placement_label,active,created_at,removed_at)
      SELECT ?,pub.id,pub.line_account_id,'site','公式サイト',1,?,NULL FROM nen_photo_publications pub
      WHERE pub.id=? AND pub.line_account_id=? AND pub.last_idempotency_key=? AND pub.version=?
      AND NOT EXISTS (SELECT 1 FROM nen_photo_publication_placements WHERE publication_id=pub.id AND placement_type='site' AND active=1)
      ON CONFLICT(publication_id,placement_type,placement_label) DO UPDATE SET active=1,removed_at=NULL`)
      .bind(`photo-publication-site-admin:${input.photoId}`, now, id, input.accountId, key, input.expectedVersion+1),
  ]);
  if (results[0].meta.changes === 1) return { kind: 'saved' as const, id, version: input.expectedVersion+1 };
  // 同じ入力の同時再送は、勝った処理の結果へ収束する。
  const replay = await db.prepare('SELECT id,version FROM nen_photo_publications WHERE photo_id=? AND line_account_id=? AND last_idempotency_key=? AND version=?')
    .bind(input.photoId, input.accountId, key, input.expectedVersion+1).first<{id: string; version: number}>();
  return replay ? { kind: 'saved' as const, ...replay } : { kind: 'conflict' as const };
}
