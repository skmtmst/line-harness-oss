import { mediaDeletionTextGuardStatements } from './deletion-guard.js';

/** Acquire references and check deletion in one D1 transaction before sending. */
export async function claimMediaForSend(db: D1Database, input: {
  claimId: string; accountId: string; content: string; expiresAt: string;
}): Promise<void> {
  const checks = await mediaDeletionTextGuardStatements(db, [input.content]);
  await db.batch([
    ...checks,
    db.prepare(`INSERT INTO media_send_claims(claim_id,media_id,line_account_id,expires_at)
      SELECT ?, m.id, ?, ? FROM media m WHERE
        instr(?, '/media/' || m.id || '/content') > 0
        OR (length(m.r2_key)>0 AND instr(?, m.r2_key)>0)
        OR EXISTS (SELECT 1 FROM media_versions v WHERE v.media_id=m.id AND length(v.r2_key)>0 AND instr(?,v.r2_key)>0)`)
      .bind(input.claimId, input.accountId, input.expiresAt, input.content, input.content, input.content),
  ]);
}

export async function releaseMediaSendClaim(db: D1Database, claimId: string): Promise<void> {
  await db.prepare('DELETE FROM media_send_claims WHERE claim_id=?').bind(claimId).run();
}

export async function purgeExpiredMediaSendClaims(db: D1Database, now: string): Promise<void> {
  await db.prepare('DELETE FROM media_send_claims WHERE expires_at<=?').bind(now).run();
}
