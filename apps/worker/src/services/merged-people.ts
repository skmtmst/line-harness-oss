import type {
  MergedPersonDeliveryPriority,
  MergedPersonDeliveryPriorityInput,
  MergedPersonDetail,
  MergedPersonEventType,
  MergedPersonHistoryItem,
  MergedPersonJsonValue,
  MergedPersonLinkedFriend,
  MergedPersonProfileSelectionInput,
  MergedPersonProfileSource,
  MergedPersonProfileUpdateMode,
  MergedPersonProfileValue,
  MergedPersonStatus,
  UpdateMergedPersonDeliveryPrioritiesRequest,
  UpdateMergedPersonRequest,
} from '@line-crm/shared';

type UserRow = {
  id: string;
  tenant_id: string | null;
  status: MergedPersonStatus;
  revision: number;
  display_name: string | null;
  primary_display_name: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

type LinkedFriendRow = {
  friend_id: string;
  display_name: string | null;
  line_account_id: string;
  line_account_name: string;
  is_following: number;
  friend_updated_at: string;
  candidate_id: string | null;
  candidate_version: number | null;
  link_method: string | null;
  confidence_score: number | null;
  linked_at: string | null;
};

type ProfileRow = {
  field_key: string;
  field_label: string;
  value_json: string;
  value_preview: string | null;
  source_type: MergedPersonProfileSource;
  source_id: string | null;
  source_label: string;
  source_friend_id: string | null;
  verified_at: string | null;
  selected_by_name: string;
  selected_at: string;
  update_mode: MergedPersonProfileUpdateMode;
};

type PriorityRow = {
  purpose: MergedPersonDeliveryPriority['purpose'];
  friend_id: string;
  line_account_id: string;
  line_account_name: string;
  priority: number;
  is_active: number;
  reason: string;
};

type EventRow = {
  id: string;
  event_type: MergedPersonEventType;
  summary: string;
  actor_name: string;
  occurred_at: string;
};

type DecisionEventRow = {
  id: string;
  from_status: string;
  to_status: string;
  actor_name: string;
  decided_at: string;
};

export type MergedPersonActor = { id: string; name: string; tenantId: string };

export class MergedPersonError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409 | 422,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const STATUSES = new Set<MergedPersonStatus>(['active', 'review', 'archived']);
const PROFILE_SOURCES = new Set<MergedPersonProfileSource>([
  'friend', 'friend_field', 'form', 'ec', 'manual',
]);
const UPDATE_MODES = new Set<MergedPersonProfileUpdateMode>(['auto', 'fixed']);
const PURPOSES = new Set<MergedPersonDeliveryPriority['purpose']>([
  'broadcast', 'scenario', 'reminder', 'transactional', 'manual',
]);
const FIELD_KEY = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/;
const MASK_MARKER = /[*\u2022\u25cf\u2026]/;
const RAW_EMAIL = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/i;
const RAW_PHONE = /(?:\+?\d[\s().-]*){10,15}/;

function nowIso(): string {
  return new Date().toISOString();
}

function isJsonValue(value: unknown, depth = 0): value is MergedPersonJsonValue {
  if (depth > 8) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  if (typeof value !== 'object') return false;
  return Object.entries(value).every(([key, item]) => key.length <= 100 && isJsonValue(item, depth + 1));
}

function safeText(value: string, label: string, min: number, max: number): string {
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    throw new MergedPersonError(422, 'INVALID_TEXT', `${label}は${min}文字以上${max}文字以内で入力してください`);
  }
  return normalized;
}

function assertSafePreview(value: string | null): void {
  if (!value) return;
  if ((RAW_EMAIL.test(value) || RAW_PHONE.test(value)) && !MASK_MARKER.test(value)) {
    throw new MergedPersonError(
      422,
      'UNMASKED_PROFILE_VALUE',
      'メールアドレスや電話番号はマスクして表示してください',
    );
  }
}

async function findUser(db: D1Database, tenantId: string, id: string): Promise<UserRow> {
  const row = await db.prepare(
    `SELECT u.id, u.tenant_id, u.status, u.revision, u.display_name,
            u.primary_display_name, u.created_at, u.updated_at, u.archived_at
       FROM users u
      WHERE u.id = ?
        AND (
          u.tenant_id = ?
          OR (
            u.tenant_id IS NULL
            AND EXISTS (
              SELECT 1 FROM friends f
              JOIN line_accounts la ON la.id = f.line_account_id
              WHERE f.user_id = u.id
                AND COALESCE(la.tenant_id, '00000000-0000-4000-8000-000000000001') = ?
            )
            AND NOT EXISTS (
              SELECT 1 FROM friends f
              JOIN line_accounts la ON la.id = f.line_account_id
              WHERE f.user_id = u.id
                AND COALESCE(la.tenant_id, '00000000-0000-4000-8000-000000000001') <> ?
            )
          )
        )`,
  ).bind(id, tenantId, tenantId, tenantId).first<UserRow>();
  if (!row) {
    throw new MergedPersonError(404, 'PERSON_NOT_FOUND', '統合ユーザーが見つかりません');
  }
  return row;
}

async function linkedRows(
  db: D1Database,
  tenantId: string,
  userId: string,
): Promise<LinkedFriendRow[]> {
  const result = await db.prepare(
    `SELECT f.id AS friend_id, f.display_name, f.line_account_id,
            la.name AS line_account_name, f.is_following,
            f.updated_at AS friend_updated_at,
            l.candidate_id, c.version AS candidate_version, l.link_method,
            l.confidence_score, l.linked_at
       FROM friends f
       JOIN line_accounts la ON la.id = f.line_account_id
       LEFT JOIN friend_identity_links l
         ON l.friend_id = f.id AND l.user_id = ? AND l.unlinked_at IS NULL
       LEFT JOIN identity_candidates c ON c.id = l.candidate_id
      WHERE f.user_id = ?
        AND COALESCE(la.tenant_id, '00000000-0000-4000-8000-000000000001') = ?
      ORDER BY la.name, f.display_name, f.id`,
  ).bind(userId, userId, tenantId).all<LinkedFriendRow>();
  return result.results;
}

async function profileRows(
  db: D1Database,
  tenantId: string,
  userId: string,
): Promise<ProfileRow[]> {
  const result = await db.prepare(
    `SELECT field_key, field_label, value_json, value_preview, source_type,
            source_id, source_label, source_friend_id, verified_at,
            selected_by_name, selected_at, update_mode
       FROM user_profile_values
      WHERE tenant_id = ? AND user_id = ? AND is_active = 1
      ORDER BY field_label, field_key`,
  ).bind(tenantId, userId).all<ProfileRow>();
  return result.results;
}

async function priorityRows(
  db: D1Database,
  tenantId: string,
  userId: string,
): Promise<PriorityRow[]> {
  const result = await db.prepare(
    `SELECT p.purpose, p.friend_id, f.line_account_id,
            la.name AS line_account_name, p.priority, p.is_active, p.reason
       FROM user_delivery_priorities p
       JOIN friends f ON f.id = p.friend_id
       JOIN line_accounts la ON la.id = f.line_account_id
      WHERE p.tenant_id = ? AND p.user_id = ? AND p.retired_at IS NULL
      ORDER BY p.purpose, p.priority, p.friend_id`,
  ).bind(tenantId, userId).all<PriorityRow>();
  return result.results;
}

async function historyRows(
  db: D1Database,
  tenantId: string,
  userId: string,
): Promise<MergedPersonHistoryItem[]> {
  const [events, decisions] = await Promise.all([
    db.prepare(
      `SELECT id, event_type, summary, actor_name, occurred_at
         FROM identity_events
        WHERE tenant_id = ? AND user_id = ?
        ORDER BY occurred_at DESC LIMIT 100`,
    ).bind(tenantId, userId).all<EventRow>(),
    db.prepare(
      `SELECT d.id, d.from_status, d.to_status, d.actor_name, d.decided_at
         FROM identity_candidate_decisions d
         JOIN friend_identity_links l ON l.candidate_id = d.candidate_id
        WHERE l.tenant_id = ? AND l.user_id = ?
        GROUP BY d.id, d.from_status, d.to_status, d.actor_name, d.decided_at
        ORDER BY d.decided_at DESC LIMIT 100`,
    ).bind(tenantId, userId).all<DecisionEventRow>(),
  ]);
  const candidateHistory: MergedPersonHistoryItem[] = decisions.results.map((row) => {
    const isLink = row.to_status === 'linked';
    const isUnlink = row.from_status === 'linked' && row.to_status === 'invalidated';
    return {
      id: row.id,
      eventType: isLink ? 'link' : isUnlink ? 'unlink' : 'candidate',
      summary: isLink
        ? '本人照合で友だちを結び付けました'
        : isUnlink
          ? '友だちの結び付きを解除しました'
          : '本人照合の判断を更新しました',
      actorName: row.actor_name,
      occurredAt: row.decided_at,
    };
  });
  return [
    ...events.results.map((row) => ({
      id: row.id,
      eventType: row.event_type,
      summary: row.summary,
      actorName: row.actor_name,
      occurredAt: row.occurred_at,
    })),
    ...candidateHistory,
  ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 100);
}

function linkedFriend(row: LinkedFriendRow): MergedPersonLinkedFriend {
  return {
    friendId: row.friend_id,
    displayName: row.display_name || '名前は未取得',
    lineAccountId: row.line_account_id,
    lineAccountName: row.line_account_name,
    isFollowing: Boolean(row.is_following),
    linkedAt: row.linked_at ?? row.friend_updated_at,
    linkMethod: row.link_method ?? 'legacy_cache',
    confidence: row.confidence_score,
    candidateId: row.candidate_id,
    candidateVersion: row.candidate_version,
  };
}

export async function mergedPersonAccountIds(
  db: D1Database,
  tenantId: string,
  id: string,
): Promise<string[]> {
  await findUser(db, tenantId, id);
  const rows = await linkedRows(db, tenantId, id);
  return [...new Set(rows.map((row) => row.line_account_id))];
}

export async function getMergedPerson(
  db: D1Database,
  tenantId: string,
  id: string,
): Promise<MergedPersonDetail> {
  const user = await findUser(db, tenantId, id);
  const [friends, profiles, priorities, history] = await Promise.all([
    linkedRows(db, tenantId, id),
    profileRows(db, tenantId, id),
    priorityRows(db, tenantId, id),
    historyRows(db, tenantId, id),
  ]);
  return {
    id: user.id,
    status: user.status,
    revision: user.revision,
    primaryDisplayName:
      user.primary_display_name || user.display_name || friends[0]?.display_name || '統合ユーザー',
    linkedFriends: friends.map(linkedFriend),
    profileValues: profiles.map((row): MergedPersonProfileValue => ({
      fieldKey: row.field_key,
      fieldLabel: row.field_label,
      valuePreview: row.value_preview,
      sourceType: row.source_type,
      sourceLabel: row.source_label,
      sourceFriendId: row.source_friend_id,
      verifiedAt: row.verified_at,
      selectedByName: row.selected_by_name,
      selectedAt: row.selected_at,
      updateMode: row.update_mode,
    })),
    deliveryPriorities: priorities.map((row): MergedPersonDeliveryPriority => ({
      purpose: row.purpose,
      friendId: row.friend_id,
      lineAccountId: row.line_account_id,
      lineAccountName: row.line_account_name,
      priority: row.priority,
      isActive: Boolean(row.is_active),
      reason: row.reason,
    })),
    history,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    archivedAt: user.archived_at,
  };
}

function validateProfileSelections(
  selections: MergedPersonProfileSelectionInput[],
  linkedFriendIds: Set<string>,
): MergedPersonProfileSelectionInput[] {
  const fields = new Set<string>();
  return selections.map((selection) => {
    if (!FIELD_KEY.test(selection.fieldKey) || fields.has(selection.fieldKey)) {
      throw new MergedPersonError(422, 'INVALID_PROFILE_FIELD', 'プロフィール項目の指定が重複または不正です');
    }
    fields.add(selection.fieldKey);
    if (!PROFILE_SOURCES.has(selection.sourceType) || !UPDATE_MODES.has(selection.updateMode)) {
      throw new MergedPersonError(422, 'INVALID_PROFILE_SOURCE', 'プロフィールの取得元を確認できません');
    }
    if (!isJsonValue(selection.value) || JSON.stringify(selection.value).length > 4_000) {
      throw new MergedPersonError(422, 'INVALID_PROFILE_VALUE', 'プロフィールの値が大きすぎるか、保存できない形です');
    }
    if (selection.sourceFriendId && !linkedFriendIds.has(selection.sourceFriendId)) {
      throw new MergedPersonError(422, 'PROFILE_SOURCE_NOT_LINKED', '結び付いていない友だちを採用元にできません');
    }
    assertSafePreview(selection.valuePreview);
    return {
      ...selection,
      fieldLabel: safeText(selection.fieldLabel, '項目名', 1, 100),
      sourceLabel: safeText(selection.sourceLabel, '取得元', 1, 120),
    };
  });
}

function staleError(): MergedPersonError {
  return new MergedPersonError(
    409,
    'STALE_PERSON',
    '別の人が先に変更しました。最新の状態を読み直してください',
  );
}

function changes(result: D1Result<unknown> | undefined): number {
  return Number(result?.meta?.changes ?? 0);
}

export async function updateMergedPerson(
  db: D1Database,
  actor: MergedPersonActor,
  id: string,
  request: UpdateMergedPersonRequest,
): Promise<MergedPersonDetail> {
  const user = await findUser(db, actor.tenantId, id);
  if (user.revision !== request.expectedRevision) throw staleError();
  const existingFriends = await linkedRows(db, actor.tenantId, id);
  const selections = validateProfileSelections(
    request.profileSelections ?? [],
    new Set(existingFriends.map((row) => row.friend_id)),
  );
  const nextName = request.primaryDisplayName === undefined
    ? user.primary_display_name || user.display_name || '統合ユーザー'
    : safeText(request.primaryDisplayName, '表示名', 1, 100);
  const nextStatus = request.status ?? user.status;
  if (!STATUSES.has(nextStatus)) {
    throw new MergedPersonError(422, 'INVALID_PERSON_STATUS', '統合ユーザーの状態が正しくありません');
  }
  if (selections.length === 0 && nextName === (user.primary_display_name || user.display_name)
    && nextStatus === user.status) {
    throw new MergedPersonError(422, 'NO_CHANGES', '変更する内容がありません');
  }

  const before = await profileRows(db, actor.tenantId, id);
  const now = nowIso();
  const correlationId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [];
  for (const selection of selections) {
    statements.push(
      db.prepare(
        `UPDATE user_profile_values
            SET is_active = 0, updated_at = ?
          WHERE tenant_id = ? AND user_id = ? AND field_key = ? AND is_active = 1
            AND EXISTS (SELECT 1 FROM users WHERE id = ? AND revision = ?)`,
      ).bind(now, actor.tenantId, id, selection.fieldKey, id, user.revision),
      db.prepare(
        `INSERT INTO user_profile_values (
          id, tenant_id, user_id, field_key, field_label, value_json, value_preview,
          source_type, source_id, source_label, source_friend_id, verified_at,
          selected_by, selected_by_name, selected_at, update_mode, is_active,
          created_at, updated_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?
        WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND revision = ?)`,
      ).bind(
        crypto.randomUUID(), actor.tenantId, id, selection.fieldKey, selection.fieldLabel,
        JSON.stringify(selection.value), selection.valuePreview, selection.sourceType,
        selection.sourceId, selection.sourceLabel, selection.sourceFriendId,
        selection.verifiedAt, actor.id, actor.name, now, selection.updateMode, now, now,
        id, user.revision,
      ),
    );
  }
  statements.push(
    db.prepare(
      `INSERT INTO identity_events (
        id, tenant_id, user_id, event_type, summary, before_json, after_json,
        actor_staff_id, actor_name, occurred_at, correlation_id
      )
      SELECT ?, ?, ?, 'profile', ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND revision = ?)`,
    ).bind(
      crypto.randomUUID(), actor.tenantId, id,
      selections.length > 0 ? `プロフィールの採用値を${selections.length}件更新しました` : '統合ユーザーの基本情報を更新しました',
      JSON.stringify(before), JSON.stringify(selections), actor.id, actor.name, now,
      correlationId, id, user.revision,
    ),
    db.prepare(
      `UPDATE users
          SET primary_display_name = ?, status = ?,
              archived_at = CASE WHEN ? = 'archived' THEN COALESCE(archived_at, ?) ELSE NULL END,
              revision = revision + 1, updated_at = ?
        WHERE id = ? AND revision = ?
          AND (tenant_id = ? OR tenant_id IS NULL)`,
    ).bind(nextName, nextStatus, nextStatus, now, now, id, user.revision, actor.tenantId),
  );
  const results = await db.batch(statements);
  if (changes(results.at(-1)) !== 1) throw staleError();
  return getMergedPerson(db, actor.tenantId, id);
}

function validatePriorities(
  priorities: MergedPersonDeliveryPriorityInput[],
  linkedFriendIds: Set<string>,
): MergedPersonDeliveryPriorityInput[] {
  const orderKeys = new Set<string>();
  const friendKeys = new Set<string>();
  return priorities.map((item) => {
    if (!PURPOSES.has(item.purpose) || !Number.isInteger(item.priority) || item.priority < 1) {
      throw new MergedPersonError(422, 'INVALID_DELIVERY_PRIORITY', '配信の用途と優先順位を確認してください');
    }
    if (!linkedFriendIds.has(item.friendId)) {
      throw new MergedPersonError(422, 'DELIVERY_FRIEND_NOT_LINKED', '結び付いていない友だちを配信先にできません');
    }
    const orderKey = `${item.purpose}:${item.priority}`;
    const friendKey = `${item.purpose}:${item.friendId}`;
    if (orderKeys.has(orderKey) || friendKeys.has(friendKey)) {
      throw new MergedPersonError(422, 'DUPLICATE_DELIVERY_PRIORITY', '同じ用途の優先順位が重複しています');
    }
    orderKeys.add(orderKey);
    friendKeys.add(friendKey);
    return { ...item, reason: safeText(item.reason, '理由', 3, 200) };
  });
}

export async function updateMergedPersonDeliveryPriorities(
  db: D1Database,
  actor: MergedPersonActor,
  id: string,
  request: UpdateMergedPersonDeliveryPrioritiesRequest,
): Promise<MergedPersonDetail> {
  const user = await findUser(db, actor.tenantId, id);
  if (user.revision !== request.expectedRevision) throw staleError();
  const friends = await linkedRows(db, actor.tenantId, id);
  const priorities = validatePriorities(
    request.priorities,
    new Set(friends.map((row) => row.friend_id)),
  );
  const before = await priorityRows(db, actor.tenantId, id);
  const now = nowIso();
  const correlationId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `UPDATE user_delivery_priorities
          SET retired_at = ?, updated_at = ?
        WHERE tenant_id = ? AND user_id = ? AND retired_at IS NULL
          AND EXISTS (SELECT 1 FROM users WHERE id = ? AND revision = ?)`,
    ).bind(now, now, actor.tenantId, id, id, user.revision),
  ];
  for (const priority of priorities) {
    statements.push(
      db.prepare(
        `INSERT INTO user_delivery_priorities (
          id, tenant_id, user_id, purpose, friend_id, priority, is_active,
          reason, selected_by, selected_at, created_at, updated_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND revision = ?)`,
      ).bind(
        crypto.randomUUID(), actor.tenantId, id, priority.purpose, priority.friendId,
        priority.priority, priority.isActive, priority.reason, actor.id, now, now, now,
        id, user.revision,
      ),
    );
  }
  statements.push(
    db.prepare(
      `INSERT INTO identity_events (
        id, tenant_id, user_id, event_type, summary, before_json, after_json,
        actor_staff_id, actor_name, occurred_at, correlation_id
      )
      SELECT ?, ?, ?, 'priority', ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND revision = ?)`,
    ).bind(
      crypto.randomUUID(), actor.tenantId, id,
      `配信先の優先順位を${priorities.length}件に更新しました`,
      JSON.stringify(before), JSON.stringify(priorities), actor.id, actor.name, now,
      correlationId, id, user.revision,
    ),
    db.prepare(
      `UPDATE users SET revision = revision + 1, updated_at = ?
        WHERE id = ? AND revision = ?
          AND (tenant_id = ? OR tenant_id IS NULL)`,
    ).bind(now, id, user.revision, actor.tenantId),
  );
  const results = await db.batch(statements);
  if (changes(results.at(-1)) !== 1) throw staleError();
  return getMergedPerson(db, actor.tenantId, id);
}
