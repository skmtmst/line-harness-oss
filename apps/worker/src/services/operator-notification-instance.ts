import type { OperatorRuleConditions } from './operator-rule-types.js';


export async function ensureOperatorInstance(
  db: D1Database,
  input: {
    lineAccountId: string;
    ruleId: string;
    ruleVersion: number;
    ruleName: string;
    message: string;
    sourceEventType: string;
    sourceEventId: string;
    dedupeMinutes: number;
    conditions: OperatorRuleConditions;
    channels: string[];
  },
): Promise<string> {
  const now = new Date().toISOString();
  // Group membership survives completion and the grouping window: a replay is never a new occurrence.
  const occurrence = await db.prepare(`SELECT instance_id FROM operator_notification_occurrences
    WHERE rule_id=? AND line_account_id=? AND source_event_id=?`).bind(
      input.ruleId, input.lineAccountId, input.sourceEventId,
    ).first<{instance_id:string}>();
  if (occurrence) return occurrence.instance_id;
  const existingBatch = await db.prepare(`SELECT i.id FROM notification_instances i
    WHERE i.line_account_id=? AND i.audience_type='operator' AND i.definition_id=?
      AND (datetime(i.created_at)>datetime(?) OR ((? > 1 OR ? != 'anytime')
        AND NOT EXISTS (SELECT 1 FROM notification_deliveries d WHERE d.instance_id=i.id AND d.status IN ('provider_accepted','failed','excluded'))))
    ORDER BY i.created_at DESC LIMIT 1`).bind(input.lineAccountId,input.ruleId,
      new Date(Date.now()-Math.max(0,input.dedupeMinutes)*60_000).toISOString(),
      input.conditions.threshold === 'ten' ? 10 : input.conditions.threshold === 'three' ? 3 : 1,
      input.conditions.schedule ?? 'anytime').first<{id:string}>();
  if (existingBatch) {
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO operator_notification_occurrences(rule_id,line_account_id,source_event_id,instance_id)
        VALUES (?,?,?,?)`).bind(input.ruleId,input.lineAccountId,input.sourceEventId,existingBatch.id),
      db.prepare(`UPDATE notification_instances SET occurrence_count=occurrence_count+1,grouped_count=grouped_count+1,updated_at=?
        WHERE id=? AND changes()=1`).bind(now,existingBatch.id),
    ]);
    return existingBatch.id;
  }
  const instanceId = crypto.randomUUID();
  const windowMs = Math.max(0, input.dedupeMinutes) * 60_000;
  const dedupeKey = windowMs > 0
    ? `${input.ruleId}:${input.sourceEventType}:${Math.floor(Date.now() / windowMs)}`
    : `${input.ruleId}:${input.sourceEventId}`;
  const metadata = JSON.stringify({
    ruleVersion: input.ruleVersion,
    ruleName: input.ruleName,
    message: input.message,
    conditions: input.conditions,
    channels: input.channels,
  });
  try {
    await db.prepare(`
      INSERT INTO notification_instances
        (id, line_account_id, audience_type, definition_id, definition_version_id,
         source_event_type, source_event_id, source_metadata_json,
         dedupe_key, status, created_at, updated_at)
      SELECT ?, ?, 'operator', ?, ?, ?, ?, ?, ?, 'pending', ?, ?
      WHERE NOT EXISTS(SELECT 1 FROM notification_instances i WHERE i.line_account_id=? AND i.audience_type='operator' AND i.definition_id=?
        AND (datetime(i.created_at)>datetime(?) OR ((?>1 OR ?!='anytime') AND NOT EXISTS(
          SELECT 1 FROM notification_deliveries d WHERE d.instance_id=i.id AND d.status IN ('provider_accepted','failed','excluded')))))
    `).bind(
      instanceId, input.lineAccountId, input.ruleId, String(input.ruleVersion),
      input.sourceEventType, input.sourceEventId, metadata, dedupeKey, now, now,
      input.lineAccountId,input.ruleId,new Date(Date.now()-Math.max(0,input.dedupeMinutes)*60_000).toISOString(),
      input.conditions.threshold==='ten'?10:input.conditions.threshold==='three'?3:1,input.conditions.schedule??'anytime',
    ).run();
    if (!await db.prepare('SELECT id FROM notification_instances WHERE id=?').bind(instanceId).first()) return ensureOperatorInstance(db,input);
    await db.prepare('INSERT OR IGNORE INTO operator_notification_occurrences(rule_id,line_account_id,source_event_id,instance_id) VALUES (?,?,?,?)').bind(input.ruleId,input.lineAccountId,input.sourceEventId,instanceId).run();
    return instanceId;
  } catch (error) {
    if (error instanceof Error && /UNIQUE/i.test(error.message)) {
      const existing = await db.prepare(`
        SELECT id, source_event_id FROM notification_instances
         WHERE line_account_id = ?
           AND audience_type = 'operator'
           AND definition_id = ?
           AND ((source_event_type = ? AND source_event_id = ?) OR dedupe_key = ?)
         ORDER BY CASE WHEN source_event_type = ? AND source_event_id = ? THEN 0 ELSE 1 END
         LIMIT 1
      `).bind(
        input.lineAccountId, input.ruleId,
        input.sourceEventType, input.sourceEventId, dedupeKey,
        input.sourceEventType, input.sourceEventId,
      ).first<{ id: string; source_event_id: string }>();
      if (existing) {
        if (existing.source_event_id !== input.sourceEventId) {
          await db.prepare(`
            UPDATE notification_instances
               SET occurrence_count = occurrence_count + 1,
                   grouped_count = grouped_count + 1,
                   updated_at = ?
             WHERE id = ? AND line_account_id = ?
          `).bind(now, existing.id, input.lineAccountId).run();
        }
        return existing.id;
      }
    }
    throw error;
  }
}
