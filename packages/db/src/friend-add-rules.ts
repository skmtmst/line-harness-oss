import { jstNow } from './utils.js';

export type FriendAddRuleKind = 'first_time' | 'returning';
export type FriendAddRuleStatus = 'draft' | 'published' | 'stopped' | 'archived';
export type FriendAddRuleVersionStatus = 'draft' | 'published' | 'retired';

export interface FriendAddRuleAction {
  type: 'add_tag' | 'remove_tag' | 'start_scenario';
  label: string;
  targetId?: string;
}

export interface FriendAddRuleDefinition {
  routeIds: string[];
  scenarioId: string | null;
  messageType: 'text' | 'template' | 'form' | 'scenario';
  messageText: string;
  timing: 'immediate' | 'scenario';
  actions: FriendAddRuleAction[];
  friendCondition: string;
  activeFrom: string | null;
  activeUntil: string | null;
  returningMode?: 'none' | 'same' | 'other';
  startPosition?: 'beginning' | 'resume';
}

export interface FriendAddRuleRow {
  id: string;
  line_account_id: string;
  friend_kind: FriendAddRuleKind;
  name: string;
  folder_name: string | null;
  priority: number;
  is_unknown_route_fallback: number;
  status: FriendAddRuleStatus;
  current_version_id: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  version_id: string | null;
  version_number: number | null;
  version_status: FriendAddRuleVersionStatus | null;
  definition_snapshot: string | null;
  last_test_status: 'succeeded' | 'failed' | null;
  last_tested_at: string | null;
  published_at: string | null;
  matched_last_7_days: number | null;
}

export const EMPTY_FRIEND_ADD_RULE_DEFINITION: FriendAddRuleDefinition = {
  routeIds: [],
  scenarioId: null,
  messageType: 'text',
  messageText: '',
  timing: 'immediate',
  actions: [],
  friendCondition: '',
  activeFrom: null,
  activeUntil: null,
};

/** migration 後に追加されたLINEアカウントにも、削除できない受け皿を必ず作る。 */
export async function ensureFriendAddFallbackRules(db: D1Database, lineAccountId: string): Promise<void> {
  const now = jstNow();
  const legacy = await db.prepare(
    `SELECT 1 AS ok FROM account_settings
      WHERE line_account_id = ? AND key = 'friend_add_routing' AND json_valid(value)
      LIMIT 1`,
  ).bind(lineAccountId).first<{ ok: number }>();
  for (const kind of ['first_time', 'returning'] as const) {
    let existing: { id: string } | null;
    try {
      existing = await db.prepare(
        `SELECT id FROM friend_add_rules
          WHERE line_account_id = ? AND friend_kind = ?
            AND is_unknown_route_fallback = 1 AND archived_at IS NULL
          LIMIT 1`,
      ).bind(lineAccountId, kind).first<{ id: string }>();
    } catch (error) {
      if (error instanceof Error && error.message.includes('no such table: friend_add_rules')) return;
      throw error;
    }
    if (existing) continue;
    // DB更新より先に新Workerが動く時間と、旧画面の互換試験では旧設定を使う。
    // migration 290 適用時には、この旧設定から受け皿が作られる。
    if (legacy) continue;
    const ruleId = `friend-add-rule-${kind}-${lineAccountId}`;
    const versionId = `friend-add-rule-version-${kind}-${lineAccountId}`;
    const definition: FriendAddRuleDefinition = {
      ...EMPTY_FRIEND_ADD_RULE_DEFINITION,
      messageType: 'scenario',
      timing: 'scenario',
      ...(kind === 'returning' ? { returningMode: 'none' as const, startPosition: 'beginning' as const } : {}),
    };
    await db.batch([
      db.prepare(
        `INSERT OR IGNORE INTO friend_add_rules
          (id, line_account_id, friend_kind, name, priority, is_unknown_route_fallback,
           status, created_at, updated_at)
         VALUES (?, ?, ?, '経路が分からなかった人', 9999, 1, 'published', ?, ?)`,
      ).bind(ruleId, lineAccountId, kind, now, now),
      db.prepare(
        `INSERT OR IGNORE INTO friend_add_rule_versions
          (id, rule_id, version_number, definition_snapshot, status, published_at, created_at, updated_at)
         VALUES (?, ?, 1, ?, 'published', ?, ?, ?)`,
      ).bind(versionId, ruleId, JSON.stringify(definition), now, now, now),
      db.prepare(
        `UPDATE friend_add_rules SET current_version_id = ?, updated_at = ?
          WHERE id = ? AND line_account_id = ? AND current_version_id IS NULL`,
      ).bind(versionId, now, ruleId, lineAccountId),
    ]);
  }
}

const RULE_SELECT = `
  SELECT r.*,
         v.id AS version_id,
         v.version_number,
         v.status AS version_status,
         v.definition_snapshot,
         v.last_test_status,
         v.last_tested_at,
         v.published_at,
         CASE
           WHEN r.current_version_id IS NULL THEN NULL
           ELSE (
             SELECT COUNT(*)
               FROM friend_add_events e
              WHERE e.line_account_id = r.line_account_id
                AND e.routing_rule_id = r.id
                AND e.occurred_at >= strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours', '-7 days')
           )
         END AS matched_last_7_days
    FROM friend_add_rules r
    LEFT JOIN friend_add_rule_versions v
      ON v.id = COALESCE(
        (SELECT d.id FROM friend_add_rule_versions d
          WHERE d.rule_id = r.id AND d.status = 'draft' LIMIT 1),
        r.current_version_id
      )`;

export async function listFriendAddRules(
  db: D1Database,
  input: { lineAccountId: string; friendKind: FriendAddRuleKind },
): Promise<FriendAddRuleRow[]> {
  const result = await db.prepare(
    `${RULE_SELECT}
      WHERE r.line_account_id = ? AND r.friend_kind = ? AND r.archived_at IS NULL
      ORDER BY r.priority ASC, r.created_at ASC`,
  ).bind(input.lineAccountId, input.friendKind).all<FriendAddRuleRow>();
  return result.results ?? [];
}

export async function getFriendAddRule(
  db: D1Database,
  input: { lineAccountId: string; ruleId: string },
): Promise<FriendAddRuleRow | null> {
  return db.prepare(
    `${RULE_SELECT}
      WHERE r.line_account_id = ? AND r.id = ? AND r.archived_at IS NULL
      LIMIT 1`,
  ).bind(input.lineAccountId, input.ruleId).first<FriendAddRuleRow>();
}

export async function createFriendAddRuleDraft(
  db: D1Database,
  input: {
    lineAccountId: string;
    friendKind: FriendAddRuleKind;
    name: string;
    folderName?: string | null;
    priority: number;
    definition?: FriendAddRuleDefinition;
    idempotencyKey?: string;
  },
): Promise<FriendAddRuleRow> {
  if (input.idempotencyKey) {
    const replay = await db.prepare(
      `SELECT id FROM friend_add_rules
        WHERE line_account_id = ? AND create_idempotency_key = ? AND archived_at IS NULL`,
    ).bind(input.lineAccountId, input.idempotencyKey).first<{ id: string }>();
    if (replay) {
      const existing = await getFriendAddRule(db, { lineAccountId: input.lineAccountId, ruleId: replay.id });
      if (existing) return existing;
    }
  }
  const now = jstNow();
  const ruleId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const definition = input.definition ?? EMPTY_FRIEND_ADD_RULE_DEFINITION;
  await db.batch([
    db.prepare(
      `INSERT INTO friend_add_rules
        (id, line_account_id, friend_kind, name, folder_name, priority, create_idempotency_key,
         status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
    ).bind(
      ruleId,
      input.lineAccountId,
      input.friendKind,
      input.name,
      input.folderName ?? null,
      input.priority,
      input.idempotencyKey ?? null,
      now,
      now,
    ),
    db.prepare(
      `INSERT INTO friend_add_rule_versions
        (id, rule_id, version_number, definition_snapshot, status, created_at, updated_at)
       VALUES (?, ?, 1, ?, 'draft', ?, ?)`,
    ).bind(versionId, ruleId, JSON.stringify(definition), now, now),
  ]);
  const created = await getFriendAddRule(db, { lineAccountId: input.lineAccountId, ruleId });
  if (!created) throw new Error('FRIEND_ADD_RULE_NOT_CREATED');
  return created;
}

export async function saveFriendAddRuleDraft(
  db: D1Database,
  input: {
    lineAccountId: string;
    ruleId: string;
    name: string;
    folderName?: string | null;
    priority: number;
    definition: FriendAddRuleDefinition;
    idempotencyKey: string;
  },
): Promise<FriendAddRuleRow> {
  const current = await getFriendAddRule(db, input);
  if (!current) throw new Error('FRIEND_ADD_RULE_NOT_FOUND');
  const replay = await db.prepare(
    `SELECT id FROM friend_add_rule_versions
      WHERE rule_id = ? AND draft_save_idempotency_key = ?`,
  ).bind(input.ruleId, input.idempotencyKey).first<{ id: string }>();
  if (replay) return current;
  const now = jstNow();
  const draftId = current.version_status === 'draft' && current.version_id
    ? current.version_id
    : crypto.randomUUID();
  const nextVersion = current.version_status === 'draft'
    ? Number(current.version_number ?? 1)
    : Number(current.version_number ?? 0) + 1;

  const statements = [
    db.prepare(
      `UPDATE friend_add_rules
          SET name = ?, folder_name = ?, priority = ?, status = 'draft', updated_at = ?
        WHERE id = ? AND line_account_id = ? AND archived_at IS NULL`,
    ).bind(
      input.name,
      input.folderName ?? null,
      input.priority,
      now,
      input.ruleId,
      input.lineAccountId,
    ),
  ];
  if (current.version_status === 'draft') {
    statements.push(db.prepare(
      `UPDATE friend_add_rule_versions
          SET definition_snapshot = ?, last_test_status = NULL, last_tested_at = NULL,
              last_tested_by_staff_id = NULL, draft_save_idempotency_key = ?, updated_at = ?
        WHERE id = ? AND rule_id = ? AND status = 'draft'`,
    ).bind(JSON.stringify(input.definition), input.idempotencyKey, now, draftId, input.ruleId));
  } else {
    statements.push(db.prepare(
      `INSERT INTO friend_add_rule_versions
        (id, rule_id, version_number, definition_snapshot, status, draft_save_idempotency_key,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`,
    ).bind(draftId, input.ruleId, nextVersion, JSON.stringify(input.definition), input.idempotencyKey, now, now));
  }
  await db.batch(statements);
  const saved = await getFriendAddRule(db, input);
  if (!saved) throw new Error('FRIEND_ADD_RULE_NOT_SAVED');
  return saved;
}

export async function recordFriendAddRuleTest(
  db: D1Database,
  input: { lineAccountId: string; ruleId: string; staffId: string; succeeded: boolean },
): Promise<void> {
  const rule = await getFriendAddRule(db, input);
  if (!rule?.version_id || rule.version_status !== 'draft') {
    throw new Error('FRIEND_ADD_RULE_DRAFT_NOT_FOUND');
  }
  const now = jstNow();
  await db.prepare(
    `UPDATE friend_add_rule_versions
        SET last_test_status = ?, last_tested_at = ?, last_tested_by_staff_id = ?, updated_at = ?
      WHERE id = ? AND rule_id = ? AND status = 'draft'`,
  ).bind(input.succeeded ? 'succeeded' : 'failed', now, input.staffId, now, rule.version_id, input.ruleId).run();
}

export async function publishFriendAddRule(
  db: D1Database,
  input: { lineAccountId: string; ruleId: string; staffId: string; idempotencyKey: string },
): Promise<FriendAddRuleRow> {
  const replay = await db.prepare(
    `SELECT v.id FROM friend_add_rule_versions v
      JOIN friend_add_rules r ON r.id = v.rule_id
     WHERE r.line_account_id = ? AND r.id = ? AND v.publish_idempotency_key = ?`,
  ).bind(input.lineAccountId, input.ruleId, input.idempotencyKey).first<{ id: string }>();
  if (replay) {
    const existing = await getFriendAddRule(db, input);
    if (!existing) throw new Error('FRIEND_ADD_RULE_NOT_FOUND');
    return existing;
  }

  const rule = await getFriendAddRule(db, input);
  if (!rule?.version_id || rule.version_status !== 'draft') {
    throw new Error('FRIEND_ADD_RULE_DRAFT_NOT_FOUND');
  }
  if (rule.last_test_status !== 'succeeded') throw new Error('FRIEND_ADD_RULE_DRAFT_NOT_TESTED');

  const now = jstNow();
  await db.batch([
    db.prepare(
      `UPDATE friend_add_rule_versions
          SET status = 'retired', updated_at = ?
        WHERE rule_id = ? AND status = 'published'`,
    ).bind(now, input.ruleId),
    db.prepare(
      `UPDATE friend_add_rule_versions
          SET status = 'published', published_at = ?, published_by_staff_id = ?,
              publish_idempotency_key = ?, updated_at = ?
        WHERE id = ? AND rule_id = ? AND status = 'draft'`,
    ).bind(now, input.staffId, input.idempotencyKey, now, rule.version_id, input.ruleId),
    db.prepare(
      `UPDATE friend_add_rules
          SET status = 'published', current_version_id = ?, updated_at = ?
        WHERE id = ? AND line_account_id = ? AND archived_at IS NULL`,
    ).bind(rule.version_id, now, input.ruleId, input.lineAccountId),
  ]);
  const published = await getFriendAddRule(db, input);
  if (!published) throw new Error('FRIEND_ADD_RULE_NOT_PUBLISHED');
  return published;
}

export async function stopFriendAddRule(
  db: D1Database,
  input: { lineAccountId: string; ruleId: string },
): Promise<void> {
  const now = jstNow();
  const result = await db.prepare(
    `UPDATE friend_add_rules SET status = 'stopped', updated_at = ?
      WHERE id = ? AND line_account_id = ? AND status = 'published' AND archived_at IS NULL`,
  ).bind(now, input.ruleId, input.lineAccountId).run();
  if ((result.meta?.changes ?? 0) !== 1) {
    const current = await getFriendAddRule(db, input);
    if (current?.status === 'stopped') return;
    throw new Error('FRIEND_ADD_RULE_NOT_STOPPED');
  }
}

export async function archiveFriendAddRule(
  db: D1Database,
  input: { lineAccountId: string; ruleId: string },
): Promise<void> {
  const now = jstNow();
  const result = await db.prepare(
    `UPDATE friend_add_rules SET status = 'archived', archived_at = ?, updated_at = ?
      WHERE id = ? AND line_account_id = ?
        AND is_unknown_route_fallback = 0 AND archived_at IS NULL`,
  ).bind(now, now, input.ruleId, input.lineAccountId).run();
  if ((result.meta?.changes ?? 0) !== 1) throw new Error('FRIEND_ADD_RULE_NOT_ARCHIVED');
}
