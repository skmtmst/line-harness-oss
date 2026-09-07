import { getTagDeleteImpact, type Tag, type TagDeleteImpactReferences } from './tags.js';
import { jstNow } from './utils.js';

export type TagLinkedAction = {
  id: string;
  type: string;
  params: Record<string, unknown>;
  onFailure: 'stop' | 'continue';
};

export type TagAutomationVersion = {
  id: string;
  versionNumber: number;
  state: 'draft' | 'published';
  actions: TagLinkedAction[];
};

export type TagAutomationDefinition = {
  id: string;
  name: string;
  status: 'draft' | 'published' | 'archived';
  draftVersion: TagAutomationVersion | null;
  publishedVersion: TagAutomationVersion | null;
  actions: TagLinkedAction[];
};

export type TagDefinitionDetail = {
  tag: Tag;
  automation: TagAutomationDefinition | null;
};

type AutomationRow = {
  id: string;
  name: string;
  status: 'draft' | 'published' | 'archived';
  draft_id: string | null;
  draft_number: number | null;
  draft_actions: string | null;
  published_id: string | null;
  published_number: number | null;
  published_actions: string | null;
};

export class TagDefinitionError extends Error {
  constructor(
    public readonly code: 'not_found' | 'version_conflict' | 'automation_conflict' | 'folder_not_found',
    message: string,
  ) {
    super(message);
    this.name = 'TagDefinitionError';
  }
}

export function normalizeScopedTagName(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ja-JP');
}

function parseActions(raw: string | null): TagLinkedAction[] {
  if (!raw) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error('stored tag action config is invalid');
  return value as TagLinkedAction[];
}

function version(
  id: string | null,
  versionNumber: number | null,
  state: 'draft' | 'published',
  actions: string | null,
): TagAutomationVersion | null {
  if (!id || versionNumber === null) return null;
  return { id, versionNumber: Number(versionNumber), state, actions: parseActions(actions) };
}

async function getAutomation(
  db: D1Database,
  tagId: string,
  lineAccountId: string,
): Promise<TagAutomationDefinition | null> {
  const row = await db.prepare(
    `SELECT ca.id, ca.name, ca.status,
            dv.id AS draft_id, dv.version_number AS draft_number,
            dv.action_config AS draft_actions,
            pv.id AS published_id, pv.version_number AS published_number,
            pv.action_config AS published_actions
       FROM common_action_bindings b
       JOIN common_actions ca
         ON ca.id = b.common_action_id AND ca.line_account_id = b.line_account_id
       LEFT JOIN common_action_versions dv
         ON dv.id = ca.current_draft_version_id AND dv.common_action_id = ca.id
       LEFT JOIN common_action_versions pv
         ON pv.id = ca.current_published_version_id AND pv.common_action_id = ca.id
      WHERE b.line_account_id = ? AND b.consumer_type = 'tag'
        AND b.consumer_id = ? AND b.consumer_path = 'tag.added'
      ORDER BY ca.updated_at DESC, ca.id DESC
      LIMIT 1`,
  ).bind(lineAccountId, tagId).first<AutomationRow>();
  if (!row) return null;
  const draftVersion = version(row.draft_id, row.draft_number, 'draft', row.draft_actions);
  const publishedVersion = version(
    row.published_id,
    row.published_number,
    'published',
    row.published_actions,
  );
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    draftVersion,
    publishedVersion,
    actions: draftVersion?.actions ?? publishedVersion?.actions ?? [],
  };
}

export async function getTagDefinition(
  db: D1Database,
  tagId: string,
  lineAccountId: string,
): Promise<TagDefinitionDetail | null> {
  const tag = await db.prepare(
    `SELECT * FROM tags WHERE id = ? AND line_account_id = ?`,
  ).bind(tagId, lineAccountId).first<Tag>();
  if (!tag) return null;
  return { tag, automation: await getAutomation(db, tagId, lineAccountId) };
}

export type CreateTagDefinitionInput = {
  lineAccountId: string;
  name: string;
  description?: string | null;
  groupId?: string | null;
  isStarred?: boolean;
  manualAssignmentAllowed?: boolean;
  reapplyPolicy?: 'first_only' | 'every_time';
  linkedEnabled?: boolean;
  mileage: {
    self: number;
    referrer: number;
    multiplier: number | null;
    priority: number;
  };
  actions?: TagLinkedAction[];
  actorId?: string | null;
};

async function requireTagFolder(db: D1Database, groupId: string | null | undefined): Promise<void> {
  if (!groupId) return;
  const folder = await db.prepare(
    `SELECT id FROM folders WHERE id = ? AND kind = 'tag'`,
  ).bind(groupId).first<{ id: string }>();
  if (!folder) throw new TagDefinitionError('folder_not_found', 'タグのフォルダが見つかりません');
}

export async function createTagDefinition(
  db: D1Database,
  input: CreateTagDefinitionInput,
): Promise<TagDefinitionDetail> {
  await requireTagFolder(db, input.groupId);
  const tagId = crypto.randomUUID();
  const now = jstNow();
  const actions = input.actions ?? [];
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO tags
         (id, name, normalized_name, color, folder_id, line_account_id, description,
          is_starred, manual_assignment_allowed, reapply_policy, linked_enabled,
          mileage_reward, referral_mileage_reward, mileage_multiplier_bps,
          mileage_multiplier_priority, status, version, created_by, updated_by,
          created_at, updated_at)
       VALUES (?, ?, ?, '#3B82F6', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?, ?)`,
    ).bind(
      tagId,
      input.name,
      normalizeScopedTagName(input.name),
      input.groupId ?? null,
      input.lineAccountId,
      input.description ?? null,
      input.isStarred ? 1 : 0,
      input.manualAssignmentAllowed === false ? 0 : 1,
      input.reapplyPolicy ?? 'first_only',
      input.linkedEnabled ? 1 : 0,
      input.mileage.self,
      input.mileage.referrer,
      input.mileage.multiplier,
      input.mileage.priority,
      input.actorId ?? null,
      input.actorId ?? null,
      now,
      now,
    ),
  ];

  if (actions.length > 0) {
    const actionId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const bindingId = crypto.randomUUID();
    statements.push(
      db.prepare(
        `INSERT INTO common_actions
           (id, line_account_id, name, description, status, current_draft_version_id,
            created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
      ).bind(
        actionId,
        input.lineAccountId,
        `${input.name} が付いたとき`,
        `タグ「${input.name}」の連動アクション`,
        versionId,
        input.actorId ?? null,
        now,
        now,
      ),
      db.prepare(
        `INSERT INTO common_action_versions
           (id, common_action_id, version_number, status, action_config, created_by, created_at)
         VALUES (?, ?, 1, 'draft', ?, ?, ?)`,
      ).bind(versionId, actionId, JSON.stringify(actions), input.actorId ?? null, now),
      db.prepare(
        `INSERT INTO common_action_bindings
           (id, line_account_id, common_action_id, common_action_version_id,
            consumer_type, consumer_id, consumer_path, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'tag', ?, 'tag.added', ?, ?, ?)`,
      ).bind(
        bindingId,
        input.lineAccountId,
        actionId,
        versionId,
        tagId,
        input.actorId ?? null,
        now,
        now,
      ),
    );
  }

  await db.batch(statements);
  return (await getTagDefinition(db, tagId, input.lineAccountId))!;
}

export type UpdateTagDefinitionInput = {
  tagId: string;
  lineAccountId: string;
  expectedVersion: number;
  name?: string;
  description?: string | null;
  groupId?: string | null;
  isStarred?: boolean;
  manualAssignmentAllowed?: boolean;
  reapplyPolicy?: 'first_only' | 'every_time';
  linkedEnabled?: boolean;
  mileage?: CreateTagDefinitionInput['mileage'];
  automationId?: string | null;
  automationDraftVersion?: string | null;
  actions?: TagLinkedAction[];
  actorId?: string | null;
};

export async function updateTagDefinition(
  db: D1Database,
  input: UpdateTagDefinitionInput,
): Promise<TagDefinitionDetail> {
  const current = await getTagDefinition(db, input.tagId, input.lineAccountId);
  if (!current) throw new TagDefinitionError('not_found', 'タグが見つかりません');
  if (current.tag.version !== input.expectedVersion) {
    throw new TagDefinitionError('version_conflict', '別の人が先にタグを更新しました');
  }
  if (input.groupId !== undefined) await requireTagFolder(db, input.groupId);
  if (input.automationId !== undefined
    && input.automationId !== current.automation?.id
    && !(input.automationId === null && current.automation === null)) {
    throw new TagDefinitionError('automation_conflict', '連動アクションの保存先が変わりました');
  }
  if (input.actions !== undefined) {
    if (current.automation) {
      if (!current.automation.draftVersion
        || current.automation.draftVersion.id !== input.automationDraftVersion) {
        throw new TagDefinitionError('automation_conflict', '連動アクションの下書き版が変わりました');
      }
    } else if (input.automationDraftVersion !== undefined
      && input.automationDraftVersion !== null) {
      throw new TagDefinitionError('automation_conflict', '連動アクションの保存先が変わりました');
    }
  }

  const name = input.name ?? current.tag.name;
  const description = input.description === undefined ? current.tag.description : input.description;
  const groupId = input.groupId === undefined ? current.tag.folder_id : input.groupId;
  const isStarred = input.isStarred === undefined
    ? current.tag.is_starred === 1
    : input.isStarred;
  const manualAssignmentAllowed = input.manualAssignmentAllowed === undefined
    ? current.tag.manual_assignment_allowed === 1
    : input.manualAssignmentAllowed;
  const reapplyPolicy = input.reapplyPolicy ?? current.tag.reapply_policy;
  const linkedEnabled = input.linkedEnabled === undefined
    ? current.tag.linked_enabled === 1
    : input.linkedEnabled;
  const mileage = input.mileage ?? {
    self: Number(current.tag.mileage_reward),
    referrer: Number(current.tag.referral_mileage_reward),
    multiplier: current.tag.mileage_multiplier_bps === null
      ? null
      : Number(current.tag.mileage_multiplier_bps),
    priority: Number(current.tag.mileage_multiplier_priority),
  };
  const now = jstNow();
  const statements: D1PreparedStatement[] = [];
  const existingDraftId = current.automation?.draftVersion?.id ?? null;
  const actionGuard = input.actions === undefined || current.automation === null
    ? ''
    : ` AND EXISTS (
          SELECT 1 FROM common_actions ca
          JOIN common_action_bindings b ON b.common_action_id = ca.id
         WHERE ca.id = ? AND ca.line_account_id = tags.line_account_id
           AND ca.current_draft_version_id = ?
           AND b.consumer_type = 'tag' AND b.consumer_id = tags.id
           AND b.consumer_path = 'tag.added'
       )`;
  const updateBinds: unknown[] = [
    name,
    normalizeScopedTagName(name),
    description ?? null,
    groupId ?? null,
    isStarred ? 1 : 0,
    manualAssignmentAllowed ? 1 : 0,
    reapplyPolicy,
    linkedEnabled ? 1 : 0,
    mileage.self,
    mileage.referrer,
    mileage.multiplier,
    mileage.priority,
    input.actorId ?? null,
    now,
    input.tagId,
    input.lineAccountId,
    input.expectedVersion,
  ];
  if (actionGuard) updateBinds.push(current.automation!.id, existingDraftId);
  statements.push(db.prepare(
    `UPDATE tags SET
       name = ?, normalized_name = ?, description = ?, folder_id = ?, is_starred = ?,
       manual_assignment_allowed = ?, reapply_policy = ?, linked_enabled = ?,
       mileage_reward = ?, referral_mileage_reward = ?, mileage_multiplier_bps = ?,
       mileage_multiplier_priority = ?, updated_by = ?, updated_at = ?, version = version + 1
     WHERE id = ? AND line_account_id = ? AND version = ?${actionGuard}`,
  ).bind(...updateBinds));

  if (input.actions !== undefined && current.automation?.draftVersion) {
    statements.push(db.prepare(
      `UPDATE common_action_versions SET action_config = ?
        WHERE id = ? AND common_action_id = ? AND status = 'draft'
          AND EXISTS (
            SELECT 1 FROM tags t
             WHERE t.id = ? AND t.line_account_id = ? AND t.version = ?
          )`,
    ).bind(
      JSON.stringify(input.actions),
      current.automation.draftVersion.id,
      current.automation.id,
      input.tagId,
      input.lineAccountId,
      input.expectedVersion + 1,
    ));
    statements.push(db.prepare(
      `UPDATE common_actions SET name = ?, description = ?, updated_at = ?
        WHERE id = ? AND line_account_id = ?`,
    ).bind(
      `${name} が付いたとき`,
      `タグ「${name}」の連動アクション`,
      now,
      current.automation.id,
      input.lineAccountId,
    ));
  } else if (input.actions !== undefined && input.actions.length > 0 && !current.automation) {
    const actionId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    statements.push(
      db.prepare(
        `INSERT INTO common_actions
           (id, line_account_id, name, description, status, current_draft_version_id,
            created_by, created_at, updated_at)
         SELECT ?, ?, ?, ?, 'draft', ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM tags WHERE id = ? AND line_account_id = ? AND version = ?
          )`,
      ).bind(
        actionId,
        input.lineAccountId,
        `${name} が付いたとき`,
        `タグ「${name}」の連動アクション`,
        versionId,
        input.actorId ?? null,
        now,
        now,
        input.tagId,
        input.lineAccountId,
        input.expectedVersion + 1,
      ),
      db.prepare(
        `INSERT INTO common_action_versions
           (id, common_action_id, version_number, status, action_config, created_by, created_at)
         SELECT ?, ?, 1, 'draft', ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM common_actions WHERE id = ? AND line_account_id = ?)`,
      ).bind(
        versionId,
        actionId,
        JSON.stringify(input.actions),
        input.actorId ?? null,
        now,
        actionId,
        input.lineAccountId,
      ),
      db.prepare(
        `INSERT INTO common_action_bindings
           (id, line_account_id, common_action_id, common_action_version_id,
            consumer_type, consumer_id, consumer_path, created_by, created_at, updated_at)
         SELECT ?, ?, ?, ?, 'tag', ?, 'tag.added', ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM common_action_versions WHERE id = ?)`,
      ).bind(
        crypto.randomUUID(),
        input.lineAccountId,
        actionId,
        versionId,
        input.tagId,
        input.actorId ?? null,
        now,
        now,
        versionId,
      ),
    );
  } else if (input.name !== undefined && current.automation) {
    statements.push(db.prepare(
      `UPDATE common_actions SET name = ?, description = ?, updated_at = ?
        WHERE id = ? AND line_account_id = ?`,
    ).bind(
      `${name} が付いたとき`,
      `タグ「${name}」の連動アクション`,
      now,
      current.automation.id,
      input.lineAccountId,
    ));
  }

  const results = await db.batch(statements);
  if ((results[0]?.meta?.changes ?? 0) !== 1) {
    throw new TagDefinitionError('version_conflict', '別の人が先にタグを更新しました');
  }
  return (await getTagDefinition(db, input.tagId, input.lineAccountId))!;
}

const REFERENCE_META: Record<keyof TagDeleteImpactReferences, { kind: string; name: string; href: string }> = {
  broadcasts: { kind: 'broadcast', name: '一斉配信', href: '/broadcasts' },
  forms: { kind: 'form', name: '回答フォーム', href: '/form-submissions' },
  scenarios: { kind: 'scenario', name: 'シナリオ', href: '/scenarios' },
  autoReplies: { kind: 'auto_reply', name: '自動応答', href: '/auto-replies' },
  savedSearches: { kind: 'saved_search', name: '保存した検索', href: '/tags?tab=searches' },
  automations: { kind: 'automation', name: 'オートメーション', href: '/automations' },
  commonActions: { kind: 'common_action', name: '共通アクション', href: '/automations/actions' },
  richMenus: { kind: 'rich_menu', name: 'リッチメニュー', href: '/rich-menus' },
  templates: { kind: 'template', name: 'テンプレート', href: '/templates' },
  webinars: { kind: 'webinar', name: 'ウェビナー', href: '/webinars' },
  reminders: { kind: 'reminder', name: 'リマインダ', href: '/reminders' },
  entryRoutes: { kind: 'entry_route', name: '流入リンク', href: '/entry-routes' },
  trackedLinks: { kind: 'tracked_link', name: '計測リンク', href: '/tracked-links' },
  bookingMenus: { kind: 'booking', name: '予約', href: '/booking-settings' },
  affiliateOffers: { kind: 'affiliate', name: 'アフィリエイト', href: '/affiliates' },
  events: { kind: 'event', name: 'イベント', href: '/events' },
  analyticsFunnels: { kind: 'analytics', name: '分析', href: '/analytics' },
  friendAddSettings: { kind: 'friend_add', name: '友だち追加時の配信', href: '/friend-add' },
};

export type ScopedTagDeleteImpact = Awaited<ReturnType<typeof getScopedTagDeleteImpact>>;

export async function getScopedTagDeleteImpact(
  db: D1Database,
  tagId: string,
  lineAccountId: string,
) {
  const detail = await getTagDefinition(db, tagId, lineAccountId);
  if (!detail) return null;
  const impact = await getTagDeleteImpact(db, tagId);
  if (!impact) return null;
  const referenceItems = (Object.entries(impact.references) as Array<[
    keyof TagDeleteImpactReferences,
    number,
  ]>)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => ({
      ...REFERENCE_META[key],
      count,
      state: 'active' as const,
      definitionVersion: null,
    }));
  const automation = detail.automation;
  const linkedActions = [
    ...(automation?.publishedVersion ? [{
      kind: 'common_action',
      name: automation.name,
      version: automation.publishedVersion.versionNumber,
      state: 'published' as const,
    }] : []),
    ...(automation?.draftVersion ? [{
      kind: 'common_action',
      name: automation.name,
      version: automation.draftVersion.versionNumber,
      state: 'draft' as const,
    }] : []),
  ];
  const pending = automation ? await db.prepare(
    `SELECT COUNT(DISTINCT s.automation_run_id) AS count
       FROM automation_run_steps s
      WHERE s.common_action_version_id IN (
        SELECT v.id FROM common_action_versions v WHERE v.common_action_id = ?
      ) AND s.status IN ('queued', 'running', 'waiting')`,
  ).bind(automation.id).first<{ count: number }>() : null;
  const mileageConfigured = Number(detail.tag.mileage_reward) > 0
    || Number(detail.tag.referral_mileage_reward) > 0
    || detail.tag.mileage_multiplier_bps !== null;
  const hasHistoryOrUse = impact.friendCount > 0
    || impact.blockingReferenceCount > 0
    || linkedActions.length > 0
    || mileageConfigured;
  return {
    tag: {
      id: detail.tag.id,
      name: detail.tag.name,
      version: Number(detail.tag.version),
      status: detail.tag.status,
    },
    friendCount: impact.friendCount,
    // 旧画面との互換用。新画面は referenceItems を使用する。
    references: impact.references,
    referenceItems,
    linkedActions,
    pendingRunCount: Number(pending?.count ?? 0),
    mileageImpact: {
      configured: mileageConfigured,
      self: Number(detail.tag.mileage_reward),
      referrer: Number(detail.tag.referral_mileage_reward),
      multiplier: detail.tag.mileage_multiplier_bps === null
        ? null
        : Number(detail.tag.mileage_multiplier_bps),
      priority: Number(detail.tag.mileage_multiplier_priority),
      reapplyPolicy: detail.tag.reapply_policy,
      historyPreserved: true,
    },
    blockingReferenceCount: impact.blockingReferenceCount,
    canArchive: detail.tag.status === 'active',
    canDelete: !hasHistoryOrUse,
    checkedAt: new Date().toISOString(),
    revision: `tag:${detail.tag.id}:v${detail.tag.version}:${detail.tag.updated_at ?? detail.tag.created_at}`,
  };
}

export class TagArchiveError extends Error {
  constructor(public readonly code: 'not_found' | 'version_conflict' | 'impact_changed' | 'replacement_not_found') {
    super(code);
  }
}

/** 履歴と現在の付与を残したまま、新規利用だけを止める。 */
export async function archiveTag(
  db: D1Database,
  input: {
    tagId: string;
    lineAccountId: string;
    expectedVersion: number;
    impactRevision: string;
    replacementTagId?: string | null;
    actorId?: string | null;
  },
): Promise<{ archived: true; replacedFriendCount: number }> {
  const tag = await db.prepare(
    `SELECT * FROM tags WHERE id = ? AND line_account_id = ?`,
  ).bind(input.tagId, input.lineAccountId).first<Tag>();
  if (!tag) throw new TagArchiveError('not_found');
  if (Number(tag.version) !== input.expectedVersion) throw new TagArchiveError('version_conflict');
  const impact = await getScopedTagDeleteImpact(db, input.tagId, input.lineAccountId);
  if (!impact) throw new TagArchiveError('not_found');
  if (impact.revision !== input.impactRevision) throw new TagArchiveError('impact_changed');
  if (input.replacementTagId) {
    const replacement = await db.prepare(
      `SELECT id FROM tags WHERE id = ? AND line_account_id = ? AND status = 'active'`,
    ).bind(input.replacementTagId, input.lineAccountId).first<{ id: string }>();
    if (!replacement || replacement.id === input.tagId) throw new TagArchiveError('replacement_not_found');
  }
  const now = jstNow();
  const statements: D1PreparedStatement[] = [];
  if (input.replacementTagId) {
    statements.push(db.prepare(
      `INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
       SELECT friend_id, ?, ? FROM friend_tags WHERE tag_id = ?`,
    ).bind(input.replacementTagId, now, input.tagId));
    statements.push(db.prepare(`DELETE FROM friend_tags WHERE tag_id = ?`).bind(input.tagId));
  }
  statements.push(db.prepare(
    `UPDATE tags SET status = 'archived', version = version + 1,
       updated_by = ?, updated_at = ?
     WHERE id = ? AND line_account_id = ? AND version = ?`,
  ).bind(input.actorId ?? null, now, input.tagId, input.lineAccountId, input.expectedVersion));
  statements.push(db.prepare(
    `INSERT INTO operation_audit
       (id, target_kind, target_id, action, actor_id, detail_json, created_at)
     VALUES (?, 'tag', ?, 'archived', ?, ?, ?)`,
  ).bind(crypto.randomUUID(), input.tagId, input.actorId ?? null, JSON.stringify({
    replacementTagId: input.replacementTagId ?? null,
    friendCount: impact.friendCount,
    historyPreserved: true,
  }), now));
  await db.batch(statements);
  return { archived: true, replacedFriendCount: input.replacementTagId ? impact.friendCount : 0 };
}
