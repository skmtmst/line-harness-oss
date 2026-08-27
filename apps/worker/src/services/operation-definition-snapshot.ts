import type { OperationCapability } from '@line-crm/db';

export type OperationDefinitionState = {
  key: string;
  capability: OperationCapability;
  kind: string;
  id: string;
  name: string;
  active: boolean;
  fingerprint: string;
};

export type OperationDefinitionSnapshot = {
  version: 1;
  capturedAt: string;
  definitions: OperationDefinitionState[];
};

export type OperationDefinitionDriftKind = 'deleted' | 'disabled' | 'edited' | 'enabled' | 'added';

export type OperationDefinitionDrift = {
  key: string;
  capability: OperationCapability;
  kind: string;
  id: string;
  name: string;
  change: OperationDefinitionDriftKind;
};

type Row = Record<string, unknown>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Row)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function rows(db: D1Database, sql: string, bindings: unknown[] = []): Promise<Row[]> {
  const result = await db.prepare(sql).bind(...bindings).all<Row>();
  return result.results ?? [];
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function accountWhere(accountId: string | null, alias = ''): { clause: string; bindings: unknown[] } {
  return accountId
    ? { clause: ` WHERE ${alias}line_account_id = ?`, bindings: [accountId] }
    : { clause: '', bindings: [] };
}

async function statesFromRows(
  capability: OperationCapability,
  kind: string,
  source: Row[],
  active: (row: Row) => boolean,
  payload: (row: Row) => unknown,
): Promise<OperationDefinitionState[]> {
  return Promise.all(source.map(async (row) => {
    const id = String(row.id);
    return {
      key: `${kind}:${id}`,
      capability,
      kind,
      id,
      name: text(row.name ?? row.title ?? row.display_name ?? row.keyword, id),
      active: active(row),
      fingerprint: await sha256(payload(row)),
    };
  }));
}

export async function captureOperationDefinitionSnapshot(
  db: D1Database,
  input: { lineAccountId: string | null; capabilities: OperationCapability[]; now?: Date },
): Promise<OperationDefinitionSnapshot> {
  const definitions: OperationDefinitionState[] = [];
  const includes = (capability: OperationCapability) => input.capabilities.includes(capability);

  if (includes('broadcast_dispatch')) {
    const scope = accountWhere(input.lineAccountId);
    const source = await rows(db,
      `SELECT id, title, message_type, message_content, target_type, target_tag_id, status,
              scheduled_at, segment_conditions, account_ids, dedup_priority, track_links, line_account_id
         FROM broadcasts${scope.clause}`,
      scope.bindings,
    );
    definitions.push(...await statesFromRows('broadcast_dispatch', 'broadcast', source,
      (row) => ['scheduled', 'sending', 'queued'].includes(String(row.status)),
      (row) => ({ ...row, status: undefined }),
    ));
  }

  if (includes('scenario_dispatch')) {
    const scope = accountWhere(input.lineAccountId, 's.');
    const parents = await rows(db,
      `SELECT s.id, s.name, s.description, s.trigger_type, s.trigger_tag_id, s.is_active,
              s.delivery_mode, s.line_account_id
         FROM scenarios s${scope.clause}`,
      scope.bindings,
    );
    const steps = await rows(db,
      `SELECT ss.id, ss.scenario_id, ss.step_order, ss.delay_minutes, ss.message_type, ss.message_content,
              ss.message_bubbles_json, ss.offset_days, ss.offset_minutes, ss.delivery_time,
              ss.template_id, ss.on_reach_tag_id
         FROM scenario_steps ss JOIN scenarios s ON s.id = ss.scenario_id${scope.clause}
        ORDER BY ss.scenario_id, ss.step_order, ss.id`,
      scope.bindings,
    );
    definitions.push(...await statesFromRows('scenario_dispatch', 'scenario', parents,
      (row) => Number(row.is_active) === 1,
      (row) => ({ ...row, is_active: undefined, steps: steps.filter((step) => step.scenario_id === row.id) }),
    ));
  }

  if (includes('reminder_dispatch')) {
    const scope = accountWhere(input.lineAccountId, 'r.');
    const parents = await rows(db,
      `SELECT r.id, r.name, r.description, r.is_active, r.delivery_mode, r.trigger_field_id,
              r.repeat_yearly, r.line_account_id
         FROM reminders r${scope.clause}`,
      scope.bindings,
    );
    const steps = await rows(db,
      `SELECT rs.id, rs.reminder_id, rs.offset_minutes, rs.message_type, rs.message_content,
              rs.offset_days, rs.send_at_time, rs.template_id
         FROM reminder_steps rs JOIN reminders r ON r.id = rs.reminder_id${scope.clause}
        ORDER BY rs.reminder_id, rs.offset_minutes, rs.id`,
      scope.bindings,
    );
    definitions.push(...await statesFromRows('reminder_dispatch', 'reminder', parents,
      (row) => Number(row.is_active) === 1,
      (row) => ({ ...row, is_active: undefined, steps: steps.filter((step) => step.reminder_id === row.id) }),
    ));
  }

  if (includes('automation_actions')) {
    const scope = accountWhere(input.lineAccountId, 'd.');
    const parents = await rows(db,
      `SELECT d.id, d.name, d.description, d.status, d.priority, d.current_published_version_id,
              d.line_account_id, v.version_number, v.trigger_type, v.trigger_config,
              v.condition_config, v.action_config
         FROM automation_definitions d
         LEFT JOIN automation_versions v ON v.id = d.current_published_version_id${scope.clause}`,
      scope.bindings,
    );
    definitions.push(...await statesFromRows('automation_actions', 'automation', parents,
      (row) => row.status === 'active',
      (row) => ({ ...row, status: undefined }),
    ));
  }

  if (includes('auto_reply_dispatch')) {
    const scope = accountWhere(input.lineAccountId);
    const source = await rows(db,
      `SELECT id, name, keyword, keywords_json, keyword_match_mode, match_type, response_type,
              response_content, template_id, line_account_id, is_active, actions_json,
              response_weekdays_json, response_holiday_rule, once_per_friend, respond_to_all
         FROM auto_replies${scope.clause}`,
      scope.bindings,
    );
    definitions.push(...await statesFromRows('auto_reply_dispatch', 'auto_reply', source,
      (row) => Number(row.is_active) === 1,
      (row) => ({ ...row, is_active: undefined }),
    ));
  }

  if (includes('webhook_outgoing')) {
    const source = await rows(db,
      `SELECT id, name, url, event_types, secret, is_active FROM outgoing_webhooks`,
    );
    definitions.push(...await statesFromRows('webhook_outgoing', 'outgoing_webhook', source,
      (row) => Number(row.is_active) === 1,
      // URLとsecretは保存せず、ほかの項目と合わせたハッシュだけを残す。
      (row) => ({ ...row, is_active: undefined }),
    ));
  }

  if (includes('ad_postback')) {
    const source = await rows(db,
      `SELECT id, name, display_name, config, is_active FROM ad_platforms`,
    );
    definitions.push(...await statesFromRows('ad_postback', 'ad_platform', source,
      (row) => Number(row.is_active) === 1,
      // configの認証情報は保存せず、変更検知用ハッシュだけを残す。
      (row) => ({ ...row, is_active: undefined }),
    ));
  }

  return {
    version: 1,
    capturedAt: (input.now ?? new Date()).toISOString(),
    definitions: definitions.sort((a, b) => a.key.localeCompare(b.key)),
  };
}

export function isOperationDefinitionSnapshot(value: unknown): value is OperationDefinitionSnapshot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<OperationDefinitionSnapshot>;
  return candidate.version === 1 && Array.isArray(candidate.definitions)
    && candidate.definitions.every((item) => item && typeof item.key === 'string'
      && typeof item.fingerprint === 'string' && typeof item.active === 'boolean');
}

export function compareOperationDefinitionSnapshots(
  before: OperationDefinitionSnapshot,
  current: OperationDefinitionSnapshot,
): OperationDefinitionDrift[] {
  const beforeByKey = new Map(before.definitions.map((item) => [item.key, item]));
  const currentByKey = new Map(current.definitions.map((item) => [item.key, item]));
  const drift: OperationDefinitionDrift[] = [];
  for (const baseline of before.definitions) {
    const now = currentByKey.get(baseline.key);
    if (!now) {
      if (baseline.active) drift.push({ ...baseline, change: 'deleted' });
      continue;
    }
    if (baseline.active && !now.active) drift.push({ ...baseline, name: now.name, change: 'disabled' });
    else if (!baseline.active && now.active) drift.push({ ...baseline, name: now.name, change: 'enabled' });
    else if (baseline.active && baseline.fingerprint !== now.fingerprint) {
      drift.push({ ...baseline, name: now.name, change: 'edited' });
    }
  }
  for (const now of current.definitions) {
    if (now.active && !beforeByKey.has(now.key)) drift.push({ ...now, change: 'added' });
  }
  return drift.sort((a, b) => a.key.localeCompare(b.key));
}

export async function operationRestorePreviewHash(input: {
  incidentId: string;
  controlVersion: number;
  current: OperationDefinitionSnapshot;
  drift: OperationDefinitionDrift[];
}): Promise<string> {
  return sha256({
    incidentId: input.incidentId,
    controlVersion: input.controlVersion,
    definitions: input.current.definitions,
    drift: input.drift,
  });
}
